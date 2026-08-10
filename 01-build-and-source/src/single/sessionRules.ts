/**
 * 싱글 세션의 순수 규칙 — 수치·판정 전부 여기 있다 (Pixi 없음, Vitest가 읽는다).
 * `single/session.ts`가 이 규칙을 소비하고 그대로 re-export 한다.
 *
 * 설계 문서: docs/SINGLE-BRIEF.md §3-2, PvP 원형은 src/pvp/sessionRules.ts
 */

import { FINAL_FLOOR } from "../core/phase/floors";
import { corruptionAtkMul } from "../core/corruption/corruption";
import { cardAtkMul } from "../core/deck/deck";
import {
  autoAttackDamage,
  type AutoAttacker,
  type MemberDamage,
} from "../core/team";
import { easeInCubic, easeOutCubic } from "../shared/tween";
import { floorKindOf } from "../core/phase/phaseWaves";

/**
 * 팀 크기 — **1인**(조작 캐릭터만).
 *
 * 2인이던 근거는 "PvP 전장과 같아서 밸런스 실측이 그대로 유효하다"였다. 그
 * 실측이 두 번째 자리를 부정한다: 싱글에서 **스킬은 조작 캐릭터만 쓴다**
 * (`session.ts`의 `onCast`가 `characters[0]`에만 시전하고, AUTO도 같은 콜백을
 * 지난다). PvP는 다르다 — `pvp/session.ts`가 AI 팀원에게도 `castSkill`을 돌린다.
 *
 * 밸런스 문서 §4-2 실측: 스킬 사이클 239.8dps, 평타는 캐릭터당 36.7~82.9dps.
 * 즉 2인의 두 번째 자리는 **평타만 내는 장식**이었고 총딜 기여가 16%다
 * (53.7 / (44.4 + 53.7 + 239.8)). 그 16%는 `SOLO_HP_SCALE`이 메운다.
 */
export const SINGLE_TEAM_SIZE = 1;

/**
 * 스킬을 시전하는 팀원 수. `session.ts`가 `characters.slice(0, this)`에 시전한다.
 *
 * **`SINGLE_TEAM_SIZE`와 같아야 한다**(테스트가 그 부등식을 묻는다). 시전자보다
 * 팀이 크면 나머지는 평타만 내는 장식이고, 그 상태가 조용히 남으면 "왜 2인인데
 * 딜이 1.16배인가"를 나중에 다시 재게 된다(`only-reachable-cases-count`).
 *
 * 하드코딩된 `characters[0]`을 대신한다 — 상수만 있고 배선이 안 쓰면 검사가
 * 상수를 복창하는 줄이 된다(`mocks-hide-the-mocked-function`).
 */
export const SINGLE_SKILL_CASTERS = 1;

/** 웨이브 창 크기 — 9,999층을 이만큼씩 잘라 러너에 넘긴다 */
export const WINDOW_FLOORS = 200;

/** 남은 웨이브가 이만큼 이하가 되면 다음 창으로 갈아탄다 */
export const WINDOW_REBUILD_MARGIN = 2;

/**
 * 창을 다시 만들어야 하는가. 러너가 창 끝에 닿기 전에 갈아타야 마지막
 * 웨이브 반복(loops)이 최종층(9,999)이 아닌 곳에서 일어나지 않는다.
 */
export function needsWindowRebuild(waveIndex: number, windowLen: number): boolean {
  if (!Number.isFinite(waveIndex) || !Number.isFinite(windowLen)) return false;
  return windowLen - 1 - waveIndex <= WINDOW_REBUILD_MARGIN;
}

/** 스와이프 러시 지속 시간 */
export const RUSH_MS = 3000;

/** 러시 중 팀 딜 배율 — "하강 가속"의 실체. 연속 스와이프는 지속을 갱신한다 */
export const RUSH_DAMAGE_MULT = 1.5;

export function rushActive(nowMs: number, rushUntilMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs < rushUntilMs;
}

/**
 * 하강 콤보 — 직전 층 클리어에서 이 시간 안에 또 클리어하면 콤보가 쌓인다.
 * 팀 데모 영상(스와이프 콤보 Idea B)의 코드화: 콤보는 골드 배율로만 작동한다.
 */
export const COMBO_WINDOW_MS = 8000;

/** 콤보 1당 골드 배율 증가분 */
export const COMBO_GOLD_STEP = 0.25;

/** 콤보 골드 배율 상한 (데모 표기 최대 3배) */
export const COMBO_GOLD_CAP = 3;

/** 층 클리어 시점의 다음 콤보 값. 창 안이면 +1, 벗어나면 0부터 */
export function nextCombo(prevCombo: number, sinceLastClearMs: number): number {
  const prev = Number.isFinite(prevCombo) ? Math.max(0, Math.floor(prevCombo)) : 0;
  return sinceLastClearMs <= COMBO_WINDOW_MS ? prev + 1 : 0;
}

export function comboGoldMul(combo: number): number {
  const c = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
  return Math.min(COMBO_GOLD_CAP, 1 + c * COMBO_GOLD_STEP);
}

/** 진행 저장 주기 — 이보다 자주 쓰면 localStorage가 매 틱 갈린다 */
export const SAVE_EVERY_MS = 5000;

/**
 * AUTO 배지를 반영한 자동 공격 딜. **꺼져 있으면 빈 배열이다.**
 *
 * ## 왜 세션에서 삼항으로 쓰지 않는가 (유저 신고 2번)
 *
 * "Auto를 키면 자동으로 잡는데, 안 키면 캐릭터가 움직이면 안 된다고 생각하거든?
 * 근데 계속 움직여, 오토하던 안 하던."
 *
 * 유저가 고른 범위는 **"동작도 딜도 함께 멈춘다"**다. 판정이 `session.ts`의
 * `step()` 안에만 있으면 node가 그 갈래를 못 밟는다 — 그 파일은 Pixi를 끌어오므로
 * 테스트가 부를 수 없다. 그러면 "OFF인데 딜이 난다"는 **실제로 있었던** 결함이
 * 다시 들어와도 조용하다: 실측에서 돌진 0회·타격 0회인 내 캐릭터가 팀 딜의
 * 45.3%(44.4 raw dps)를 냈다.
 *
 * ## 무엇을 안 끄는가
 *
 * 직접 누른 스킬의 분산분(`castQueue.drain`)은 여기 안 들어온다. 유저 요구는
 * "혼자 진행되지 않는 것"이고 손으로 누른 스킬은 혼자 난 일이 아니다 — 배지
 * 문구가 그 경계를 말한다(`autoScopeNotice("battle")`의 "스킬은 직접 누른다").
 *
 * `auto`를 필드에서 읽는 것이 계약이다(`field.auto`). 세션이 배지 상태를 따로
 * 들면 동작과 딜이 두 값을 보게 되고, 갈리는 순간이 위 결함이다.
 */
export function autoTeamDamage(
  chars: readonly AutoAttacker[],
  stepMs: number,
  auto: boolean,
): MemberDamage[] {
  return auto ? autoAttackDamage(chars, stepMs) : [];
}

/**
 * 팀 딜에 곱하는 배율의 합성 — 버프 스킬 × 타락도 단계 × 스와이프 러시 × 덱.
 * 자동공격·스킬 분산분 모두에 곱한다 (PvP의 buffMult 자리와 같다).
 *
 * **덱(카드 수)이 여기 들어오는 것이 3단계다.** 카드는 이기면 한 장씩
 * 늘어나는데 그 수가 지금까지 카드함 숫자에만 있었다 — 곱을 한 곳으로 모아야
 * 두 배율이 서로를 모르는 채 각자 걸리는 일이 생기지 않는다. 곡선은
 * `core/deck.cardAtkMul`이 갖는다(밸런스는 두 모드 공용).
 *
 * @param cardCount 보유 카드 장수. 안 주면 0 = 효과 없음 — 카드함이 없는
 *   호출부(갤러리·디버그 프리뷰)가 배율을 억지로 1로 만들지 않게 한다.
 */
export function totalDamageMult(
  buffMult: number,
  corruption: number,
  rush: boolean,
  cardCount = 0,
): number {
  const buff = Number.isFinite(buffMult) && buffMult > 0 ? buffMult : 1;
  return (
    buff *
    corruptionAtkMul(corruption) *
    (rush ? RUSH_DAMAGE_MULT : 1) *
    cardAtkMul(cardCount)
  );
}

/**
 * 층 전환 = 세로 하강 슬라이드 (2026-08-03 정호 확정).
 *
 * PvP의 전진 연출(가로 스크롤·달리기)은 "같은 층을 앞으로 민다"는 그림이라
 * 하강 모드의 정체성과 어긋난다. 싱글은 숏츠 문법 그대로: 클리어하면 현재
 * 층이 **위로 빠지고**(카메라가 내려간다) 다음 층이 **아래에서 올라온다**.
 * 나가는 쪽은 easeIn(가속 — 떨어지기 시작), 들어오는 쪽은 easeOut(감속 —
 * 착지)이라 한 번의 낙하로 읽힌다.
 */
export const DIVE_SLIDE_OUT_MS = 280;

export const DIVE_SLIDE_IN_MS = 340;

export const DIVE_SLIDE_TOTAL_MS = DIVE_SLIDE_OUT_MS + DIVE_SLIDE_IN_MS;

/**
 * 슬라이드 경과 → 전장 컨테이너의 y 오프셋(px).
 * 나가는 구간: 0 → −fieldH (위로 퇴장). 스왑 후: +fieldH → 0 (아래에서 착지).
 * 스왑 시점(OUT_MS 경계)은 호출자가 advanceCrossed로 잡아 placeFloor 한다.
 */
export function diveSlideOffset(elapsedMs: number, fieldH: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(fieldH)) return 0;
  if (elapsedMs <= 0 || elapsedMs >= DIVE_SLIDE_TOTAL_MS) return 0;
  if (elapsedMs < DIVE_SLIDE_OUT_MS) {
    return -fieldH * easeInCubic(elapsedMs / DIVE_SLIDE_OUT_MS);
  }
  return fieldH * (1 - easeOutCubic((elapsedMs - DIVE_SLIDE_OUT_MS) / DIVE_SLIDE_IN_MS));
}

/**
 * '심연의 선택'을 제안하는 주기 — **50층마다** (보스 층 클리어 직후).
 *
 * ## 왜 100(네임드 보스)이 아닌가 — 6번째 칸이 대전에 안 나오던 이유 (2026-08-06)
 *
 * 이 값이 `NAMED_BOSS_EVERY`(100)였다. 그러면 대전이 열리는 층
 * (`PVP_UNLOCK_FLOOR` = 100)까지 제안이 **최대 한 번**이고, 타락도는
 * `corruptionFromFloor(100)`(=12) + `CHOICE_CORRUPTION`(=10) = **22**에서 멈춘다.
 * 타락 칸은 각성(30)에서 열리므로(`CORRUPTION_SKILL_STAGE`) 6번째 칸이 대전에
 * **구조적으로 도달 불가**했다 — 깊이만으로 30에 닿으려면 625층이고, 대전을
 * 여는 층은 100층이다. 두 상수가 서로를 배제하고 있었다.
 *
 * 50이면 대전 해금 시점에 제안이 두 번(50·100층)이고, 둘 다 받아들이면
 * 12 + 20 = 32 ≥ 30이다 — 이건 새로 만든 페이스가 아니라 `corruption.ts`의
 * `CORRUPTION_SKILL_STAGE` 주석이 **이미 데모 경로로 적어 둔 값**("100층 + 선택
 * 두 번 = 32")이다. 즉 문서가 말하던 경로를 코드가 못 만들고 있었다.
 *
 * 50층도 보스 층이다(`MINIBOSS_EVERY` = 10의 배수) — "보스가 남긴 심연의 마력"
 * (`CHOICE_BODY`)이라는 서사가 그대로 성립한다. 더 잘게(10층마다) 쪼개지 않은
 * 이유: 100층까지 제안이 열 번이면 타락도가 선택만으로 100에 닿아 5단계
 * 전부가 첫 세션에 지나가고, 엔딩 분기(70)가 의미를 잃는다.
 *
 * **이 값을 옮기면 `tests/singleSessionRules.test.ts`의 도달성 계약이 깨진다** —
 * 거기서 세 상수(대전 해금 층·이 주기·해금 단계)를 한 부등식으로 묶어 뒀다.
 * 그게 이 결함이 조용히 돌아오지 못하게 하는 유일한 검사다.
 */
export const CHOICE_EVERY = 50;

/** '심연의 선택'을 제안하는 층 — 보스 층 클리어 직후 (`CHOICE_EVERY`) */
export function isChoiceFloor(floor: number): boolean {
  return Number.isFinite(floor) && floor > 0 && floor % CHOICE_EVERY === 0;
}

/**
 * 이 층까지 내려온 사람이 받은 '심연의 선택' 제안 횟수.
 *
 * 도달성 계약(위 주석)이 이걸로 표현된다 — 제안 횟수를 손으로 세면
 * 주기를 바꾼 날 계약만 옛 값에 남는다.
 */
export function choiceOffersUpTo(floor: number): number {
  if (!Number.isFinite(floor) || floor <= 0) return 0;
  return Math.floor(floor / CHOICE_EVERY);
}

/** 층 도장 — 창이 갈리면 waveIndex가 리셋되므로 PvP의 WaveStamp 대신 층 번호로 센다 */
export interface FloorStamp {
  floor: number;
  loops: number;
}

export function sameFloorStamp(a: FloorStamp, b: FloorStamp): boolean {
  return a.floor === b.floor && a.loops === b.loops;
}

/** 엔딩 도달 — 최종층(9,999)의 무리를 한 번이라도 다 쓸었다(러너 loops가 돌았다) */
export function endingReached(floor: number, loops: number): boolean {
  return floor === FINAL_FLOOR && loops > 0;
}

/**
 * 배경 깊이(0..1)가 최대가 되는 층. PvP는 시간축(90초)으로 내려가지만 싱글의
 * 하강은 층이 정체성이므로 층으로 매핑한다. 60층이면 첫 세션 안에 심연
 * 팔레트가 완성된다 — 테마가 2종뿐이라 그 뒤로는 색이 고정된다(GAPS.md §3).
 */
export const DEPTH_FULL_FLOOR = 60;

/** 층 → 배경 깊이. `field.setDepth`에 넣는 0..1 */
export function depthForFloor(floor: number): number {
  if (!Number.isFinite(floor)) return 0;
  return Math.max(0, Math.min(1, floor / DEPTH_FULL_FLOOR));
}

/** HUD 층 표기: "53F" — 데모 영상의 표기를 따른다 */
export function floorLabel(floor: number): string {
  return `${Math.max(1, Math.floor(floor))}F`;
}

/** 층 클리어 배너: PvP의 waveClearLabel 대응 */
export function floorClearLabel(floor: number): string {
  return `${Math.max(1, Math.floor(floor))}층 돌파`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 층 돌파 쇼케이스 (유저 신고 2026-08-09)
 *
 * "10층 내려갈 때마다 pvp 이겼을 때처럼 캐릭터 보여주고, 카드 얻어달라고
 * 했는데, 반영 안 된 것 같아."
 *
 * **카드는 이미 나왔다.** `cardsForFloorClear`가 미니보스 층마다 한 장을 주고
 * `grantFloorCards`가 그걸 받는다 — 빠져 있던 것은 **보여 주는 쪽**이다. 지급은
 * 1.8초 토스트 한 줄이 전부였고(`TOAST_HOLD_MS`), 그 줄은 층 돌파 배너·콤보·
 * 골드 숫자가 같이 뜨는 프레임에 섞여서 "카드를 얻었다"로 읽히지 않는다.
 * 신고가 "반영 안 된 것 같아"인 이유다 — 기능이 아니라 인지의 문제였다.
 *
 * 그래서 지급 경로는 손대지 않고 **연출만** 얹는다. 카드를 여기서 다시 주면
 * 10층마다 두 장이 나가고, 그건 신고보다 나쁜 결함이다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 쇼케이스가 뜨는 층인가 — 미니보스 주기와 **같은 값을 본다.**
 *
 * `MINIBOSS_EVERY`를 재export해서 쓴다: 10을 여기 다시 적으면 카드가 나오는
 * 층과 축하가 뜨는 층이 갈릴 수 있고, 그게 정확히 이 신고의 모양이다
 * (한쪽만 일어나면 유저는 "반영 안 됐다"고 읽는다).
 */
export function isShowcaseFloor(floor: number): boolean {
  return (
    Number.isFinite(floor) && floor > 0 && floorKindOf(floor) !== "minions"
  );
}

/**
 * 워드마크 — 몇 층을 돌파했는가.
 *
 * **`floorLabel`을 그대로 쓴다.** 큰 글자가 말하는 값과 HUD가 계속 보여 주는
 * 값이 같은 것(`53F`)이어야 "내가 지금 어디까지 왔다"가 한 번에 읽힌다. 여기에
 * `"10층 돌파"`를 따로 적으면 같은 수를 두 표기로 말하게 되고, 표기를 고친 날
 * 한쪽만 바뀐다.
 *
 * 층 돌파 **배너**(`floorClearLabel` = `"10층 돌파"`)와 다른 문구인 것은
 * 의도다 — 배너는 이 오버레이 아래에서 같은 프레임에 뜬다(`DIVE_FX_STACK`).
 * 같은 글자를 두 크기로 겹쳐 놓으면 한 줄이 두 번 찍힌 것으로 보인다.
 */
export function showcaseWord(floor: number): string {
  return floorLabel(floor);
}

/** 워드마크 아래 한 줄 — 네임드 보스와 미니보스를 구별해 말한다 */
export function showcaseSub(floor: number): string {
  return floorKindOf(floor) === "boss" ? "네임드 보스 격파" : "미니보스 격파";
}
