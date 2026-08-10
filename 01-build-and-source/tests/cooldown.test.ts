import { expect, test } from "vitest";
import { createCooldownTracker } from "../src/core/cooldown";
import type { SkillDef } from "../src/core/types";

const SKILLS: SkillDef[] = [
  { id: "slash", name: "베기", kind: "attack", cooldownMs: 1000, power: 50 },
  { id: "slow", name: "감속", kind: "interference", cooldownMs: 5000, power: 0.3, interferenceKind: "slow", durationMs: 2000 },
];

test("all skills are ready at start", () => {
  const cd = createCooldownTracker(SKILLS);
  expect(cd.isReady("slash", 0)).toBe(true);
  expect(cd.isReady("slow", 0)).toBe(true);
  expect(cd.readySkills(0).map((s) => s.id)).toEqual(["slash", "slow"]);
});

test("trigger puts a skill on cooldown", () => {
  const cd = createCooldownTracker(SKILLS);
  cd.trigger("slash", 1000);
  expect(cd.isReady("slash", 1000)).toBe(false);
  expect(cd.isReady("slash", 1500)).toBe(false);
});

test("skill becomes ready exactly at cooldown expiry", () => {
  const cd = createCooldownTracker(SKILLS);
  cd.trigger("slash", 1000);
  expect(cd.isReady("slash", 1999)).toBe(false);
  expect(cd.isReady("slash", 2000)).toBe(true);
});

test("triggering one skill does not affect others", () => {
  const cd = createCooldownTracker(SKILLS);
  cd.trigger("slash", 0);
  expect(cd.isReady("slow", 0)).toBe(true);
});

test("remainingMs counts down and floors at 0", () => {
  const cd = createCooldownTracker(SKILLS);
  cd.trigger("slow", 0);
  expect(cd.remainingMs("slow", 0)).toBe(5000);
  expect(cd.remainingMs("slow", 2000)).toBe(3000);
  expect(cd.remainingMs("slow", 9999)).toBe(0);
});

test("readySkills excludes skills on cooldown", () => {
  const cd = createCooldownTracker(SKILLS);
  cd.trigger("slash", 0);
  expect(cd.readySkills(500).map((s) => s.id)).toEqual(["slow"]);
});

test("unknown skill id is never ready and has 0 remaining", () => {
  const cd = createCooldownTracker(SKILLS);
  expect(cd.isReady("nope", 0)).toBe(false);
  expect(cd.remainingMs("nope", 0)).toBe(0);
});

test("triggering an unknown skill is a no-op, not a crash", () => {
  const cd = createCooldownTracker(SKILLS);
  expect(() => cd.trigger("nope", 0)).not.toThrow();
  expect(cd.readySkills(0)).toHaveLength(2);
});
