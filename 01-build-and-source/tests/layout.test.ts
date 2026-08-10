import { expect, test } from "vitest";
import {
  computeSplit,
  lerpRatio,
  DESIGN_H,
  DESIGN_W,
  GAUGE_BAR_H,
  HUD_RATIO,
  SKILLBAR_RATIO,
} from "../src/pvp/splitLayout";

test("design resolution is 720x1280 (9:16)", () => {
  expect(DESIGN_W / DESIGN_H).toBeCloseTo(9 / 16, 10);
});

test("all five bands exactly fill the height with no gap or overlap", () => {
  const l = computeSplit(0);
  const bands = [l.hud, l.top, l.gauge, l.bottom, l.skillBar];
  for (let i = 1; i < bands.length; i++) {
    expect(bands[i]!.y).toBeCloseTo(bands[i - 1]!.y + bands[i - 1]!.h, 6);
  }
  expect(bands[0]!.y).toBe(0);
  const last = bands[bands.length - 1]!;
  expect(last.y + last.h).toBeCloseTo(DESIGN_H, 6);
});

test("every band spans the full width", () => {
  for (const r of Object.values(computeSplit(0))) {
    expect(r.x).toBe(0);
    expect(r.w).toBe(DESIGN_W);
  }
});

test("hud and skillbar heights are fixed regardless of gauge", () => {
  const a = computeSplit(-1);
  const b = computeSplit(1);
  expect(a.hud.h).toBeCloseTo(DESIGN_H * HUD_RATIO, 6);
  expect(b.hud.h).toBeCloseTo(a.hud.h, 6);
  expect(a.skillBar.h).toBeCloseTo(DESIGN_H * SKILLBAR_RATIO, 6);
  expect(b.skillBar.h).toBeCloseTo(a.skillBar.h, 6);
});

test("gauge bar height is fixed", () => {
  expect(computeSplit(0).gauge.h).toBe(GAUGE_BAR_H);
  expect(computeSplit(0.9).gauge.h).toBe(GAUGE_BAR_H);
});

test("top and bottom fields are equal at gauge center", () => {
  const l = computeSplit(0);
  expect(l.top.h).toBeCloseTo(l.bottom.h, 6);
});

test("winning grows our field and shrinks theirs", () => {
  const win = computeSplit(0.8);
  const mid = computeSplit(0);
  expect(win.top.h).toBeGreaterThan(mid.top.h);
  expect(win.bottom.h).toBeLessThan(mid.bottom.h);
});

test("losing shrinks our field but never to zero", () => {
  const lose = computeSplit(-1);
  expect(lose.top.h).toBeGreaterThan(0);
  expect(lose.bottom.h).toBeGreaterThan(0);
});

test("field total is conserved as the gauge moves", () => {
  const total = (pos: number): number => {
    const l = computeSplit(pos);
    return l.top.h + l.bottom.h;
  };
  expect(total(0.9)).toBeCloseTo(total(-0.9), 6);
  expect(total(0)).toBeCloseTo(total(0.5), 6);
});

test("custom viewport size scales the bands", () => {
  const l = computeSplit(0, 360, 640);
  expect(l.hud.w).toBe(360);
  expect(l.skillBar.y + l.skillBar.h).toBeCloseTo(640, 6);
});

test("lerpRatio moves toward the target and never overshoots", () => {
  const next = lerpRatio(0.5, 0.9, 100);
  expect(next).toBeGreaterThan(0.5);
  expect(next).toBeLessThan(0.9);
});

test("lerpRatio converges to the target over time", () => {
  let v = 0.5;
  for (let i = 0; i < 200; i++) v = lerpRatio(v, 0.9, 16);
  expect(v).toBeCloseTo(0.9, 4);
});

test("lerpRatio with dtMs 0 is a no-op", () => {
  expect(lerpRatio(0.42, 0.9, 0)).toBe(0.42);
});

test("lerpRatio reaches roughly halfway after one half-life", () => {
  expect(lerpRatio(0, 1, 120, 120)).toBeCloseTo(0.5, 2);
});
