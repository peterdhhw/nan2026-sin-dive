import { expect, test } from "vitest";
import { isInterferenceEvent, INTERFERENCE_KINDS } from "../src/core/types";

test("valid interference event passes guard", () => {
  const e = { eventId: "e1", kind: "slow", fromTeam: 0, atMs: 1200, magnitude: 0.5 };
  expect(isInterferenceEvent(e)).toBe(true);
});

test("unknown kind fails guard", () => {
  expect(isInterferenceEvent({ eventId: "e1", kind: "explode", fromTeam: 0, atMs: 0, magnitude: 1 })).toBe(false);
});

test("missing eventId fails guard", () => {
  expect(isInterferenceEvent({ kind: "slow", fromTeam: 0, atMs: 0, magnitude: 1 })).toBe(false);
});

test("invalid fromTeam fails guard", () => {
  expect(isInterferenceEvent({ eventId: "e1", kind: "slow", fromTeam: 2, atMs: 0, magnitude: 1 })).toBe(false);
});

test("non-object fails guard", () => {
  expect(isInterferenceEvent(null)).toBe(false);
  expect(isInterferenceEvent("slow")).toBe(false);
});

test("all four interference kinds are listed", () => {
  expect([...INTERFERENCE_KINDS]).toEqual(["slow", "spawn_adds", "gauge_drain", "blind"]);
});
