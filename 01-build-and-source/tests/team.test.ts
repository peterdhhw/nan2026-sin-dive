import { expect, test } from "vitest";
import { autoAttackDamage, sumTeamRawDamage, teamPush } from "../src/core/team";
import { dpsToPush } from "../src/core/gauge";

test("empty team deals zero", () => {
  expect(sumTeamRawDamage([])).toBe(0);
  expect(teamPush([])).toBe(0);
});

test("sums raw damage across 2 members", () => {
  expect(sumTeamRawDamage([
    { memberId: "a", rawDamage: 100 },
    { memberId: "b", rawDamage: 44 },
  ])).toBe(144);
});

test("works unchanged for 3 members (teamSize generalization)", () => {
  expect(sumTeamRawDamage([
    { memberId: "a", rawDamage: 10 },
    { memberId: "b", rawDamage: 20 },
    { memberId: "c", rawDamage: 30 },
  ])).toBe(60);
});

test("teamPush converts the aggregate, not each member separately", () => {
  const members = [
    { memberId: "a", rawDamage: 100 },
    { memberId: "b", rawDamage: 100 },
  ];
  // 합산 후 sqrt(200) — 멤버별 sqrt(100)*2 = 20 보다 작아야 한다
  expect(teamPush(members)).toBeCloseTo(dpsToPush(200), 10);
  expect(teamPush(members)).toBeLessThan(20);
});

test("negative member damage is ignored, not subtracted", () => {
  expect(sumTeamRawDamage([
    { memberId: "a", rawDamage: 100 },
    { memberId: "b", rawDamage: -50 },
  ])).toBe(100);
});

test("auto attack damage scales with elapsed time", () => {
  const chars = [{ memberId: "a", stats: { attack: 100, attackIntervalMs: 1000 } }];
  const oneSecond = autoAttackDamage(chars, 1000);
  expect(oneSecond).toHaveLength(1);
  expect(oneSecond[0]!.rawDamage).toBeCloseTo(100, 6);
  expect(autoAttackDamage(chars, 500)[0]!.rawDamage).toBeCloseTo(50, 6);
});

test("auto attack damage never goes negative and survives a zero interval", () => {
  const chars = [
    { memberId: "a", stats: { attack: 100, attackIntervalMs: 0 } },
    { memberId: "b", stats: { attack: -50, attackIntervalMs: 1000 } },
  ];
  for (const d of autoAttackDamage(chars, 100)) {
    expect(Number.isFinite(d.rawDamage)).toBe(true);
    expect(d.rawDamage).toBeGreaterThanOrEqual(0);
  }
});
