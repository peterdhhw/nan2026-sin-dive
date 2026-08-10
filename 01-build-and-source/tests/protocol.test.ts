import { expect, test } from "vitest";
import {
  hashSeed,
  localizeMatch,
  matchChannel,
  opponentClientIds,
  parseChannelMsg,
  pruneRoster,
  resolveMatch,
  ROSTER_STALE_MS,
  type RosterEntry,
} from "../src/net/appsync/protocol";

const entry = (clientId: string, lastSeenMs = 0, teamSize = 2): RosterEntry => ({
  clientId,
  teamSize,
  lastSeenMs,
});

test("parses a hello message", () => {
  const m = parseChannelMsg({ t: "hello", clientId: "a", teamSize: 2, atMs: 5 });
  expect(m).toEqual({ t: "hello", clientId: "a", teamSize: 2, atMs: 5 });
});

test("rejects junk, wrong types and unknown kinds", () => {
  expect(parseChannelMsg(null)).toBeNull();
  expect(parseChannelMsg("hello")).toBeNull();
  expect(parseChannelMsg({ t: "nope", clientId: "a" })).toBeNull();
  expect(parseChannelMsg({ t: "hello", clientId: 5, teamSize: 2, atMs: 0 })).toBeNull();
  expect(
    parseChannelMsg({ t: "snap", clientId: "a", rawDamage: "x", atMs: 0, seq: 1 }),
  ).toBeNull();
});

test("rejects an intf message whose event fails the core guard", () => {
  expect(parseChannelMsg({ t: "intf", clientId: "a", event: { kind: "slow" } })).toBeNull();
});

test("accepts a well-formed intf message", () => {
  const event = {
    eventId: "e1",
    kind: "slow" as const,
    fromTeam: 1 as const,
    atMs: 100,
    magnitude: 3000,
  };
  expect(parseChannelMsg({ t: "intf", clientId: "a", event })).toEqual({
    t: "intf",
    clientId: "a",
    event,
  });
});

test("stale roster entries are dropped", () => {
  const r = [entry("a", 10_000), entry("b", 1_000)];
  expect(pruneRoster(r, 11_000).map((e) => e.clientId)).toEqual(["a"]);
  expect(pruneRoster(r, 11_000, 20_000)).toHaveLength(2);
  expect(ROSTER_STALE_MS).toBeGreaterThan(0);
});

test("seed hashing is deterministic and stays a positive 32-bit int", () => {
  expect(hashSeed("abc")).toBe(hashSeed("abc"));
  expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  for (const s of ["", "a", "zzzzzzzzzzzzzzzzzzzz", "t0-s0|t1-s0"]) {
    const h = hashSeed(s);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  }
});

test("a match needs at least one human per team", () => {
  expect(resolveMatch([entry("a")], 2)).toBeNull();
  expect(resolveMatch([entry("a"), entry("b")], 2)).not.toBeNull();
});

test("both clients compute the identical match from the same roster", () => {
  // 명단 순서가 달라도 같은 결과가 나와야 한다 — 도착 순서는 클라이언트마다 다르다
  const forward = resolveMatch([entry("a"), entry("b"), entry("c")], 2)!;
  const reverse = resolveMatch([entry("c"), entry("b"), entry("a")], 2)!;
  expect(forward).toEqual(reverse);
});

test("humans are split across the two teams, not stacked on one", () => {
  const m = resolveMatch([entry("a"), entry("b"), entry("c"), entry("d")], 2)!;
  expect(m.humanIds).toHaveLength(4);
  // 전역 인덱스 0,2 → team0 / 1,3 → team1 (교대 배치)
  const local = localizeMatch(m, "a");
  const teams = local.slots.filter((s) => s.kind === "human").map((s) => s.team);
  expect(teams.filter((t) => t === 0)).toHaveLength(2);
  expect(teams.filter((t) => t === 1)).toHaveLength(2);
});

test("extra humans beyond the match size are ignored", () => {
  const m = resolveMatch(
    [entry("a"), entry("b"), entry("c"), entry("d"), entry("e")],
    2,
  )!;
  expect(m.humanIds).toHaveLength(4);
  expect(m.humanIds).not.toContain("e");
});

test("teamSize comes from the roster majority, ignoring outliers", () => {
  const m = resolveMatch([entry("a", 0, 3), entry("b", 0, 3), entry("c", 0, 2)], 3)!;
  expect(m.teamSize).toBe(3);
});

test("each client sees itself on team 0 (the game always renders us on top)", () => {
  const m = resolveMatch([entry("a"), entry("b")], 2)!;
  const asA = localizeMatch(m, "a");
  const asB = localizeMatch(m, "b");
  expect(asA.slots.find((s) => s.slotId === asA.mySlotId)!.team).toBe(0);
  expect(asB.slots.find((s) => s.slotId === asB.mySlotId)!.team).toBe(0);
});

test("both clients share matchId and seed but see mirrored teams", () => {
  const m = resolveMatch([entry("a"), entry("b")], 2)!;
  const asA = localizeMatch(m, "a");
  const asB = localizeMatch(m, "b");
  expect(asA.matchId).toBe(asB.matchId);
  expect(asA.seed).toBe(asB.seed);
  expect(asA.mySlotId).toBe(asB.mySlotId); // 둘 다 "t0-s0"
  expect(asA.slots).toHaveLength(4);
  expect(asB.slots).toHaveLength(4);
});

test("empty slots are filled with ai (spec 2-1 partial matching)", () => {
  // 명단이 3v3를 요청했는데 사람은 2명뿐인 상황. teamSize는 명단 다수결에서 온다
  // (아래 "teamSize comes from the roster majority" 테스트가 그 규칙을 못박는다).
  const m = resolveMatch([entry("a", 0, 3), entry("b", 0, 3)], 3)!;
  const local = localizeMatch(m, "a");
  expect(local.slots).toHaveLength(6);
  expect(local.slots.filter((s) => s.kind === "ai")).toHaveLength(4);
});

test("each client's opponents are exactly the other team's humans", () => {
  const m = resolveMatch(
    [entry("a", 0, 2), entry("b", 0, 2), entry("c", 0, 2), entry("d", 0, 2)],
    2,
  )!;
  // 전역 인덱스 0,2 = 한 팀 / 1,3 = 다른 팀
  const [i0, i1, i2, i3] = m.humanIds as [string, string, string, string];
  expect(opponentClientIds(m, i0)).toEqual([i1, i3]);
  expect(opponentClientIds(m, i1)).toEqual([i0, i2]);
  // 상대 목록에 자신이나 같은 팀원이 섞이면 자기 딜을 상대 딜로 세게 된다
  for (const id of m.humanIds) {
    expect(opponentClientIds(m, id)).not.toContain(id);
  }
});

test("deriving opponents for a stranger throws", () => {
  const m = resolveMatch([entry("a"), entry("b")], 2)!;
  expect(() => opponentClientIds(m, "zzz")).toThrow();
});

test("localizing with an unknown client id throws", () => {
  const m = resolveMatch([entry("a"), entry("b")], 2)!;
  expect(() => localizeMatch(m, "zzz")).toThrow();
});

test("match channel name is derived from the match id", () => {
  const m = resolveMatch([entry("a"), entry("b")], 2)!;
  expect(matchChannel(m.matchId)).toBe(`pvp/m-${m.matchId}`);
});

test("slot ids are unique for every client's view", () => {
  const m = resolveMatch(
    [entry("a", 0, 3), entry("b", 0, 3), entry("c", 0, 3), entry("d", 0, 3)],
    3,
  )!;
  for (const id of m.humanIds) {
    const slots = localizeMatch(m, id).slots;
    expect(new Set(slots.map((s) => s.slotId)).size).toBe(slots.length);
    expect(slots.filter((s) => s.displayName === "나")).toHaveLength(1);
  }
});
