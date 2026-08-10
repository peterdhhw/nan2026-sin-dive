/**
 * 스와이프 판정 — 포인터 시작/끝 표본으로 제스처를 분류하는 순수 규칙.
 *
 * 설계 문서: docs/SINGLE-BRIEF.md §7 ("지금 코드에 제스처 처리가 전혀 없다")
 *
 * ## 결정 (2026-08-03 정호 확정)
 *
 * - **위로 스와이프 = 하강.** GDD 초안(7/24)은 "아래로 스와이프"라고 적었지만,
 *   숏츠의 문법(손가락을 위로 밀면 다음 콘텐츠)이 컨셉의 원형이고 팀 데모
 *   영상(NAN2026_demo.mp4)의 HUD도 "위로 스와이프하여 다음 층으로"다.
 *   데모·숏츠 문법 쪽으로 통일한다.
 * - 하강은 자동이고 스와이프는 **가속**이다(층 전환 연출 스킵 + 세션의 러시
 *   버프). 판정만 여기 있고 효과는 sessionRules 몫이다.
 * - 화면 아래쪽 밴드(스킬바·강화 줄)에서 시작한 제스처는 하강 스와이프가
 *   아니다 — 거기서의 위쪽 드래그는 강화 시트를 여는 제스처다. 경계는
 *   `FIELD_SWIPE_MAX_START_RATIO`.
 */

/** 스와이프로 인정하는 최소 세로 이동 (디자인 px, 720×1280 기준) */
export const SWIPE_MIN_DIST_PX = 80;

/** 스와이프로 인정하는 최대 소요 시간 — 느린 드래그는 스와이프가 아니다 */
export const SWIPE_MAX_MS = 600;

/** 세로 우세 비율 — |dy|가 |dx|의 이 배수 이상이어야 세로 스와이프다 */
export const SWIPE_AXIS_RATIO = 1.5;

/** 탭으로 보는 최대 이동 거리 */
export const TAP_MAX_DIST_PX = 14;

/** 탭으로 보는 최대 소요 시간 */
export const TAP_MAX_MS = 350;

/**
 * 하강 스와이프의 시작점은 화면 위쪽 이 비율 안이어야 한다.
 * 그 아래(강화 줄 + 스킬바 밴드)에서 시작한 위쪽 드래그는 강화 시트의 몫이다.
 */
export const FIELD_SWIPE_MAX_START_RATIO = 0.7;

export interface SwipeSample {
  x: number;
  y: number;
  atMs: number;
}

export type SwipeVerdict = "descend" | "tap" | "none";

/** 시작 y가 하강 스와이프를 낼 수 있는 영역인가 (viewH = 화면 높이 px) */
export function fieldSwipeAllowed(startY: number, viewH: number): boolean {
  if (!Number.isFinite(startY) || !Number.isFinite(viewH) || viewH <= 0) return false;
  return startY <= viewH * FIELD_SWIPE_MAX_START_RATIO;
}

/**
 * 포인터 다운/업 표본 → 제스처. 씬은 "descend"만 하강 가속으로 배선하고,
 * "tap"은 기존 버튼/슬롯 히트 판정에 맡긴다 ("none"도 마찬가지 — 아무 일 없음).
 */
export function classifySwipe(start: SwipeSample, end: SwipeSample, viewH: number): SwipeVerdict {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dt = end.atMs - start.atMs;
  if (![dx, dy, dt].every(Number.isFinite) || dt < 0) return "none";

  const dist = Math.hypot(dx, dy);
  if (dist <= TAP_MAX_DIST_PX && dt <= TAP_MAX_MS) return "tap";

  const isUp = dy < 0;
  const vertical = Math.abs(dy) >= Math.abs(dx) * SWIPE_AXIS_RATIO;
  const farEnough = Math.abs(dy) >= SWIPE_MIN_DIST_PX;
  const fastEnough = dt <= SWIPE_MAX_MS;
  if (isUp && vertical && farEnough && fastEnough && fieldSwipeAllowed(start.y, viewH)) {
    return "descend";
  }
  return "none";
}
