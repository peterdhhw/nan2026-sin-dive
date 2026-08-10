import { expect, test } from "vitest";
import { createCastQueue, SKILL_SPREAD_MS } from "../src/core/castQueue";
import { sumTeamRawDamage } from "../src/core/team";

test("a cast spreads its power over SKILL_SPREAD_MS, not one tick", () => {
  const q = createCastQueue();
  q.push("me", 600);
  const first = sumTeamRawDamage(q.drain(100));
  // 600딜을 400ms에 나누면 100ms 몫은 150 — 한 틱에 600이 들어가면 dps가 60배로 튄다
  expect(first).toBeCloseTo(150, 6);
  expect(q.pendingDamage).toBeCloseTo(450, 6);
});

test("the full power is eventually paid out, never lost", () => {
  const q = createCastQueue();
  q.push("me", 650);
  let total = 0;
  for (let i = 0; i < 40; i++) total += sumTeamRawDamage(q.drain(1000 / 60));
  expect(total).toBeCloseTo(650, 6);
  expect(q.pendingDamage).toBe(0);
});

test("a dt longer than the remaining window pays out the rest at once", () => {
  const q = createCastQueue();
  q.push("me", 500);
  expect(sumTeamRawDamage(q.drain(SKILL_SPREAD_MS * 2))).toBeCloseTo(500, 6);
  expect(q.pendingDamage).toBe(0);
});

test("overlapping casts accumulate independently", () => {
  const q = createCastQueue();
  q.push("a", 400);
  q.drain(200); // a는 절반 소진
  q.push("b", 400);
  expect(q.pendingDamage).toBeCloseTo(600, 6);
  const out = q.drain(200);
  // a는 잔량 전부(200), b는 절반(200)
  expect(sumTeamRawDamage(out)).toBeCloseTo(400, 6);
  expect(q.pendingDamage).toBeCloseTo(200, 6);
});

test("zero and negative power are ignored", () => {
  const q = createCastQueue();
  q.push("me", 0);
  q.push("me", -10);
  expect(q.pendingDamage).toBe(0);
  expect(q.drain(100)).toEqual([]);
});

test("drain reports the casting member so damage stays attributable", () => {
  const q = createCastQueue();
  q.push("noa", 400);
  expect(q.drain(100)[0]?.memberId).toBe("noa");
});
