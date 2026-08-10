import { describe, expect, it } from "vitest";
import {
  SCRIM_FADE_MS,
  SCRIM_SATURATE,
  scrimDimRect,
  scrimSaturate,
} from "../src/shared/ui/scrimRules";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";

describe("scrimSaturate (§C9)", () => {
  it("진행도 0은 원본, 1은 목표 채도다", () => {
    expect(scrimSaturate(0)).toBe(1);
    expect(scrimSaturate(1)).toBeCloseTo(SCRIM_SATURATE, 6);
  });

  it("중간은 두 값 사이에 있다 — 딤과 같이 내려가야 한다", () => {
    const mid = scrimSaturate(0.5);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(SCRIM_SATURATE);
  });

  it("범위를 벗어난 값·NaN을 접는다", () => {
    expect(scrimSaturate(-3)).toBe(1);
    expect(scrimSaturate(4)).toBeCloseTo(SCRIM_SATURATE, 6);
    expect(scrimSaturate(NaN)).toBe(1);
  });

  it("채도는 흑백까지 가지 않는다 — 뒤 화면이 살아 있어야 한다 (§08-1)", () => {
    expect(SCRIM_SATURATE).toBeGreaterThan(0);
    expect(SCRIM_SATURATE).toBeLessThan(1);
    expect(SCRIM_FADE_MS).toBeGreaterThan(0);
  });
});

/* ── scrimDimRect — 칠할 구역 (2026-08-07)
 *
 * 강화 시트가 최상단 레이어로 올라가면서 전면 딤이 HUD를 덮었다(골드 필 명도
 * 0.28 → 0.10). 근거는 `scrimRules.scrimDimRect` 주석에 있다.
 *
 * **여기서 묻는 것은 "칠할 구역과 삼킬 구역이 다를 수 있는가"다.** 삼킬 구역이
 * 전면으로 남는지는 위젯 쪽 계약이라 `upgradePanelRules.test.ts`가 시트 기하로
 * 같이 본다.
 */
describe("scrimDimRect", () => {
  it("구역을 안 주면 전면이다 — 기존 호출부의 동작이 그대로여야 한다", () => {
    expect(scrimDimRect(DESIGN_W, DESIGN_H)).toEqual({
      x: 0,
      y: 0,
      w: DESIGN_W,
      h: DESIGN_H,
    });
    expect(scrimDimRect(DESIGN_W, DESIGN_H, null)).toEqual({
      x: 0,
      y: 0,
      w: DESIGN_W,
      h: DESIGN_H,
    });
  });

  it("준 구역을 그대로 쓴다 — 위쪽 밴드를 남길 수 있다", () => {
    const r = scrimDimRect(DESIGN_W, DESIGN_H, { x: 0, y: 154, w: DESIGN_W, h: DESIGN_H - 154 });
    expect(r.y).toBe(154);
    expect(r.h).toBe(DESIGN_H - 154);
    // 남긴 밴드가 실제로 칠해지지 않는다 (그게 결함의 수정이다)
    expect(r.y).toBeGreaterThan(0);
  });

  /**
   * **딤이 사라지는 쪽으로 접지 않는다.**
   *
   * 0 크기나 NaN에서 "안 칠함"을 고르면 "모달인데 뒤가 밝다"가 되고, 그건
   * 위젯 첫 주석의 오조작 방지가 조용히 없어진 상태다 — 히트 영역은 남아
   * 있으니 탭은 삼키는데 화면은 모달로 안 보인다.
   */
  it("이상한 구역은 전면으로 접는다, 빈 구역으로 접지 않는다", () => {
    for (const bad of [
      { x: 0, y: 0, w: 0, h: 100 },
      { x: 0, y: 0, w: 100, h: 0 },
      { x: 0, y: 0, w: -50, h: 100 },
      { x: Number.NaN, y: 0, w: 100, h: 100 },
      { x: 0, y: 0, w: Number.NaN, h: 100 },
      { x: 0, y: Number.POSITIVE_INFINITY, w: 100, h: 100 },
    ]) {
      const r = scrimDimRect(DESIGN_W, DESIGN_H, bad);
      expect(r.w * r.h, JSON.stringify(bad)).toBe(DESIGN_W * DESIGN_H);
    }
  });

  it("전면 밖으로 나가는 부분은 잘라낸다", () => {
    const r = scrimDimRect(100, 100, { x: 60, y: 60, w: 200, h: 200 });
    expect(r).toEqual({ x: 60, y: 60, w: 40, h: 40 });
  });

  it("화면 크기 자체가 이상하면 최소 1px로 접는다 — 0으로 나누는 곳이 없다", () => {
    const r = scrimDimRect(Number.NaN, -5);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
});
