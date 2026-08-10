import { expect, test } from "vitest";
import { Battle, DEFAULT_TIME_LIMIT_MS } from "../src/core/battle";
import { DEFAULT_WIN_THRESHOLD } from "../src/core/gauge";
import { createCastQueue } from "../src/core/castQueue";
import { createCooldownTracker } from "../src/core/cooldown";
import { createRng } from "../src/core/rng";
import { autoAttackDamage } from "../src/core/team";
import { createWaveRunner } from "../src/core/waveRunner";
import { AIOpponentSource } from "../src/ai/aiOpponentSource";
import { decideNextAction } from "../src/ai/decision";
import { DEFAULT_STRATEGY } from "../src/ai/strategy";
import { PresetLoadoutProvider } from "../src/loadout/preset";
import { interferenceMagnitude } from "../src/core/types";
import type { SkillDef } from "../src/core/types";
import { ADV_TOTAL_MS } from "../src/shared/advanceRules";
import { TEAM_DPS_REF, waveTotalHp } from "../src/core/waves";
import { AUTO_INTERVAL_MS } from "../src/shared/skillBarRules";
import { pickAutoSkill } from "../src/shared/skillRules";
import { myAutoDamage } from "../src/pvp/sessionRules";

/**
 * 밸런스 회귀 테스트. GAUGE_RATE·AI 난이도·스킬 수치를 만지면 여기가 먼저 깨진다.
 * 핵심 계약: **손을 쓰면 결판을 내고, 방치하면 진다.**
 * 방치로도 이기면 스킬 UI가 장식이 되고, 손을 써도 못 이기면 조작이 무의미하다.
 *
 * session.ts와 같은 모델로 돌린다 — 팀원(AI)은 500ms마다 판단하고,
 * 플레이어의 **조작 방식**이 갈린다(`PlayMode`).
 */
const STEP_MS = 1000 / 60;
const TEAM_SIZE = 2;
const TEAMMATE_DECISION_MS = 500;
const SEEDS = [3, 7, 11, 42];

/**
 * 플레이어가 판을 어떻게 치르는가. **세 갈래가 다 필요하다** (2026-08-10).
 *
 * 예전에는 `playerActs: boolean` 하나였고 `true`가 곧 난사였다 — 매 프레임
 * `readySkills`를 전부 지른다. 그래서 이 파일은 **AUTO 경로를 한 번도 밟지
 * 않았다**: 배지를 켜면 시전은 `AUTO_INTERVAL_MS`(680ms) 박자로 나가고 자동
 * 공격 딜이 살아 있는데, 그 조합의 페이싱은 여기 어느 계약에도 걸리지 않았다.
 * 유저가 그 차이를 신고하고 나서야("AUTO로 하면 pvp 너무 빨리 끝나고") 두 경로가
 * 다른 속도라는 것이 드러났다 — 실제로는 AUTO가 **느린** 쪽이다.
 *
 * - `"auto"`: 배지 ON. 자동 공격 딜 + 680ms 박자 시전.
 * - `"spam"`: 배지 OFF + 손으로 난사. **내 자동 공격은 꺼진다**(`myAutoDamage`).
 * - `"idle"`: 배지 OFF + 입력 0회. 내 캐릭터는 아무것도 하지 않는다.
 */
type PlayMode = "auto" | "spam" | "idle";

interface Outcome {
  winner: 0 | 1 | null;
  elapsedSec: number;
  gauge: number;
  /** 층 하나에 걸린 시간(ms) 목록 — 하강 페이스다 */
  floorMs: number[];
  /** 판이 끝났을 때의 층 (1-based) */
  depth: number;
  /**
   * 판의 **여는 딜** — 전진 연출 길이(`ADV_TOTAL_MS`) 동안의 팀 합산 실딜.
   *
   * catchup의 진짜 입력이 이 값이다. `waves.test.ts`는 이 하한을 평균 dps
   * (`TEAM_DPS_REF` 520)로 모델링하는데, 첫 프레임에는 쿨다운이 전부 준비돼
   * 있어서 실제 폭이 그 4배다 — 그래서 그 검사는 6번째 칸이 1층을 383ms에
   * 녹이는 것을 통과시켰다. 여기서 시뮬레이션 실측으로 다시 잡는다.
   */
  openingDamage: number;
}

/**
 * @param mode 플레이어의 조작 방식 (`PlayMode`). `true`/`false`도 받는다 —
 *   각각 `"spam"`/`"idle"`이다(앞선 회차의 호출 형태).
 */
function simulate(seed: number, mode: PlayMode | boolean): Outcome {
  const play: PlayMode =
    typeof mode === "boolean" ? (mode ? "spam" : "idle") : mode;
  const loadout = new PresetLoadoutProvider().load(TEAM_SIZE);
  const ai = new AIOpponentSource({
    seed,
    teamSize: TEAM_SIZE,
    characters: loadout.characters,
    skills: loadout.skills,
  });
  const battle = new Battle({ seed, teamSize: TEAM_SIZE, opponent: ai });
  /**
   * 세션과 같은 러너다 (`pvp/session.ts`의 `myWaves`) — 하강 페이스를 재려면
   * 게이지만으론 안 된다. 코어가 층을 넘기는 시각이 화면 연출의 입력이다.
   */
  const waves = createWaveRunner(battle.waves, 0);
  const casts = createCastQueue();
  const myCooldowns = createCooldownTracker(loadout.skills);
  const mateCooldowns = createCooldownTracker(loadout.skills);
  const rng = createRng(seed);
  let buffUntilMs = 0;
  let buffMult = 1;
  let nextDecisionMs = 0;
  /** 다음 AUTO 시전이 허용되는 시각 — 배지 박자(`AUTO_INTERVAL_MS`) */
  let nextAutoMs = 0;
  let lastClearMs = 0;
  let shownIndex = 0;
  const floorMs: number[] = [];
  let openingDamage = 0;

  const cast = (
    skill: { id: string; kind: string; power: number; durationMs?: number; interferenceKind?: string },
    memberId: string,
    nowMs: number,
  ): void => {
    if (skill.kind === "attack") {
      casts.push(memberId, skill.power);
    } else if (skill.kind === "buff") {
      buffUntilMs = nowMs + (skill.durationMs ?? 0);
      buffMult = skill.power;
    } else if (skill.interferenceKind !== undefined) {
      // main.ts의 onInterferenceCast 배선과 같다 — AI도 우리 방해를 받는다.
      // magnitude 규칙은 코어(`interferenceMagnitude`)를 쓴다: 손으로 적으면
      // 이 시뮬레이션만 다른 세기로 돌아 밸런스 실측이 프로덕션과 갈린다
      ai.receiveInterference(
        skill.interferenceKind as "slow",
        interferenceMagnitude(skill as SkillDef),
        nowMs,
      );
    }
  };

  // 130초 = 시간 제한(120초) + 여유. 무한 루프 방지용 상한이다.
  for (let i = 0; i < 60 * 130 && battle.state.phase === "running"; i++) {
    const nowMs = battle.state.elapsedMs;
    /**
     * **실명 중에는 우리 팀 전원이 시전하지 못한다** (`BattleState.blindUntilMs`).
     *
     * 세션(`pvp/session.castSkill`)이 나·AI 팀원 공용 경로에서 이걸 막으므로
     * 여기서 안 막으면 시뮬레이션이 프로덕션보다 강한 팀을 돌린다 — 그러면
     * 이 파일이 고정하는 밸런스 수치가 실제로 플레이되는 판의 것이 아니게 된다.
     * (`blind`가 연출 전용이던 동안에는 이 줄이 필요 없었다.)
     */
    const blinded = battle.state.blindUntilMs > nowMs;

    if (!blinded && nowMs >= nextDecisionMs) {
      nextDecisionMs = nowMs + TEAMMATE_DECISION_MS;
      const action = decideNextAction(
        {
          elapsedMs: nowMs,
          gaugePos: battle.state.gauge.pos,
          readySkills: mateCooldowns.readySkills(nowMs),
        },
        DEFAULT_STRATEGY,
        rng,
      );
      if (action.type === "cast") {
        mateCooldowns.trigger(action.skill.id, nowMs);
        cast(action.skill, "mate", nowMs);
      }
    }

    if (play === "spam" && !blinded) {
      for (const skill of myCooldowns.readySkills(nowMs)) {
        myCooldowns.trigger(skill.id, nowMs);
        cast(skill, "me", nowMs);
      }
    }
    /**
     * 배지가 켜져 있으면 **한 칸씩 680ms 박자로** 지른다 — 난사가 아니다.
     * 세션의 배선과 같다(`skillBar.update`의 `pickAutoSkill` + `AUTO_INTERVAL_MS`).
     * 여기서 난사로 모델링하면 이 파일이 재는 AUTO 페이싱이 프로덕션의 것이 아니다.
     */
    if (play === "auto" && !blinded && nowMs >= nextAutoMs) {
      const skill = pickAutoSkill(myCooldowns.readySkills(nowMs));
      if (skill) {
        nextAutoMs = nowMs + AUTO_INTERVAL_MS;
        myCooldowns.trigger(skill.id, nowMs);
        cast(skill, "me", nowMs);
      }
    }

    const mult = nowMs < buffUntilMs ? buffMult : 1;
    /**
     * **자동 공격은 배지를 본다** (`myAutoDamage`) — 프로덕션의 게이트다.
     * 이 줄이 `autoAttackDamage`를 직접 부르던 동안 시뮬레이션은 배지가 OFF인
     * 판에서도 내 딜을 세고 있었고, 그래서 유저가 신고한 화면("auto off여도 내
     * 캐릭터가 공격하는")을 이 파일이 밸런스로 승인하고 있었다.
     */
    const members = [
      ...myAutoDamage(
        loadout.characters.slice(0, TEAM_SIZE),
        STEP_MS,
        play === "auto",
      ),
      ...casts.drain(STEP_MS),
    ].map((m) => ({ memberId: m.memberId, rawDamage: m.rawDamage * mult }));
    const st = battle.tick(members, STEP_MS);
    // 여는 딜은 **연출 창 안의 것만** 센다 — catchup이 터지는 조건이 그 창이다
    if (st.elapsedMs <= ADV_TOTAL_MS) openingDamage += st.myTeamRawDamage;
    // 세션과 같은 순서 — 코어가 확정한 딜을 러너에 넣는다
    waves.applyDamage(st.myTeamRawDamage);
    if (waves.state.waveIndex !== shownIndex) {
      floorMs.push(st.elapsedMs - lastClearMs);
      lastClearMs = st.elapsedMs;
      shownIndex = waves.state.waveIndex;
    }
  }

  return {
    winner: battle.state.winner,
    elapsedSec: battle.state.elapsedMs / 1000,
    gauge: battle.state.gauge.pos,
    floorMs,
    depth: waves.state.waveIndex + 1,
    openingDamage,
  };
}

test("playing the skills wins by threshold, not by time-out judgment", () => {
  for (const seed of SEEDS) {
    const o = simulate(seed, true);
    expect(o.winner, `seed ${seed}`).toBe(0);
    // 임계치로 끝났다는 뜻 = 시간 제한 전에 결판
    expect(o.elapsedSec, `seed ${seed}`).toBeLessThan(90);
    // 20초 미만이면 스킬 4개를 돌려볼 틈도 없다
    expect(o.elapsedSec, `seed ${seed}`).toBeGreaterThan(30);
  }
});

/**
 * ── 방치는 **진다** (2026-08-06, 판정 근거는 2026-08-10에 바뀌었다)
 *
 * 예전 이 테스트는 `Math.abs(o.gauge) < 0.5`만 봤고 승자를 아예 묻지 않았다.
 * 그 절댓값이 부호를 지워서 "간신히 이김"과 "간신히 짐"을 한 키로 합쳤고,
 * 실제로는 **입력 0회로 30시드 전승**(최종 게이지 최소 +0.097)이었다 —
 * 대전에 패배가 존재하지 않는 상태를 이 테스트가 통과시키고 있었다.
 * (원인은 `ai/aiOpponentSource.ts`의 `members` 결정 기록.)
 *
 * 그래서 부호를 **따로** 묻는다. 지지만 무엇으로 지는가가 바뀌었다:
 *
 * **시간 판정 → 임계치 판정.** 예전에는 방치도 내 자동 공격 딜을 받고 있어서
 * (배지가 딜을 끄지 않았다) 120초를 다 쓰고 −0.39~−0.66에서 끝났다. 배지가 내
 * 칸을 끄자 방치는 **정말로 아무것도 하지 않고**, 12시드 전부 84.2~106.0초에
 * −0.80으로 KO당한다. 즉 방치의 벌이 커졌다 — 유저가 신고한 결함
 * ("auto off여도 내 캐릭터가 공격하는")의 다른 얼굴이 이 완만한 패배였다.
 *
 * 그래서 이제 **임계치로 진다**고 묻는다. 시간 상한(120초)은 그대로 두면
 * 아무것도 안 지키므로(어차피 못 넘는다) 지우고, 대신 KO가 시간 제한보다
 * **먼저** 온다는 것을 묻는다 — 그게 이 판정이 임계치라는 증거다.
 */
test("leaving the skills unused loses — by threshold KO, not by time-out", () => {
  for (const seed of SEEDS) {
    const o = simulate(seed, "idle");
    // 1) 방치는 진다. 이 한 줄이 없어서 전승을 60판 놓쳤다
    expect(o.winner, `seed ${seed}`).toBe(1);
    // 2) 임계치까지 밀린다 — 내 칸이 꺼진 방치에는 버틸 딜이 없다
    expect(o.gauge, `seed ${seed}`).toBeLessThanOrEqual(-DEFAULT_WIN_THRESHOLD);
    // 3) 그 KO가 시간 제한보다 먼저 온다 = 시간 판정이 아니다.
    //    (실측 84.2~106.0초. 여유를 두되 상한 자체는 코어 상수에서 읽는다)
    expect(o.elapsedSec * 1000, `seed ${seed}`).toBeLessThan(
      DEFAULT_TIME_LIMIT_MS,
    );
  }
});

/**
 * ── 배지(AUTO ON)도 이긴다, 그리고 **난사보다 느리다** (2026-08-10)
 *
 * 유저 신고: "AUto로 하면 pvp 너무 빨리 끝나고". 이 파일이 그 말을 확인하지도
 * 반박하지도 못했다 — `simulate`가 난사 하나만 모델링했기 때문이다(`PlayMode`
 * 주석). 갈래를 만들어 재보니 **반대**였다: AUTO는 12/12 시드에서 난사보다
 * 느리고 배율은 1.10~1.69배다. 신고된 체감의 원인은 페이싱이 아니라 다른
 * 곳에 있다(680ms 박자 자체는 `AUTO_INTERVAL_MS`가 쿨 합에서 유도한 값이다).
 *
 * 이 계약은 두 갈래를 **같은 시드에서 짝지어** 비교한다. 절대 시간 두 개를
 * 따로 묶으면 둘 다 느려지는 변경(예: 딜 하향)이 통과한다 — 관계가 아니라
 * 각자의 상한만 지키기 때문이다.
 */
test("AUTO wins too — and it is the slower path, not the faster one", () => {
  for (const seed of SEEDS) {
    const auto = simulate(seed, "auto");
    const spam = simulate(seed, "spam");
    // 1) 배지만 켜고 손을 놓아도 이긴다 — 안 그러면 배지가 함정이다
    expect(auto.winner, `seed ${seed}`).toBe(0);
    // 2) 그래도 난사보다 느리다 — 유저 신고("너무 빨리 끝나고")의 반대다.
    //    실측 1.10~1.69배. 하한 1.05는 그 최소에 여유를 둔 값이고, 이 부등식이
    //    뒤집히면 배지가 수동을 앞지른 것이므로 신고가 실제 결함이 된다
    expect(auto.elapsedSec, `seed ${seed}`).toBeGreaterThan(
      spam.elapsedSec * 1.05,
    );
    // 3) 시간 제한 안에서 끝난다 — 넘으면 배지가 판을 못 끝낸다는 뜻이다.
    //    (실측 95.5~120.0초. 시드 1은 120초 버저에 +0.786로 이긴다 —
    //     그래서 여기서 "임계치로 끝난다"고 묻지 않는다. 배지는 이기는 것까지만
    //     약속하고, 임계치 결판은 손을 쓰는 판의 계약이다)
    expect(auto.elapsedSec * 1000, `seed ${seed}`).toBeLessThanOrEqual(
      DEFAULT_TIME_LIMIT_MS,
    );
  }
});

/**
 * 조작이 **승패를 뒤집는다** — 이게 이 게임의 계약이다.
 *
 * 시간 비교(`acted < idled`)만으로는 부족하다: 방치가 120초를 다 쓰는 순간
 * 그 부등식은 자동으로 참이 되어, 조작이 아무것도 바꾸지 못해도 통과한다.
 * 같은 시드에서 **승자가 갈리는지**를 물어야 한다.
 */
test("the same match flips its winner on player input alone", () => {
  for (const seed of SEEDS) {
    const acted = simulate(seed, true);
    const idled = simulate(seed, false);
    expect(acted.winner, `seed ${seed} acted`).toBe(0);
    expect(idled.winner, `seed ${seed} idled`).toBe(1);
    // 게이지 격차로도 확인한다 — 승자만 보면 임계치 직전의 아슬아슬한 통과가 섞인다
    expect(acted.gauge - idled.gauge, `seed ${seed}`).toBeGreaterThan(1.0);
  }
});

/**
 * ── 하강 페이스 (2026-08-05)
 *
 * 실제 플레이에서 `WAVE 1 클리어` 직후 화면이 `WAVE 3`으로 뛰었다 (118초에 3번,
 * 1→3 / 6→8 / 10→12). 원인은 층 HP가 시간에 묶여 있지 않았던 것이고
 * (`core/waves.ts` 머리 주석), 층 예산 모델로 고쳤다. 그 증상이 조용히 돌아오지
 * 못하게 **층 시간 자체**를 여기서 잰다 — 게이지만 보면 층을 건너뛰어도 통과한다.
 */
test("no floor clears faster than the advance animation — catchup never fires", () => {
  for (const seed of SEEDS) {
    // 세 갈래 다 본다 — catchup은 딜이 몰릴 때 터지므로 가장 빠른 갈래(난사)를
    // 빼면 감시가 헐거워진다
    for (const play of ["auto", "spam", "idle"] as const) {
      const o = simulate(seed, play);
      /**
       * 층을 몇 개는 넘어야 페이스를 잴 표본이 생긴다. **하한이 갈린다**:
       * 방치는 내 칸이 꺼진 채 −0.80으로 KO당하므로(위 계약) 판이 84초에
       * 끝나고 층은 4~6개뿐이다. 예전 `> 5`는 방치가 120초를 다 쓰던 시절의
       * 표본 수였다 — 그 숫자를 남겨두면 이 검사가 잡는 것은 catchup이 아니라
       * 판이 짧아졌다는 사실이 된다.
       */
      const minFloors = play === "idle" ? 3 : 5;
      expect(
        o.floorMs.length,
        `seed ${seed} play=${play}`,
      ).toBeGreaterThan(minFloors);
      for (const [i, ms] of o.floorMs.entries()) {
        // `session.tickAdvance`가 층을 건너뛰는(catchup) 조건이 바로 이것이다:
        // 연출 1.2초가 끝나기 전에 다음 층이 넘어가면 웨이브 하나가 안 보인다
        expect(ms, `seed ${seed} play=${play} floor ${i + 1}`).toBeGreaterThan(
          ADV_TOTAL_MS,
        );
      }
    }
  }
});

/**
 * ── 여는 딜이 1층 예산을 넘지 않는다 (2026-08-05, 3단계)
 *
 * 위 검사는 **증상**(층 시간)을 잡는다. 이 검사는 그 원인을 직접 잡는다:
 * 판 첫 프레임에는 쿨다운이 전부 준비돼 있어서 스킬이 한꺼번에 나가고, 그
 * 폭이 1층 예산을 넘으면 층이 전진 연출 안에 죽는다.
 *
 * **`waves.test.ts`의 하한과 다른 것을 잰다.** 그쪽은 폭을 평균 dps
 * (`TEAM_DPS_REF` 520 × 1.4초 = 728)로 모델링해서 실측(2,721)을 4배 낮게
 * 봤고, 그래서 6번째 칸이 폭을 4,082로 밀어 1층(2,808)을 383ms에 녹였을 때도
 * 통과했다 — 모델이 아니라 시뮬레이션 실측으로 물어야 잡힌다.
 *
 * **지키는 방법이 바뀌었다 (2026-08-10).** 예전에는 그 칸만 늦게 여는
 * `SkillDef.openingDelayMs`(3초)가 장치였다. 칸을 지우면서 그 필드도 지웠고
 * (`core/waves.ts`의 결정 기록), 지금 부등식이 성립하는 이유는 **여는 딜 자체가
 * 작다**는 것이다 — 네 공격 칸의 합이 735딜로 옛 1,300보다 낮다. 장치가 없는
 * 부등식이므로 이 검사가 유일한 감시자다: 딜을 올리면 여기서 걸린다.
 */
test("opening burst stays under the first floor's budget — no catchup on frame 1", () => {
  for (const seed of SEEDS) {
    const o = simulate(seed, true);
    expect(o.openingDamage, `seed ${seed}`).toBeLessThan(waveTotalHp(0));
    // 첫 층이 연출보다 오래 걸린다 — 부등식이 실제로 그 결과를 낸다
    expect(o.floorMs[0], `seed ${seed}`).toBeGreaterThan(ADV_TOTAL_MS);
  }
});

/**
 * ── 층 시간이 **층 예산을 따라가는가** (2026-08-06 재작성)
 *
 * 예전 판정은 `max(floorMs) / min(floorMs) < 5`, 즉 **생 시간의 최대/최소비**였다.
 * 그 비율 한 개에 서로 다른 세 가지가 섞여 있었다:
 *
 *   1. 깊이 성장 — 설계값이다 (`FLOOR_TIME_SPAN` 1.5)
 *   2. 보스 층 배율 — 설계값이다 (`BOSS_HP_MULT` 1.4). 1·2를 곱하면 2.1배까지는
 *      **정상**이므로 `< 5`의 여유는 실제로 2.4배뿐이었다
 *   3. 방해(실명) 다운타임 — 깊이와 무관하게 층 하나에만 얹힌다
 *
 * 그래서 `blind`가 실제 방해가 되자 시드 42가 5.47로 깨졌는데, 실측을 보면
 * 페이스 결함이 아니었다: 느린 층은 f10(예산이 1층의 1.9배)이고 그 11.6초 중
 * 3.0초가 실명 대기였다. 다른 시드는 느린 층이 f5(1.6배)라서 같은 실명을 받고도
 * 통과했다 — **어느 깊이에서 방해가 터졌는지**가 판정을 갈랐다.
 *
 * 그 상황에서 `< 5`를 `< 6`으로 넓히는 것은 임계값을 실측에 맞추는 것이고,
 * 정상 성장 2.1배가 여유 안에 계속 숨어 있어서 검사가 무엇을 잡는지 알 수 없다.
 * 그래서 **각 층을 자기 예산으로 나눈다**: 1.0 = `TEAM_DPS_REF`로 예산을 정확히
 * 목표 시간에 녹인 것. 이러면 설계된 성장(1·2)이 분모로 빠지고 남는 것은
 * "우리 딜이 예산을 예상대로 녹였는가"뿐이다.
 *
 * 예산 대비 실측(시드 3·7·11·42, 조작): 0.39~1.37이고 시드별 최대/최소비는
 * 3.02~3.49다 — 생 시간 비(3.24~5.47)와 달리 시드 42가 튀지 않는다.
 *
 * **이 형태가 원래 결함을 그대로 잡는가**(넓히기가 아니라는 근거): 예전 식은
 * 마리 수(1~4)를 층 총 HP에 곱했다. 그게 돌아오면 `waveTotalHp`는 예산을
 * 그대로 돌려주는데 실제 총량이 최대 4배가 되므로 그 층의 이 비율이 4 근처로
 * 뜬다. 상한 2.0은 실측 최대(1.37)에 46% 여유를 두고 그 4를 확실히 거른다 —
 * 생 시간 비 `< 5`는 정상 성장 2.1배를 이미 삼키고 있었으므로 이보다 무디었다.
 */
test("each floor's time tracks its own HP budget — the same depth is not 4x work", () => {
  for (const seed of SEEDS) {
    const o = simulate(seed, true);
    const perBudget = o.floorMs.map(
      (ms, i) => ms / ((waveTotalHp(i) / TEAM_DPS_REF) * 1000),
    );
    for (const [i, r] of perBudget.entries()) {
      // 상한: 마리 수 곱셈(≈4배)이 돌아오면 여기가 먼저 깨진다.
      // 실명 다운타임(최대 4.5초)은 이 안에 들어간다 — 방해는 층 예산이 아니다
      expect(r, `seed ${seed} floor ${i + 1}`).toBeLessThan(2.0);
      // 하한: 판 첫 층은 쿨다운이 전부 준비된 채로 시작해 예산의 0.39배에
      // 녹는다(그 폭 자체는 위 '여는 딜' 검사가 예산 이하로 묶는다).
      // 이보다 더 빠르면 예산이 시간을 정하지 못하고 있다는 뜻이다
      expect(r, `seed ${seed} floor ${i + 1}`).toBeGreaterThan(0.3);
    }
  }
});

test("acting descends faster per floor than idling", () => {
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const seed of SEEDS) {
    const acted = simulate(seed, "spam");
    const idled = simulate(seed, "idle");
    /**
     * **층당 시간**으로 비교한다. 총 깊이는 비교할 수 없다 — 판 길이가 갈래마다
     * 다르기 때문이다(난사 64.7~98.3초, 방치 84.2~106.0초). 예전 주석은 그
     * 이유를 "방치는 120초를 다 쓰므로 더 깊이 간다"고 적었는데, 배지가 내 칸을
     * 끄면서 방치는 오히려 **얕게** 끝난다(depth 5~7 대 9~11). 결론은 그대로고
     * 근거가 반대가 됐다.
     */
    expect(mean(acted.floorMs), `seed ${seed}`).toBeLessThan(
      mean(idled.floorMs) * 0.75,
    );
    /**
     * 그래도 방치가 층을 못 넘는 건 아니다 — 화면이 멈춰 보이면 그것도 결함이다.
     * 하한이 5 → 3으로 내려간 이유는 위와 같다(방치의 depth 실측 5~7). 이건
     * 실측에 맞춘 완화가 아니라 **다른 판을 재게 된 것**이다: 예전 방치는 내 딜을
     * 받으며 120초를 버텼고 지금 방치는 84초에 KO당한다.
     */
    expect(idled.depth, `seed ${seed}`).toBeGreaterThan(3);
  }
});

test("the AI damage scale is the single difficulty knob", () => {
  const loadout = new PresetLoadoutProvider().load(TEAM_SIZE);
  const strong = new AIOpponentSource({
    seed: 5,
    teamSize: TEAM_SIZE,
    characters: loadout.characters,
    skills: loadout.skills,
    damageScale: 3,
  });
  const battle = new Battle({ seed: 5, teamSize: TEAM_SIZE, opponent: strong });
  for (let i = 0; i < 60 * 130 && battle.state.phase === "running"; i++) {
    battle.tick(
      autoAttackDamage(loadout.characters.slice(0, TEAM_SIZE), STEP_MS),
      STEP_MS,
    );
  }
  // 3배 딜 AI에게 자동 공격만으로 맞서면 진다 — 스칼라가 실제로 먹는다는 증거
  expect(battle.state.winner).toBe(1);
});
