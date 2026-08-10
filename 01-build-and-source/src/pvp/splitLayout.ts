/**
 * 상/하 2분할 레이아웃 — **PvP 전용**이다.
 *
 * 모드 공용인 것(디자인 해상도 `DESIGN_W/H`, `SplitRect`, `lerpRatio`)은
 * `viewport.ts`로 나갔다. 이 파일은 `core/gauge`를 import하는데, 게이지는
 * 줄다리기 PvP만의 개념이다 — 싱글플레이는 화면을 반으로 나누지 않으므로
 * **`viewport.ts`만 보고 이 파일은 보지 않는다.**
 *
 * 아래로 재export하는 이유: 예전 `layout.ts`의 공개 API를 쓰던 PvP 코드가
 * 임포트를 두 줄로 쪼개지 않아도 되게 한다. 새 코드는 공용 심볼을
 * `viewport.ts`에서 직접 가져와라 — 여기서 가져오면 싱글이 못 쓰는 파일에
 * 의존이 생긴다.
 */

import { gaugeToViewportRatio } from "../core/gauge";
import { DESIGN_H, DESIGN_W, HUD_RATIO, SKILLBAR_RATIO } from "../shared/viewport";
import type { SplitRect } from "../shared/viewport";

export {
  DESIGN_H,
  DESIGN_W,
  DEFAULT_HALF_LIFE_MS,
  HUD_RATIO,
  SKILLBAR_RATIO,
  lerpRatio,
} from "../shared/viewport";
export type { SplitRect } from "../shared/viewport";

/**
 * 중앙 게이지 바 높이(px, 디자인 좌표).
 *
 * 44 → 56. 44px에는 프레임(아웃라인 5px×2) + 트랙 + 임계선 눈금 + 마커가
 * 겹쳐서 아무것도 안 읽혔다. `gaugeBarRules.BAR_H`와 반드시 같아야 한다
 * (설계 문서 07-5, 테스트로 고정).
 */
export const GAUGE_BAR_H = 56;

export interface SplitLayout {
  hud: SplitRect;
  /** 우리 팀 전투 필드 (상단) */
  top: SplitRect;
  gauge: SplitRect;
  /** 상대 팀 전투 필드 (하단) */
  bottom: SplitRect;
  skillBar: SplitRect;
}

/**
 * 게이지 위치로 상/하 2분할 레이아웃을 만든다.
 * HUD·스킬바·게이지 바는 고정 높이고, 남은 공간을 게이지 비율로 나눈다.
 */
export function computeSplit(
  gaugePos: number,
  w: number = DESIGN_W,
  h: number = DESIGN_H,
): SplitLayout {
  const hudH = h * HUD_RATIO;
  const skillH = h * SKILLBAR_RATIO;
  const fieldTotal = h - hudH - skillH - GAUGE_BAR_H;
  const topRatio = gaugeToViewportRatio(gaugePos);
  const topH = fieldTotal * topRatio;

  let y = 0;
  const band = (bh: number): SplitRect => {
    const r = { x: 0, y, w, h: bh };
    y += bh;
    return r;
  };

  return {
    hud: band(hudH),
    top: band(topH),
    gauge: band(GAUGE_BAR_H),
    bottom: band(fieldTotal - topH),
    skillBar: band(skillH),
  };
}
