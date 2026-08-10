import { expect, test } from "vitest";
import {
  applyPush,
  createGauge,
  dpsToPush,
  gaugeToViewportRatio,
  gaugeWinner,
  DEFAULT_WIN_THRESHOLD,
  RATIO_MAX,
  RATIO_MIN,
} from "../src/core/gauge";

test("dpsToPush is monotonically increasing", () => {
  expect(dpsToPush(400)).toBeGreaterThan(dpsToPush(100));
});

test("dpsToPush has diminishing returns (4x damage < 4x push)", () => {
  expect(dpsToPush(400)).toBeLessThan(dpsToPush(100) * 4);
  expect(dpsToPush(400)).toBeCloseTo(dpsToPush(100) * 2, 5);
});

test("dpsToPush(0) is 0 and negatives clamp to 0", () => {
  expect(dpsToPush(0)).toBe(0);
  expect(dpsToPush(-50)).toBe(0);
});

test("gauge starts centered", () => {
  expect(createGauge().pos).toBe(0);
});

test("higher own push moves gauge positive (AC-1)", () => {
  const g = applyPush(createGauge(), 10, 2, 1000);
  expect(g.pos).toBeGreaterThan(0);
});

test("higher opponent push moves gauge negative", () => {
  const g = applyPush(createGauge(), 2, 10, 1000);
  expect(g.pos).toBeLessThan(0);
});

test("equal push leaves gauge unchanged", () => {
  const g = applyPush({ pos: 0.3 }, 7, 7, 1000);
  expect(g.pos).toBeCloseTo(0.3, 10);
});

test("applyPush does not mutate the input", () => {
  const before = createGauge();
  applyPush(before, 10, 0, 1000);
  expect(before.pos).toBe(0);
});

test("gauge clamps to [-1, 1]", () => {
  expect(applyPush({ pos: 0.99 }, 1000, 0, 5000).pos).toBe(1);
  expect(applyPush({ pos: -0.99 }, 0, 1000, 5000).pos).toBe(-1);
});

test("push scales with dtMs", () => {
  const a = applyPush(createGauge(), 10, 0, 100).pos;
  const b = applyPush(createGauge(), 10, 0, 200).pos;
  expect(b).toBeCloseTo(a * 2, 10);
});

test("gaugeWinner returns null before threshold (AC-2)", () => {
  expect(gaugeWinner({ pos: 0.5 }, DEFAULT_WIN_THRESHOLD)).toBeNull();
  expect(gaugeWinner({ pos: -0.5 }, DEFAULT_WIN_THRESHOLD)).toBeNull();
});

test("gaugeWinner returns 0 when we reach +threshold", () => {
  expect(gaugeWinner({ pos: 0.8 }, 0.8)).toBe(0);
  expect(gaugeWinner({ pos: 1 }, 0.8)).toBe(0);
});

test("gaugeWinner returns 1 when opponent reaches -threshold", () => {
  expect(gaugeWinner({ pos: -0.8 }, 0.8)).toBe(1);
  expect(gaugeWinner({ pos: -1 }, 0.8)).toBe(1);
});

test("viewport ratio is 0.5 at center", () => {
  expect(gaugeToViewportRatio(0)).toBeCloseTo(0.5, 10);
});

test("viewport ratio grows as we win and stays within bounds", () => {
  expect(gaugeToViewportRatio(0.5)).toBeGreaterThan(0.5);
  expect(gaugeToViewportRatio(-0.5)).toBeLessThan(0.5);
  expect(gaugeToViewportRatio(1)).toBeCloseTo(RATIO_MAX, 10);
  expect(gaugeToViewportRatio(-1)).toBeCloseTo(RATIO_MIN, 10);
});

test("viewport ratio never leaves [RATIO_MIN, RATIO_MAX] even for out-of-range input", () => {
  expect(gaugeToViewportRatio(5)).toBe(RATIO_MAX);
  expect(gaugeToViewportRatio(-5)).toBe(RATIO_MIN);
});

// 디버그 진입(`?gauge=`)이 시작 위치를 옮긴다. 로직은 그대로다 (설계 문서 09-3)
test("createGauge accepts a start position and clamps it", () => {
  expect(createGauge().pos).toBe(0);
  expect(createGauge(-0.72).pos).toBe(-0.72);
  expect(createGauge(5).pos).toBe(1);
  expect(createGauge(-5).pos).toBe(-1);
  expect(createGauge(Number.NaN).pos).toBe(0);
});
