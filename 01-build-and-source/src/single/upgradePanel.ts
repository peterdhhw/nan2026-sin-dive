/**
 * 강화 UI — 스킬바 위 상시 노출 강화 줄 + 위로 끌면 열리는 전체 목록 시트.
 *
 * 배치·라벨·상태 판정은 `upgradePanelRules.ts`가 정본이다. 구매 판정·잔고
 * 차감은 세션 몫이고(onBuy), 이 위젯은 표시와 탭만 담당한다.
 */

import { Container, Graphics, Text } from "pixi.js";
import {
  FONT_FAMILY,
  T_BODY,
  T_CAPTION,
  UI_OUTLINE,
  UI_TEXT_DIM,
  fontWeightOf,
  snapFontSize,
} from "../shared/theme";
import { DESIGN_W, DESIGN_H } from "../shared/viewport";
import { createButton, type Button } from "../shared/ui/button";
import { createPanel, type Panel } from "../shared/ui/panel";
import { createScrim, type Scrim } from "../shared/ui/scrim";
import { fillPixelRect } from "../shared/ui/pixelShape";
import { easeOutCubic } from "../shared/tween";
import { UPGRADE_IDS, type UpgradeId, type UpgradeLevels } from "./economyRules";
import {
  DRAW_ROW_INDEX,
  DRAW_ROW_NAME,
  GRABBER_H,
  GRABBER_W,
  GRABBER_Y,
  ROW_BUTTON_H,
  ROW_BUTTON_TAP_ROOM,
  ROW_BUTTON_Y,
  SHEET_CLOSE_H,
  SHEET_CLOSE_W,
  SHEET_DIM_RECT,
  SHEET_H,
  SHEET_OPEN_MS,
  SHEET_W,
  SHEET_X,
  SHEET_Y,
  UPGRADE_ROW_H,
  UPGRADE_ROW_Y,
  drawButtonState,
  drawCostLabel,
  drawEffectLabel,
  rowButtonW,
  rowButtonX,
  sheetCloseY,
  sheetRowY,
  upgradeButtonLabel,
  upgradeButtonState,
  upgradeCostLabel,
  upgradeEffectLabel,
} from "./upgradePanelRules";

export interface UpgradePanelOpts {
  /** 표시 갱신에 쓰는 현재 상태 — 세션이 정본을 들고 있다 */
  getGold(): number | null;
  getLevels(): UpgradeLevels;
  /** 심연석 잔고 (카드 뽑기 행). null은 읽기 실패 — 뽑기 버튼이 비활성이다 */
  getAbyss(): number | null;
  /** 구매 시도. 성공 여부와 무관하게 refresh는 세션이 다시 부른다 */
  onBuy(id: UpgradeId): void;
  /** 카드 뽑기 시도. 잔고 판정·차감·카드 지급은 세션 몫이다 */
  onDraw(): void;
  /** 시트를 딤 뒤에 깔 때 채도를 낮출 대상 (전장 컨테이너) */
  dimTarget?: Container | null;
}

export interface UpgradePanel {
  /** 강화 줄 (상시 노출) — layers.gauge에 얹는다 */
  rowView: Container;
  /** 시트 + 딤 (모달) — layers.skillBar 위에 얹는다 */
  sheetView: Container;
  readonly sheetOpen: boolean;
  openSheet(): void;
  closeSheet(): void;
  /** 골드·레벨이 바뀌었을 때 라벨과 버튼 상태를 다시 그린다 */
  refresh(): void;
  update(dtMs: number): void;
  destroy(): void;
}

function rowText(token: { size: number; weight: 400 | 700 }, color: number): Text {
  return new Text({
    text: "",
    style: {
      fill: color,
      fontFamily: FONT_FAMILY,
      fontSize: snapFontSize(token.size),
      fontWeight: fontWeightOf(token),
    },
  });
}

export function createUpgradePanel(opts: UpgradePanelOpts): UpgradePanel {
  // ── 강화 줄 ──────────────────────────────────────────────────────────
  const rowView = new Container();
  rowView.label = "upgrade-row";
  rowView.position.set(0, UPGRADE_ROW_Y);

  const rowBg = new Graphics();
  fillPixelRect(rowBg, 0, 0, DESIGN_W, UPGRADE_ROW_H, 0, { color: 0x2e2a40, alpha: 0.92 });
  // 그래버 — "여기를 끌면 시트가 올라온다"는 손잡이 표식
  fillPixelRect(
    rowBg,
    (DESIGN_W - GRABBER_W) / 2,
    GRABBER_Y,
    GRABBER_W,
    GRABBER_H,
    4,
    { color: UI_OUTLINE },
  );
  rowView.addChild(rowBg);

  const rowButtons = new Map<UpgradeId, Button>();
  UPGRADE_IDS.forEach((id, i) => {
    const btn = createButton({
      label: upgradeButtonLabel(id, 0),
      sublabel: upgradeCostLabel(id, 0),
      state: "disabled",
      w: rowButtonW(),
      h: ROW_BUTTON_H,
      // 64px이라 관용이 필요하지만 줄이 96px뿐이고 옆 버튼이 10px 옆이다
      tapRoom: ROW_BUTTON_TAP_ROOM,
      onTap: () => opts.onBuy(id),
    });
    btn.view.position.set(rowButtonX(i), ROW_BUTTON_Y);
    rowView.addChild(btn.view);
    rowButtons.set(id, btn);
  });

  // ── 시트 (모달) ──────────────────────────────────────────────────────
  const sheetView = new Container();
  sheetView.label = "upgrade-sheet";
  sheetView.visible = false;

  const scrim: Scrim = createScrim({
    w: DESIGN_W,
    h: DESIGN_H,
    // 칠하는 구역은 HUD 아래만 — 잔고를 읽으면서 강화한다 (`SHEET_DIM_RECT`).
    // 탭 삼키기는 여전히 전면이다(w·h)
    dimRect: SHEET_DIM_RECT,
    target: opts.dimTarget ?? null,
    onTap: () => close(),
  });
  sheetView.addChild(scrim.view);

  const panel: Panel = createPanel({ w: SHEET_W, h: SHEET_H, header: "강화" });
  panel.view.position.set(SHEET_X, SHEET_Y);
  sheetView.addChild(panel.view);

  interface SheetRow {
    id: UpgradeId;
    name: Text;
    effect: Text;
    buy: Button;
  }
  const sheetRows: SheetRow[] = [];
  UPGRADE_IDS.forEach((id, i) => {
    const rowY = sheetRowY(i);
    const name = rowText(T_BODY, panel.textColor);
    name.position.set(0, rowY);
    panel.content.addChild(name);

    const effect = rowText(T_CAPTION, UI_TEXT_DIM);
    effect.position.set(0, rowY + 44);
    panel.content.addChild(effect);

    const buy = createButton({
      label: "강화",
      sublabel: upgradeCostLabel(id, 0),
      state: "disabled",
      w: 180,
      h: 88,
      onTap: () => opts.onBuy(id),
    });
    buy.view.position.set(panel.innerW - 180, rowY);
    panel.content.addChild(buy.view);

    sheetRows.push({ id, name, effect, buy });
  });

  // ── 카드 뽑기 행 — 강화 행과 같은 기하를 쓰되 재화가 심연석이다.
  // `SheetRow`에 안 넣는다: 그쪽은 `UpgradeId`로 라벨을 유도하는 구조라
  // 뽑기를 끼우려면 id를 유니온으로 넓혀야 하고, 그러면 강화 4행의 refresh가
  // 매 행마다 "뽑기인가"를 물어야 한다.
  const drawRowY = sheetRowY(DRAW_ROW_INDEX);
  const drawName = rowText(T_BODY, panel.textColor);
  drawName.text = DRAW_ROW_NAME;
  drawName.position.set(0, drawRowY);
  panel.content.addChild(drawName);

  const drawEffect = rowText(T_CAPTION, UI_TEXT_DIM);
  drawEffect.position.set(0, drawRowY + 44);
  panel.content.addChild(drawEffect);

  const drawBtn = createButton({
    label: "뽑기",
    sublabel: drawCostLabel(),
    state: "disabled",
    w: 180,
    h: 88,
    onTap: () => opts.onDraw(),
  });
  drawBtn.view.position.set(panel.innerW - 180, drawRowY);
  panel.content.addChild(drawBtn.view);

  const closeBtn = createButton({
    label: "닫기",
    state: "neutral",
    w: SHEET_CLOSE_W,
    h: SHEET_CLOSE_H,
    onTap: () => close(),
  });
  // 행이 하나 늘었으므로 닫기도 한 행만큼 내려간다 — 자리는 규칙이 정본이다
  // (`sheetFits`가 이 y + 버튼 높이가 패널 안인지 본다)
  closeBtn.view.position.set((panel.innerW - SHEET_CLOSE_W) / 2, sheetCloseY());
  panel.content.addChild(closeBtn.view);

  let open = false;
  /** 시트 등장 트윈 경과. -1 = 진행 중 아님 */
  let openMs = -1;

  const refresh = (): void => {
    const gold = opts.getGold();
    const levels = opts.getLevels();
    for (const id of UPGRADE_IDS) {
      const state = upgradeButtonState(gold, id, levels);
      const row = rowButtons.get(id);
      if (row) {
        row.setLabel(upgradeButtonLabel(id, levels[id]), upgradeCostLabel(id, levels[id]));
        row.setState(state);
      }
    }
    for (const r of sheetRows) {
      r.name.text = upgradeButtonLabel(r.id, levels[r.id]);
      r.effect.text = upgradeEffectLabel(r.id, levels[r.id]);
      r.buy.setLabel("강화", upgradeCostLabel(r.id, levels[r.id]));
      r.buy.setState(upgradeButtonState(gold, r.id, levels));
    }
    const abyss = opts.getAbyss();
    drawEffect.text = drawEffectLabel(abyss);
    drawBtn.setState(drawButtonState(abyss));
  };

  const openSheet = (): void => {
    if (open) return;
    open = true;
    openMs = 0;
    sheetView.visible = true;
    scrim.show();
    refresh();
  };

  const close = (): void => {
    if (!open) return;
    open = false;
    scrim.hide();
  };

  refresh();

  return {
    rowView,
    sheetView,
    get sheetOpen(): boolean {
      return open;
    },
    openSheet,
    closeSheet: close,
    refresh,
    update(dtMs: number): void {
      for (const b of rowButtons.values()) b.update(dtMs);
      for (const r of sheetRows) r.buy.update(dtMs);
      drawBtn.update(dtMs);
      closeBtn.update(dtMs);
      scrim.update(dtMs);
      if (openMs >= 0) {
        openMs += dtMs;
        const t = Math.min(1, openMs / SHEET_OPEN_MS);
        panel.view.position.set(SHEET_X, SHEET_Y + (1 - easeOutCubic(t)) * 48);
        panel.view.alpha = easeOutCubic(t);
        if (t >= 1) openMs = -1;
      }
      // 닫힘은 스크림 페이드가 끝난 뒤 통째로 숨긴다
      if (!open && sheetView.visible && !scrim.visible) {
        sheetView.visible = false;
      }
    },
    destroy(): void {
      for (const b of rowButtons.values()) b.destroy();
      for (const r of sheetRows) r.buy.destroy();
      drawBtn.destroy();
      closeBtn.destroy();
      scrim.destroy();
      panel.destroy();
      rowView.destroy({ children: true });
      sheetView.destroy({ children: true });
    },
  };
}
