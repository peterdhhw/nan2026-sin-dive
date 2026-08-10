/**
 * 싱글 HUD — 층·페이즈·타락도(왼쪽), 타이틀 버튼·골드·콤보(오른쪽).
 *
 * PvP의 `shared/hud.ts`는 두 팀 플레이트·게이지 수치가 전제라 재사용하지
 * 않는다 (SHARED-API의 권고). 수치·배치는 `diveHudRules.ts`가 정본이다.
 */

import { Container, Graphics, Text } from "pixi.js";
import {
  ACCENT_GOLD,
  ACCENT_MAGENTA,
  FONT_FAMILY,
  T_CAPTION,
  T_HEADLINE,
  T_LABEL,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  UI_TEXT_DIM,
  fontWeightOf,
  snapFontSize,
} from "../shared/theme";
import { DESIGN_W } from "../shared/viewport";
import { createButton, type Button } from "../shared/ui/button";
import { createPill, type Pill } from "../shared/ui/pill";
import { fillPixelRect, strokePixelRect } from "../shared/ui/pixelShape";
import { fitText } from "../shared/ui/fitText";
import {
  ABYSS_PILL_W,
  ABYSS_PILL_X,
  ABYSS_PILL_Y,
  COMBO_TEXT_X,
  COMBO_TEXT_Y,
  CORRUPTION_TEXT_Y,
  FLOOR_TEXT_X,
  FLOOR_TEXT_Y,
  GOLD_PILL_W,
  GOLD_PILL_X,
  GOLD_PILL_Y,
  HUD_H,
  PHASE_TEXT_MAX_W,
  PHASE_TEXT_Y,
  TITLE_BTN_H,
  TITLE_BTN_TAP_ROOM,
  TITLE_BTN_W,
  TITLE_BTN_X,
  TITLE_BTN_Y,
  abyssLabel,
  comboLabel,
  corruptionLabel,
  goldLabel,
} from "./diveHudRules";
import { floorLabel } from "./sessionRules";

export interface DiveHud {
  view: Container;
  setFloor(floor: number): void;
  setPhaseName(name: string): void;
  setCorruption(corruption: number): void;
  /** gold=null은 "확인 불가"로 표기된다 — 0으로 위장하지 않는다 */
  setGold(gold: number | null): void;
  /** 심연석 잔고 (카드 뽑기 재화). null은 "확인 불가" */
  setAbyss(abyss: number | null): void;
  setCombo(combo: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

export interface DiveHudOpts {
  onTitle(): void;
}

function leftText(token: { size: number; weight: 400 | 700 }, color: number): Text {
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

export function createDiveHud(opts: DiveHudOpts): DiveHud {
  const view = new Container();
  view.label = "dive-hud";

  // 배경 밴드 — 필드가 HUD 아래에서 시작하므로 이 띠가 없으면 검은 구멍이 된다
  const bg = new Graphics();
  fillPixelRect(bg, 0, 0, DESIGN_W, HUD_H, 0, { color: UI_PANEL });
  strokePixelRect(bg, 0, HUD_H - 4, DESIGN_W, 4, 0, { color: UI_OUTLINE, width: 4 });
  view.addChild(bg);

  const floorText = leftText(T_HEADLINE, UI_TEXT);
  floorText.position.set(FLOOR_TEXT_X, FLOOR_TEXT_Y);
  view.addChild(floorText);

  const phaseText = leftText(T_CAPTION, UI_TEXT_DIM);
  phaseText.position.set(FLOOR_TEXT_X, PHASE_TEXT_Y);
  view.addChild(phaseText);

  const corruptionText = leftText(T_LABEL, ACCENT_MAGENTA);
  corruptionText.position.set(FLOOR_TEXT_X, CORRUPTION_TEXT_Y);
  view.addChild(corruptionText);

  const titleBtn: Button = createButton({
    label: "타이틀",
    state: "neutral",
    w: TITLE_BTN_W,
    h: TITLE_BTN_H,
    // 48px이라 탭 관용이 필요한데 아래가 골드 필이다 — 한도는 규칙이 정본이다
    tapRoom: TITLE_BTN_TAP_ROOM,
    onTap: () => opts.onTitle(),
  });
  titleBtn.view.position.set(TITLE_BTN_X, TITLE_BTN_Y);
  view.addChild(titleBtn.view);

  const goldPill: Pill = createPill({
    w: GOLD_PILL_W,
    iconColor: ACCENT_GOLD,
    text: goldLabel(0),
  });
  goldPill.view.position.set(GOLD_PILL_X, GOLD_PILL_Y);
  view.addChild(goldPill.view);

  // 심연석 필 — 자리·문구는 규칙이 정본이다. 색은 타락 계열(마젠타)이라
  // 골드(노랑)와 한눈에 갈린다: 나란히 있는 두 필이 같은 색이면 숫자를 읽어야
  // 어느 재화인지 안다
  const abyssPill: Pill = createPill({
    w: ABYSS_PILL_W,
    iconColor: ACCENT_MAGENTA,
    text: abyssLabel(0),
  });
  abyssPill.view.position.set(ABYSS_PILL_X, ABYSS_PILL_Y);
  view.addChild(abyssPill.view);

  const comboText = leftText(T_CAPTION, ACCENT_GOLD);
  comboText.anchor.set(1, 0); // 오른쪽 정렬 — 콤보 자릿수가 늘어도 오른쪽 끝이 고정
  comboText.position.set(COMBO_TEXT_X, COMBO_TEXT_Y);
  view.addChild(comboText);

  // setValue(카운트업)는 단위 없는 순수 숫자만 굴린다 — "1,234 G" 표기와 섞이면
  // 획득 순간마다 단위가 사라졌다 돌아온다. 골드는 항상 setText로 일관 표기한다.
  let lastGold: number | null = 0;
  let lastAbyss: number | null = 0;

  return {
    view,
    setFloor(floor: number): void {
      floorText.text = floorLabel(floor);
    },
    setPhaseName(name: string): void {
      phaseText.text = name;
      // 심연석 필과 같은 줄이다 — 예산을 넘으면 필 아래로 들어가 사라진다
      // (`PHASE_TEXT_MAX_W`). 축소만으로 열 이름 전부가 들어간다
      fitText(phaseText, PHASE_TEXT_MAX_W);
    },
    setCorruption(corruption: number): void {
      corruptionText.text = corruptionLabel(corruption);
    },
    setGold(gold: number | null): void {
      if (gold !== lastGold) goldPill.setText(goldLabel(gold));
      lastGold = gold;
    },
    setAbyss(abyss: number | null): void {
      if (abyss !== lastAbyss) abyssPill.setText(abyssLabel(abyss));
      lastAbyss = abyss;
    },
    setCombo(combo: number): void {
      comboText.text = comboLabel(combo);
    },
    update(dtMs: number): void {
      titleBtn.update(dtMs);
      goldPill.update(dtMs);
      abyssPill.update(dtMs);
    },
    destroy(): void {
      titleBtn.destroy();
      goldPill.destroy();
      abyssPill.destroy();
      view.destroy({ children: true });
    },
  };
}
