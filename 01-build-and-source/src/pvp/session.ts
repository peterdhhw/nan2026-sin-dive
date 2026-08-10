import {
  Battle,
  DEFAULT_TIME_LIMIT_MS,
  type BattleState,
  type OpponentSource,
} from "../core/battle";
import { createCastQueue } from "../core/castQueue";
import { createCooldownTracker } from "../core/cooldown";
import { type MemberDamage } from "../core/team";
import { createWaveRunner } from "../core/waveRunner";
import { createRng } from "../core/rng";
import type { SkillDef } from "../core/types";
import type { Loadout } from "../loadout/types";
import type { MatchResult } from "../net/matchmaking";
import { decideNextAction } from "../ai/decision";
import { DEFAULT_STRATEGY } from "../ai/strategy";
import {
  ADV_SPAWN_AT_MS,
  ADV_THEME_AT_MS,
  ADV_TOTAL_MS,
  advanceCrossed,
  advanceRunning,
  advanceScrollSpeed,
  sameWave,
  waveClearLabel,
  type WaveStamp,
} from "../shared/advanceRules";
import { playSfx, resetSfxThrottle } from "../shared/audio";
import { volumeNotice } from "../shared/audioSettingsRules";
import { createBattleField } from "../shared/battleField";
import {
  createCastGate,
  skillImpactMs,
  type CastGate,
} from "../shared/castGateRules";
import { buildSkillImpactTable } from "../shared/skillMeleeRules";
import { charDef } from "../shared/spriteChar";
import { SCROLL_IDLE_PX_S } from "../shared/backgroundRules";
import { theirRoster } from "./rosterRules";
import { interferenceEndNotice } from "./interferenceRules";
import { NO_DEBUG, type DebugEntry } from "../shared/debugEntry";
import { createEffectPlayer } from "../shared/effects";
import { autoBadgePos, volumeBadgePos } from "./autoBadgeRules";
import { createGaugeBar } from "./gaugeBar";
import { shouldSurge } from "./gaugeBarRules";
import {
  accumulateHit,
  createHitAccumulator,
  resetHitAccumulator,
} from "../shared/hitAccumulator";
import { createHud } from "../shared/hud";
import { DESIGN_H, DESIGN_W, computeSplit, lerpRatio } from "./splitLayout";
import { createLoop } from "../shared/loop";
import {
  GAUGE_DANGER_HYST,
  GAUGE_DANGER_POS,
  aiTeammateIds,
  castActorLabel,
  castBannerKind,
  celebrateAttacker,
  finishReason,
  interferenceNotice,
  myAutoDamage,
  myTeamSlots,
  waveProgress,
} from "./sessionRules";
import { autoBadgeD, autoScopeNotice, createSkillBar } from "../shared/skillBar";
import { createBanner } from "../shared/ui/banner";
import { BANNER_GAP_Y } from "../shared/ui/bannerRules";
import { createCastBeamLayer } from "../shared/ui/castBeam";
import { castBeamShown } from "../shared/ui/castBeamRules";
import { createHintFinger, createToast, fingerAnchor } from "../shared/ui/hint";
import { TOAST_BOTTOM_RATIO } from "../shared/ui/hintRules";
import { createVolumeBadge } from "../shared/ui/volumeBadge";
import { waveLabel } from "../shared/ui/waveRailRules";
import {
  TEAM_OURS_HI,
  TEAM_THEIRS_HI,
  ACCENT_GOLD,
  debugDepthFloor,
  descentDepth,
} from "../shared/theme";
import type { GameApp } from "../shared/app";

// 순수 규칙은 sessionRules.ts에 있다 (node 테스트가 pixi를 못 불러오기 때문).
// 계획서의 공개 API를 유지하기 위해 여기서 그대로 다시 내보낸다.
export {
  CELEBRATE_PERIOD_MS,
  aiTeammateIds,
  celebrateAttacker,
  finishReason,
  myTeamSlots,
  waveProgress,
} from "./sessionRules";

export interface SessionResult {
  winner: 0 | 1 | null;
  elapsedMs: number;
  myKills: number;
  gaugePos: number;
  reason: "threshold" | "timeLimit" | "forfeit";
}

export interface SessionOpts {
  app: GameApp;
  loadout: Loadout;
  match: MatchResult;
  opponent: OpponentSource;
  onFinish(result: SessionResult): void;
  /** 방해 스킬 시전 시 호출 — Plan 2에서 AppSync publish를 연결한다 */
  onInterferenceCast?: (skill: SkillDef, nowMs: number) => void;
  /**
   * 코어 틱 직후 호출. 딜 스냅샷 발행과 AI 전략 보고가 여기에 붙는다.
   * 세션은 net/ai를 import하지 않는다 — 배선은 main.ts가 한다 (L2→L3 의존 금지).
   */
  onTick?: (state: BattleState) => void;
  /**
   * 디버그 진입값 (`?gauge=` / `?wave=`). DEV에서만 채워진다 (설계 문서 09-3).
   * 전투 로직은 건드리지 않는다 — 게이지·웨이브의 **시작값**만 옮긴다.
   */
  debug?: DebugEntry;
}

export interface Session {
  /**
   * 전장을 시작 상태로 배치한다 (루프는 돌지 않는다).
   *
   * VS 인트로(§06)가 1.2초에 사선 배경을 갈라 그 틈으로 전장을 보여준다 —
   * 그때 필드가 기본 위치에 있으면 열리는 순간 캐릭터가 제자리로 튄다.
   * `start()`가 이걸 먼저 부른다.
   */
  prime(): void;
  start(): void;
  stop(): void;
  forfeit(team: 0 | 1): void;
  /**
   * 우리 팀 아군 한 명이 승리 포즈를 취한다 (§08-1: 200~700ms 반복).
   *
   * 결과 씬이 부른다. 씬이 `topField`를 직접 만지지 않게 하는 이유는 전장이
   * `app.layers.*`에 있어 씬 컨테이너 밖이고, 아군 `memberId`를 씬이 알면
   * 로드아웃 구조가 씬으로 새기 때문이다.
   */
  celebrate(turn: number): void;
  /**
   * 전장을 완전히 치운다 (Spine 인스턴스 4~8개 포함).
   *
   * 재대전이 리로드가 아니라 씬 전환이므로(§08-5) 이걸 부르지 않으면
   * 판마다 스켈레톤이 쌓여 5판이면 40개가 된다 (§09-4 누수 위험).
   */
  destroy(): void;
  readonly state: BattleState;
}

/** AI 팀원이 이 주기로 스킬을 판단한다 */
const TEAMMATE_DECISION_MS = 500;

export async function createSession(opts: SessionOpts): Promise<Session> {
  const { app, loadout, match } = opts;
  const debug = opts.debug ?? NO_DEBUG;
  const teamSize = myTeamSlots(match).length;
  const battle = new Battle({
    seed: match.seed,
    teamSize,
    opponent: opts.opponent,
    ...(debug.gauge !== null ? { startGaugePos: debug.gauge } : {}),
  });
  const timeLimitMs = DEFAULT_TIME_LIMIT_MS;

  /**
   * 양 팀이 **같은 층**을 싸운다 (설계 문서 07-8: "공용 웨이브이므로 동기").
   * `?wave=`는 1-based로 받는다 (HUD 표기와 같아야 헷갈리지 않는다).
   *
   * 웨이브를 넘기는 것은 **내 러너 하나**다. 상대 러너는 `autoAdvance: false`로
   * 두고 `placeWave`가 같은 층으로 맞춘다 — 예전에는 둘 다 스스로 전진해서
   * 프레임의 96~98%에서 인덱스가 벌어졌고(최대 5층), 그러면 위아래에 다른
   * 종족이 서서 "같은 층을 누가 더 빨리 쓰는가"가 화면에서 사라진다.
   *
   * 승패는 이 동기화와 무관하다 — 게이지는 코어의 딜만 보고, 러너는 연출용이다.
   */
  const startWave = debug.wave === null ? 0 : debug.wave - 1;
  /**
   * `?wave=3` 진입이 요구하는 시작 깊이 — 하강이 시간축으로 옮겨간 뒤에도
   * 그 파라미터로 심연을 스크린샷 검증할 수 있어야 한다 (설계 문서 09-3).
   */
  const depthFloor = debugDepthFloor(debug.wave);
  const myWaves = createWaveRunner(battle.waves, startWave);
  const theirWaves = createWaveRunner(battle.waves, startWave, {
    autoAdvance: false,
  });

  const myCooldowns = createCooldownTracker(loadout.skills);
  // AI 팀원은 각자 쿨다운을 따로 갖는다
  const teammateIds = aiTeammateIds(match);
  const teammates = teammateIds.map((slotId, i) => ({
    slotId,
    character: loadout.characters[(i + 1) % loadout.characters.length]!,
    cooldowns: createCooldownTracker(loadout.skills),
    rng: createRng(match.seed + 1000 + i),
    nextDecisionMs: 0,
  }));

  let split = computeSplit(0);
  const fx = await createEffectPlayer();
  // 광선은 스킬바에서 필드로 밴드를 넘나든다 — 디자인 좌표 전체를 쓴다
  const beams = createCastBeamLayer();
  const hud = createHud({
    rect: split.hud,
    myTeamName: "우리 팀",
    theirTeamName: match.slots.some((s) => s.team === 1 && s.kind === "human")
      ? "상대 팀"
      : "AI 상대",
    myCharacters: loadout.characters.slice(0, teamSize),
    debugHud: debug.debugHud,
  });
  // 공지는 배너로 나간다 — `hud.setNotice()`의 텍스트 한 줄은 놓치기 쉬웠다 (§C8)
  const banner = createBanner({ w: DESIGN_W });
  const toast = createToast({
    cx: DESIGN_W / 2,
    cy: DESIGN_H * (1 - TOAST_BOTTOM_RATIO),
  });
  /** 첫 대전 무설명 온보딩 — 스킬 슬롯 위 파란 손 (§C10) */
  const hintFinger = createHintFinger();
  const gaugeBar = createGaugeBar(split.gauge);
  const myChars = loadout.characters.slice(0, teamSize);
  /**
   * 상대 팀은 **다른 캐릭터**로 세운다 — 유도식은 `rosterRules.theirRoster`에
   * 있다. VS 인트로가 같은 함수를 부르므로 두 화면이 같은 넷을 세운다
   * (그 파일의 결정 기록: 예전에는 VS가 내 로드아웃을 양쪽에 깔았다).
   */
  const theirChars = theirRoster(match.seed, myChars);
  const topField = await createBattleField({
    characters: myChars,
    rect: split.top,
    fx,
    // 데미지 숫자 지터를 매치 시드에 묶는다 — 같은 판을 재생하면 같은 그림이 나온다
    rngSeed: match.seed + 101,
  });
  const bottomField = await createBattleField({
    characters: theirChars,
    rect: split.bottom,
    // 상대 팀은 **좌우** 반전이다 — 두 팀 모두 땅에 똑바로 서고, 상대는
    // 오른쪽에서 왼쪽으로 공격한다. 예전의 상하 반전(설계 문서 07-6-2)은
    // 상대 팀이 거꾸로 매달린 거울상으로 보였다
    mirrorX: true,
    fx,
    rngSeed: match.seed + 202,
  });
  /** 시전 큐 — AI 상대(ai/aiOpponentSource)와 같은 코어 구현을 쓴다 */
  const casts = createCastQueue();

  // 버프 상태는 castSkill이 쓰므로 그보다 먼저 선언한다
  let buffUntilMs = 0;
  let buffMult = 1;
  // 디버그로 게이지를 옮겨 시작하면 화면비도 거기서 시작해야 한다 —
  // 0에서 보간하면 첫 0.5초가 "밀리는 애니메이션"이 되어 스크린샷 타이밍이 흔들린다
  let renderedRatioPos = battle.state.gauge.pos;
  /**
   * 화면에 배치되어 있는 웨이브. 코어(`myWaves.state`)보다 최대 1.2초 뒤처진다 —
   * 전진 연출(§8)이 그만큼 걸리기 때문이다.
   */
  let shownWave: WaveStamp = { waveIndex: -1, loops: -1 };
  /**
   * 전진 연출 경과(ms). `null`이면 연출 중이 아니다.
   *
   * 고정 스텝으로 돌린다 — 프레임 델타로 돌리면 저사양 기기에서 스폰 시각이
   * 밀려 클리어 배너와 다음 웨이브 배너가 겹친다.
   */
  let advanceMs: number | null = null;
  /** 직전 프레임의 감속 여부 — 해제 순간을 잡아 알린다 (§9) */
  let wasSlowed = false;
  /** 직전 프레임의 실명 여부 — 같은 근거로 해제를 알린다 */
  let wasBlinded = false;
  /**
   * 지금 우리 팀이 실명 상태인가. 코어가 소유한 값을 그대로 읽는다 —
   * 세션이 따로 세면 두 시계가 갈린다(`setSlowed` 주석과 같은 근거).
   */
  const blinded = (): boolean =>
    battle.state.blindUntilMs > battle.state.elapsedMs;
  let finished = false;
  let forfeitReason = false;
  /**
   * `destroy()`가 지나갔는가.
   *
   * 재대전은 결과 씬이 아직 화면에 있는 동안 세션을 파괴한다(전환 페이드
   * 160ms가 남아 있다, §08-5). 그 사이 씬 `update`가 `celebrate()`를 부르면
   * 이미 파괴된 필드를 만지게 되므로 여기서 끊는다.
   */
  let destroyed = false;
  /** 임계선 경고를 울린 방향 (0 = 아직 안 울림). 판당 방향별 1회 */
  let dangerSideWarned: -1 | 0 | 1 = 0;
  /** 직전 프레임에 쿨다운이 준비된 스킬 ID — 준비 완료 순간을 잡는다 */
  let prevReadyIds = new Set<string>();
  /** 데미지 숫자 누적기 (필드별) */
  const myHits = createHitAccumulator();
  const theirHits = createHitAccumulator();
  /**
   * 마지막 게이지 파동 시각 (`elapsedMs`). -1 = 아직 없다.
   * 벽시계가 아니라 코어 시각을 쓴다 — 결정론이어야 스크린샷 회귀가 성립한다.
   */
  let lastSurgeMs = -1;

  /**
   * 스킬 슬롯 → 작용 지점으로 광선을 쏜다. 인과 사슬의 첫 단이다 (README §3-2).
   *
   * 목표는 `kind`가 결정한다: 공격은 우리 필드의 적 무리, 방해는 **상대 필드**,
   * 버프는 우리 아군. 이 방향이 "이 스킬이 어디에 작용하는가"를 유일하게 말해준다.
   */
  const fireCastBeam = (skill: SkillDef, slotIndex: number): void => {
    /**
     * 공격 스킬은 광선을 안 쓴다 — 아군이 직접 달려가 때리는 것이 인과다
     * (`castBeamShown`의 주석 참고). 여기서 거르므로 호출자는 종류를 안 봐도 된다.
     */
    if (!castBeamShown(skill.kind)) return;
    const from = skillBar.slotCenter(skill.id);
    if (!from) return;
    const target =
      skill.kind === "interference"
        ? { field: split.bottom, xr: 0.5, yr: 0.5 }
        : skill.kind === "buff"
          ? { field: split.top, xr: 0.2, yr: 0.62 }
          : { field: split.top, xr: 0.72, yr: 0.62 };
    const color =
      skill.kind === "interference"
        ? TEAM_THEIRS_HI
        : skill.kind === "buff"
          ? ACCENT_GOLD
          : TEAM_OURS_HI;
    // 슬롯 인덱스로 휘는 방향을 갈라 놓는다 — 연타 시 궤적이 한 줄로 뭉치지 않는다
    beams.fire(
      from,
      {
        x: target.field.x + target.field.w * target.xr,
        y: target.field.y + target.field.h * target.yr,
      },
      color,
      slotIndex % 2 === 0 ? 1 : -1,
    );
  };

  /**
   * 스킬 id → 임팩트까지 시간(ms). 아래 모션 게이트가 얼마나 잠글지의 입력이다.
   *
   * 싱글과 같은 표를 쓴다(`single/session.ts`) — 캐릭터의 클립 실측과 역할의
   * 접근 배율이 만나는 값이라 **상수로 적을 수 없다**. 매니페스트가 아직 없으면
   * 빈 표가 되고 게이트는 열려 있다: 그림도 못 받은 판에서 입력까지 막으면
   * 화면이 죽은 것으로 보인다.
   */
  const impactTable = buildSkillImpactTable(loadout.characters, (slug, clip) => {
    const a = charDef(slug)?.actions[clip];
    return a === undefined ? null : { impactFrame: a.impact ?? 0, fps: a.fps };
  });
  /**
   * 시전자별 **모션 게이트** — 방금 지른 타격이 다음 입력에 지워지지 않게 막는다.
   *
   * ## PvP에도 필요하다 (2026-08-10, 유저 신고 "스킬 눌러도 동작안하고")
   *
   * 이 게이트는 싱글에만 있었다. PvP의 `castSkill`은 실명과 쿨다운만 보고 바로
   * `topField.onAllyAttack`으로 넘겼는데, 그쪽은 **진행 중인 사이클을 끊고
   * 갈아탄다**(그 결정 기록 참고 — 안 끊으면 스킬 돌진이 아예 안 선다).
   * 쿨다운은 칸마다 따로 도니까 1번 직후 2번은 자기 쿨이 다 돌아 있어 통과하고,
   * 2번의 돌진이 1번의 임팩트 프레임을 지운다 — **눌렀는데 타격이 안 나간다.**
   * 쿨 값으로는 못 막는다: 쿨은 한 칸의 연타만 막는다(`castGateRules` 머리).
   *
   * 시전자마다 하나씩 갖는 이유는 AI 팀원이 같이 지르기 때문이다(`step`) —
   * 한 명의 게이트가 다른 명을 막으면 팀원이 지를 때마다 내 입력이 삼켜진다.
   */
  const castGates = new Map<string, CastGate>();
  const gateOf = (memberId: string): CastGate => {
    let g = castGates.get(memberId);
    if (!g) {
      g = createCastGate();
      castGates.set(memberId, g);
    }
    return g;
  };

  /**
   * 시전 한 번. **받아들였는지 돌려준다** — 스킬바가 거부된 탭에 반응하기
   * 위해서다(`SkillBarOpts.onCast` 주석). 거부 사유는 실명과 모션 게이트이고,
   * 둘 다 쿨다운을 소모하지 않는다.
   */
  const castSkill = (
    memberId: string,
    skill: SkillDef,
    nowMs: number,
    cooldowns: ReturnType<typeof createCooldownTracker>,
  ): boolean => {
    /**
     * **실명 중에는 아무도 시전하지 못한다** (`BattleState.blindUntilMs`).
     *
     * `isReady`보다 먼저 본다 — 뒤에 두면 `trigger`가 먼저 지나가서 실명이
     * 시전을 미루는 것이 아니라 쿨다운을 태워 없앤다. 상대 AI도 같은 순서다
     * (`aiOpponentSource.poll`의 `blinded`는 판단 자체를 건너뛴다).
     *
     * 내 팀 전원(나 + AI 팀원)에 걸린다 — 실명은 팀에 오는 방해이지 슬롯
     * 하나의 문제가 아니다. 눌린 것을 삼키기만 하면 "왜 안 나가지"가 되므로
     * 잠금 표시는 `syncBlindLocks`가 매 프레임 슬롯에 준다.
     */
    if (blinded()) return false;
    if (!cooldowns.isReady(skill.id, nowMs)) return false;
    /**
     * **모션 게이트를 쿨다운 소모보다 앞에서 본다.** 뒤에 두면 게이트에 걸린
     * 입력이 쿨은 태우고 딜은 못 내서 "눌렀는데 아무 일도 없고 쿨만 돈다"가
     * 된다 — 고치려던 것보다 나쁘다(`castGateRules`의 결정 기록).
     *
     * 광선으로 나가는 스킬(방해·버프)은 표에 없어 임팩트 0이므로 잠금이 걸리지
     * 않는다 — 몸이 안 움직이니 끊길 모션도 없다.
     */
    const gate = gateOf(memberId);
    if (!gate.canCast(nowMs)) return false;
    gate.mark(nowMs, skillImpactMs(impactTable, skill.id));
    cooldowns.trigger(skill.id, nowMs);
    /**
     * **돌진하는 스킬만 돌진시킨다.**
     *
     * 예전에는 종류를 안 보고 전부 `onAllyAttack`으로 넘겼다. 그래서 방해·버프를
     * 눌러도 아군이 적에게 달려가 칼을 휘둘렀다 — 헤드리스 로그에서 AUTO를 끈
     * 채로 `impact:m1:attack1:auto`가 찍혀 잡았다(`skillMelee`가 `null`이라
     * 스킬 id가 로그에서 `auto`로 나온다). 사슬을 거는 연출이 광선인데 몸까지
     * 뛰어나가면, 무엇이 상대 필드에 작용했고 무엇이 앞의 적을 때렸는지가
     * 화면에서 섞인다.
     *
     * 판정은 `castBeamShown`의 **여집합**이다 — 한 스킬은 광선이거나 돌진이거나
     * 둘 중 하나다(`castBeamRules.test`가 이 상보성을 고정한다). 여기서 따로
     * `kind`를 보면 두 곳이 갈라져 한쪽만 고치게 된다.
     */
    if (!castBeamShown(skill.kind)) {
      // 스킬 id를 같이 넘긴다 — 전장이 그것으로 모션·이펙트를 갈라 쓴다
      // (`skillMeleeRules`). 안 넘기면 네 스킬이 같은 동작 하나로 보인다
      topField.onAllyAttack(memberId, skill.id);
    }
    playSfx("skill_cast");
    /**
     * **내 조작인가.** 광선·배너·publish가 다 이 판정을 쓴다 —
     * `castSkill`은 나와 AI 팀원 공용이므로(`step` 1단계) 여기서 안 가르면
     * 팀원이 한 일이 내가 한 일과 화면에서 같아진다(`castActorLabel` 주석).
     */
    const mine = memberId === loadout.characters[0]?.memberId;
    // 광선은 **내 조작에만** 준다. AI 팀원 시전까지 그리면 화면이 광선으로 덮이고
    // 정작 내가 누른 것이 어느 것인지 안 보인다 (인과 사슬의 목적과 반대)
    if (mine) {
      fireCastBeam(
        skill,
        loadout.skills.findIndex((s) => s.id === skill.id),
      );
    }

    if (skill.kind === "attack") {
      casts.push(memberId, skill.power);
      return true;
    }
    if (skill.kind === "buff") {
      // 버프는 자기 팀 딜 배수 — 지속시간 동안 power배
      buffUntilMs = Math.max(buffUntilMs, nowMs + (skill.durationMs ?? 0));
      buffMult = skill.power;
      fx.spawn({
        sheet: "aura",
        x: split.top.x + split.top.w * 0.2,
        y: split.top.y + split.top.h * 0.8,
        scale: 1.6,
      });
      /**
       * 버프는 내 것만 `buff`(초록)을 쓴다. 팀원 버프까지 초록이면 "내가 눌러
       * 팀 딜이 올랐다"는 신호가 값싸진다 — 120초에 팀원이 버프를 쓰는 횟수가
       * 내 것보다 많다.
       */
      banner.show(
        mine ? "buff" : castBannerKind(false),
        `${castActorLabel(mine)}${skill.name}!`,
      );
      return true;
    }
    // 방해 — 상대 화면(하단)에 즉시 연출하고 발행 훅을 부른다
    if (skill.interferenceKind) {
      fx.playInterference({ kind: skill.interferenceKind }, split.bottom);
    }
    /**
     * `myCast`(우리 팀 색) / `teammate`(어두운 패널)로 갈린다.
     *
     * **`interference`를 쓰지 않는다** — 그 종류는 *도착한* 방해
     * (`interferenceNotice`, 아래 `pendingEvents`)가 쓰고 있고 상대색이다.
     * 같은 종류를 쓰면 색이 같아져 "걸었다"와 "당했다"가 안 갈리고, 배너 슬롯도
     * 하나라 내가 거는 순간 도착 공지를 덮어쓴다(`bannerAction`).
     */
    banner.show(
      castBannerKind(mine),
      `${castActorLabel(mine)}${skill.name} → 상대`,
    );
    opts.onInterferenceCast?.(skill, nowMs);
    return true;
  };

  const skillBar = createSkillBar({
    skills: loadout.skills,
    rect: split.skillBar,
    cooldowns: myCooldowns,
    /**
     * 배지는 스킬바 밖 — 우리 필드 오른쪽 위 하늘이다 (`autoBadgeRules`의 결정
     * 기록). `split.hud`는 게이지가 움직여도 안 변하므로 자리가 고정된다.
     */
    autoBadgeAt: autoBadgePos(split.hud, autoBadgeD(split.skillBar.h)),
    onCast: (skill, nowMs) => {
      // 유저가 한 번 눌렀으면 손가락 힌트는 영구 해제한다 (§C10).
      // 거부된 탭에도 해제한다 — 누를 줄 안다는 것은 이미 보여줬다
      hintFinger.dismiss();
      const myChar = loadout.characters[0]!;
      // 받아들여졌는지 바에 돌려준다 — 거부면 바가 흔들림 + 잠김 소리를 준다
      return castSkill(myChar.memberId, skill, nowMs, myCooldowns);
    },
    /**
     * 배지가 실제로 무엇을 끄는지 알린다 (`autoScopeNotice`).
     *
     * PvP에서 `OFF`가 끄는 것: **내 캐릭터**의 자동 공격 — 동작
     * (`render`의 `setAuto(…, [내 memberId])`)과 딜(`step`의 `myAutoDamage`)이
     * 같은 값을 본다. 그리고 내 스킬 자동 시전(`skillBar.update`)이다.
     *
     * `OFF`가 **남기는** 것: AI 팀원(`step` 1단계 + 그쪽 자동 공격)과 상대
     * 필드다. 그래서 배지를 껐어도 전투는 굴러가고, 그것이 공지 문구
     * ("팀은 계속 싸운다")가 말하는 경계다. 팀원까지 세우면 난사해도 못 이긴다
     * (`sessionRules.myAutoDamage`의 12시드 표 셋째 줄).
     *
     * **범위가 `"skill"`인 이유**: 싱글의 `"battle"`은 전투 전체가 멈춘다
     * (상대가 없다). 대전에서 멈추는 것은 내 칸 하나이므로 같은 문구를 쓸 수 없다.
     * 그리고 `"skill"`이므로 배지는 **OFF에서 시작한다**(`initialAutoFor`) —
     * 시작 상태가 "내 캐릭터는 내가 움직인다"다.
     */
    autoScope: "skill",
    onAutoToggle: (on, scope) => {
      toast.show(autoScopeNotice(on, scope));
    },
  });

  /**
   * 실명 중 스킬바 전체를 잠근다 — **여섯 칸 전부**다.
   *
   * `SkillBar.setLocked`가 세 가지를 한꺼번에 한다: 슬롯을 회색으로, 탭을
   * `ui_locked` + 흔들림으로 삼키고, AUTO 대상에서 뺀다. 세 번째가 특히 중요하다 —
   * AUTO가 켜져 있으면 실명이 봉인한 시전을 배지가 대신 눌러 버린다
   * (`castSkill`이 막으니 딜은 안 나가지만, 쿨다운은 `castSkill` **안**에서
   * 돌기 때문에 화면만 조용히 아무 일도 안 하는 상태가 된다).
   *
   * 싱글의 타락 칸(`single/session.ts`의 `syncSkillLocks`)과 같은 모양이지만
   * 잠기는 이유가 다르다: 그쪽은 판 내내 안 변하는 해금 상태고, 이쪽은 2.5초
   * 지속 방해다. 그래서 매 프레임 다시 쓴다.
   */
  const syncBlindLocks = (locked: boolean): void => {
    for (const s of loadout.skills) skillBar.setLocked(s.id, locked);
  };

  /**
   * 소리 배지 — AUTO 바로 아래. `split.hud`를 넘기는 이유는 AUTO와 같다
   * (HUD는 고정 높이라 게이지가 어디에 있어도 배지가 안 움직인다 —
   * `autoBadgeRules.volumeBadgePos` 주석의 최악 여유 108px).
   */
  const volumeBadge = createVolumeBadge({
    diameter: autoBadgeD(split.skillBar.h),
    at: volumeBadgePos(split.hud, autoBadgeD(split.skillBar.h)),
    onChange: (v) => {
      toast.show(volumeNotice(v));
    },
  });

  app.layers.hud.addChild(hud.view);
  app.layers.top.addChild(topField.view);
  app.layers.bottom.addChild(bottomField.view);
  app.layers.gauge.addChild(gaugeBar.view);
  app.layers.skillBar.addChild(skillBar.view);
  app.layers.fx.addChild(beams.view);
  app.layers.fx.addChild(fx.view);
  // 배너·토스트·힌트는 fx 위에 얹는다 — 공지가 이펙트에 묻히면 못 읽는다
  app.layers.fx.addChild(banner.view, toast.view, hintFinger.view);
  // AUTO 배지는 바 밴드 밖(우리 필드 위 하늘)이므로 바 뷰의 자식이 아니다
  app.layers.hud.addChild(skillBar.autoView);
  // 소리 배지도 같은 레이어·같은 열이다 (AUTO 아래)
  app.layers.hud.addChild(volumeBadge.view);

  const relayout = (): void => {
    topField.setRect(split.top);
    bottomField.setRect(split.bottom);
    gaugeBar.setRect(split.gauge);
    // 배너는 우리 필드 상단에 걸친다 — 방해·버프·웨이브는 전부 여기서 일어난다.
    // `view.x`는 배너가 스와이프에 쓰므로 y만 만진다. 간격은 규칙이 정본이다
    // (AUTO 배지가 이 띠 아래에 앉는다 — `autoBadgeRules`)
    banner.view.y = split.hud.y + split.hud.h + BANNER_GAP_Y;
  };

  /** 웨이브 러너의 남은 HP를 슬롯별 비율로 (전진 1.2초 동안 코어가 앞선 만큼) */
  const hpRatios = (runner: typeof myWaves): number[] =>
    runner.currentWave.enemies.map((e, i) =>
      e.hp > 0 ? Math.max(0, runner.state.enemyHp[i] ?? 0) / e.hp : 0,
    );

  /**
   * 화면을 이 웨이브로 갈아 끼운다 — 배경·적·HUD·배너를 한 번에.
   * 전진 연출의 마지막 단(1200ms)과 첫 배치가 같은 코드를 쓴다.
   */
  const placeWave = (stamp: WaveStamp): void => {
    shownWave = stamp;
    /**
     * 상대 러너를 이 층으로 맞춘다 — 그 러너는 스스로 전진하지 않는다.
     * 화면에 깔기 **전에** 맞춰야 아래 필드가 이 층의 적을 받는다.
     *
     * 상대가 아직 그 층을 못 끝냈어도 만피로 다시 깐다. 남은 HP를 이어 주면
     * 위아래 HP바가 다른 진행률을 말하는데, 그건 "같은 층을 동시에 시작해
     * 누가 먼저 쓰는가"라는 읽기와 어긋난다.
     */
    theirWaves.syncTo(stamp.waveIndex, stamp.loops);
    topField.setWave(myWaves.currentWave, hpRatios(myWaves));
    bottomField.setWave(theirWaves.currentWave, hpRatios(theirWaves));
    hud.setWave(stamp.waveIndex);
    // 배너와 HUD 구름이 같은 함수로 번호를 만든다 — 문자열을 두 곳에서
    // 조립하면 한쪽만 고쳐서 서로 다른 웨이브를 말하는 사고가 난다
    banner.show("wave", waveLabel(stamp.waveIndex));
    // 슬롯의 주인이 바뀌었다 — 이전 적의 누적 딜을 다음 적에게 얹으면 안 된다
    resetHitAccumulator(myHits);
    resetHitAccumulator(theirHits);
  };

  /** 0ms — 금색 클리어 배너. 방금 끝난 웨이브 번호를 말한다 (§8) */
  const startAdvance = (): void => {
    advanceMs = 0;
    banner.show("wave", waveClearLabel(shownWave.waveIndex));
    // 1.2초 연출은 스크린샷 한 장으로 검증할 수 없다 — 헤드리스 하네스가
    // 이 로그로 순서(clear → spawn)를 읽는다
    if (import.meta.env.DEV) {
      console.log(
        `[adv] clear wave=${shownWave.waveIndex + 1} t=${performance.now().toFixed(0)}`,
      );
    }
  };

  /**
   * 전진 연출을 접고 배경·모션을 평상시로 되돌린다.
   *
   * 끝값을 코드로 못 박는다 — 마지막 스텝이 정확히 `ADV_TOTAL_MS`에 떨어지지
   * 않으면 스크롤이 12로 안 돌아와 배경이 영구히 흐른다.
   */
  const endAdvance = (why: string): null => {
    for (const f of [topField, bottomField]) {
      f.setScrollSpeed(SCROLL_IDLE_PX_S);
      f.setAdvancing(false);
    }
    if (import.meta.env.DEV) {
      console.log(`[adv] ${why} speed=${SCROLL_IDLE_PX_S}`);
    }
    return null;
  };

  /**
   * 전진 연출 한 스텝. 다음 경과값을 돌려주고, 끝났으면 `null`.
   *
   * 상/하 필드가 **동시에** 움직인다 (§8) — 공용 웨이브이므로 동기다.
   */
  const tickAdvance = (prevMs: number, stepMs: number): number | null => {
    const nextMs = prevMs + stepMs;
    /**
     * 연출 도중에 코어가 **또** 웨이브를 넘겼다 — 판 시작 직후 쿨다운 4개가
     * 동시에 준비된 상태에서 첫 웨이브들이 1.2초보다 빨리 녹으면 일어난다.
     * 그대로 두면 화면이 `WAVE 1 클리어` → `WAVE 4`로 뛰어 웨이브 2·3을 아예
     * 보여주지 않는다 (로그에서 확인). 연출을 접고 즉시 따라잡는다 —
     * 화려함보다 지금 어디를 싸우고 있는지가 먼저다.
     */
    if (myWaves.state.waveIndex - shownWave.waveIndex >= 2) {
      placeWave({
        waveIndex: myWaves.state.waveIndex,
        loops: myWaves.state.loops,
      });
      return endAdvance("catchup");
    }
    const speed = advanceScrollSpeed(nextMs);
    topField.setScrollSpeed(speed);
    bottomField.setScrollSpeed(speed);
    const running = advanceRunning(nextMs);
    topField.setAdvancing(running);
    bottomField.setAdvancing(running);

    // 테마 크로스페이드는 배경이 빠르게 흐르는 동안 시작한다 — 멈춘 뒤에
    // 바뀌면 "도착했다"가 아니라 "색이 변했다"가 된다
    if (advanceCrossed(prevMs, nextMs, ADV_THEME_AT_MS)) {
      topField.setWaveBackground(myWaves.currentWave);
      bottomField.setWaveBackground(theirWaves.currentWave);
    }
    // 스폰은 한 번만 — `nextMs >= 1200`만 보면 매 프레임 다시 깔린다
    if (advanceCrossed(prevMs, nextMs, ADV_SPAWN_AT_MS)) {
      placeWave({
        waveIndex: myWaves.state.waveIndex,
        loops: myWaves.state.loops,
      });
      if (import.meta.env.DEV) {
        console.log(
          `[adv] spawn wave=${shownWave.waveIndex + 1} speed=${speed.toFixed(0)} t=${performance.now().toFixed(0)}`,
        );
      }
    }
    if (nextMs < ADV_TOTAL_MS) return nextMs;
    return endAdvance("done");
  };

  const step = (stepMs: number): void => {
    if (finished) return;
    const nowMs = battle.state.elapsedMs;

    // 1) AI 팀원 판단 (스펙 §3-7 — 내 클라이언트가 로컬 시뮬레이션)
    for (const t of teammates) {
      if (nowMs < t.nextDecisionMs) continue;
      t.nextDecisionMs = nowMs + TEAMMATE_DECISION_MS;
      const action = decideNextAction(
        {
          elapsedMs: nowMs,
          gaugePos: battle.state.gauge.pos,
          readySkills: t.cooldowns.readySkills(nowMs),
        },
        DEFAULT_STRATEGY,
        t.rng,
      );
      if (action.type === "cast") {
        castSkill(t.character.memberId, action.skill, nowMs, t.cooldowns);
      }
    }

    /**
     * 2) 우리 팀 딜 = 자동 공격 + 시전 분산분, 버프 적용.
     *
     * **자동 공격은 배지를 본다**(`myAutoDamage`) — OFF면 내 칸이 빠진다.
     * 게이트 인자가 `topField.auto`인 것이 요점이다: 모션 게이트도 같은 값을
     * 읽으므로(`render`의 `setAuto`) 몸과 수치가 갈릴 수 없다. 배지 상태를
     * 여기서 따로 읽으면(`skillBar.auto`) 두 시계가 되고, 갈리는 순간이
     * 실측된 결함이다(돌진 0회인데 팀 딜의 45.3%).
     *
     * `casts.drain`은 게이트 밖이다 — 손으로 누른 스킬은 혼자 난 일이 아니고,
     * 안에 넣으면 OFF 동안 쌓인 시전분이 켜는 순간 한꺼번에 터진다.
     */
    const members = [
      ...myAutoDamage(loadout.characters.slice(0, teamSize), stepMs, topField.auto),
      ...casts.drain(stepMs),
    ];
    const mult = nowMs < buffUntilMs ? buffMult : 1;
    const scaled: MemberDamage[] = members.map((m) => ({
      memberId: m.memberId,
      rawDamage: m.rawDamage * mult,
    }));

    // 3) 코어 틱 — 게이지·방해·승패는 전부 여기서 결정된다
    const st = battle.tick(scaled, stepMs);
    // 발행·전략 보고는 코어가 확정한 수치로 한다 (감속 반영 후)
    opts.onTick?.(st);

    // 4) 웨이브 진행 (연출용). 코어가 실제 반영한 딜을 쓴다
    for (const hit of myWaves.applyDamage(st.myTeamRawDamage)) {
      // 숫자는 시간축으로 묶어서 띄운다 — 틱당 딜은 소수점이라 그대로 띄우면
      // 초당 60개의 "1"이 쏟아진다 (hitAccumulator 주석)
      const shown = accumulateHit(
        myHits,
        hit.enemyIndex,
        hit.dealt,
        hit.killed,
        st.elapsedMs,
      );
      topField.onEnemyHit({ ...hit, dealt: shown });
      // 소리는 우리 필드만 낸다. 양쪽에서 다 울리면 초당 발생이 두 배가 되고
      // 스로틀에 걸려 정작 내 타격이 씹힌다 (설계 문서 01-7)
      playSfx(hit.killed ? "enemy_death" : "hit");
      /**
       * 큰 딜 → 게이지 마커 파동. `데미지 → 게이지` 인과를 잇는다 (README §3-2).
       *
       * **처치에만 주고 있었다.** 실측하면 60초에 처치 46회 / 20딜 넘는 타격
       * 410회 — 화면에 큰 숫자가 뜨는 사건의 대부분이 바 쪽에서 아무 반응도
       * 얻지 못했다. 스킬(power 700)이 잡몹을 못 죽이면 700이 뜨는데 바는
       * 조용하다. 상시 켜지는 것을 막는 일은 임계값·간격이 한다 (`shouldSurge`).
       *
       * 화면에 **뜬 숫자**(`shown`)로 판정한다 — 틱당 원시 딜(0.5딜)이 아니라
       * 유저가 실제로 본 덩어리가 파동의 근거여야 인과가 맞는다.
       */
      if (shouldSurge(shown, hit.killed, st.elapsedMs - lastSurgeMs)) {
        gaugeBar.surge();
        lastSurgeMs = st.elapsedMs;
      }
    }
    /**
     * 상대 딜도 같은 단위(틱당 원시 딜)다 — 코어가 그대로 넘겨준다.
     *
     * 이 러너는 스스로 전진하지 않으므로(`autoAdvance: false`) 무리를 다 쓸면
     * 다음 층까지 조용하다 — 남은 딜은 `applyDamage`가 버린다. 상대가 더 빠른
     * 만큼 아래 필드가 비어 보이는 것이 곧 "상대는 이 층을 벌써 끝냈다"다.
     * **승패에는 영향이 없다** — 게이지는 코어의 `theirTeamRawDamage`를 본다.
     */
    for (const hit of theirWaves.applyDamage(st.theirTeamRawDamage)) {
      bottomField.onEnemyHit({
        ...hit,
        dealt: accumulateHit(
          theirHits,
          hit.enemyIndex,
          hit.dealt,
          hit.killed,
          st.elapsedMs,
        ),
      });
    }
    // 웨이브 클리어 → 전진 연출 시작 (§8). 코어는 이미 다음 웨이브를 돌고 있고
    // 화면만 1.2초 뒤에서 따라간다 — **전투는 멈추지 않는다**
    const coreWave: WaveStamp = {
      waveIndex: myWaves.state.waveIndex,
      loops: myWaves.state.loops,
    };
    if (!sameWave(coreWave, shownWave) && advanceMs === null) {
      // 첫 배치는 연출 없이 즉시 (prime이 이미 깔아 뒀다)
      if (shownWave.waveIndex < 0) {
        placeWave(coreWave);
      } else {
        startAdvance();
      }
    }
    if (advanceMs !== null) advanceMs = tickAdvance(advanceMs, stepMs);
    // 레일 마커는 웨이브 내 처치 진행률을 따라간다 (§07-4-5)
    hud.setWaveProgress(waveProgress(myWaves));

    // 5) 도착한 방해 이벤트를 우리 화면에 즉시 연출 (체감 실시간)
    for (const ev of st.pendingEvents) {
      fx.playInterference(ev, split.top);
      if (ev.kind === "gauge_drain") {
        gaugeBar.shake(1);
        // 마커에서 상대 쪽으로 입자가 흐른다 — 줄어든 양은 숫자가 말하지만
        // **어디로 갔는지**는 방향이 있는 움직임만 말할 수 있다 (§9)
        gaugeBar.drain();
        // 게이지를 얼마나 빼앗겼는지 숫자로 보여준다. magnitude는 0~1 정규화
        // 게이지 단위라 100배해서 읽을 수 있는 정수로 만든다 (설계 문서 02-C6)
        topField.showInterference(ev.magnitude * 100);
      }
      banner.show("interference", interferenceNotice(ev.kind));
      // 어디서 맞았는지가 즉시 보여야 한다 — HUD 전체가 상대색으로 번쩍인다 (§3)
      hud.flashInterference();
      playSfx("interference");
    }

    // 감속 지속 표현 + **해제 알림** (§9). 지금까지는 도착만 알렸다 —
    // 언제 풀리는지 모르면 스킬을 지금 쓸지 기다릴지 판단할 수 없다
    const slowed = st.elapsedMs <= st.slowUntilMs;
    topField.setSlowed(slowed, st.slowUntilMs - st.elapsedMs);
    if (wasSlowed !== slowed) {
      if (!slowed) toast.show(interferenceEndNotice("slow"));
      // 지속 상태의 시작·끝은 프레임 하나에만 있는 사건이라 스크린샷으로
      // 잡기 어렵다 — 헤드리스 검증이 이 로그로 읽는다
      if (import.meta.env.DEV) {
        console.log(
          `[intf] slow ${slowed ? "on" : "off"} until=${st.slowUntilMs.toFixed(0)}`,
        );
      }
    }
    wasSlowed = slowed;

    /**
     * 실명 지속 표현 + 해제 알림 — 감속과 같은 구조다.
     *
     * **잠금을 매 프레임 다시 쓴다** (`syncBlindLocks`). 켜질 때 한 번만 쓰면
     * 해제 프레임에 초록 준비 링이 한 프레임 늦게 돌아온다 — 싱글의 타락 칸이
     * 같은 자리에서 같은 실패를 했고(`single/session.ts`의 `syncSkillLocks`),
     * 그쪽처럼 `skillBar.update` **앞**에 둔다.
     */
    // `blinded()`와 같은 부등호여야 한다 — 한쪽이 `<=`면 판 시작(둘 다 0)에
    // 슬롯 여섯 개가 회색으로 뜨고, 첫 프레임만 눌러도 안 나간다
    const nowBlinded = st.blindUntilMs > st.elapsedMs;
    syncBlindLocks(nowBlinded);
    if (wasBlinded !== nowBlinded) {
      if (!nowBlinded) toast.show(interferenceEndNotice("blind"));
      if (import.meta.env.DEV) {
        console.log(
          `[intf] blind ${nowBlinded ? "on" : "off"} until=${st.blindUntilMs.toFixed(0)}`,
        );
      }
    }
    wasBlinded = nowBlinded;

    hud.setTime(timeLimitMs - st.elapsedMs);
    hud.setGauge(st.gauge.pos);
    hud.setDps(st.myDps, st.theirDps);

    // 6) 임계선 임박 경고. **판당 방향별 1회만** 울린다 (설계 문서 01-7) —
    // 게이지가 임계선 주변에서 떨면 경고음이 연타되어 오히려 정보가 죽는다.
    const danger = Math.abs(st.gauge.pos) >= GAUGE_DANGER_POS;
    if (danger) {
      const side = st.gauge.pos < 0 ? -1 : 1;
      if (dangerSideWarned !== side) {
        dangerSideWarned = side;
        playSfx("gauge_danger");
      }
    } else if (Math.abs(st.gauge.pos) < GAUGE_DANGER_POS - GAUGE_DANGER_HYST) {
      // 충분히 물러났을 때만 해제한다 — 임계선 위에서 떨 때 재발화를 막는 히스테리시스
      dangerSideWarned = 0;
    }

    if (st.phase === "finished") {
      finished = true;
      // 배너 큐를 비운다 — 전장은 결과 화면 뒤에 남으므로(§08-1) 흘러가던
      // `WAVE 3` 배너가 승리 스탬프와 같은 자리에서 경쟁한다 (스크린샷에서 확인)
      banner.clear();
      // 전진·감속 연출도 여기서 끊는다. 결과 화면 뒤에서 배경이 계속 흐르거나
      // 아군이 달리고 있으면 승리 포즈(§08-1)와 경쟁한다
      advanceMs = null;
      for (const f of [topField, bottomField]) {
        f.setScrollSpeed(SCROLL_IDLE_PX_S);
        f.setAdvancing(false);
        f.setSlowed(false, 0);
      }
      // 임계 도달 흰 플래시 (§07-5). 시간 만료로 끝난 판에는 주지 않는다 —
      // 플래시는 "밀어서 끝냈다"는 의미이고, 판정승은 다른 사건이다
      if (st.winner !== null && st.elapsedMs < timeLimitMs) gaugeBar.flash();
      opts.onFinish({
        winner: st.winner,
        elapsedMs: st.elapsedMs,
        myKills: myWaves.state.killCount,
        gaugePos: st.gauge.pos,
        reason: forfeitReason
          ? "forfeit"
          : finishReason({ elapsedMs: st.elapsedMs, timeLimitMs }),
      });
    }
  };

  const render = (dtMs: number): void => {
    const st = battle.state;
    // 화면비는 게이지를 부드럽게 따라간다 — 200ms 스냅샷 사이를 메운다 (스펙 §3-6)
    renderedRatioPos = lerpRatio(renderedRatioPos, st.gauge.pos, dtMs);
    split = computeSplit(renderedRatioPos);
    relayout();
    gaugeBar.setPos(renderedRatioPos);
    // 스트라이프 방향·마커 발광은 **누적이 아니라 변화율**을 보여준다.
    // 코어가 게이지 계산에 실제로 쓴 초당 딜을 그대로 넘긴다 — 여기서 다른 값을
    // 쓰면 바가 "밀고 있다"고 그리는 동안 게이지가 반대로 갈 수 있다
    gaugeBar.setDps(st.myDps, st.theirDps);
    gaugeBar.update(dtMs);
    /**
     * **AUTO 배지가 내 아군을 세운다** — 내 칸 하나만이다(`onlyIds`).
     *
     * 여기에는 "배지는 필드를 세우지 않는다"고 적혀 있었다. 근거는 두 가지였고
     * 하나는 여전히 맞고 하나는 틀렸다:
     *
     * - (맞음) 동작만 끄면 화면이 코어를 배신한다 — AUTO OFF에서 내 캐릭터가
     *   26초간 돌진 0회로 팀 딜의 45.3%를 냈다(실측). 그래서 아래 `step`이
     *   **같은 값으로 딜도 끈다**(`myAutoDamage(…, topField.auto)`). 두 게이트가
     *   한 값을 보므로 구조적으로 갈릴 수 없다.
     * - (틀림) "AI 상대는 같은 식을 쓰므로 한쪽만 끄면 승패가 배지로 결정된다."
     *   12시드로 재니 내 칸만 껐을 때도 손을 쓰면 12/12로 이겼다(65~98초).
     *   표와 그 해석은 `sessionRules.myAutoDamage`에 있다.
     *
     * **매 프레임 다시 쓴다.** 배지 탭에서 한 번만 부르면 재대전이 새 필드를
     * 만들 때 그 필드는 기본값(`AUTO_DEFAULT_ON`)으로 출발해서, 배지에 `OFF`가
     * 적힌 채 내 캐릭터가 돌진한다 — 유저 신고 2번이 정확히 그 화면이었다.
     * 같은 값이면 아무 일도 하지 않으므로 매 프레임 불러도 싸다.
     */
    topField.setAuto(skillBar.auto, [loadout.characters[0]!.memberId]);
    /**
     * 하강은 **시간**이 정한다 (§01-1-3). 매 프레임 조금씩 내려가므로 판이
     * 끝날 때(81~84초)까지 계속 내려가는 중이다 — 예전에는 웨이브 3에 걸려
     * 0.2초에 심연으로 바뀌고 남은 80초가 한 장으로 고정돼 있었다.
     *
     * 전투 시각(`st.elapsedMs`)을 쓴다: 고정 스텝이라 결정론이 유지되고
     * (AC-4), 스크린샷 회귀가 같은 시각에 같은 색을 본다.
     */
    const depth = descentDepth(st.elapsedMs, depthFloor);
    topField.setDepth(depth);
    bottomField.setDepth(depth);
    topField.update(dtMs);
    bottomField.update(dtMs);
    beams.update(dtMs);
    fx.update(dtMs);
    hud.update(dtMs);
    banner.update(dtMs);
    toast.update(dtMs);
    hintFinger.update(dtMs);
    skillBar.update(st.elapsedMs);
    // 표현 애니메이션은 프레임 델타로 돈다 — 전투 시각(`elapsedMs`)은
    // 고정 스텝이라 눌림·펄스가 계단처럼 끊긴다
    skillBar.animate(dtMs);
    volumeBadge.update(dtMs);

    // 쿨다운 완료 차임. 초록 점등과 같은 프레임에 울려야 한다 —
    // 이게 우리 도파민 루프의 핵심이다 (설계 문서 01-7, README 3).
    // 내 스킬만 본다. 팀원(AI) 쿨다운까지 울리면 내 조작과 무관한 소리가 섞인다.
    // 실명 중에는 울리지 않는다 — 못 쓰는 스킬의 준비 차임은 거짓 신호다.
    // (해제 프레임에 그동안 돌아온 것들이 한꺼번에 울리는 것은 맞는 소리다)
    const readyIds = new Set(
      blinded()
        ? []
        : myCooldowns.readySkills(st.elapsedMs).map((s) => s.id),
    );
    for (const id of readyIds) {
      if (!prevReadyIds.has(id)) playSfx("cooldown_ready");
    }
    prevReadyIds = readyIds;
  };

  const loop = createLoop({ step, render });

  const prime = (): void => {
    // 레이아웃부터 게이지 시작 위치에 맞춘다 — `?gauge=`로 진입할 때
    // 필드 높이가 먼저 정해져야 캐릭터·HP바가 제자리에 그려진다
    split = computeSplit(renderedRatioPos);
    relayout();
    gaugeBar.setPos(renderedRatioPos);
    /**
     * 깊이를 **적보다 먼저** 세운다. 테마가 환경광이라 캐릭터 틴트가 여기서
     * 나오는데, 적을 깐 뒤에 깊이를 주면 첫 프레임의 적이 지상 틴트로 뜬다
     * (`?wave=3` 스크린샷에서 티가 난다). 첫 호출은 크로스페이드 없이 즉시다.
     */
    const depth0 = descentDepth(battle.state.elapsedMs, depthFloor);
    topField.setDepth(depth0);
    bottomField.setDepth(depth0);
    topField.setWave(myWaves.currentWave);
    bottomField.setWave(theirWaves.currentWave);
    shownWave = {
      waveIndex: myWaves.state.waveIndex,
      loops: myWaves.state.loops,
    };
    // setWave는 값이 같으면 아무 일도 안 한다 — 시작 웨이브가 0이어도
    // 라벨이 "WAVE 1"로 초기화돼 있으므로 표기는 맞다
    hud.setWave(shownWave.waveIndex);
    hud.setGauge(renderedRatioPos);
  };

  return {
    prime,
    start(): void {
      prime();
      // 첫 스킬 슬롯 위에 손가락. 이미 한 번 눌러 본 유저면 아무 일도 없다
      const firstSlot = skillBar.slotCenter(loadout.skills[0]?.id ?? "");
      if (firstSlot) {
        // 슬롯 위가 아니라 슬롯 안쪽 모서리에 매단다 — 위쪽은 모드마다 이웃이
        // 다르다(싱글은 강화 줄이 44px 위에 있다). `fingerAnchor` 주석 참고
        const at = fingerAnchor(firstSlot.x, firstSlot.y, firstSlot.d);
        hintFinger.showAt(at.x, at.y);
      }
      // 시작 시점에 모든 스킬이 이미 준비 상태다. 미리 채워두지 않으면
      // 첫 프레임에 차임이 4개 동시에 터진다.
      prevReadyIds = new Set(myCooldowns.readySkills(0).map((s) => s.id));
      resetSfxThrottle();
      loop.start();
    },
    stop(): void {
      loop.stop();
      // 배너 큐를 비운다 — 씬을 나간 뒤에도 남아 있으면 다음 씬 위에 뜬다
      banner.clear();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      banner.clear();
      // 위젯이 각자 자기 자식을 파괴한다 — 레이어에서 떼기만 하면
      // Spine·텍스처는 그대로 남는다
      hud.destroy();
      topField.destroy();
      bottomField.destroy();
      gaugeBar.destroy();
      skillBar.destroy();
      volumeBadge.destroy();
      beams.destroy();
      fx.destroy();
      banner.destroy();
      toast.destroy();
      hintFinger.destroy();
    },
    celebrate(turn: number): void {
      if (destroyed) return;
      // 로드아웃 순서가 곧 필드 배치 순서다 (battleField가 같은 배열을 받는다)
      const who = celebrateAttacker(turn, teamSize);
      const member = loadout.characters[who];
      if (member) topField.onAllyAttack(member.memberId);
    },
    forfeit(team: 0 | 1): void {
      forfeitReason = true;
      const st = battle.forfeit(team);
      finished = true;
      loop.stop();
      opts.onFinish({
        winner: st.winner,
        elapsedMs: st.elapsedMs,
        myKills: myWaves.state.killCount,
        gaugePos: st.gauge.pos,
        reason: "forfeit",
      });
    },
    get state(): BattleState {
      return battle.state;
    },
  };
}
