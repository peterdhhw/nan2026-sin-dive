import { Container, Graphics, Text } from "pixi.js";
import {
  FONT_FAMILY,
  T_TITLE,
  UI_HEADER_PURPLE,
  UI_OUTLINE,
  UI_PANEL,
  UI_PANEL_CREAM,
  UI_PANEL_EDGE,
  UI_TEXT,
  UI_TEXT_ON_CREAM,
  fontWeightOf,
} from "../theme";
import {
  HEADER_H,
  OUTLINE_PANEL,
  PAD_PANEL,
  RADIUS_PANEL,
  shadeBands,
} from "./shapeRules";
import { fillPixelRect, strokePixelRect } from "./pixelShape";

// 순수 규칙은 shapeRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export { HEADER_H, PAD_PANEL, RADIUS_PANEL } from "./shapeRules";

/**
 * 패널 / 팝업.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C1
 *
 * 호출부가 매번 stroke를 지정하지 않게 아웃라인·반경·패딩을 **내부에서** 지킨다
 * (§01-3의 전제). 내용은 `content` 컨테이너에 넣고, 그 원점은 패딩 안쪽이다.
 */

export type PanelVariant = "dark" | "cream";

export interface PanelOpts {
  w: number;
  h: number;
  variant?: PanelVariant;
  /** 상단 바 제목. 없으면 헤더를 그리지 않는다 */
  header?: string;
}

export interface Panel {
  view: Container;
  /** 내용 컨테이너. 원점은 패딩 안쪽(헤더가 있으면 그 아래) */
  content: Container;
  /** 내용 영역 크기 — 자식 배치 계산에 쓴다 */
  readonly innerW: number;
  readonly innerH: number;
  /** 이 패널 위 텍스트에 써야 하는 색 (cream이면 어두운 갈색) */
  readonly textColor: number;
  resize(w: number, h: number): void;
  destroy(): void;
}

export function createPanel(opts: PanelOpts): Panel {
  const view = new Container();
  const g = new Graphics();
  const content = new Container();
  view.addChild(g, content);

  const variant: PanelVariant = opts.variant ?? "dark";
  const body = variant === "cream" ? UI_PANEL_CREAM : UI_PANEL;
  const textColor = variant === "cream" ? UI_TEXT_ON_CREAM : UI_TEXT;
  const headerColor = variant === "cream" ? UI_HEADER_PURPLE : UI_PANEL_EDGE;
  const hasHeader = typeof opts.header === "string" && opts.header.length > 0;

  let w = opts.w;
  let h = opts.h;

  const title = hasHeader
    ? new Text({
        text: opts.header ?? "",
        style: {
          fill: UI_TEXT,
          fontFamily: FONT_FAMILY,
          fontSize: T_TITLE.size,
          fontWeight: fontWeightOf(T_TITLE),
        },
      })
    : null;
  if (title) {
    title.anchor.set(0.5);
    view.addChild(title);
  }

  const paint = (): void => {
    g.clear();
    // 몸통 + 3단 셰이딩. 평면 금지 (§3-3)
    const bands = shadeBands(body, h);
    fillPixelRect(g, 0, 0, w, h, RADIUS_PANEL, { color: bands.base });
    fillPixelRect(g, 0, 0, w, bands.lipH + RADIUS_PANEL, RADIUS_PANEL, {
      color: bands.lip,
      alpha: 0.5,
    });
    fillPixelRect(
      g,
      0,
      h - bands.bootH - RADIUS_PANEL,
      w,
      bands.bootH + RADIUS_PANEL,
      RADIUS_PANEL,
      { color: bands.boot, alpha: 0.5 },
    );
    // 몸통을 한 번 더 덮어 립·굽이 깎인 모서리 밖으로 새지 않게 한다.
    // (도형을 겹쳐 자르는 게 마스크보다 싸다 — 마스크는 렌더 타깃을 만든다)
    g.rect(0, bands.lipH, w, h - bands.lipH - bands.bootH).fill({
      color: bands.base,
    });

    if (hasHeader) {
      fillPixelRect(g, 0, 0, w, HEADER_H, RADIUS_PANEL, { color: headerColor });
      // 헤더 아래쪽 모서리는 각져야 몸통과 이어진다
      g.rect(0, HEADER_H - RADIUS_PANEL, w, RADIUS_PANEL).fill({
        color: headerColor,
      });
    }

    // 아웃라인은 마지막에 — 바깥쪽 정렬이라 내부 색 면적을 줄이지 않는다 (§3-1)
    strokePixelRect(g, 0, 0, w, h, RADIUS_PANEL, {
      color: UI_OUTLINE,
      width: OUTLINE_PANEL,
      alignment: 1,
    });

    if (title) title.position.set(w / 2, HEADER_H / 2);
    content.position.set(PAD_PANEL, (hasHeader ? HEADER_H : 0) + PAD_PANEL);
  };

  paint();

  return {
    view,
    content,
    get innerW(): number {
      return w - PAD_PANEL * 2;
    },
    get innerH(): number {
      return h - (hasHeader ? HEADER_H : 0) - PAD_PANEL * 2;
    },
    textColor,
    resize(nextW: number, nextH: number): void {
      w = nextW;
      h = nextH;
      paint();
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
