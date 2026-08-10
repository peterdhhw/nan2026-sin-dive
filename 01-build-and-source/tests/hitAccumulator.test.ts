import { expect, test } from "vitest";
import {
  FLUSH_MS,
  accumulateHit,
  createHitAccumulator,
  resetHitAccumulator,
} from "../src/shared/hitAccumulator";

test("sub-flush ticks accumulate silently then release as one number", () => {
  const acc = createHitAccumulator();
  // 60fps 틱, dps 50 → 틱당 0.83. 그대로 띄우면 초당 60개의 "1"이 쏟아진다
  let shown = 0;
  let emitted = 0;
  for (let t = 0; t < FLUSH_MS; t += 1000 / 60) {
    const out = accumulateHit(acc, 0, 0.83, false, t);
    if (out > 0) {
      emitted += 1;
      shown += out;
    }
  }
  expect(emitted).toBeLessThanOrEqual(1);
  const flush = accumulateHit(acc, 0, 0, false, FLUSH_MS * 2);
  expect(shown + flush).toBeGreaterThan(10);
});

test("a kill flushes immediately regardless of the window", () => {
  const acc = createHitAccumulator();
  expect(accumulateHit(acc, 0, 5, false, 0)).toBe(0);
  // 결정타 숫자가 250ms 뒤에 뜨면 인과가 끊긴다
  expect(accumulateHit(acc, 0, 7, true, 10)).toBe(12);
});

test("each enemy slot accumulates independently", () => {
  const acc = createHitAccumulator();
  accumulateHit(acc, 0, 10, false, 0);
  accumulateHit(acc, 1, 3, false, 0);
  expect(accumulateHit(acc, 0, 0, true, 5)).toBe(10);
  expect(accumulateHit(acc, 1, 0, true, 5)).toBe(3);
});

test("nothing is lost across a flush boundary", () => {
  const acc = createHitAccumulator();
  let total = 0;
  for (let t = 0; t <= FLUSH_MS * 4; t += 16) {
    total += accumulateHit(acc, 0, 2, false, t);
  }
  total += accumulateHit(acc, 0, 0, true, FLUSH_MS * 5);
  const ticks = Math.floor((FLUSH_MS * 4) / 16) + 1;
  expect(total).toBeCloseTo(ticks * 2);
});

test("reset drops pending damage so a new enemy starts clean", () => {
  const acc = createHitAccumulator();
  accumulateHit(acc, 0, 999, false, 0);
  // 웨이브가 넘어가면 슬롯의 주인이 바뀐다 — 이전 적의 딜을 다음 적에게 얹으면 안 된다
  resetHitAccumulator(acc);
  expect(accumulateHit(acc, 0, 4, true, 10)).toBe(4);
});

test("garbage and non-positive damage contribute nothing", () => {
  const acc = createHitAccumulator();
  accumulateHit(acc, 0, Number.NaN, false, 0);
  accumulateHit(acc, 0, -50, false, 1);
  expect(accumulateHit(acc, 0, 0, true, 2)).toBe(0);
});
