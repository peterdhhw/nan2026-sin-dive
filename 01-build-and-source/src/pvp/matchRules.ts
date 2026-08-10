/**
 * 매칭 씬의 순수 규칙 — 카운트다운 링, 슬롯 배치, 확정 연출 타이밍.
 *
 * 설계 문서: specs/2026-07-27-ux/05-scene-matchmaking.md §3~5
 *
 * Pixi를 import하지 않는다 (`matchScene.ts`가 재export한다).
 */

import { ACCENT_GOLD, TEAM_OURS, TEAM_THEIRS } from "../shared/theme";

/**
 * 대기 화면의 로고 배율. 타이틀(1.0)보다 작다 — 여기서는 로고가 주인공이 아니다.
 *
 * 규칙 파일에 두는 이유: 로고 오른쪽 빈 자리에 카드함 입구 버튼이 놓이므로
 * (§10-3) 둘이 겹치는지를 node 테스트가 이 값으로 계산한다(`logoWidth`).
 */
export const MATCH_LOGO_SCALE = 0.42;

/** 카운트다운 링 (§05-2: 지름 148, 두께 12) */
export const RING_D = 148;
export const RING_W = 12;

/** 슬롯 카드의 폭 비율 (§05-2: 폭 44%). 이 화면의 배치값이다 */
export const CARD_W_RATIO = 0.44;
// 카드 높이는 `shared/viewport.ts`로 올라갔다 — 삽화를 몇 px로 굽는지의 기준이라
// (`gen_portraits.py`의 `REF_CARD_H`와 대조) 매칭 화면만의 값이 아니다.
export { CARD_H } from "../shared/viewport";

/**
 * 링 색은 남은 비율로 갈린다 (§05-4).
 *
 * 100~40% 우리색 → 40~15% 금색 → 15% 미만 상대색 + 펄스.
 * 숫자만으로는 "얼마 안 남았다"가 안 읽힌다 — 색이 먼저 눈에 들어온다.
 */
export function ringColor(remainRatio: number): number {
  const r = Number.isFinite(remainRatio)
    ? Math.max(0, Math.min(1, remainRatio))
    : 0;
  if (r >= 0.4) return TEAM_OURS;
  if (r >= 0.15) return ACCENT_GOLD;
  return TEAM_THEIRS;
}

/** 15% 미만에서만 링이 뛴다 — 항상 뛰면 5초 내내 시선을 잡아먹는다 */
export function ringUrgent(remainRatio: number): boolean {
  const r = Number.isFinite(remainRatio) ? remainRatio : 0;
  return r < 0.15;
}

/** 링 스윕 각(라디안). 12시에서 시작해 **시계 반대**로 줄어든다 (§05-2) */
export function ringSweep(remainRatio: number): number {
  const r = Number.isFinite(remainRatio)
    ? Math.max(0, Math.min(1, remainRatio))
    : 0;
  return r * Math.PI * 2;
}

/** 슬롯 채움 플러리시 (§05-3: 320ms easeOutBack) */
export const FLOURISH_MS = 320;

/**
 * 카드 스케일 0.85 → 1.06 → 1.0. `easeOutBack`을 직접 쓰지 않는 이유는
 * 오버슈트 정점(1.06)을 스펙 값으로 고정해야 하기 때문이다.
 */
export function flourishScale(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 1;
  if (elapsedMs >= FLOURISH_MS) return 1;
  const t = elapsedMs / FLOURISH_MS;
  // 전반 60%에 0.85→1.06, 후반 40%에 1.06→1.0
  if (t < 0.6) {
    const k = t / 0.6;
    return 0.85 + (1.06 - 0.85) * (1 - (1 - k) ** 3);
  }
  const k = (t - 0.6) / 0.4;
  return 1.06 + (1.0 - 1.06) * k;
}

/** 채워진 순간의 흰 플래시 알파 */
export function flourishFlash(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  if (elapsedMs >= FLOURISH_MS) return 0;
  return 1 - elapsedMs / FLOURISH_MS;
}

/** 대기 카드의 `⋯` 점멸 주기 (§05-3: 1.2s) */
export const DOTS_PERIOD_MS = 1_200;

/** 세 점 중 지금 밝은 점의 인덱스 */
export function dotPhase(elapsedMs: number): number {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return Math.floor((t % DOTS_PERIOD_MS) / (DOTS_PERIOD_MS / 3));
}

/** 확정 연출 (§05-5): 0.9초 유지 후 120ms 흰 플래시 */
export const CONFIRM_HOLD_MS = 900;
export const CONFIRM_FLASH_MS = 120;
export const CONFIRM_TOTAL_MS = CONFIRM_HOLD_MS + CONFIRM_FLASH_MS;
/** 빈 슬롯이 AI로 바뀌는 간격 (§05-5) */
export const AI_FILL_STAGGER_MS = 120;

/** 스탬프 스케일 1.4 → 1.0 */
export function stampScale(elapsedMs: number): number {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const d = 260;
  if (t >= d) return 1;
  return 1.4 + (1 - 1.4) * (1 - (1 - t / d) ** 3);
}

/** 확정 마지막 120ms의 흰 플래시 */
export function confirmFlashAlpha(elapsedMs: number): number {
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  if (t < CONFIRM_HOLD_MS) return 0;
  if (t >= CONFIRM_TOTAL_MS) return 1;
  return (t - CONFIRM_HOLD_MS) / CONFIRM_FLASH_MS;
}

/**
 * 슬롯 채움 순서가 몇 번째 AI인지 → 그 슬롯이 채워지는 시각.
 * 전부 동시에 바뀌면 "채워지는 과정"이 안 보인다 (§05-5).
 */
export function aiFillAtMs(order: number): number {
  const n = Number.isFinite(order) ? Math.max(0, Math.floor(order)) : 0;
  return n * AI_FILL_STAGGER_MS;
}

export type SlotCardKind = "empty" | "me" | "human" | "ai";

/**
 * 카드 테두리 색 (§05-3).
 *
 * 내 카드만 금색이다 — 네 칸 중 어디가 나인지 한눈에 찾을 수 있어야 한다.
 */
export function cardBorder(kind: SlotCardKind, team: 0 | 1): number {
  if (kind === "me") return ACCENT_GOLD;
  if (kind === "empty") return 0x6a6480;
  if (kind === "ai") return 0x8a84a0;
  return team === 0 ? TEAM_OURS : TEAM_THEIRS;
}

/** 카드가 비어 있는가 — 점선 테두리·점멸 점을 그릴지 결정한다 */
export function isEmptyCard(kind: SlotCardKind): boolean {
  return kind === "empty";
}

/**
 * 대기 중 사람이 채워지는 **카드 순서** (§05-3 "양쪽에서 같은 그림").
 *
 * 카드는 `MatchResult.slots` 순서, 즉 `[t0s0, t0s1, t1s0, t1s1]`로 놓여 있다.
 * 앞에서부터 채우면 두 번째 합류자가 **우리 팀**에 앉는데, 실제 배정은
 * 명단 인덱스 홀짝으로 팀이 갈리므로(`localizeMatch`) 2명 대전에서 그 사람은
 * 항상 상대 팀이다. 확정 순간에 카드가 건너뛰는 그림이 되어 버그처럼 보인다.
 *
 * 그래서 배정과 같은 순서로 채운다: 나 → 상대 0번 → 우리 1번 → 상대 1번.
 */
export function waitingFillOrder(teamSize: number): number[] {
  // Math.max(1, NaN)은 NaN이다 — 그대로 두면 루프가 한 번도 안 돌아 빈 배열이 된다
  const size = Number.isFinite(teamSize)
    ? Math.max(1, Math.floor(teamSize))
    : 1;
  const order: number[] = [];
  for (let seat = 0; seat < size; seat += 1) {
    // 우리 팀 카드는 앞 size개, 상대 팀은 그 뒤 size개다
    order.push(seat, size + seat);
  }
  return order;
}
