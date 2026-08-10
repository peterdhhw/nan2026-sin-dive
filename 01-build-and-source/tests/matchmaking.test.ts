import { expect, test } from "vitest";
import { LocalMatchmaking, MATCH_WAIT_MS } from "../src/net/matchmaking";

// 첫 진입이 이 씬으로 직행하므로 대기가 곧 첫인상이다 (설계 문서 05-0)
test("human wait window is 5 seconds (spec)", () => {
  expect(MATCH_WAIT_MS).toBe(5_000);
});

test("local matchmaking resolves immediately with no wait", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.waitedMs).toBe(0);
});

test("returns teamSize * 2 slots split evenly across both teams", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.slots).toHaveLength(4);
  expect(r.slots.filter((s) => s.team === 0)).toHaveLength(2);
  expect(r.slots.filter((s) => s.team === 1)).toHaveLength(2);
});

test("generalizes to 3:3", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 3, levelBracket: 0 });
  expect(r.slots).toHaveLength(6);
  expect(r.slots.filter((s) => s.team === 1)).toHaveLength(3);
});

test("exactly one slot is human and it is mine, on team 0", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 2, levelBracket: 0 });
  const humans = r.slots.filter((s) => s.kind === "human");
  expect(humans).toHaveLength(1);
  expect(humans[0]!.slotId).toBe(r.mySlotId);
  expect(humans[0]!.team).toBe(0);
});

test("every other slot is filled by AI (spec: empty slots become AI, start now)", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.slots.filter((s) => s.kind === "ai")).toHaveLength(3);
});

test("slot ids are unique", async () => {
  const r = await new LocalMatchmaking({ seed: 42 }).findMatch({ teamSize: 3, levelBracket: 0 });
  expect(new Set(r.slots.map((s) => s.slotId)).size).toBe(6);
});

test("the seed is passed through so both teams share waves", async () => {
  const r = await new LocalMatchmaking({ seed: 777 }).findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.seed).toBe(777);
});

test("matchId is provided and stable when supplied", async () => {
  const r = await new LocalMatchmaking({ seed: 1, matchId: "local-1" }).findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.matchId).toBe("local-1");
});

test("teamSize below 1 rejects", async () => {
  await expect(
    new LocalMatchmaking({ seed: 1 }).findMatch({ teamSize: 0, levelBracket: 0 }),
  ).rejects.toThrow();
});
