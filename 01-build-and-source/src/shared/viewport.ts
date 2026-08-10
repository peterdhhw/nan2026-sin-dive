/**
 * 화면 좌표계와 프레임 무관 보간 — **모드와 무관한 것만** 둔다.
 *
 * `layout.ts`에서 갈라져 나왔다. 예전 `layout.ts`는 디자인 해상도(모드 공용)와
 * `computeSplit`(상/하 2분할 = PvP 전용)을 한 파일에 담고 있었고, 그래서
 * **PvP 전용인 `core/gauge`가 공용 모듈로 끌려 들어왔다.** 싱글플레이는 2분할
 * 화면이 아니므로 그 의존을 물려받을 이유가 없다 —
 * 분할 레이아웃은 `pvp/splitLayout.ts`에 있다.
 *
 * 여기 있는 것: 디자인 해상도, 밴드 사각형 타입, 지수 보간.
 * 여기 없는 것: 게이지·팀·승패 — 그건 전부 PvP 개념이다.
 */

/** 9:16 디자인 해상도. 실제 캔버스는 이 좌표계를 스케일해 그린다. */
export const DESIGN_W = 720;
export const DESIGN_H = 1280;

/** 상단 HUD 높이 비율 (GDD §1-5의 ~12%) */
export const HUD_RATIO = 0.12;
/** 하단 스킬바 높이 비율 */
export const SKILLBAR_RATIO = 0.18;

export interface SplitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 캐릭터 카드 한 장의 높이(디자인 px) — §05-2.
 *
 * `pvp/matchRules.ts`에 있었지만 여기로 올렸다. 이 값은 매칭 화면 배치가
 * 아니라 **카드 삽화를 몇 px로 구울지의 기준**이고(`portraitManifest`의
 * `PORTRAIT_BASE_H.card`, `tools/gen_portraits.py`의 `REF_CARD_H`와 대조),
 * 카드는 싱글에도 나온다. `pvp/`에 두면 공용 매니페스트가 PvP를 import하게 된다.
 *
 * 카드 **폭**은 화면마다 다르므로 여기 없다 — 매칭 화면의 `CARD_W_RATIO`는
 * 그 화면의 배치값이라 `pvp/matchRules.ts`에 남는다.
 */
export const CARD_H = 150;

/** 기본 반감기 — 게이지가 튀지 않고 부드럽게 따라오는 체감값 */
export const DEFAULT_HALF_LIFE_MS = 180;

/**
 * 프레임레이트에 무관한 지수 보간. dtMs가 커도 목표를 넘지 않는다.
 * 스냅샷이 200ms 단위로 도착하므로(설계 스펙 §3-6) 그 사이를 이걸로 메운다.
 */
export function lerpRatio(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  if (dtMs <= 0) return current;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return current + (target - current) * k;
}
