/**
 * **화면에 실제로 놓인 탭 대상들이 88px(§3-4)을 확보하는가.**
 *
 * ## 왜 이 파일이 있는가 (2026-08-07)
 *
 * `MIN_TAP = 88`은 `shapeRules.ts`에 처음부터 있었다. 그런데 그 값을 쓰는 곳은
 * `buttonWidth`(라벨에서 폭을 구할 때의 하한) **하나**였고, `w`/`h`를 직접
 * 넘기는 호출은 전부 검사 밖이었다. 실측 결과 여덟 곳이 88 아래였다:
 *
 * | 위젯 | 크기 |
 * |---|---|
 * | 싱글 HUD `타이틀` | 132×**48** |
 * | 카드함 입구 | 216×**56** |
 * | 강화 줄 4칸 | 162×**64** |
 * | 시트 닫기 · 대기 건너뛰기 · 카드함 닫기 | ×**68** |
 * | 결과 `타이틀로` · 타이틀 `대전` | ×**76** (=`BUTTON_H` 기본값) |
 *
 * 48px은 실기기에서 약 26dp다. **상수가 있어도 아무것도 안 물으면 없는 것과
 * 같다** — 그래서 상수의 존재가 아니라 화면의 목록을 여기서 센다.
 *
 * ## 왜 크기가 아니라 hitArea인가
 *
 * 여덟 곳 전부 자기 밴드에 여유가 없다(근거는 `shapeRules.tapSlack` 주석에
 * 부등식으로 남겼다). 그래서 `ui/button.ts`가 그림은 그대로 두고 hitArea만
 * `tapSlack`만큼 넓힌다 — 스킬 슬롯이 이미 쓰던 해법(`HIT_SLACK_PX`)의 사각형
 * 판이다. 이 파일은 **관용을 더한 뒤에도** 88이 되는지, 그리고 그 관용이 이웃을
 * 덮지 않는지를 같이 묻는다. 둘 중 하나만 물으면 반대쪽으로 고쳐진다.
 */

import { describe, expect, it } from "vitest";
import { ART_PX, BUTTON_H, MIN_TAP, tapSlack } from "../src/shared/ui/shapeRules";
import { DESIGN_H, DESIGN_W, SKILLBAR_RATIO } from "../src/shared/viewport";
import {
  GOLD_PILL_X,
  GOLD_PILL_Y,
  HUD_H,
  TITLE_BTN_H,
  TITLE_BTN_TAP_ROOM,
  TITLE_BTN_W,
  TITLE_BTN_X,
  TITLE_BTN_Y,
} from "../src/single/diveHudRules";
import { PILL_H } from "../src/shared/ui/pillRules";
import {
  GRABBER_H,
  GRABBER_Y,
  ROW_BUTTON_GAP,
  ROW_BUTTON_H,
  ROW_BUTTON_TAP_ROOM,
  ROW_BUTTON_Y,
  SHEET_CLOSE_H,
  SHEET_CLOSE_W,
  UPGRADE_ROW_H,
  rowButtonW,
  rowButtonX,
} from "../src/single/upgradePanelRules";
import {
  BOX_BUTTON_H,
  BOX_ENTRY_H,
  BOX_ENTRY_W,
} from "../src/shared/scenes/cardRules";
import {
  STATUS_PILL_Y_RATIO,
  TITLE_BOX_ENTRY_H,
  TITLE_BOX_ENTRY_MARGIN,
  TITLE_BOX_ENTRY_W,
  titleBoxEntryTapRoom,
} from "../src/shared/scenes/titleRules";
import { UPGRADE_IDS } from "../src/single/economyRules";

/**
 * 한 변이 관용을 더해 `MIN_TAP`에 닿는지. **면적으로 묻지 않는다** — 손가락은
 * 가장 짧은 변에 걸린다(720×20은 면적이 넉넉해도 세로로 못 맞춘다).
 */
function reach(size: number, roomA?: number, roomB?: number): number {
  return size + tapSlack(size, roomA) + tapSlack(size, roomB);
}

/**
 * 화면에 놓인 사각 버튼들의 **높이** 목록. 폭은 전부 128px 이상이라(가장 좁은
 * 것이 갤러리의 128, 실제 화면은 강화 줄의 162) 짧은 변은 늘 높이다.
 *
 * 목록을 손으로 든다: 씬은 Pixi를 부르므로 node가 못 읽고, 그렇다고 안 세면
 * "상수는 있는데 아무도 안 지킨다"로 돌아간다. 새 버튼이 이 목록에 없으면
 * 검사를 못 받는다는 것이 이 방식의 한계이고, 그래서 기본값(`BUTTON_H`)도
 * 같이 센다 — `h`를 생략한 버튼은 전부 그 값이다.
 */
const BUTTON_HEIGHTS: readonly (readonly [string, number])[] = [
  ["기본값 (h 생략)", BUTTON_H],
  ["싱글 HUD 타이틀", TITLE_BTN_H],
  ["카드함 입구 (대기 S2)", BOX_ENTRY_H],
  ["카드함 입구 (타이틀 우상단)", TITLE_BOX_ENTRY_H],
  ["강화 줄 버튼", ROW_BUTTON_H],
  ["강화 시트 닫기", SHEET_CLOSE_H],
  ["카드함 닫기", BOX_BUTTON_H],
  // 아래 셋은 씬에 인라인으로 적힌 값이다. 규칙으로 올릴 자리가 마땅치 않아
  // (한 씬에서만 쓰는 배치값) 여기에 숫자로 둔다 — 씬을 고치면 이 검사가
  // 깨지는 쪽이 조용히 26dp로 돌아가는 것보다 낫다
  ["대기 건너뛰기 (matchScene)", 68],
  ["결과 타이틀로 (resultScene)", 76],
  ["타이틀 대전 (titleScene)", 76],
  ["스토리 계속 (storyOverlay)", 88],
  ["강화 시트 강화·뽑기", 88],
  ["결과 다시 대전 · 타이틀 싱글", 96],
] as const;

describe("사각 버튼 — 짧은 변이 88을 확보한다", () => {
  /**
   * 관용을 **한도 없이** 물었을 때의 검사다. 이웃이 있는 둘(HUD 타이틀·강화 줄
   * 버튼)은 아래에서 따로, 한도를 넣어 다시 묻는다.
   */
  it("모든 버튼 높이가 관용을 더하면 88에 닿는다", () => {
    for (const [name, h] of BUTTON_HEIGHTS) {
      expect(h, `${name} 높이`).toBeGreaterThan(0);
      expect(reach(h), `${name} (${h}px)`).toBeGreaterThanOrEqual(MIN_TAP);
    }
  });

  /**
   * **관용이 필요 없는 크기를 관용으로 위장하지 않는다.** 88 이상인 버튼은
   * `tapSlack`이 0이어야 하고, 그래야 큰 버튼의 hitArea가 이웃으로 새지 않는다
   * (결과 화면의 `다시 대전`(96)과 `타이틀로`는 38px 떨어져 있다).
   */
  it("88 이상인 버튼은 그림 그대로다 — 관용이 이웃으로 새지 않는다", () => {
    for (const [name, h] of BUTTON_HEIGHTS) {
      if (h >= MIN_TAP) expect(tapSlack(h), `${name}`).toBe(0);
    }
  });

  /** 목록이 비면 위 검사가 아무것도 안 묻는다 — 실제로 그런 통과를 겪었다 */
  it("목록이 화면의 버튼 수만큼 있다", () => {
    expect(BUTTON_HEIGHTS.length).toBeGreaterThanOrEqual(13);
  });
});

/**
 * 타이틀 우상단 카드함 입구 — **이웃이 연결 상태 필이다.**
 *
 * 싱글 HUD `타이틀`과 같은 형태의 갇힘이다: 48px에 관용 20px씩이 필요한데
 * 아래에 만지면 안 되는 위젯이 있다. 자리·겹침 산술은 `titleRules.test.ts`가
 * 보고, 여기서는 **관용을 다 써도 88에 못 미친다는 사실**을 기록한다 —
 * "통과했으니 됐다"로 덮으면 위쪽 띠를 재배치할 근거가 사라진다.
 */
describe("타이틀 카드함 입구 — 관용이 연결 상태 필을 덮지 않는다", () => {
  const room = titleBoxEntryTapRoom(DESIGN_H);
  const up = tapSlack(TITLE_BOX_ENTRY_H, room.top);
  const down = tapSlack(TITLE_BOX_ENTRY_H, room.bottom);

  it("관용이 실제 이웃 자리에서 유도된다 — 손으로 적은 숫자가 아니다", () => {
    expect(room.bottom).toBe(
      DESIGN_H * STATUS_PILL_Y_RATIO -
        (TITLE_BOX_ENTRY_MARGIN + TITLE_BOX_ENTRY_H),
    );
  });

  it("관용을 다 써도 88에 못 미친다 — 남은 답은 위쪽 띠 재배치뿐이다", () => {
    const reachY = TITLE_BOX_ENTRY_H + up + down;
    expect(reachY).toBeLessThan(MIN_TAP);
    // 관용이 0이면 이 배선이 죽은 것이다 (원래 48보다는 넓어야 한다)
    expect(reachY).toBeGreaterThan(TITLE_BOX_ENTRY_H);
    // 가로는 넉넉하다 — 세로만 갇혀 있다는 것이 이 결함의 형태다
    expect(TITLE_BOX_ENTRY_W).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

/**
 * 싱글 HUD `타이틀` — 이 버튼이 이 파일의 이유다.
 *
 * 48px에 관용 20px씩이 필요한데 **아래 8px에 골드 필이 있다.** 관용을 그냥
 * 주면 잔고를 누른 손가락이 하강을 끝낸다.
 */
describe("싱글 HUD 타이틀 — 관용이 골드 필을 덮지 않는다", () => {
  const up = tapSlack(TITLE_BTN_H, TITLE_BTN_TAP_ROOM.top);
  const down = tapSlack(TITLE_BTN_H, TITLE_BTN_TAP_ROOM.bottom);

  it("한도가 실제 이웃 자리에서 유도된다 — 손으로 적은 숫자가 아니다", () => {
    expect(TITLE_BTN_TAP_ROOM.top).toBe(TITLE_BTN_Y);
    expect(TITLE_BTN_TAP_ROOM.bottom).toBe(
      GOLD_PILL_Y - (TITLE_BTN_Y + TITLE_BTN_H),
    );
  });

  it("탭 영역이 골드 필 위쪽으로 넘어가지 않는다", () => {
    expect(TITLE_BTN_Y + TITLE_BTN_H + down).toBeLessThanOrEqual(GOLD_PILL_Y);
  });

  it("탭 영역이 화면 위로 나가지 않는다", () => {
    expect(TITLE_BTN_Y - up).toBeGreaterThanOrEqual(0);
  });

  it("HUD 밴드 안이다 — 필 두 개와 같은 열을 쓴다", () => {
    expect(TITLE_BTN_Y + TITLE_BTN_H + down).toBeLessThan(HUD_H);
    expect(GOLD_PILL_Y + PILL_H).toBeLessThanOrEqual(HUD_H);
  });

  /**
   * **이 버튼은 88을 못 채운다 — 그 사실을 기록한다.** 위 10 + 아래 0 = 58px이
   * 여기서 얻을 수 있는 전부다. "통과했으니 됐다"로 덮으면 나중에 밴드를
   * 재배치할 근거가 사라진다. 더 필요하면 답은 관용이 아니라 HUD 재배치다
   * (그때 이 검사가 먼저 깨져서 알려준다).
   */
  it("관용을 다 써도 88에 못 미친다 — 남은 답은 HUD 재배치뿐이다", () => {
    const reachY = TITLE_BTN_H + up + down;
    expect(reachY).toBeLessThan(MIN_TAP);
    // 그래도 원래(48)보다는 넓어야 한다 — 관용이 0이면 이 배선이 죽은 것이다
    expect(reachY).toBeGreaterThan(TITLE_BTN_H);
    // 가로는 이미 넉넉하다 — 세로만 갇혀 있다는 것이 이 결함의 형태다
    expect(TITLE_BTN_W).toBeGreaterThanOrEqual(MIN_TAP);
    // 필과 세로로 갈려 있다는 사실 자체 (겹치면 위 검사가 무의미해진다)
    expect(GOLD_PILL_X).toBeLessThan(TITLE_BTN_X + TITLE_BTN_W);
  });
});

/**
 * 강화 줄 4칸 — 이웃이 **좌우에도** 있다. 두 버튼의 관용이 겹치면 경계
 * 픽셀의 주인이 그리는 순서로 정해진다(`강화`를 눌렀는데 옆 칸이 올라간다).
 */
describe("강화 줄 버튼 — 관용이 옆 칸·스킬바로 새지 않는다", () => {
  const up = tapSlack(ROW_BUTTON_H, ROW_BUTTON_TAP_ROOM.top);
  const down = tapSlack(ROW_BUTTON_H, ROW_BUTTON_TAP_ROOM.bottom);
  const side = tapSlack(rowButtonW(), ROW_BUTTON_TAP_ROOM.left);

  it("한도가 줄 높이·이웃 간격에서 유도된다", () => {
    expect(ROW_BUTTON_TAP_ROOM.top).toBe(ROW_BUTTON_Y);
    expect(ROW_BUTTON_TAP_ROOM.bottom).toBe(
      UPGRADE_ROW_H - (ROW_BUTTON_Y + ROW_BUTTON_H),
    );
    expect(ROW_BUTTON_TAP_ROOM.left).toBe(ROW_BUTTON_GAP / 2);
    expect(ROW_BUTTON_TAP_ROOM.right).toBe(ROW_BUTTON_GAP / 2);
  });

  /**
   * **버튼이 그래버 아래에 앉는다** — `ROW_BUTTON_Y`가 `GRABBER_Y`를 더하는
   * 이유이고, 그게 없으면 위 검사들은 **더 통과한다**: 버튼이 6px 올라가서
   * 아래 여백이 10 → 16으로 늘어나므로 관용이 12px 다 들어가 `86 → 88`이
   * 된다. 즉 탭만 물으면 이 상수는 지워도 아무도 모르고, 화면에서는 그래버
   * (y 6~14)와 버튼 사이가 2px만 남아 손잡이가 버튼에 붙어 버린다 —
   * 아트 픽셀(4) 한 칸도 안 되는 간격은 실화면에서 선이 하나로 읽힌다.
   *
   * 그래서 상수를 다시 적지 않고 **간격**을 묻는다: 그래버 아래로 한 칸 이상
   * 비어야 하고, 그래버 아래 남은 자리를 버튼이 위아래로 고르게 나눠 가져야
   * 한다(한쪽으로 몰리면 줄이 기울어 보인다).
   */
  it("버튼이 그래버 아래 한 칸 이상 떨어져, 남은 자리를 고르게 쓴다", () => {
    const grabberBottom = GRABBER_Y + GRABBER_H;
    const above = ROW_BUTTON_Y - grabberBottom;
    const below = UPGRADE_ROW_H - (ROW_BUTTON_Y + ROW_BUTTON_H);
    expect(above).toBeGreaterThanOrEqual(ART_PX);
    expect(below).toBeGreaterThanOrEqual(ART_PX);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(ART_PX);
  });

  it("탭 영역이 강화 줄 밖으로 나가지 않는다 — 아래는 스킬바다", () => {
    expect(ROW_BUTTON_Y - up).toBeGreaterThanOrEqual(0);
    expect(ROW_BUTTON_Y + ROW_BUTTON_H + down).toBeLessThanOrEqual(
      UPGRADE_ROW_H,
    );
  });

  /**
   * 폭은 162px이라 `tapSlack`이 0이다 — 좌우 관용은 아예 안 생긴다. 그래도
   * 한도를 넘기는 이유는 폭이 줄어드는 날(칸이 5개가 되는 날) 조용히 겹치지
   * 않게 하는 것이다. 그 사실을 여기서 확인해 둔다.
   */
  it("이웃한 두 칸의 탭 영역이 겹치지 않는다", () => {
    expect(side).toBe(0);
    for (let i = 1; i < UPGRADE_IDS.length; i++) {
      const prevRight = rowButtonX(i - 1) + rowButtonW() + side;
      expect(rowButtonX(i) - side, `#${i}`).toBeGreaterThanOrEqual(prevRight);
    }
  });

  it("마지막 칸까지 화면 안이다", () => {
    const last = UPGRADE_IDS.length - 1;
    expect(rowButtonX(last) + rowButtonW() + side).toBeLessThanOrEqual(DESIGN_W);
  });

  /** 줄이 96px뿐이라 여기도 88을 다 못 채운다 — 22 + 10 = 96px까지다 */
  it("관용을 다 써도 줄 높이가 상한이다", () => {
    expect(ROW_BUTTON_H + up + down).toBeLessThanOrEqual(UPGRADE_ROW_H);
    expect(ROW_BUTTON_H + up + down).toBeGreaterThan(ROW_BUTTON_H);
  });
});

/**
 * 이웃 없는 버튼들 — 한도를 안 받으므로 관용이 온전히 들어간다. 그 자리가
 * 화면 안인지만 본다(관용은 화면 밖으로도 나갈 수 있다).
 */
describe("여백에 놓인 버튼 — 관용이 화면을 넘지 않는다", () => {
  it("강화 시트 닫기가 88을 얻는다", () => {
    expect(reach(SHEET_CLOSE_H)).toBeGreaterThanOrEqual(MIN_TAP);
    expect(SHEET_CLOSE_W).toBeGreaterThanOrEqual(MIN_TAP);
  });

  it("카드함 입구·닫기가 88을 얻는다", () => {
    expect(reach(BOX_ENTRY_H)).toBeGreaterThanOrEqual(MIN_TAP);
    expect(BOX_ENTRY_W).toBeGreaterThanOrEqual(MIN_TAP);
    expect(reach(BOX_BUTTON_H)).toBeGreaterThanOrEqual(MIN_TAP);
  });

  /**
   * 대기 화면 `건너뛰기`는 y 0.925(=1184)에 68px이라 관용 10px을 더하면
   * 아래 끝이 1262다. 화면(1280) 안이다 — 나가면 아래쪽 관용이 잘려서 한쪽만
   * 넓어지고, 그러면 버튼 중심이 눈에 보이는 곳과 어긋난다.
   */
  it("대기 건너뛰기의 관용이 화면 아래를 넘지 않는다", () => {
    const y = DESIGN_H * 0.925;
    expect(y + 68 + tapSlack(68)).toBeLessThanOrEqual(DESIGN_H);
  });

  /** 스킬바 밴드는 관용까지 포함해 화면 안이다 (엄지가 가장 많이 오는 띠다) */
  it("스킬바 위 버튼들이 스킬바를 파고들지 않는다", () => {
    const barTop = DESIGN_H * (1 - SKILLBAR_RATIO);
    expect(ROW_BUTTON_Y + ROW_BUTTON_H + tapSlack(ROW_BUTTON_H, ROW_BUTTON_TAP_ROOM.bottom))
      .toBeLessThanOrEqual(UPGRADE_ROW_H);
    expect(barTop).toBeGreaterThan(0);
  });
});
