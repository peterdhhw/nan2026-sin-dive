/**
 * 버튼의 순수 규칙 — 상태별 색·입력 허용 여부.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C2
 *
 * Pixi를 import하지 않는다 (`ui/button.ts`가 재export한다).
 */

import {
  STATE_AD,
  STATE_CONFIRM,
  STATE_OFF,
  STATE_OK,
  UI_CARD,
  UI_TEXT,
} from "../theme";

export type ButtonState = "ready" | "disabled" | "confirm" | "ad" | "neutral";

export interface ButtonSkin {
  readonly base: number;
  readonly label: number;
  /** 비용 등 서브라벨 색. disabled에서만 본문과 갈라진다 (§C2) */
  readonly sub: number;
  /** 입력을 받는지. false여도 hitArea는 살려 흔들림으로 답한다 */
  readonly interactive: boolean;
  /** 라벨 앞에 붙는 글리프 (광고 버튼의 ▶) */
  readonly glyph: string | null;
}

/** disabled의 흐린 라벨색 (§C2: `#8b8b96`) */
export const DISABLED_LABEL = 0x8b8b96;
/** disabled의 비용 숫자만 빨강 — 레퍼런스 frame_13 관례 */
export const DISABLED_COST = 0xf83840;

export function buttonSkin(state: ButtonState): ButtonSkin {
  switch (state) {
    case "ready":
      return {
        base: STATE_OK,
        label: UI_TEXT,
        sub: UI_TEXT,
        interactive: true,
        glyph: null,
      };
    case "confirm":
      return {
        base: STATE_CONFIRM,
        label: UI_TEXT,
        sub: UI_TEXT,
        interactive: true,
        glyph: null,
      };
    case "ad":
      return {
        base: STATE_AD,
        label: UI_TEXT,
        sub: UI_TEXT,
        interactive: true,
        glyph: "▶",
      };
    case "neutral":
      return {
        base: UI_CARD,
        label: UI_TEXT,
        sub: UI_TEXT,
        interactive: true,
        glyph: null,
      };
    case "disabled":
      return {
        base: STATE_OFF,
        label: DISABLED_LABEL,
        sub: DISABLED_COST,
        interactive: false,
        glyph: null,
      };
  }
}

/**
 * 초록 버튼에만 얹는 좌상단 대각 하이라이트 (§3-3, 레퍼런스 frame_02).
 *
 * 다른 색에 얹으면 "이것도 주 행동인가?"로 읽혀서 초록의 의미가 흐려진다.
 */
export function hasDiagonalHighlight(state: ButtonState): boolean {
  return state === "ready";
}

/** 하이라이트 폭 비율 (§3-3: 40%) */
export const HIGHLIGHT_W_RATIO = 0.4;
export const HIGHLIGHT_ALPHA = 0.18;
