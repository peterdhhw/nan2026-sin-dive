import { expect, test } from "vitest";
// loop.ts가 아니라 loopMath.ts에서 가져온다 — Pixi Ticker import는 node 환경에서
// navigator를 요구하므로 순수 계산만 분리해 테스트한다 (fxMapping·skillRules와 동일).
import {
  accumulateSteps,
  FIXED_STEP_MS,
  MAX_STEPS_PER_FRAME,
} from "../src/shared/loopMath";

test("one 60fps frame yields exactly one step", () => {
  const r = accumulateSteps(0, FIXED_STEP_MS);
  expect(r.steps).toBe(1);
  expect(r.restMs).toBeCloseTo(0, 6);
});

test("a short frame yields no step and carries the remainder", () => {
  const r = accumulateSteps(0, 5);
  expect(r.steps).toBe(0);
  expect(r.restMs).toBe(5);
});

test("carried remainder eventually produces a step", () => {
  let acc = 0;
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const r = accumulateSteps(acc, 5);
    acc = r.restMs;
    total += r.steps;
  }
  // 12 * 5ms = 60ms → 16.67ms 스텝 3개
  expect(total).toBe(3);
});

test("a long stall is clamped so the game never freeze-catches-up", () => {
  const r = accumulateSteps(0, 10_000);
  expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
  // 남은 시간은 버린다 — 누적하면 다음 프레임도 계속 클램프에 걸린다
  expect(r.restMs).toBe(0);
});

test("negative or zero dt is ignored", () => {
  expect(accumulateSteps(3, 0)).toEqual({ steps: 0, restMs: 3 });
  expect(accumulateSteps(3, -100)).toEqual({ steps: 0, restMs: 3 });
});
