import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { FX_SHEETS } from "../src/shared/fxManifest";

test("declares every effect sheet", () => {
  expect(Object.keys(FX_SHEETS).sort()).toEqual([
    "aura",
    "dust",
    "impact",
    "missile",
    // 근접 전용 — 캐릭터별로 갈라 쓴다 (`meleeFx`)
    "slash",
    "spark",
  ]);
});

test("every sheet has sane frame metadata", () => {
  for (const [key, s] of Object.entries(FX_SHEETS)) {
    expect(s.key).toBe(key);
    expect(s.frameW).toBeGreaterThan(0);
    expect(s.frameH).toBeGreaterThan(0);
    expect(s.frames).toBeGreaterThan(1);
    expect(s.fps).toBeGreaterThan(0);
    expect(s.url).toMatch(/^assets\/fx\/.+\.png$/);
  }
});

test("TS manifest matches the Python-generated fx.json", () => {
  const gen = JSON.parse(readFileSync("public/assets/fx/fx.json", "utf-8")) as Record<
    string,
    { url: string; frameW: number; frameH: number; frames: number; fps: number }
  >;
  expect(Object.keys(gen).sort()).toEqual(Object.keys(FX_SHEETS).sort());
  for (const [key, g] of Object.entries(gen)) {
    const s = FX_SHEETS[key as keyof typeof FX_SHEETS];
    expect(s).toEqual({ key, ...g });
  }
});
