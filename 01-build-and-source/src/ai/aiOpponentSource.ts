import { SLOW_DAMAGE_MULT } from "../core/battle";
import type {
  OpponentSource,
  OpponentUpdate,
  OpponentSnapshot,
} from "../core/battle";
import { createCastQueue, type CastQueue } from "../core/castQueue";
import { createCooldownTracker, type CooldownTracker } from "../core/cooldown";
import { createRng, type Rng } from "../core/rng";
import { autoAttackDamage, sumTeamRawDamage, type MemberDamage } from "../core/team";
import { interferenceMagnitude } from "../core/types";
import type { InterferenceEvent, SkillDef } from "../core/types";
import type { CharacterLoadout } from "../loadout/types";
import { decideNextAction } from "./decision";
import { DEFAULT_STRATEGY, sanitizeStrategy, type AiStrategy } from "./strategy";

export interface AiOpponentConfig {
  seed: number;
  teamSize: number;
  characters: readonly CharacterLoadout[];
  skills: readonly SkillDef[];
  strategy?: AiStrategy;
  /**
   * AI 딜 배율 (기본 {@link DEFAULT_AI_DAMAGE_SCALE}).
   * AI는 쿨다운을 사람보다 정확하게 소비하므로 1.0이면 사람이 스킬을 완벽히
   * 써도 게이지가 거의 안 밀린다 — 난이도는 이 스칼라 하나로만 조절한다.
   */
  damageScale?: number;
}

/**
 * 기본 난이도. 난이도를 바꿀 때는 스킬·스탯이 아니라 이 스칼라만 만진다.
 *
 * **이 스칼라로 "AI가 약하다"를 고치지 않는다.** 방치가 이기던 결함의 원인은 딜
 * 배율이 아니라 아래 `members`의 인원수였다(그 결정 기록 참조) — 배율만 올려
 * 덮으면 자동 공격까지 같이 부풀어서, 스킬을 써도 못 이기는 판이 된다.
 *
 * ── 왜 1.0이 아니라 0.65인가 (2026-08-06)
 *
 * 1.0은 **인원 결함을 안고 맞춘 값**이었다. 상대가 인원수만큼 시전하게 되자 같은
 * 1.0에서 완벽 조작조차 120초 판정까지 끌려갔다(12시드 전부, 게이지 0.25~0.49) —
 * 이기지만 결판을 못 내는 판이다. 인원을 고친 뒤 12시드 실측으로 다시 잡았다:
 *
 * ```
 *          쿨마다 조작              방치
 * 0.60  승12/12 임계결판 50~66s   패12/12 g -0.53~-0.12  (판정까지 갔지만 여유가 큼)
 * 0.65  승12/12 임계결판 55~76s   패12/12 g -0.75~-0.32  ← 채택
 * 0.70  승12/12 임계결판 63~88s   패 12/12, 3판은 105s에 임계 패배
 * 1.00  승12/12 판정 120s          패12/12 (56~60s에 임계 패배)
 * ```
 *
 * 0.65를 고른 기준은 승률이 아니라 **양쪽 끝이 다 살아 있는가**다: 조작은 임계치로
 * 결판(12/12)하고, 방치는 임계치까지 밀리지 않고 120초 판정으로 진다 — 밀린 상태에서
 * 되돌릴 시간이 남아 있다는 뜻이다. 0.70은 그 되돌릴 구간이 사라지기 시작하고
 * (105초 임계 패배), 0.60은 방치의 벌이 게이지 -0.12까지 얕아진다.
 */
export const DEFAULT_AI_DAMAGE_SCALE = 0.65;

/**
 * AI 한 명이 결정을 재검토하는 주기.
 *
 * **`pvp/session.ts`의 `TEAMMATE_DECISION_MS`와 같은 값이어야 한다** — 상대 팀은
 * 내 팀원과 같은 정책으로 도는 거울이고, 그래야 "내가 손으로 누르는 것"만이
 * 두 팀의 유일한 차이가 된다. 여기만 400이면 상대가 인원당 25% 더 자주 판단해서
 * 조작으로 벌 수 있는 몫을 그만큼 먹는다.
 */
const DECISION_INTERVAL_MS = 500;

/** AI 팀 한 명 — 쿨다운·난수·판단 시계를 각자 갖는다 */
interface AiMember {
  readonly memberId: string;
  readonly cooldowns: CooldownTracker;
  readonly rng: Rng;
  nextDecisionMs: number;
}

/**
 * AI 상대. 자동 공격 딜 + 스킬 시전을 OpponentUpdate 스키마로 변환한다.
 * Battle 입장에서는 FakeOpponentSource·AppSyncOpponentSource와 구분되지 않는다.
 */
export class AIOpponentSource implements OpponentSource {
  /**
   * 상대 팀 **각자**. 인원수만큼 있어야 대칭이다.
   *
   * ── 2026-08-06 결정 기록 (디렉터 플레이 리뷰에서 잡힌 결함)
   *
   * 예전에는 추적기·난수가 팀에 하나였다. `teamSize`를 받으면서도 자동 공격
   * (`autoAttackDamage`)에만 쓰고 스킬 시전에는 쓰지 않았다. 그래서 2인 팀에서
   * 내 팀은 추적기 2개(나 + 팀원)로 120초에 224회 시전하고, 상대는 1개로 105회만
   * 시전했다 — **2.13배**다. 결과: 입력을 한 번도 하지 않아도 30시드 전승
   * (최종 게이지 최소 +0.097). 대전에 패배가 존재하지 않았다.
   *
   * 왜 이걸 딜 배율(`damageScale`)로 덮지 않았나: 그 스칼라는 자동 공격까지
   * 곱해서, 방치를 지게 만들려면 조작해도 못 이기는 값이 된다. 없던 것은 딜이
   * 아니라 **상대 팀원의 스킬**이었으므로 그것을 세운다. 격리 실험(추적기 수만
   * 바꿈): 1개 → 방치 승 20/20, 2개 → 방치 패 20/20 · 조작 승 20/20.
   *
   * 회귀는 `tests/pacing.test.ts`가 잡는다 — 그 테스트가 통과하고 있었던 이유는
   * 방치 판정에서 `Math.abs(gauge)`로 **부호를 지웠기** 때문이다(같이 고쳤다).
   */
  private readonly members: readonly AiMember[];
  /** 우리 팀(session)과 같은 구현 — 스킬 딜 곡선을 대칭으로 유지한다 */
  private readonly casts: CastQueue = createCastQueue();
  private readonly cfg: AiOpponentConfig;
  private strategy: AiStrategy;
  private lastPollMs = 0;
  private eventSeq = 0;
  private buffUntilMs = 0;
  private buffMult = 1;
  private slowUntilMs = 0;
  /** 이 시각까지 이 팀은 실명 — 새 스킬을 시전하지 못한다 (`receiveInterference`) */
  private blindUntilMs = 0;
  private readonly damageScale: number;

  constructor(cfg: AiOpponentConfig) {
    this.cfg = cfg;
    const n = Math.max(1, Math.floor(cfg.teamSize));
    this.members = Array.from({ length: n }, (_, i) => ({
      // 자동 공격이 쓰는 캐릭터 순서와 같게 — 시전자 라벨이 어긋나지 않는다
      memberId: cfg.characters[i]?.memberId ?? `ai${i}`,
      cooldowns: createCooldownTracker(cfg.skills),
      // 사람 팀과 겹치지 않는 파생 seed. 멤버끼리도 갈라야 같은 판단을 복제하지
      // 않는다 — 같은 난수면 둘이 늘 같은 스킬을 동시에 눌러 한 명이나 같다
      rng: createRng((cfg.seed ^ 0x5f3759df) + i * 7919),
      nextDecisionMs: 0,
    }));
    this.strategy = sanitizeStrategy(cfg.strategy ?? DEFAULT_STRATEGY);
    const scale = cfg.damageScale;
    this.damageScale =
      scale !== undefined && scale > 0 ? scale : DEFAULT_AI_DAMAGE_SCALE;
  }

  /** Bedrock(Plan 2)이 전략만 교체할 때 쓴다. */
  setStrategy(s: AiStrategy): void {
    this.strategy = sanitizeStrategy(s);
  }

  /**
   * 우리가 쏜 방해를 AI에게도 먹인다. 이게 없으면 방해가 한 방향으로만
   * 작동해서(AI의 slow만 유효) AI가 구조적으로 유리해진다 — 사람 대전에서는
   * 양쪽 Battle이 서로의 이벤트를 받으므로 대칭인데, AI전만 어긋나 있었다.
   */
  receiveInterference(kind: InterferenceEvent["kind"], magnitude: number, nowMs: number): void {
    if (kind === "slow") {
      this.slowUntilMs = Math.max(this.slowUntilMs, nowMs + magnitude);
    } else if (kind === "blind") {
      /**
       * 실명은 **시전을 막는다** (`BattleState.blindUntilMs`의 결정 기록).
       *
       * 이 거울이 없으면 실명은 내 팀에만 걸린다 — 내가 쏜 방해가 나만 아프게
       * 하는 것이므로 방해 칸 두 개 중 하나가 "누르면 손해"가 된다. AI전에서
       * `blind`가 아무 효과도 없던 결함(스펙 §13-6)을 여기서 닫는다.
       */
      this.blindUntilMs = Math.max(this.blindUntilMs, nowMs + magnitude);
    } else if (kind === "gauge_drain") {
      // 게이지는 코어가 소유한다 — 이 소스는 딜만 만들므로 무시한다
    }
    // spawn_adds 는 연출 전용 (설계 스펙 §2-2)
  }

  poll(nowMs: number): OpponentUpdate {
    const dtMs = Math.max(0, nowMs - this.lastPollMs);
    this.lastPollMs = nowMs;

    // 1) 자동 공격 딜 + 이전에 시전한 스킬의 이번 틱 몫.
    //    분산 적립까지 우리 팀과 같은 구현을 쓴다 (한 틱 스파이크 금지)
    //    인원은 `teamSize`가 정본이다 — 내 팀도 `slice(0, teamSize)`로 센다
    //    (`pvp/session.step`). 캐릭터 목록이 팀보다 길 때 조용히 갈라지지 않게.
    const members: MemberDamage[] = [
      ...autoAttackDamage(this.cfg.characters.slice(0, this.members.length), dtMs),
      ...this.casts.drain(dtMs),
    ];
    const buff = nowMs < this.buffUntilMs ? this.buffMult : 1;
    // 우리가 건 감속 — 코어가 우리 팀에 쓰는 배율과 같은 상수를 쓴다
    const slow = nowMs <= this.slowUntilMs ? SLOW_DAMAGE_MULT : 1;
    let rawDamage = sumTeamRawDamage(members) * buff * slow * this.damageScale;

    // 2) 결정 주기마다 **멤버마다** 스킬 1회 시도.
    //    내 팀(session.step)의 팀원 루프와 같은 모양이다 — 인원이 늘면 시전도
    //    같은 비율로 늘어야 한다
    const events: InterferenceEvent[] = [];
    /**
     * 실명 중에는 **판단 자체를 미룬다** — 쿨다운을 태우고 넘기면 실명이
     * 시전을 미루는 것이 아니라 영구히 빼앗는 것이 되어, 내 팀이 받는 실명
     * (`pvp/session`은 눌러도 `trigger`하지 않는다)과 비대칭이 된다.
     */
    // `>`다 — `<=`면 판 첫 poll(둘 다 0)에서 상대가 한 번 판단을 건너뛴다
    const blinded = this.blindUntilMs > nowMs;
    for (const m of this.members) {
      if (blinded) continue;
      if (nowMs < m.nextDecisionMs) continue;
      m.nextDecisionMs = nowMs + DECISION_INTERVAL_MS;
      const action = decideNextAction(
        {
          elapsedMs: nowMs,
          // 이 소스는 게이지를 모른다 — Battle이 주지 않으므로 중립으로 둔다.
          // Plan 2에서 Bedrock 전략이 실제 게이지를 반영한다.
          gaugePos: 0,
          readySkills: m.cooldowns.readySkills(nowMs),
        },
        this.strategy,
        m.rng,
      );
      if (action.type !== "cast") continue;
      const skill = action.skill;
      m.cooldowns.trigger(skill.id, nowMs);
      if (skill.kind === "attack") {
        // 즉시 더하지 않는다 — 큐에 넣어 SKILL_SPREAD_MS 동안 나눠 낸다
        this.casts.push(m.memberId, skill.power);
      } else if (skill.kind === "buff") {
        // 우리 팀과 동일 — 지속시간 동안 딜 배수 (한 틱만 증폭하면 안 된다)
        this.buffUntilMs = Math.max(
          this.buffUntilMs,
          nowMs + (skill.durationMs ?? 0),
        );
        this.buffMult = skill.power;
      } else if (skill.interferenceKind) {
        events.push({
          eventId: `ai-${this.cfg.seed}-${this.eventSeq++}`,
          kind: skill.interferenceKind,
          fromTeam: 1,
          atMs: nowMs,
          // 지속형(slow·blind)은 ms, 즉발형은 세기 — 규칙은 코어가 갖는다
          magnitude: interferenceMagnitude(skill),
        });
      }
    }

    // windowMs = 이 poll이 덮은 구간. 사람 상대(200ms 배치)와 같은 단위로
    // 비교되게 하려면 반드시 붙여야 한다.
    const snapshot: OpponentSnapshot = {
      rawDamage,
      atMs: nowMs,
      windowMs: dtMs,
    };
    return { snapshot, events };
  }
}
