import { expect, test } from "vitest";
// skillBar.ts가 아니라 skillRules.ts에서 가져온다 — Pixi import는 node 환경에서
// navigator를 요구하므로 순수 규칙만 분리해 테스트한다 (effects/fxMapping과 동일).
import { cooldownSweep, pickAutoSkill } from "../src/shared/skillRules";
import { PRESET_SKILLS } from "../src/loadout/preset";
import type { SkillDef } from "../src/core/types";

test("sweep is 0 when ready and 1 right after casting", () => {
  expect(cooldownSweep(0, 2000)).toBe(0);
  expect(cooldownSweep(2000, 2000)).toBe(1);
  expect(cooldownSweep(1000, 2000)).toBeCloseTo(0.5, 10);
});

test("sweep never leaves 0..1 even with junk input", () => {
  expect(cooldownSweep(-50, 2000)).toBe(0);
  expect(cooldownSweep(9999, 2000)).toBe(1);
  expect(cooldownSweep(500, 0)).toBe(0); // 0 나눗셈 방어
});

test("auto picks nothing when no skill is ready", () => {
  expect(pickAutoSkill([])).toBeNull();
});

test("auto prefers the strongest attack skill", () => {
  const weak: SkillDef = { id: "a", name: "약", kind: "attack", cooldownMs: 1000, power: 100 };
  const strong: SkillDef = { id: "b", name: "강", kind: "attack", cooldownMs: 1000, power: 500 };
  expect(pickAutoSkill([weak, strong])).toBe(strong);
  expect(pickAutoSkill([strong, weak])).toBe(strong);
});

test("auto falls back to a non-attack skill when no attack is ready", () => {
  const buff: SkillDef = { id: "c", name: "버프", kind: "buff", cooldownMs: 1000, power: 1.5, durationMs: 3000 };
  expect(pickAutoSkill([buff])).toBe(buff);
});

test("auto never picks an interference skill while an attack is available", () => {
  const harass = PRESET_SKILLS.find((s) => s.kind === "interference")!;
  const atk = PRESET_SKILLS.find((s) => s.kind === "attack")!;
  expect(pickAutoSkill([harass, atk])?.kind).toBe("attack");
});
