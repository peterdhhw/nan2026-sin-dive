import { expect, test } from "vitest";
import { createRng } from "../src/core/rng";
import { decideNextAction } from "../src/ai/decision";
import { DEFAULT_STRATEGY, STRATEGY_PRESETS } from "../src/ai/strategy";
import type { SkillDef } from "../src/core/types";
import type { AiView } from "../src/ai/decision";

const ATTACK: SkillDef = { id: "atk", name: "공격", kind: "attack", cooldownMs: 2000, power: 200 };
const HARASS: SkillDef = { id: "har", name: "방해", kind: "interference", cooldownMs: 8000, power: 0.4, interferenceKind: "slow", durationMs: 3000 };
const BUFF: SkillDef = { id: "buf", name: "버프", kind: "buff", cooldownMs: 10000, power: 1.4, durationMs: 4000 };

const view = (over: Partial<AiView> = {}): AiView => ({
  elapsedMs: 5000,
  gaugePos: 0,
  readySkills: [ATTACK, HARASS, BUFF],
  ...over,
});

test("no ready skills means idle", () => {
  expect(decideNextAction(view({ readySkills: [] }), DEFAULT_STRATEGY, createRng(1)))
    .toEqual({ type: "idle" });
});

test("decisions are deterministic for the same view and seed", () => {
  const a = decideNextAction(view(), DEFAULT_STRATEGY, createRng(9));
  const b = decideNextAction(view(), DEFAULT_STRATEGY, createRng(9));
  expect(a).toEqual(b);
});

test("only ever returns a skill that was in readySkills", () => {
  for (let seed = 0; seed < 100; seed++) {
    const a = decideNextAction(view(), DEFAULT_STRATEGY, createRng(seed));
    if (a.type === "cast") expect([ATTACK, HARASS, BUFF]).toContain(a.skill);
  }
});

test("rush preset casts attack more often than harasser does", () => {
  const count = (strategy: typeof DEFAULT_STRATEGY): number => {
    let n = 0;
    for (let seed = 0; seed < 300; seed++) {
      const a = decideNextAction(view(), strategy, createRng(seed));
      if (a.type === "cast" && a.skill.kind === "attack") n++;
    }
    return n;
  };
  expect(count(STRATEGY_PRESETS.rush)).toBeGreaterThan(count(STRATEGY_PRESETS.harasser));
});

test("harasser preset casts interference more often than rush does", () => {
  const count = (strategy: typeof DEFAULT_STRATEGY): number => {
    let n = 0;
    for (let seed = 0; seed < 300; seed++) {
      const a = decideNextAction(view(), strategy, createRng(seed));
      if (a.type === "cast" && a.skill.kind === "interference") n++;
    }
    return n;
  };
  expect(count(STRATEGY_PRESETS.harasser)).toBeGreaterThan(count(STRATEGY_PRESETS.rush));
});

test("losing badly makes the AI reach for interference more", () => {
  const harassRate = (gaugePos: number): number => {
    let n = 0;
    for (let seed = 0; seed < 300; seed++) {
      const a = decideNextAction(view({ gaugePos }), DEFAULT_STRATEGY, createRng(seed));
      if (a.type === "cast" && a.skill.kind === "interference") n++;
    }
    return n;
  };
  // gaugePos > 0 = 상대(사람)가 이기는 중 = AI가 지는 중
  expect(harassRate(0.7)).toBeGreaterThan(harassRate(-0.7));
});

test("all zero weights means idle, never a crash", () => {
  const flat = { aggression: 0, harass: 0, support: 0 };
  for (let seed = 0; seed < 20; seed++) {
    expect(decideNextAction(view(), flat, createRng(seed))).toEqual({ type: "idle" });
  }
});

test("only a buff available and support weight positive still casts it", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 60; seed++) {
    const a = decideNextAction(
      view({ readySkills: [BUFF] }),
      { aggression: 0, harass: 0, support: 1 },
      createRng(seed),
    );
    seen.add(a.type === "cast" ? a.skill.id : "idle");
  }
  expect(seen.has("buf")).toBe(true);
});

test("default strategy weights are all within 0..1", () => {
  for (const v of Object.values(DEFAULT_STRATEGY)) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
});
