/**
 * 스토리 모달(프롤로그·심연의 선택·엔딩) 패널의 순수 규칙 —
 * **높이는 내용이 정한다.**
 *
 * ## 왜 필요했나 (2026-08-07)
 *
 * 높이가 `PANEL_H = 520`으로 박혀 있었다. 세 모달의 내용 길이가 다 다른데
 * (프롤로그 2줄, 선택 2줄+힌트, 엔딩 5줄) 한 값을 나눠 쓰니 짧은 쪽에 빈
 * 구간이 남는다 — 프롤로그 1:1 캡처에서 본문이 y470에서 끝나고 다음 요소가
 * y685에 있었다. **패널 안 200px이 비어 있었다.**
 *
 * 그냥 넓은 게 아니라 읽는 순서가 끊긴다: 본문을 읽고 나서 눈이 빈 곳을 지나
 * 아래를 찾아야 하고, 프롤로그는 심사자가 게임을 켜면 **가장 먼저 보는
 * 화면이다.** 게다가 520은 가장 긴 엔딩에 맞춘 값이라, 나머지 둘이 엔딩의
 * 높이를 입고 있었다.
 *
 * ## 방향
 *
 * `upgradePanelRules.SHEET_H`는 반대다 — 거기는 배너·스킬바 사이에 갇혀서
 * **화면이 높이를 정하고 내용이 맞춘다.** 스토리 모달은 그런 이웃이 없다
 * (`paused`를 걸고 화면 가운데 뜨는 유일한 것이다). 그래서 여기서는 내용이
 * 높이를 정하고, 화면은 **상한**만 준다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

import { PAD_PANEL } from "../shared/ui/shapeRules";
import { T_CAPTION } from "../shared/theme";
import { DESIGN_H, DESIGN_W } from "../shared/viewport";

export const STORY_PANEL_W = DESIGN_W - 96;
export const STORY_PANEL_X = (DESIGN_W - STORY_PANEL_W) / 2;

/**
 * 패널의 세로 **중심**. 화면 중앙보다 60px 위다.
 *
 * 고치기 전 코드의 `PANEL_Y = (DESIGN_H - PANEL_H) / 2 - 60`과 같은 자리다 —
 * 높이가 변수가 되면서 "위 y"로는 표현할 수 없어졌다(높이마다 달라진다).
 * 중심으로 적으면 높이가 어떻게 바뀌어도 모달이 같은 자리에 뜬다.
 *
 * 왜 위로 60px인가: 아래쪽 화면은 엄지가 가려서, 정중앙에 두면 긴 본문의
 * 마지막 줄이 손에 덮인다.
 */
export const STORY_CENTER_Y = DESIGN_H / 2 - 60;

/** 화면 가장자리와 패널 사이 최소 여백 */
export const STORY_MARGIN_Y = 24;

/** 버튼 한 줄 — `createButton`에 넘기는 높이 */
export const STORY_BUTTON_H = 88;
/** 버튼 아래 여백 */
export const STORY_BUTTON_PAD_B = 12;
/** 두 버튼(수용/거부) 사이 간격 */
export const STORY_BUTTON_GAP_X = 16;

/** 프롤로그 페이지 표시(`1 / 3`) 높이와 버튼과의 간격 */
export const STORY_PAGEMARK_H = T_CAPTION.size;
export const STORY_PAGEMARK_GAP = 24;

/**
 * 본문 마지막 줄과 아래 블록 사이 간격.
 *
 * **이 값이 결함의 크기를 정한다.** 고치기 전에는 이 자리가 남는 공간 전부
 * (프롤로그에서 200px)였다. 32면 본문과 버튼이 다른 블록으로 읽히면서
 * 눈이 건너뛸 거리는 아니다.
 */
export const STORY_CONTENT_GAP = 32;

/**
 * 위로 쌓는 글 블록 사이 간격 (제목 → 본문 → 힌트).
 *
 * 이 자리도 고치기 전에는 y를 손으로 적고 있었다 — 선택 모달의 힌트가 `y=200`
 * 이라 본문이 128px(2줄) 안에 들어간다는 가정이 박혀 있었다. 본문이 3줄이
 * 되는 날 힌트가 본문을 덮는다. 앞 블록의 **측정된** 아래 끝에서 쌓는다.
 */
export const STORY_TEXT_GAP = 24;

/** 쌓기 — 첫 블록은 0, 그 뒤는 앞 블록 아래 끝 + 간격 */
export function storyStackY(prevBottom: number): number {
  const b = Number.isFinite(prevBottom) ? Math.max(0, prevBottom) : 0;
  return b <= 0 ? 0 : b + STORY_TEXT_GAP;
}

/**
 * 패널 높이의 상한 — 중심을 지키면서 화면에 들어가는 최대치.
 *
 * 중심이 화면 중앙보다 위에 있으므로 **위쪽이 먼저 막힌다**. 위 여유의 두 배가
 * 상한이다(아래로도 같은 만큼 자라야 중심이 유지되므로).
 */
export const STORY_PANEL_MAX_H = (STORY_CENTER_Y - STORY_MARGIN_Y) * 2;

/**
 * 패널 높이의 하한.
 *
 * 내용이 아무리 짧아도 이보다 납작하면 패널이 버튼 테두리처럼 보인다 —
 * 헤더 없는 패널이라 모달이라는 신호가 몸통 크기밖에 없다. 아래 블록만으로도
 * 필요한 높이(패딩 + 버튼 + 여백)를 하한으로 쓴다.
 */
export const STORY_PANEL_MIN_H =
  PAD_PANEL * 2 + STORY_BUTTON_H + STORY_BUTTON_PAD_B + STORY_CONTENT_GAP;

/**
 * 아래 블록의 높이 — 버튼 줄 (+ 프롤로그의 페이지 표시).
 *
 * 페이지 표시를 옵션으로 받는 이유: 프롤로그에만 있다. 세 모달에 같은 높이를
 * 주면 나머지 둘에 다시 빈 줄이 생긴다(작게 되풀이되는 원래 결함이다).
 */
export function storyBottomH(hasPageMark: boolean): number {
  const mark = hasPageMark ? STORY_PAGEMARK_H + STORY_PAGEMARK_GAP : 0;
  return mark + STORY_BUTTON_H + STORY_BUTTON_PAD_B;
}

/**
 * 내용 높이 → 패널 높이.
 *
 * @param contentBottom 위에서 쌓은 글의 아래 끝(패널 내부 좌표). 호출부가
 *   **측정한** 값을 넘긴다 — 줄 수로 어림하면 폰트나 줄바꿈 폭이 바뀌는 날
 *   조용히 틀린다(그 증상은 마지막 줄이 버튼에 닿는 것이다).
 * @param bottomH `storyBottomH`
 */
export function storyPanelH(contentBottom: number, bottomH: number): number {
  const c = Number.isFinite(contentBottom) ? Math.max(0, contentBottom) : 0;
  const b = Number.isFinite(bottomH) ? Math.max(0, bottomH) : 0;
  const want = PAD_PANEL * 2 + c + STORY_CONTENT_GAP + b;
  return Math.max(STORY_PANEL_MIN_H, Math.min(STORY_PANEL_MAX_H, want));
}

/** 패널 높이 → 화면 y. 중심을 지킨다 */
export function storyPanelY(panelH: number): number {
  const h = Number.isFinite(panelH) ? Math.max(0, panelH) : 0;
  return STORY_CENTER_Y - h / 2;
}

/** 버튼 줄의 위 y (패널 내부 좌표) */
export function storyButtonY(innerH: number): number {
  const h = Number.isFinite(innerH) ? Math.max(0, innerH) : 0;
  return h - STORY_BUTTON_H - STORY_BUTTON_PAD_B;
}

/** 페이지 표시의 y — 버튼 줄 위 */
export function storyPageMarkY(innerH: number): number {
  return storyButtonY(innerH) - STORY_PAGEMARK_GAP - STORY_PAGEMARK_H;
}

/**
 * 버튼 `count`개의 x·폭 (패널 내부 좌표).
 *
 * 1개는 가운데, 2개는 간격을 두고 반씩 나눈다. **`preferredW`는 1개일 때만
 * 쓴다** — 2개에서 폭을 지정하면 두 버튼의 합이 내부 폭을 넘는 순간 한쪽이
 * 패널 밖으로 나가고, 그건 "선택지가 하나만 보인다"다.
 */
export function storyButtonSlots(
  innerW: number,
  count: number,
  preferredW?: number,
): Array<{ x: number; w: number }> {
  const iw = Number.isFinite(innerW) ? Math.max(0, innerW) : 0;
  const n = Math.max(1, Math.floor(count));
  if (n === 1) {
    const w = Math.min(iw, preferredW !== undefined && Number.isFinite(preferredW) ? Math.max(0, preferredW) : iw);
    return [{ x: (iw - w) / 2, w }];
  }
  const w = Math.floor((iw - STORY_BUTTON_GAP_X * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({
    x: i * (w + STORY_BUTTON_GAP_X),
    w,
  }));
}
