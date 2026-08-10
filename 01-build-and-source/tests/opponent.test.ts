import { expect, test } from "vitest";
import { FakeOpponentSource } from "../src/net/opponent";
import { Battle } from "../src/core/battle";
import type { MemberDamage } from "../src/core/team";

const me = (rawDamage: number): MemberDamage[] => [{ memberId: "me", rawDamage }];

test("replays scripted damage at the scheduled time", () => {
  const src = new FakeOpponentSource([
    { atMs: 0, rawDamage: 100 },
    { atMs: 1000, rawDamage: 300 },
  ]);
  expect(src.poll(0).snapshot?.rawDamage).toBe(100);
  expect(src.poll(500).snapshot).toBeNull();       // 새 스텝 없음
  expect(src.poll(1000).snapshot?.rawDamage).toBe(300);
});

test("a step fires only once", () => {
  const src = new FakeOpponentSource([{ atMs: 0, rawDamage: 100 }]);
  expect(src.poll(0).snapshot?.rawDamage).toBe(100);
  expect(src.poll(10).snapshot).toBeNull();
});

test("late polling fires all due steps and reports the latest damage", () => {
  const src = new FakeOpponentSource([
    { atMs: 0, rawDamage: 100 },
    { atMs: 100, rawDamage: 200 },
    { atMs: 200, rawDamage: 500 },
  ]);
  expect(src.poll(999).snapshot?.rawDamage).toBe(500);
});

test("scripted events are stamped with fromTeam 1", () => {
  const src = new FakeOpponentSource([
    { atMs: 0, event: { eventId: "e1", kind: "slow", atMs: 0, magnitude: 500 } },
  ]);
  const evs = src.poll(0).events;
  expect(evs).toHaveLength(1);
  expect(evs[0]!.fromTeam).toBe(1);
  expect(evs[0]!.kind).toBe("slow");
});

test("an empty script yields nothing forever", () => {
  const src = new FakeOpponentSource([]);
  expect(src.poll(0)).toEqual({ snapshot: null, events: [] });
  expect(src.poll(100_000)).toEqual({ snapshot: null, events: [] });
});

test("unsorted script steps still fire in time order", () => {
  const src = new FakeOpponentSource([
    { atMs: 500, rawDamage: 300 },
    { atMs: 0, rawDamage: 100 },
  ]);
  expect(src.poll(0).snapshot?.rawDamage).toBe(100);
  expect(src.poll(500).snapshot?.rawDamage).toBe(300);
});

test("Battle works unchanged with FakeOpponentSource (AC-5)", () => {
  const b = new Battle({
    seed: 1,
    teamSize: 2,
    opponent: new FakeOpponentSource([{ atMs: 0, rawDamage: 100 }]),
  });
  b.tick(me(400), 100);
  expect(b.state.theirTeamRawDamage).toBe(100);
  expect(b.state.gauge.pos).toBeGreaterThan(0);
});
