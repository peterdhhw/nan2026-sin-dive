import { expect, test } from "vitest";
import { createRng } from "../src/core/rng";

test("same seed yields same sequence", () => {
  const a = createRng(42);
  const b = createRng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});

test("next() stays in [0,1)", () => {
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test("int(max) stays in [0,max) and is integral", () => {
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(5);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
    expect(Number.isInteger(v)).toBe(true);
  }
});

test("pick returns an element of the array", () => {
  const r = createRng(3);
  const arr = ["a", "b", "c"] as const;
  expect(arr).toContain(r.pick(arr));
});

test("pick on empty array throws", () => {
  const r = createRng(3);
  expect(() => r.pick([])).toThrow();
});

test("different seeds differ", () => {
  expect(createRng(1).next()).not.toBe(createRng(2).next());
});
