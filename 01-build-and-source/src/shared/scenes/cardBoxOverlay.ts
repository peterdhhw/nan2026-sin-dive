import { Container, Graphics, Sprite, Text } from "pixi.js";
import { DESIGN_H, DESIGN_W } from "../viewport";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FONT_FAMILY,
  T_CAPTION,
  T_LABEL,
  T_TITLE,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  UI_TEXT_DIM,
  fontWeightOf,
} from "../theme";
import { darken } from "../color";
import { playSfx } from "../audio";
import { HERO_SLUGS, type HeroSlug } from "../charManifest";
import { heroDisplayName } from "../../loadout/preset";
import type { CardManifest, CardRegion } from "../cardManifest";
import { cardSprite, loadCardArt, type CardArt } from "../cards";
import { ART_PX, RADIUS_CARD, snapPx } from "../ui/shapeRules";
import { createButton, type Button } from "../ui/button";
import { fillPixelRect, strokePixelRect } from "../ui/pixelShape";
import { caption, fitText, sceneText } from "./common";
import {
  BOX_CELL_H,
  BOX_CELL_W,
  BOX_COLS,
  BOX_DIM_ALPHA,
  BOX_GAP,
  BOX_NAME_W,
  BOX_PROGRESS_Y,
  BOX_TITLE_Y,
  BOX_BUTTON_H,
  boxCellPos,
  boxLayout,
  boxRowLabelY,
  cardBoxLabel,
  heroProgress,
} from "./cardRules";

/**
 * 카드함 — 대기 화면(S2) 위에 뜬다.
 *
 * 설계 문서: specs/2026-07-27-ux/10-cards.md §3
 *
 * 유저 지시: "로비에서 내가 모은 카드 볼 수 있게 해주고."
 *
 * ## 왜 대기 화면(S2)인가 — 타이틀(S1)이 아니라
 *
 * 유저가 말한 "로비"에 가장 가까운 화면이 두 개다: 타이틀(S1)과 대기(S2).
 * **첫 진입이 S2 직행이다**(§05-0: 타이틀을 경유하지 않는다). 즉 타이틀에만
 * 두면 대부분의 유저는 카드함이 있다는 걸 모른다. S2는 5초를 어차피 기다리는
 * 화면이라 그 시간에 열어 볼 수 있고, 캐릭터 선택도 이미 여기 얹혀 있다
 * (씬을 새로 세우면 탭이 늘고 그만큼 전투가 늦어진다 — §05-0 "탭 0회").
 *
 * ## 미획득 = 실루엣
 *
 * 안 딴 칸을 빈 사각형으로 두는 안을 접었다 — 무엇이 남았는지가 안 읽히면
 * 모을 이유가 안 생긴다. 실루엣은 **별도 파일**(`_s.png`)이다. 딴 카드의 그림을
 * 받아 흰색으로 덮는 방식이면 네트워크 탭에 안 딴 카드가 다 보인다
 * (`tools/gen_cards.py` docstring). 그래서 kind를 `owned`로 정해서 받는다.
 */

export interface CardBoxOverlayOpts {
  /** `cards.json`. `null`이면 격자가 비고 안내만 나온다 */
  manifest: CardManifest | null;
  /** 획득한 카드 id */
  owned: ReadonlySet<string>;
  onClose(): void;
}

export interface CardBoxOverlay {
  view: Container;
  readonly open: boolean;
  show(): void;
  /**
   * 유저의 닫기 — **상세가 열려 있으면 상세만** 닫는다(카드를 보다가 대기
   * 화면으로 튕기지 않게).
   */
  close(): void;
  /**
   * 화면이 넘어간다 — 층을 몇 개 열어 놨든 전부 접는다. 확정 연출(§05-5)이
   * 부른다. `close()`를 쓰면 상세만 닫히고 격자가 남아 VS 커튼 밑에 깔린다.
   */
  hide(): void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 격자 칸 하나 */
interface BoxCell {
  view: Container;
  /**
   * 카드 그림이 들어갈 자리. **칸의 자식이다** — 예전에는 격자의 형제였고,
   * 그것이 "캐릭터를 눌러도 큰 그림이 안 뜨는" 결함의 원인이었다.
   *
   * Pixi의 히트 테스트는 자식을 **나중에 붙은 것부터** 훑고, 맞은 것이
   * 인터랙티브하지 않으면 **빈 경로(`[]`)** 를 되돌린다. 빈 경로는 위로
   * 올라가다 처음 만난 인터랙티브 조상을 대상으로 삼는다. 그림이 칸의
   * 형제였을 때는 그 조상이 씬 뷰(`title`)여서 칸의 `pointertap`이 아예
   * 안 불렸다 — 그림이 도착한 뒤에만 그렇게 되므로 dev에서는 그림이 늦게
   * 오는 첫 탭만 열려 "가끔 된다"로 보였다(프로덕션 캡처로 확정).
   *
   * 그림을 칸 안에 두면 같은 빈 경로가 **칸**을 대상으로 만든다 —
   * 그림에 `eventMode`를 걸어 막는 방식은 스프라이트를 만드는 모든 자리에서
   * 기억해야 하므로 자리(구조)로 고정한다.
   */
  art: Container;
  destroy(): void;
}

function createCell(
  row: CardRegion | undefined,
  owned: boolean,
  onTap: (() => void) | null,
): BoxCell {
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  fillPixelRect(g, 0, 0, BOX_CELL_W, BOX_CELL_H, RADIUS_CARD, {
    // 딴 칸은 금빛 바탕, 안 딴 칸은 패널색 — 색으로 한 번, 그림(실루엣)으로
    // 한 번 말한다 (§01-6: 색만으로는 부족)
    color: owned ? darken(ACCENT_GOLD_DEEP, 0.62) : darken(UI_PANEL, 0.35),
  });
  strokePixelRect(g, 0, 0, BOX_CELL_W, BOX_CELL_H, RADIUS_CARD, {
    color: owned ? ACCENT_GOLD : UI_OUTLINE,
    width: owned ? ART_PX : 2,
    alignment: 1,
  });
  if (!row) {
    // 매니페스트에 없는 칸 — 카드 그림을 굽지 못한 자리다. 다른 그림으로
    // 메우지 않고 물음표를 남긴다(생성기의 "빠진 그림" 규칙과 같다)
    const q = sceneText("?", T_TITLE, UI_TEXT_DIM);
    q.position.set(BOX_CELL_W / 2, BOX_CELL_H / 2);
    view.addChild(q);
  }
  // 그림 자리는 바탕 위·글자 아래다. 칸의 자식이어야 탭이 칸으로 온다(위 주석)
  const art = new Container();
  view.addChild(art);
  if (onTap) {
    view.eventMode = "static";
    view.cursor = "pointer";
    view.hitArea = {
      contains: (x, y) =>
        x >= 0 && x <= BOX_CELL_W && y >= 0 && y <= BOX_CELL_H,
    };
    view.on("pointertap", onTap);
  }
  return {
    view,
    art,
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

export function createCardBoxOverlay(opts: CardBoxOverlayOpts): CardBoxOverlay {
  const view = new Container();
  view.label = "card-box";
  view.visible = false;

  /**
   * 불투명도의 근거는 `BOX_DIM_ALPHA`에 있다 — 여기 숫자를 적으면 밑 화면의
   * 위젯이 카드함 글자와 겹치는 것을 테스트가 못 묻는다(캡처로 찾은 결함).
   */
  const dim = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x0a0812, alpha: BOX_DIM_ALPHA });
  dim.eventMode = "static";
  dim.on("pointertap", () => api.close());
  view.addChild(dim);

  const title = sceneText("카드함", T_TITLE);
  title.position.set(DESIGN_W / 2, BOX_TITLE_Y);
  view.addChild(title);

  const progress = sceneText(cardBoxLabel(opts.owned), T_LABEL, ACCENT_GOLD);
  progress.position.set(DESIGN_W / 2, BOX_PROGRESS_Y);
  view.addChild(progress);

  const layout = boxLayout(HERO_SLUGS.length);
  const grid = new Container();
  grid.position.set(snapPx(layout.gridX), snapPx(layout.gridY));
  view.addChild(grid);

  const cells: BoxCell[] = [];
  /** 칸 안에 그림을 붙일 자리 — 그림은 나중에 도착한다 */
  const slots = new Map<string, Container>();
  /** 안 딴 칸의 실루엣만 흰색이 아니게 틴트한다 */
  const silIds = new Set<string>();

  HERO_SLUGS.forEach((slug: HeroSlug, r) => {
    const rows = opts.manifest?.[slug] ?? [];
    const p = heroProgress(slug, opts.owned);
    const name = new Text({
      text: heroDisplayName(slug),
      style: {
        fill: p.got > 0 ? UI_TEXT : UI_TEXT_DIM,
        fontFamily: FONT_FAMILY,
        fontSize: T_CAPTION.size,
        fontWeight: fontWeightOf(T_CAPTION),
        wordWrap: true,
        wordWrapWidth: BOX_NAME_W - 8,
      },
    });
    name.anchor.set(0, 0.5);
    const rowY = r * (BOX_CELL_H + BOX_GAP);
    fitText(name, BOX_NAME_W - 8);
    /**
     * 이름이 몇 줄로 접혔는지는 **찍어 보고 나서야** 안다 — `fitText` 뒤에
     * 재야 축소까지 반영된 줄 수가 나온다. 지금 로스터는 일곱 다 한 줄이지만
     * (두세 글자) 이름이 길어지면 두 줄이 되고, 그때 수와 겹치지 않게 하는 것이
     * 이 계산이다. 자리는 `boxRowLabelY`가 정한다 — §10-3.
     */
    const lines = Math.max(
      1,
      Math.round(name.height / (T_CAPTION.size * name.scale.y || 1)),
    );
    const labelY = boxRowLabelY(lines, T_CAPTION.size + 2);
    name.position.set(0, snapPx(rowY + labelY.nameY));
    const count = new Text({
      text: `${p.got}/${p.total}`,
      style: {
        fill: p.got >= p.total ? ACCENT_GOLD : UI_TEXT_DIM,
        fontFamily: FONT_FAMILY,
        fontSize: T_CAPTION.size,
        fontWeight: fontWeightOf(T_CAPTION),
        wordWrap: true,
        wordWrapWidth: BOX_NAME_W - 8,
      },
    });
    count.anchor.set(0, 0.5);
    count.position.set(0, snapPx(rowY + labelY.countY));
    grid.addChild(name, count);

    for (let c = 0; c < BOX_COLS; c += 1) {
      const row = rows.find((x) => x.no === c + 1);
      const id = row?.id;
      const got = id !== undefined && opts.owned.has(id);
      const cell = createCell(
        row,
        got,
        row ? () => showDetail(row, got) : null,
      );
      const pos = boxCellPos(r, c);
      cell.view.position.set(snapPx(pos.x), snapPx(pos.y));
      grid.addChild(cell.view);
      cells.push(cell);
      if (id !== undefined) {
        slots.set(id, cell.art);
        if (!got) silIds.add(id);
      }
    }
  });

  const empty =
    opts.manifest === null
      ? caption("카드 정보를 받지 못했습니다 — 다시 접속해 주세요")
      : null;
  if (empty) {
    empty.position.set(DESIGN_W / 2, DESIGN_H / 2);
    view.addChild(empty);
  }

  const close: Button = createButton({
    label: "닫기",
    state: "neutral",
    w: DESIGN_W * 0.6,
    h: BOX_BUTTON_H,
    onTap: () => api.close(),
  });
  close.view.position.set((DESIGN_W - close.width) / 2, snapPx(layout.buttonY));
  view.addChild(close.view);

  /**
   * 카드 상세 — 탭한 칸의 큰 그림.
   *
   * **안 딴 카드는 상세도 실루엣이다.** 여기서만 진짜 그림을 보여주면 전부
   * 눌러 보는 것이 수집을 건너뛰는 길이 된다. 320×560 원본을 받지 않으므로
   * 실루엣 카드는 썸네일 크기를 키워 쓴다(도트라 확대가 흠이 아니다).
   */
  const detail = new Container();
  detail.visible = false;
  const detailDim = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x07050e, alpha: 0.94 });
  detailDim.eventMode = "static";
  detailDim.on("pointertap", () => {
    detail.visible = false;
  });
  detail.addChild(detailDim);
  const detailSlot = new Container();
  detailSlot.position.set(DESIGN_W / 2, DESIGN_H * 0.46);
  detail.addChild(detailSlot);
  const detailTitle = sceneText("", T_TITLE, ACCENT_GOLD);
  detailTitle.position.set(DESIGN_W / 2, DESIGN_H * 0.82);
  const detailHint = caption("탭하면 닫힙니다");
  detailHint.position.set(DESIGN_W / 2, DESIGN_H * 0.88);
  detail.addChild(detailTitle, detailHint);
  view.addChild(detail);
  let detailArt: Sprite | null = null;

  /** 상세로 받은 `full` 그림. 두 번 받지 않는다 */
  const fullCache = new Map<string, CardArt>();

  function showDetail(row: CardRegion, got: boolean): void {
    playSfx("ui_tap");
    detail.visible = true;
    detailTitle.text = got ? row.title : "아직 얻지 못한 카드";
    fitText(detailTitle, DESIGN_W - 80);
    detailArt?.destroy();
    detailArt = null;
    const put = (art: CardArt, silhouette: boolean): void => {
      detailArt?.destroy();
      // 화면 절반보다 크게 — 상세는 "크게 본다"가 존재 이유다
      const sp = cardSprite(art, {
        maxW: DESIGN_W * 0.8,
        maxH: DESIGN_H * 0.6,
      });
      sp.anchor.set(0.5);
      if (silhouette) sp.tint = darken(UI_PANEL, 0.1);
      detailSlot.addChild(sp);
      detailArt = sp;
    };
    const cached = fullCache.get(row.id);
    if (cached) {
      put(cached, !got);
      return;
    }
    // 안 딴 카드는 **`sil`을 받는다** — `full`을 받으면 안 딴 그림이 도착한다
    void loadCardArt([{ row, kind: got ? "full" : "sil" }]).then((got2) => {
      const art = got2.get(row.id);
      if (!art) return;
      fullCache.set(row.id, art);
      // 받는 동안 상세가 닫혔거나 다른 카드로 옮겼으면 붙이지 않는다
      if (
        !detail.visible ||
        detailTitle.text !== (got ? row.title : "아직 얻지 못한 카드")
      )
        return;
      put(art, !got);
    });
  }

  /** 격자 그림. 열 때 한 번만 받는다 — 대부분의 판에서 카드함은 안 열린다 */
  let artLoaded = false;
  const loadGridArt = (): void => {
    if (artLoaded || opts.manifest === null) return;
    artLoaded = true;
    const items = [...slots.keys()].flatMap((id) => {
      const row = Object.values(opts.manifest ?? {})
        .flat()
        .find((x) => x.id === id);
      if (!row) return [];
      // **안 딴 카드는 `sil`.** 이 한 줄이 수집의 의미를 지킨다
      return [
        { row, kind: silIds.has(id) ? ("sil" as const) : ("thumb" as const) },
      ];
    });
    void loadCardArt(items).then((arts) => {
      for (const [id, art] of arts) {
        const slot = slots.get(id);
        if (!slot || slot.destroyed) continue;
        const sp = cardSprite(art, {
          maxW: BOX_CELL_W - ART_PX * 2,
          maxH: BOX_CELL_H - ART_PX * 2,
        });
        sp.anchor.set(0.5);
        sp.position.set(BOX_CELL_W / 2, BOX_CELL_H / 2);
        // 실루엣은 흰색으로 구워져 있다 — 흰 그대로면 안 딴 칸이 딴 칸보다
        // 밝아서 눈이 거기로 간다. 어둡게 눌러 "빈자리"로 읽히게 한다
        if (silIds.has(id)) sp.tint = darken(UI_PANEL, 0.15);
        slot.addChild(sp);
      }
    });
  };

  const api: CardBoxOverlay = {
    view,
    get open(): boolean {
      return view.visible;
    },
    show(): void {
      view.visible = true;
      loadGridArt();
    },
    close(): void {
      if (!view.visible) return;
      // 상세가 열려 있으면 상세만 닫는다 — 한 번의 탭으로 두 층이 닫히면
      // 카드를 보다가 대기 화면으로 튕긴다
      if (detail.visible) {
        detail.visible = false;
        return;
      }
      view.visible = false;
      opts.onClose();
    },
    hide(): void {
      detail.visible = false;
      view.visible = false;
    },
    update(dtMs: number): void {
      if (!view.visible) return;
      close.update(dtMs);
    },
    destroy(): void {
      close.destroy();
      for (const c of cells) c.destroy();
      view.destroy({ children: true });
    },
  };
  return api;
}
