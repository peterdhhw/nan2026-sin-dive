import { describe, expect, it } from "vitest";
import {
  BUTTON_TEXT_INSET,
  HEADER_H,
  PAD_BUTTON_X,
  PAD_PANEL,
  buttonTextMaxW,
} from "../src/shared/ui/shapeRules";
import { FIT_MIN_SCALE } from "../src/shared/ui/fitTextRules";
import { DRAW_COST, canDraw } from "../src/core/deck/deck";
import {
  DRAW_ROW_INDEX,
  ROW_MARGIN_X,
  SHEET_CLOSE_GAP,
  SHEET_CLOSE_H,
  SHEET_DIM_RECT,
  SHEET_H,
  SHEET_ROWS,
  SHEET_ROW_GAP,
  SHEET_ROW_H,
  SHEET_Y,
  SINGLE_FIELD_H,
  UPGRADE_ROW_H,
  UPGRADE_ROW_Y,
  drawButtonState,
  drawCostLabel,
  drawEffectLabel,
  rowButtonW,
  rowButtonX,
  sheetCloseY,
  sheetFits,
  sheetRowY,
  upgradeButtonLabel,
  upgradeButtonState,
  upgradeCostLabel,
  upgradeEffectLabel,
} from "../src/single/upgradePanelRules";
import {
  ABYSS_PILL_Y,
  BANNER_BOTTOM_Y,
  FLOOR_TEXT_Y,
  GOLD_PILL_Y,
  HUD_H,
  TITLE_BTN_H,
  TITLE_BTN_Y,
} from "../src/single/diveHudRules";
import { PILL_H } from "../src/shared/ui/pillRules";
import { DESIGN_W, DESIGN_H, SKILLBAR_RATIO, HUD_RATIO } from "../src/shared/viewport";
import { SPD_MAX_LEVEL, UPGRADE_IDS, emptyLevels, upgradeCost } from "../src/single/economyRules";

describe("배치 — 강화 줄과 시트", () => {
  it("강화 줄은 스킬바 바로 위에 붙는다", () => {
    expect(UPGRADE_ROW_Y + UPGRADE_ROW_H).toBeCloseTo(DESIGN_H * (1 - SKILLBAR_RATIO));
  });

  it("강화 줄이 전장(HUD 아래)을 침범하지 않는다", () => {
    expect(UPGRADE_ROW_Y).toBeGreaterThan(DESIGN_H * HUD_RATIO);
  });

  it("줄 버튼 4개가 좌우 여백 안에 정확히 들어간다", () => {
    const n = UPGRADE_IDS.length;
    const lastRight = rowButtonX(n - 1, n) + rowButtonW(n);
    expect(rowButtonX(0, n)).toBe(ROW_MARGIN_X);
    expect(lastRight).toBeLessThanOrEqual(DESIGN_W - ROW_MARGIN_X);
    expect(lastRight).toBeGreaterThan(DESIGN_W - ROW_MARGIN_X - 8); // 남는 픽셀은 반올림 몫뿐
  });

  it("시트는 화면 안에 있고 스킬바를 덮지 않는다", () => {
    expect(SHEET_Y).toBeGreaterThan(0);
    expect(SHEET_Y + SHEET_H).toBeLessThanOrEqual(DESIGN_H * (1 - SKILLBAR_RATIO));
  });

  /**
   * **배너가 시트 헤더를 덮으면 안 된다** — 캡처로 잡은 실결함이다(3단계에서
   * 행이 하나 늘자 `SHEET_H`를 826으로 손으로 키웠고, 시트는 스킬바 위에서
   * **위로** 자라므로 헤더("강화")가 배너 띠 안으로 들어갔다).
   *
   * 이 겹침은 조용하다: 배너는 `fx` 레이어라 시트보다 위에 그려지고 900ms만
   * 뜬다 — 시트를 연 채 층을 돌파하는 순간에만 보인다. 그래서 부등식으로 못
   * 박는다. 지금은 top을 배너 아래에 **고정**해서 구조적으로 불가능하지만,
   * 누군가 다시 높이를 손으로 키우면 여기서 걸린다.
   */
  it("시트 헤더가 배너 띠 아래에서 시작한다", () => {
    expect(SHEET_Y).toBeGreaterThanOrEqual(BANNER_BOTTOM_Y);
    // 헤더 전체가 배너 밖이다 — top만 보면 헤더 글자가 걸릴 수 있다
    expect(SHEET_Y + HEADER_H).toBeGreaterThan(BANNER_BOTTOM_Y);
  });

  /** 닫기 버튼이 패널 밖으로 넘치던 실결함(캡처로 발견)을 고정하는 예산 검사 */
  it("시트 내부 예산: 모든 행 + 닫기 버튼이 패널 콘텐츠 안에 들어간다", () => {
    // 패널 내부 높이 = SHEET_H − 패딩(PAD_PANEL×2) − 헤더(HEADER_H)
    const innerH = SHEET_H - PAD_PANEL * 2 - HEADER_H;
    const rowsH = SHEET_ROWS * (SHEET_ROW_H + SHEET_ROW_GAP);
    expect(rowsH + SHEET_CLOSE_GAP + SHEET_CLOSE_H).toBeLessThanOrEqual(innerH);
    expect(sheetFits(SHEET_ROWS)).toBe(true);
  });

  /**
   * 예산 검사가 **거짓 통과할 수 없어야** 한다 — 행을 하나 더 얹으면 넘쳐야
   * 한다. 이게 없으면 SHEET_H를 크게 잡아 두고 "언제나 통과"인 검사가 된다.
   * (3단계에서 정확히 그 방식으로 통과시켰다 — 높이를 키워서. 지금은 높이가
   * 화면에서 나오므로 그 도피로가 없다.)
   */
  it("행이 하나 더 늘면 예산을 넘는다 (검사가 실제로 조인다)", () => {
    expect(sheetFits(SHEET_ROWS + 1)).toBe(false);
  });

  /** 행 안에서 가장 큰 것은 88px 강화 버튼이다 — 행이 그보다 낮으면 버튼이 넘친다 */
  it("행 높이가 행 안의 버튼보다 크다", () => {
    expect(SHEET_ROW_H).toBeGreaterThanOrEqual(88);
  });

  it("행 수는 강화 4 + 뽑기 1이고, 닫기는 마지막 행 아래다", () => {
    expect(SHEET_ROWS).toBe(UPGRADE_IDS.length + 1);
    expect(DRAW_ROW_INDEX).toBe(UPGRADE_IDS.length);
    // 닫기가 마지막 행(뽑기)과 겹치지 않는다
    expect(sheetCloseY()).toBeGreaterThanOrEqual(
      sheetRowY(DRAW_ROW_INDEX) + SHEET_ROW_H,
    );
  });
});

describe("카드 뽑기 행 (3단계)", () => {
  it("비용 라벨은 심연석 단위다", () => {
    expect(drawCostLabel()).toBe(`${DRAW_COST} 심연석`);
  });

  it("설명이 잔고와 남은 횟수를 함께 말한다", () => {
    expect(drawEffectLabel(0)).toBe("심연석 0 · 0회 가능");
    expect(drawEffectLabel(DRAW_COST * 3 + 4)).toContain("3회 가능");
    expect(drawEffectLabel(12345)).toContain("12,345");
  });

  it("잔고 실패(null)는 숫자를 위장하지 않는다", () => {
    // 0으로 적으면 "번 적 없음"으로 읽힌다 — 실패와 0은 다른 값이다(§4-3)
    expect(drawEffectLabel(null)).not.toContain("0");
    expect(drawEffectLabel(null)).toContain("확인 불가");
  });

  it("버튼 상태는 canDraw와 갈리지 않는다", () => {
    expect(drawButtonState(DRAW_COST)).toBe("ready");
    expect(drawButtonState(DRAW_COST - 1)).toBe("disabled");
    expect(drawButtonState(null)).toBe("disabled");
    expect(drawButtonState(Number.NaN)).toBe("disabled");
    for (const abyss of [null, Number.NaN, -1, 0, DRAW_COST - 1, DRAW_COST, 1e6]) {
      expect(drawButtonState(abyss)).toBe(canDraw(abyss) ? "ready" : "disabled");
    }
  });
});

describe("라벨", () => {
  it("버튼 라벨과 비용", () => {
    expect(upgradeButtonLabel("atk", 3)).toBe("공격력 Lv.3");
    expect(upgradeCostLabel("atk", 0)).toBe(`${upgradeCost("atk", 0)} G`);
    expect(upgradeCostLabel("spd", SPD_MAX_LEVEL)).toBe("MAX");
  });

  it("비용은 천 단위 구분이다", () => {
    // atk 레벨 30 비용 = round(60×1.14^30) ≈ 3,059 — 네 자리부터 콤마
    const label = upgradeCostLabel("atk", 30);
    expect(label).toMatch(/^\d{1,3}(,\d{3})+ G$/);
  });

  it("효과 설명은 현재 배율을 말한다", () => {
    expect(upgradeEffectLabel("atk", 0)).toBe("팀 공격력 ×1.00");
    expect(upgradeEffectLabel("spd", 10)).toBe(`공격 간격 ×${Math.pow(0.99, 10).toFixed(2)}`);
    expect(upgradeEffectLabel("gold", 1)).toBe("골드 획득 ×1.06");
    expect(upgradeEffectLabel("skill", 2)).toBe(`스킬 위력 ×${Math.pow(1.08, 2).toFixed(2)}`);
  });
});

describe("upgradeButtonState — 잔고 실패 방어", () => {
  it("잔고가 충분하면 ready, 부족하면 disabled", () => {
    expect(upgradeButtonState(1000, "atk", emptyLevels())).toBe("ready");
    expect(upgradeButtonState(1, "atk", emptyLevels())).toBe("disabled");
  });

  it("잔고 실패(null)와 만렙은 항상 disabled", () => {
    expect(upgradeButtonState(null, "atk", emptyLevels())).toBe("disabled");
    expect(
      upgradeButtonState(1e12, "spd", { ...emptyLevels(), spd: SPD_MAX_LEVEL }),
    ).toBe("disabled");
  });
});

/**
 * 강화 줄 라벨이 버튼 폭 안에 들어가는가.
 *
 * **폭을 재는 방법**: `dotTextW`(diveHudRules.test.ts와 같은 어림)를 쓴다 —
 * node는 폰트를 못 재므로(Galmuri11 로드는 브라우저 몫) 한글 전각 24 / ASCII
 * 반각 12로 센다. 브라우저 `measureText` 실측과 대조해 한글 문구에서 ±6px이고
 * 이쪽이 **크게** 나오는 방향이라 예산 검사로 안전하다
 * (`공격 속도 Lv.100` 실측 194 / 어림 192, 2026-08-07 측정).
 *
 * 이 검사가 잡는 것은 **폭 예산의 산술**이다: `rowButtonW()`·`BUTTON_TEXT_INSET`
 * 중 하나가 바뀌면 깨진다. 겹침 자체는 캡처로 판정했다 — `fitText`가 붙기 전
 * 버튼 셋의 글자가 옆 버튼으로 흘러 한 줄로 읽혔다.
 */
describe("강화 줄 라벨 폭 예산", () => {
  /** 도트 폰트 24px 어림 — 한글 전각, ASCII 반각 */
  const dotTextW = (text: string, size = 24): number => {
    let w = 0;
    for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x80 ? size / 2 : size;
    return w;
  };

  /** 실제로 도달하는 최대 표기 — 레벨은 세 자리까지 본다 */
  const LEVELS = [0, 10, 100];

  it("가장 긴 라벨도 축소 하한 안에서 버튼에 들어간다", () => {
    const maxW = buttonTextMaxW(rowButtonW());
    for (const id of UPGRADE_IDS) {
      for (const lv of LEVELS) {
        const text = upgradeButtonLabel(id, lv);
        // fitText는 minScale까지 줄인다. 그 안에 들어가면 말줄임이 없다 —
        // 말줄임되면 어떤 강화인지 안 읽힌다("스킬 위…")
        expect(dotTextW(text) * FIT_MIN_SCALE, text).toBeLessThanOrEqual(maxW);
      }
    }
  });

  it("서브라벨(비용)도 같은 예산 안이다", () => {
    const maxW = buttonTextMaxW(rowButtonW());
    for (const id of UPGRADE_IDS) {
      for (const lv of LEVELS) {
        const text = upgradeCostLabel(id, lv);
        expect(dotTextW(text) * FIT_MIN_SCALE, text).toBeLessThanOrEqual(maxW);
      }
    }
  });

  it("안쪽 여백이 라벨 밖에 더하는 패딩보다 작다 — 안 넘치던 라벨을 깨지 않는다", () => {
    // PAD_BUTTON_X(20)를 예산으로 쓰면 122px가 되어 `공격력 Lv.0`(134px)까지
    // 축소된다. 그건 겹침을 고치면서 멀쩡한 라벨을 건드리는 것이다
    expect(BUTTON_TEXT_INSET).toBeLessThan(PAD_BUTTON_X);
    expect(buttonTextMaxW(rowButtonW())).toBeGreaterThanOrEqual(
      dotTextW(upgradeButtonLabel("atk", 0)),
    );
  });
});

/* ── 시트 딤이 칠할 구역 (2026-08-07)
 *
 * 시트가 최상단 레이어(`layers.fx`)로 올라가면서 전면 딤이 HUD를 덮었다.
 * 1:1 캡처 실측: 골드 필 명도 0.28 → 0.10(2.8배), 심연석 필 0.35 → 0.12,
 * 층 숫자 0.28 → 0.10. 유도는 `upgradePanelRules.SHEET_DIM_RECT` 주석이다.
 *
 * **HUD의 세 수를 하나하나 확인한다.** 구역의 y만 재면 "HUD 아래에서 시작한다"는
 * 확인되지만 "그래서 잔고가 읽히는가"는 안 물어진다 — 필이 아래로 내려가는 날
 * (필 y는 `ABYSS_PILL_W` 주석의 부등식 안에서 움직인다) 조용히 다시 덮인다.
 */
describe("시트 딤 — 무엇을 어둡게 하고 무엇을 남기는가", () => {
  const inDim = (y: number, h: number): boolean =>
    y + h > SHEET_DIM_RECT.y && y < SHEET_DIM_RECT.y + SHEET_DIM_RECT.h;

  it("HUD에서 읽어야 하는 수는 딤 밖에 남는다", () => {
    // 강화 화면이 하는 일이 비용과 잔고의 뺄셈이다 — 그 잔고가 여기 있다
    for (const [name, y, h] of [
      ["골드 필", GOLD_PILL_Y, PILL_H],
      ["심연석 필", ABYSS_PILL_Y, PILL_H],
      ["층 숫자", FLOOR_TEXT_Y, 56],
    ] as const) {
      expect(inDim(y, h), name).toBe(false);
    }
  });

  it("전장은 딤 안이다 — 시트가 가리려는 것이 그것이다", () => {
    // 하강은 시트를 열어도 멈추지 않는다(`paused`가 아니다) — 뒤에서 계속
    // 돌아가는 전투가 시선을 끌면 시트를 읽을 수 없다
    expect(inDim(HUD_H, SINGLE_FIELD_H)).toBe(true);
  });

  it("강화 줄과 스킬바도 딤 안이다 — 시트가 열린 동안 쓸 수 없는 것들이다", () => {
    expect(inDim(UPGRADE_ROW_Y, UPGRADE_ROW_H)).toBe(true);
    expect(inDim(DESIGN_H * (1 - SKILLBAR_RATIO), DESIGN_H * SKILLBAR_RATIO)).toBe(true);
  });

  /**
   * **딤은 시트 뒤를 다 덮어야 한다.** 시트보다 좁으면 패널 가장자리에 밝은
   * 테가 생기고, 그건 "모달인데 뒤가 살아 있다"로 읽힌다.
   */
  it("딤이 시트 패널을 완전히 감싼다", () => {
    expect(SHEET_DIM_RECT.y).toBeLessThanOrEqual(SHEET_Y);
    expect(SHEET_DIM_RECT.y + SHEET_DIM_RECT.h).toBeGreaterThanOrEqual(SHEET_Y + SHEET_H);
    expect(SHEET_DIM_RECT.x).toBeLessThanOrEqual(0);
    expect(SHEET_DIM_RECT.x + SHEET_DIM_RECT.w).toBeGreaterThanOrEqual(DESIGN_W);
  });

  /**
   * **탭 삼키기는 전면이다 — 칠하는 구역과 다르다.**
   *
   * 딤을 좁히면서 히트 영역도 같이 좁히면, 시트가 열린 동안 HUD의 타이틀
   * 버튼이 눌려 모달 위에서 씬이 바뀐다. 위젯이 `hitArea`를 명시하는 이유이고
   * (`shared/ui/scrim.ts`), 여기서는 그 두 구역이 **실제로 다름**을 기록한다 —
   * 같아지면 위 검사들이 전부 통과하면서 오조작만 돌아온다.
   */
  it("칠할 구역이 전면보다 작다 — 그래서 히트 영역과 갈라져 있어야 한다", () => {
    expect(SHEET_DIM_RECT.w * SHEET_DIM_RECT.h).toBeLessThan(DESIGN_W * DESIGN_H);
    // 타이틀 버튼(씬을 바꾼다)이 칠하지 않는 구역에 있다 — 여기가 삼켜져야 한다
    expect(inDim(TITLE_BTN_Y, TITLE_BTN_H)).toBe(false);
  });
});
