/**
 * 배경 딤의 순수 규칙 — 페이드 시간과 채도 목표.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C9
 *
 * Pixi를 import하지 않는다 (`scrim.ts`가 재export한다). 결과 씬(§08-1)이
 * `Scrim` 위젯을 쓰지 않고 자체 딤을 쓰면서도 **같은 채도 값**을 써야 하므로
 * 상수를 위젯 밖으로 뺐다 — 두 곳에 0.4를 적어두면 한쪽만 고치게 된다.
 */

export const SCRIM_FADE_MS = 200;
/** 뒤 콘텐츠 채도 (§C9). 1 = 원본, 0 = 흑백 */
export const SCRIM_SATURATE = 0.4;

/** 디자인 좌표의 사각형. Pixi `Rectangle`을 안 쓴다(여기는 순수 규칙이다) */
export interface ScrimRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * **어둡게 칠할 구역과 탭을 삼킬 구역은 다르다 (2026-08-07).**
 *
 * 위젯은 둘을 한 사각형으로 갖고 있었다 — `Graphics`를 전면에 칠하고 그 경계가
 * 그대로 히트 영역이었다. 강화 시트가 `layers.fx`(최상단)로 올라가면서
 * (`diveLayerRules` 주석의 세 부등식) 그 전면 딤이 **HUD 위에** 앉았고, 1:1
 * 캡처에서 골드 필의 명도가 0.28 → 0.10으로(2.8배) 떨어졌다. 심연석 필도
 * 0.35 → 0.12, 층 숫자도 같다.
 *
 * 하필 **읽어야 하는 수가 그것들이다.** 시트에는 골드 필이 없고 심연석 필도
 * HUD에 있다(`upgradePanelRules.drawEffectLabel` 주석). 강화 화면이 하는 일은
 * 비용과 잔고의 뺄셈인데(`upgradeCostLabel` 주석) 그 뺄셈의 한쪽이 어두워졌다.
 *
 * **삼키는 쪽은 줄이면 안 된다.** 딤을 좁히면서 히트 영역도 같이 좁히면, 시트가
 * 열린 동안 HUD의 타이틀 버튼이 눌려서 모달 위에서 씬이 바뀐다 — 위젯 첫 주석의
 * "팝업이 뜬 동안의 오조작은 되돌릴 수 없다"가 그 얘기다. 그래서 히트 영역은
 * `w`×`h` 전면으로 두고 칠하는 구역만 뗀다.
 *
 * @param dim 칠할 구역. 없거나 값이 이상하면 전면으로 접는다 — 딤이 사라지는
 *            쪽(0 크기)으로 접으면 "모달인데 뒤가 밝다"가 조용히 나온다
 */
export function scrimDimRect(w: number, h: number, dim?: ScrimRect | null): ScrimRect {
  const fullW = Math.max(1, Number.isFinite(w) ? w : 1);
  const fullH = Math.max(1, Number.isFinite(h) ? h : 1);
  const full: ScrimRect = { x: 0, y: 0, w: fullW, h: fullH };
  if (!dim) return full;
  const vals = [dim.x, dim.y, dim.w, dim.h];
  if (vals.some((v) => !Number.isFinite(v))) return full;
  if (dim.w <= 0 || dim.h <= 0) return full;
  // 전면 밖으로 나가는 부분은 잘라낸다 — 칠해도 안 보이는데 히트 영역과
  // 헷갈리게 만든다
  const x = Math.max(0, Math.min(dim.x, fullW));
  const y = Math.max(0, Math.min(dim.y, fullH));
  return {
    x,
    y,
    w: Math.min(dim.w, fullW - x),
    h: Math.min(dim.h, fullH - y),
  };
}

/**
 * 딤 진행도 0..1 → 실제 채도.
 *
 * 딤이 페이드 인하는 동안 채도가 **같이** 내려가야 한다. 필터를 끝값으로 한 번에
 * 걸면 전장이 먼저 흑백이 되고 딤이 나중에 덮여, 두 개의 사건으로 보인다.
 */
export function scrimSaturate(progress: number): number {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return 1 + (SCRIM_SATURATE - 1) * p;
}
