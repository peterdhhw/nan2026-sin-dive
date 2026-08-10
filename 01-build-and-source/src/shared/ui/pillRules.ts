/**
 * 정보 필의 순수 규칙 — 카운트업과 펄스.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C3
 *
 * Pixi를 import하지 않는다 (`ui/pill.ts`가 재export한다).
 */

/** 값 변경 시 숫자가 굴러가는 시간 (§C3) */
export const COUNTUP_MS = 280;
/** 값 변경 시 필 스케일 펄스 배율 (§C3) */
export const PULSE_SCALE = 1.06;
export const PULSE_MS = 220;

/** 기본 필 높이 (§C3) */
export const PILL_H = 52;
/** 아이콘 원이 필 왼쪽 끝에서 밖으로 튀어나오는 거리 (§C3) */
export const ICON_OVERHANG = 6;

/** 아이콘 원 지름 = 필 높이 − 8 (§C3) */
export function iconDiameter(pillH: number): number {
  return Math.max(0, pillH - 8);
}

/**
 * 글자가 쓸 수 있는 폭. 글자 시작 위치(`textX`)와 오른쪽 여백을 뺀 값이다.
 *
 * 왜 필요한가: 필은 글자를 재지 않고 그렸다. VS 씬 캡처에서 `물의 여사제 (나)`가
 * 폭 168 알약을 넘쳐 **옆 사람 이름 위로 흘렀다** — 두 이름이 한 덩어리로 읽혔다.
 * 필은 HUD·씬 전역에서 쓰이므로 이름을 넣는 모든 자리가 같은 사고를 안고 있었다.
 *
 * **오른쪽 여백을 `textX`와 같게 잡으면 안 된다.** 아이콘이 있을 때 `textX`는 54쯤인데
 * 그걸 오른쪽에도 빼면 폭 168 필의 글자 자리가 60px(두 글자)로 줄어든다 — 넘침을
 * 막으려다 더 심하게 잘리는 셈이다. 오른쪽은 라운드 코너만 피하면 된다.
 */
export function pillTextWidth(
  pillW: number,
  textX: number,
  rightPad: number,
  minW = 24,
): number {
  return Math.max(minW, pillW - textX - rightPad);
}

/**
 * 카운트업 중 표시할 값.
 *
 * 정수로 반올림한다 — 소수가 스치듯 지나가면 읽을 수 없고, 우리 값은 전부 정수다.
 * `elapsedMs`가 음수(=진행 중 아님)면 목표값을 그대로 준다.
 */
export function countUpValue(
  from: number,
  to: number,
  elapsedMs: number,
): number {
  if (elapsedMs < 0 || COUNTUP_MS <= 0) return to;
  const t = Math.max(0, Math.min(1, elapsedMs / COUNTUP_MS));
  // easeOutCubic — 처음 빠르게 굴러가고 끝에서 붙는다
  const e = 1 - (1 - t) ** 3;
  return Math.round(from + (to - from) * e);
}

/**
 * 펄스 스케일. 1 → PULSE_SCALE → 1을 한 번 왕복한다.
 *
 * `-1` 센티넬은 "펄스 중 아님"이며 1을 돌려준다 — 0을 돌려주면 필이 사라진다.
 */
export function pulseScale(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= PULSE_MS) return 1;
  const t = elapsedMs / PULSE_MS;
  return 1 + (PULSE_SCALE - 1) * Math.sin(t * Math.PI);
}
