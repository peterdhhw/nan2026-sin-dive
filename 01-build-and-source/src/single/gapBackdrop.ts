/**
 * 층 사이 지층 배경 — 하강 슬라이드 때 전장 뒤로 드러나는 틈을 메운다.
 *
 * 슬라이드 중 현재 층과 다음 층 사이에는 전장 그림이 없는 구간이 지나간다.
 * 검은 공백은 "화면이 비었다"로 읽히므로, 심연의 지층(토양 띠·암석·결정)을
 * 깔아 "땅을 뚫고 내려가는 중"으로 읽히게 한다. 슬라이드 오프셋의 일부만
 * 따라 움직여(패럴랙스) 층보다 깊은 배경으로 보인다.
 *
 * 배치는 시드 결정론이다(createRng) — 같은 판을 재생하면 같은 지층이 나온다.
 *
 * **색은 여기 없다 (2026-08-07).** 팔레트가 상수 네 개로 박혀 있었고 심연만
 * 보고 고른 값이라, 표층(1~59층)에서는 이 모듈이 막으려던 그 "검은 공백"이
 * 그대로 나왔다 — 22층 캡처에서 필드 800px 중 347px이 명도 22였다. 유도와
 * 근거는 `gapBackdropRules.strataPalette`에 있다.
 */

import { Container, Graphics } from "pixi.js";
import { createRng } from "../core/rng";
import type { SplitRect } from "../shared/viewport";
import { fillPixelRect } from "../shared/ui/pixelShape";
import { THEME_SURFACE, sameTheme, themeAtDepth, type WaveTheme } from "../shared/theme";
import { strataPalette } from "./gapBackdropRules";

/** 지층 띠 간격(px). 오프셋 래핑 주기이기도 하다 */
export const STRATA_SPACING = 96;

/** 지층이 슬라이드를 따라가는 비율 — 1보다 작아서 층보다 깊어 보인다 */
export const STRATA_PARALLAX = 0.6;

export interface GapBackdrop {
  view: Container;
  /** 슬라이드 오프셋(px)을 넘기면 지층이 패럴랙스로 따라 흐른다. 0 = 제자리 */
  setOffset(slidePx: number): void;
  /**
   * 하강 깊이(0..1) → 지층 팔레트. 세션이 매 프레임 부른다.
   *
   * **같은 테마면 아무 일도 하지 않는다** — 깊이는 매 프레임 조금씩 오르는데
   * 지층을 매 프레임 다시 그리면 `Graphics`를 초당 60번 재빌드한다(띠 여덟
   * 줄 + 잔돌 수십 개다). `battleField.setDepth`와 같은 가드다.
   */
  setDepth(depth: number): void;
  destroy(): void;
}

/** 시드로 한 번 뽑아 두는 잔돌 하나 — 색은 여기 없다, 재칠 때 팔레트가 준다 */
interface Rock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 드물게 박히는 결정인가 */
  readonly crystal: boolean;
}

export function createGapBackdrop(rect: SplitRect, seed: number): GapBackdrop {
  const view = new Container();
  view.label = "gap-backdrop";

  // 래핑 스크롤이 가장자리를 드러내지 않게 밴드보다 위아래로 두 주기 넉넉히 그린다
  const top = rect.y - STRATA_SPACING * 2;
  const height = rect.h + STRATA_SPACING * 4;

  /* 배치는 **생성 때 한 번만** 뽑는다.
   *
   * 재칠할 때마다 rng를 다시 돌리면 색이 바뀌는 프레임에 잔돌이 순간이동한다 —
   * 하강 중에 배경이 튀는 것으로 보인다. 시드 결정론(모듈 첫 주석)도 "같은 판을
   * 재생하면 같은 지층"이지 "같은 프레임을 다시 칠하면 다른 지층"이 아니다. */
  const bandYs: number[] = [];
  const rocks: Rock[] = [];
  const rng = createRng(seed);
  for (let y = top; y < top + height; y += STRATA_SPACING) {
    bandYs.push(y);
    const count = 3 + rng.int(4);
    for (let i = 0; i < count; i++) {
      const rx = rect.x + rng.next() * (rect.w - 24);
      const ry = y + 16 + rng.next() * (STRATA_SPACING - 34);
      const size = 8 + rng.int(12);
      rocks.push({
        x: rx,
        y: ry,
        w: size,
        h: Math.max(6, size * 0.7),
        crystal: rng.next() < 0.18,
      });
    }
  }

  const base = new Graphics();
  view.addChild(base);
  const inner = new Graphics();
  view.addChild(inner);

  let theme: WaveTheme | null = null;

  function paint(next: WaveTheme): void {
    const palette = strataPalette(next);
    base.clear();
    fillPixelRect(base, rect.x, top, rect.w, height, 0, { color: palette.soil });
    inner.clear();
    // 지층 경계 띠
    for (const y of bandYs) {
      fillPixelRect(inner, rect.x, y, rect.w, 10, 0, { color: palette.band });
    }
    // 띠 사이 잔돌 — 드물게 심연 결정이 박힌다
    for (const r of rocks) {
      fillPixelRect(inner, r.x, r.y, r.w, r.h, 2, {
        color: r.crystal ? palette.crystal : palette.rock,
        alpha: r.crystal ? 1 : 0.9,
      });
    }
    theme = next;
  }

  // 첫 칠 — 하강 전이므로 표층이다. 세션이 첫 프레임에 setDepth로 덮어쓴다
  paint(THEME_SURFACE);

  return {
    view,
    setOffset(slidePx: number): void {
      const px = Number.isFinite(slidePx) ? slidePx : 0;
      // 래핑 — 그려 둔 두 주기 여유 안에서만 움직인다
      inner.y = (px * STRATA_PARALLAX) % STRATA_SPACING;
    },
    setDepth(depth: number): void {
      const next = themeAtDepth(depth);
      if (theme !== null && sameTheme(theme, next)) return;
      paint(next);
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
