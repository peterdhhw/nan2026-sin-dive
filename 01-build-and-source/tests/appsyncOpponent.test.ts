import { expect, test, vi } from "vitest";
import {
  AppSyncOpponentSource,
  DISCONNECT_MS,
} from "../src/net/appsync/opponentSource";
import { createPublisher, SNAPSHOT_INTERVAL_MS } from "../src/net/publisher";
import type { ChannelMsg } from "../src/net/appsync/protocol";
import type { SkillDef } from "../src/core/types";

const snap = (
  rawDamage: number,
  seq: number,
  clientId = "peer",
): ChannelMsg => ({
  t: "snap",
  clientId,
  rawDamage,
  atMs: seq * 200,
  seq,
});

test("a received snapshot becomes the next poll result", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(500, 1));
  expect(src.poll(200).snapshot?.rawDamage).toBe(500);
});

test("polling twice without a new snapshot returns null the second time", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(500, 1));
  expect(src.poll(200).snapshot).not.toBeNull();
  expect(src.poll(400).snapshot).toBeNull();
});

test("out-of-order snapshots are discarded", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(500, 5));
  src.accept(snap(100, 2)); // 늦게 도착한 옛 스냅샷
  expect(src.poll(200).snapshot?.rawDamage).toBe(500);
});

test("snapshots from unknown clients are ignored", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(999, 1, "stranger"));
  expect(src.poll(200).snapshot).toBeNull();
});

test("multiple opponents on the same team are summed", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["p1", "p2"] });
  src.accept(snap(300, 1, "p1"));
  src.accept(snap(200, 1, "p2"));
  expect(src.poll(200).snapshot?.rawDamage).toBe(500);
});

test("every snapshot carries the publisher's window so the core can convert it to dps", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(500, 1));
  // windowMs를 빼먹으면 코어가 200ms 배치를 초당 값으로 오해해 상대가 5배 강해진다
  expect(src.poll(200).snapshot?.windowMs).toBe(SNAPSHOT_INTERVAL_MS);
});

test("an interference message is surfaced once and deduped by eventId", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  const event = {
    eventId: "e1",
    kind: "slow" as const,
    fromTeam: 1 as const,
    atMs: 10,
    magnitude: 3000,
  };
  src.accept({ t: "intf", clientId: "peer", event });
  src.accept({ t: "intf", clientId: "peer", event }); // 재전송
  expect(src.poll(100).events).toHaveLength(1);
  expect(src.poll(200).events).toHaveLength(0);
});

test("no message for 3 seconds counts as a disconnect", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept(snap(100, 1));
  src.poll(0);
  expect(src.disconnected).toBe(false);
  src.poll(DISCONNECT_MS - 1);
  expect(src.disconnected).toBe(false);
  src.poll(DISCONNECT_MS + 1);
  expect(src.disconnected).toBe(true);
});

test("a bye message marks a disconnect immediately", () => {
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.accept({ t: "bye", clientId: "peer" });
  src.poll(10);
  expect(src.disconnected).toBe(true);
});

test("the disconnect callback fires exactly once", () => {
  const cb = vi.fn();
  const src = new AppSyncOpponentSource({ peerIds: ["peer"] });
  src.onDisconnect(cb);
  src.poll(DISCONNECT_MS + 1);
  src.poll(DISCONNECT_MS + 2);
  expect(cb).toHaveBeenCalledTimes(1);
});

/** 발행부 */
function fakeChannel() {
  const sent: ChannelMsg[] = [];
  return {
    sent,
    handle: {
      publish: async (m: ChannelMsg) => {
        sent.push(m);
      },
      close: () => {},
      connected: true,
    },
  };
}

test("damage is batched into one snapshot per interval", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 0,
  });
  p.recordDamage(100);
  p.tick(50);
  expect(ch.sent).toHaveLength(0); // 200ms 전에는 안 보낸다
  p.recordDamage(150);
  p.tick(SNAPSHOT_INTERVAL_MS);
  expect(ch.sent).toHaveLength(1);
  expect((ch.sent[0] as { rawDamage: number }).rawDamage).toBe(250);
});

test("the accumulator resets after publishing", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 0,
  });
  p.recordDamage(100);
  p.tick(SNAPSHOT_INTERVAL_MS);
  p.tick(SNAPSHOT_INTERVAL_MS * 2);
  expect((ch.sent[1] as { rawDamage: number }).rawDamage).toBe(0);
});

test("snapshot seq increases monotonically", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 0,
  });
  for (let i = 1; i <= 3; i++) p.tick(SNAPSHOT_INTERVAL_MS * i);
  const seqs = ch.sent.map((m) => (m as { seq: number }).seq);
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  expect(new Set(seqs).size).toBe(seqs.length);
});

test("interference publishes immediately, not batched (spec 3-6)", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 0,
  });
  const skill: SkillDef = {
    id: "chains",
    name: "사슬",
    kind: "interference",
    cooldownMs: 8000,
    power: 0.4,
    interferenceKind: "slow",
    durationMs: 3000,
  };
  p.publishInterference(skill, 123);
  expect(ch.sent).toHaveLength(1);
  expect(ch.sent[0]!.t).toBe("intf");
});

test("published interference carries a unique eventId and my team number", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 1,
  });
  const skill: SkillDef = {
    id: "chains",
    name: "사슬",
    kind: "interference",
    cooldownMs: 8000,
    power: 0.4,
    interferenceKind: "slow",
    durationMs: 3000,
  };
  p.publishInterference(skill, 100);
  p.publishInterference(skill, 200);
  const ids = ch.sent.map(
    (m) => (m as { event: { eventId: string } }).event.eventId,
  );
  expect(new Set(ids).size).toBe(2);
  expect((ch.sent[0] as { event: { fromTeam: number } }).event.fromTeam).toBe(1);
});

test("a null channel makes the publisher a no-op (offline AI match)", () => {
  const p = createPublisher({ channel: null, clientId: "me", myTeam: 0 });
  const skill: SkillDef = {
    id: "x",
    name: "x",
    kind: "interference",
    cooldownMs: 1,
    power: 1,
    interferenceKind: "slow",
    durationMs: 1,
  };
  expect(() => {
    p.recordDamage(10);
    p.tick(SNAPSHOT_INTERVAL_MS);
    p.publishInterference(skill, 0);
    p.bye();
  }).not.toThrow();
});

test("a non-interference skill is never published", () => {
  const ch = fakeChannel();
  const p = createPublisher({
    channel: ch.handle as never,
    clientId: "me",
    myTeam: 0,
  });
  p.publishInterference(
    { id: "a", name: "공격", kind: "attack", cooldownMs: 1000, power: 100 },
    0,
  );
  expect(ch.sent).toHaveLength(0);
});
