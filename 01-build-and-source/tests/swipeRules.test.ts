import { describe, expect, it } from "vitest";
import {
  FIELD_SWIPE_MAX_START_RATIO,
  SWIPE_MAX_MS,
  SWIPE_MIN_DIST_PX,
  TAP_MAX_DIST_PX,
  TAP_MAX_MS,
  classifySwipe,
  fieldSwipeAllowed,
} from "../src/single/swipeRules";

const VIEW_H = 1280;

function sample(x: number, y: number, atMs: number) {
  return { x, y, atMs };
}

describe("classifySwipe — 위로 스와이프 = 하강 (숏츠 문법·팀 데모 기준)", () => {
  it("전장에서 위로 빠르게 밀면 descend다", () => {
    expect(classifySwipe(sample(360, 600, 0), sample(360, 450, 200), VIEW_H)).toBe("descend");
  });

  it("아래로 밀면 아무 일도 아니다 (하강은 위로만)", () => {
    expect(classifySwipe(sample(360, 450, 0), sample(360, 600, 200), VIEW_H)).toBe("none");
  });

  it("가로 우세 이동은 스와이프가 아니다", () => {
    expect(classifySwipe(sample(200, 600, 0), sample(500, 480, 200), VIEW_H)).toBe("none");
  });

  it("짧은 이동은 스와이프가 아니다", () => {
    expect(
      classifySwipe(sample(360, 600, 0), sample(360, 600 - SWIPE_MIN_DIST_PX + 1, 200), VIEW_H),
    ).toBe("none");
    expect(
      classifySwipe(sample(360, 600, 0), sample(360, 600 - SWIPE_MIN_DIST_PX, 200), VIEW_H),
    ).toBe("descend");
  });

  it("느린 드래그는 스와이프가 아니다", () => {
    expect(
      classifySwipe(sample(360, 600, 0), sample(360, 400, SWIPE_MAX_MS + 1), VIEW_H),
    ).toBe("none");
  });

  it("아래쪽 밴드(강화 줄·스킬바)에서 시작한 위 드래그는 descend가 아니다 — 시트의 몫", () => {
    const bandY = VIEW_H * FIELD_SWIPE_MAX_START_RATIO + 1;
    expect(classifySwipe(sample(360, bandY, 0), sample(360, bandY - 200, 200), VIEW_H)).toBe(
      "none",
    );
  });

  it("살짝 눌렀다 떼면 tap이다", () => {
    expect(classifySwipe(sample(360, 600, 0), sample(365, 605, 100), VIEW_H)).toBe("tap");
    expect(
      classifySwipe(sample(360, 600, 0), sample(360, 600 + TAP_MAX_DIST_PX, TAP_MAX_MS), VIEW_H),
    ).toBe("tap");
  });

  it("느리게 눌렀다 떼면(길게 누름) tap도 descend도 아니다", () => {
    expect(classifySwipe(sample(360, 600, 0), sample(360, 602, TAP_MAX_MS + 200), VIEW_H)).toBe(
      "none",
    );
  });

  it("시간이 거꾸로 가거나 NaN이면 none이다", () => {
    expect(classifySwipe(sample(360, 600, 500), sample(360, 400, 0), VIEW_H)).toBe("none");
    expect(classifySwipe(sample(360, Number.NaN, 0), sample(360, 400, 200), VIEW_H)).toBe("none");
  });
});

describe("fieldSwipeAllowed", () => {
  it("화면 위 70%까지만 하강 스와이프 시작점이다", () => {
    expect(fieldSwipeAllowed(0, VIEW_H)).toBe(true);
    expect(fieldSwipeAllowed(VIEW_H * FIELD_SWIPE_MAX_START_RATIO, VIEW_H)).toBe(true);
    expect(fieldSwipeAllowed(VIEW_H * FIELD_SWIPE_MAX_START_RATIO + 1, VIEW_H)).toBe(false);
  });

  it("비정상 입력은 거짓이다", () => {
    expect(fieldSwipeAllowed(Number.NaN, VIEW_H)).toBe(false);
    expect(fieldSwipeAllowed(100, 0)).toBe(false);
  });
});
