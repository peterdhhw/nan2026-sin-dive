import type { MatchResult, MatchSlot } from "../net/matchmaking";
import {
  autoAttackDamage,
  type AutoAttacker,
  type MemberDamage,
} from "../core/team";

/**
 * 세션의 순수 규칙. session.ts와 분리한 이유는 fxMapping·skillRules·loopMath와 같다 —
 * pixi.js를 import하는 모듈은 node 테스트 환경에서 불러올 수 없다.
 * session.ts가 이 세 함수를 그대로 re-export하므로 계획서의 공개 API는 유지된다.
 */

/**
 * AUTO 배지를 반영한 우리 팀 자동 공격 딜. **OFF면 내 칸(0번)이 빠진다.**
 *
 * 유저 신고: "auto off여도 내 캐릭터가 공격하는 이슈 있어."
 *
 * ## 앞선 결정을 뒤집었다 — 논거를 재 봤고 틀렸다
 *
 * 이 자리에는 "배지를 딜에 걸면 승패가 배지 하나로 결정된다"는 기록이 있었다
 * (양 팀이 같은 코어 식을 쓰므로 한쪽만 끄면 기울어진다). 12시드로 재면:
 *
 * | 끄는 범위 | 손을 쓴 판 | 손을 놓은 판 |
 * | --- | --- | --- |
 * | 안 끔(예전) | 12/12 승 49~65초 | 12/12 패 (시간초과, 게이지 −0.39~−0.66) |
 * | 내 칸(지금) | 12/12 승 65~98초 | 12/12 패 (게이지 −0.80) |
 * | 팀 전원 | **0/12 승** (전부 시간초과) | 12/12 패 38~51초 |
 *
 * 가운데 줄이 그 논거를 닫는다: 내 칸을 껐어도 **손을 쓰면 12/12로 이긴다.**
 * 판을 정하는 것은 배지가 아니라 행동이고, 배지가 바꾸는 것은 이기는 데 걸리는
 * 시간(49~65 → 65~98초)뿐이다. 아래 줄이 범위를 내 칸으로 묶는 이유다 — 팀
 * 전원을 끄면 난사해도 임계선에 못 닿아서, 배지가 "손을 놓아도 되는가"가 아니라
 * "이 판을 포기하는가"가 된다.
 *
 * ## 무엇을 안 끄는가
 *
 * 직접 누른 스킬의 분산분(`castQueue.drain`)과 **AI 팀원**은 여기 안 들어온다 —
 * 배지 문구가 그 경계를 말한다(`autoScopeNotice`의 `"skill"`: "팀은 계속 싸운다").
 *
 * ## 왜 삼항으로 쓰지 않는가
 *
 * 판정이 `session.ts` 안에만 있으면 node가 그 갈래를 못 밟는다(Pixi를 끌어온다).
 * 싱글에서 같은 결함이 그 이유로 조용히 살아 있었다 — 돌진 0회·타격 0회인 내
 * 캐릭터가 팀 딜의 45.3%를 냈다(`single/sessionRules.autoTeamDamage`).
 *
 * `auto`는 **전장에서 읽는다**(`field.auto`). 세션이 배지 상태를 따로 들면
 * 모션과 딜이 두 값을 보게 되고, 갈리는 순간이 정확히 그 결함이다.
 */
export function myAutoDamage(
  chars: readonly AutoAttacker[],
  stepMs: number,
  auto: boolean,
): MemberDamage[] {
  // 0으로 채워 넣지 않고 **뺀다** — 남기면 필드가 그 id로 슬롯을 찾아
  // 딜 0인 타격 연출을 세운다
  return autoAttackDamage(auto ? chars : chars.slice(1), stepMs);
}

/** 내 팀(team 0) 슬롯 목록 */
export function myTeamSlots(match: MatchResult): MatchSlot[] {
  return match.slots.filter((s) => s.team === 0);
}

/** 내가 아닌 우리 팀 슬롯 id — 이 슬롯들은 내 클라이언트가 로컬 시뮬레이션한다 (스펙 §3-7) */
export function aiTeammateIds(match: MatchResult): string[] {
  return myTeamSlots(match)
    .filter((s) => s.slotId !== match.mySlotId)
    .map((s) => s.slotId);
}

/** 임계치 선착인지 제한시간 백스톱인지 구분 */
export function finishReason(a: {
  elapsedMs: number;
  timeLimitMs: number;
}): "threshold" | "timeLimit" {
  return a.elapsedMs >= a.timeLimitMs ? "timeLimit" : "threshold";
}

/**
 * 임계선 임박 경고가 울리는 게이지 절대값 (설계 문서 01-7).
 * 승패 임계치 0.8보다 앞이라 "곧 진다/이긴다"를 미리 알린다.
 */
export const GAUGE_DANGER_POS = 0.7;

/**
 * 경고 해제 히스테리시스. 0.7 근처에서 게이지가 떨 때 경고음이 연타되면
 * 정보가 아니라 노이즈가 된다 — 0.65 아래로 물러나야 다시 울릴 수 있다.
 */
export const GAUGE_DANGER_HYST = 0.05;

/**
 * 승리 축하 포즈 주기 (§08-1: 200~700ms에 아군 승리 포즈 **반복**).
 *
 * 리그에 승리 전용 애니메이션이 없어서 `attack`을 재활용한다 — 한 번만 치면
 * 전투 중 평타와 구분이 안 되므로 번갈아 반복해야 "축하"로 읽힌다.
 */
export const CELEBRATE_PERIOD_MS = 620;

/**
 * `turn`번째 축하 포즈를 취할 아군 인덱스.
 *
 * 전원이 동시에 치면 한 덩어리로 보인다 — 순서대로 돌려서 두 명이 번갈아
 * 환호하는 그림을 만든다.
 */
export function celebrateAttacker(turn: number, count: number): number {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return 0;
  const t = Number.isFinite(turn) ? Math.max(0, Math.floor(turn)) : 0;
  return t % n;
}

/**
 * 시전 공지를 **누가 했는가**로 갈라준다.
 *
 * 왜 필요한가: `castSkill`은 나와 AI 팀원이 **공용**이다(`session.step`이
 * 팀원 판단 결과를 같은 함수로 넘긴다). 그래서 팀원이 방해를 쓰면 내가 누른
 * 것과 **글자 하나 다르지 않은** 배너가 떴다 — 입력 0회로 118초를 돌린 캡처에
 * `심연의 장막 → 상대`가 찍혀 있고, 그 판에서 나는 아무것도 안 눌렀다.
 * 유저가 "AUTO를 안 켰는데 자동으로 동작한다"고 읽은 것의 가장 큰 몫이 이것이다.
 *
 * 광선(`fireCastBeam`)은 이미 `memberId`로 갈라져 있었다 — 그 근거("내가 누른
 * 것이 어느 것인지 안 보인다")가 배너에도 그대로 적용되는데 배너만 안 갈라져
 * 있었다. 같은 판정을 여기 한 곳에 둔다.
 *
 * **딜·밸런스는 건드리지 않는다.** 팀원의 시전은 그대로 나가고 표기만 갈린다.
 */
export function castActorLabel(isMine: boolean): string {
  return isMine ? "" : "팀원 · ";
}

/**
 * 시전 공지 배너 종류 — `mine`이면 내 것, 아니면 팀원 것.
 *
 * 색과 **배너 슬롯**이 같이 갈린다: `bannerAction`이 종류당 한 장을 주므로
 * 내 공지가 팀원 것에 밀려 사라지지 않는다(`BannerKind` 주석에 유래를 적었다).
 * 문구 접두사만 바꾸면 1.26초에 스쳐 가는 배너에서 못 읽는다.
 */
export function castBannerKind(isMine: boolean): "myCast" | "teammate" {
  return isMine ? "myCast" : "teammate";
}

/**
 * 도착한 방해 이벤트를 알리는 중앙 공지 문구.
 *
 * **`blind`가 여기 있어야 하는 이유** (2026-08-06): 실명은 스킬바를 잠그므로
 * 눌러도 아무 일이 안 일어난다. 종류를 안 알려 주면 그 몇 초가 "맞았다"가 아니라
 * **버튼이 고장난 것**으로 읽힌다 — 다른 세 방해는 화면에 결과가 보이지만
 * (감속=딜, 증원=적, 게이지) 실명은 결과가 **아무 일도 안 일어남**이기 때문에
 * 문구가 유일한 단서다. `blind`가 연출 전용이던 동안엔 잠금 자체가 없었다.
 */
export function interferenceNotice(kind: string): string {
  switch (kind) {
    case "slow":
      return "⚡ 감속당했다!";
    case "blind":
      return "🌑 시야를 잃었다 — 시전 불가!";
    case "gauge_drain":
      return "게이지를 빼앗겼다!";
    case "spawn_adds":
      return "적이 증원됐다!";
    default:
      return "방해당했다!";
  }
}

/**
 * 웨이브 내 처치 진행률 0..1 — WaveRail 마커가 이 값으로 움직인다 (§07-4-5).
 *
 * 처치 수가 아니라 **남은 HP 총합**으로 센다. 처치 수만 쓰면 적 4마리 웨이브에서
 * 마커가 0 → 0.25로 네 번 튀고, 보스 웨이브(1마리)는 죽는 순간까지 0에 붙어 있다.
 */
export function waveProgress(runner: {
  state: { enemyHp: number[] };
  currentWave: { enemies: readonly { hp: number }[] };
}): number {
  const max = runner.currentWave.enemies.reduce((a, e) => a + e.hp, 0);
  if (!(max > 0)) return 0;
  const left = runner.state.enemyHp.reduce((a, hp) => a + Math.max(0, hp), 0);
  return Math.max(0, Math.min(1, 1 - left / max));
}
