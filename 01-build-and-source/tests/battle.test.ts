import { expect, test } from "vitest";
import { Battle, DEFAULT_TIME_LIMIT_MS, SLOW_DAMAGE_MULT } from "../src/core/battle";
import type { OpponentSource, OpponentUpdate } from "../src/core/battle";
import type { MemberDamage } from "../src/core/team";
import type { InterferenceEvent } from "../src/core/types";

/** 고정 딜만 내는 상대. 테스트 전용. */
function constantOpponent(rawDamage: number, events: InterferenceEvent[] = []): OpponentSource {
  let sent = false;
  return {
    poll(nowMs: number): OpponentUpdate {
      const out: OpponentUpdate = {
        snapshot: { rawDamage, atMs: nowMs },
        events: sent ? [] : events,
      };
      sent = true;
      return out;
    },
  };
}

const me = (rawDamage: number): MemberDamage[] => [{ memberId: "me", rawDamage }];

test("battle starts running, centered, no winner", () => {
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  expect(b.state.phase).toBe("running");
  expect(b.state.gauge.pos).toBe(0);
  expect(b.state.winner).toBeNull();
  expect(b.state.elapsedMs).toBe(0);
});

test("waves are generated from the seed and shared by both teams (AC-4)", () => {
  const a = new Battle({ seed: 77, teamSize: 2, waveCount: 8, opponent: constantOpponent(0) });
  const c = new Battle({ seed: 77, teamSize: 2, waveCount: 8, opponent: constantOpponent(0) });
  expect(a.waves).toEqual(c.waves);
  expect(a.waves).toHaveLength(8);
});

test("elapsedMs accumulates dtMs", () => {
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  b.tick(me(0), 100);
  b.tick(me(0), 150);
  expect(b.state.elapsedMs).toBe(250);
});

test("out-dealing the opponent pushes the gauge positive (AC-1)", () => {
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(10) });
  b.tick(me(1000), 1000);
  expect(b.state.gauge.pos).toBeGreaterThan(0);
});

test("being out-dealt pushes the gauge negative", () => {
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(1000) });
  b.tick(me(10), 1000);
  expect(b.state.gauge.pos).toBeLessThan(0);
});

test("reaching the threshold finishes the battle with a winner (AC-2)", () => {
  const b = new Battle({ seed: 1, teamSize: 2, winThreshold: 0.1, opponent: constantOpponent(0) });
  for (let i = 0; i < 200 && b.state.phase === "running"; i++) b.tick(me(10_000), 100);
  expect(b.state.phase).toBe("finished");
  expect(b.state.winner).toBe(0);
});

test("ticks after finish do not change the state", () => {
  const b = new Battle({ seed: 1, teamSize: 2, winThreshold: 0.05, opponent: constantOpponent(0) });
  while (b.state.phase === "running") b.tick(me(10_000), 100);
  const snap = { ...b.state, gauge: { ...b.state.gauge } };
  b.tick(me(10_000), 1000);
  expect(b.state.elapsedMs).toBe(snap.elapsedMs);
  expect(b.state.gauge.pos).toBe(snap.gauge.pos);
});

test("time limit finishes the battle and the leading team wins (AC-3)", () => {
  const b = new Battle({ seed: 1, teamSize: 2, timeLimitMs: 3000, winThreshold: 0.99, opponent: constantOpponent(1) });
  // 딜 격차를 작게 둔다 — 3초 안에 임계치에 닿아버리면 시간 백스톱을 못 본다.
  // (스냅샷에 windowMs가 없으면 상대 딜은 "이미 초당 값" = 1dps로 본다)
  for (let i = 0; i < 40 && b.state.phase === "running"; i++) b.tick(me(40), 100);
  expect(b.state.phase).toBe("finished");
  expect(b.state.elapsedMs).toBeGreaterThanOrEqual(3000);
  expect(b.state.winner).toBe(0);
});

test("exact tie at the time limit is a draw (winner null)", () => {
  const b = new Battle({ seed: 1, teamSize: 2, timeLimitMs: 1000, winThreshold: 0.99, opponent: constantOpponent(100) });
  b.tick(me(100), 1000);
  expect(b.state.phase).toBe("finished");
  expect(b.state.winner).toBeNull();
});

test("default time limit is 120s", () => {
  expect(DEFAULT_TIME_LIMIT_MS).toBe(120_000);
});

test("opponent interference events surface in pendingEvents", () => {
  const ev: InterferenceEvent = { eventId: "x1", kind: "slow", fromTeam: 1, atMs: 0, magnitude: 0.5 };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, [ev]) });
  const s = b.tick(me(0), 100);
  expect(s.pendingEvents).toEqual([ev]);
});

test("pendingEvents are drained each tick, not accumulated", () => {
  const ev: InterferenceEvent = { eventId: "x1", kind: "slow", fromTeam: 1, atMs: 0, magnitude: 0.5 };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, [ev]) });
  b.tick(me(0), 100);
  expect(b.tick(me(0), 100).pendingEvents).toEqual([]);
});

test("duplicate eventIds are deduped (spec section 7)", () => {
  const ev: InterferenceEvent = { eventId: "dup", kind: "slow", fromTeam: 1, atMs: 0, magnitude: 0.5 };
  const src: OpponentSource = { poll: () => ({ snapshot: null, events: [ev, ev] }) };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: src });
  expect(b.tick(me(0), 100).pendingEvents).toHaveLength(1);
  expect(b.tick(me(0), 100).pendingEvents).toHaveLength(0);
});

test("incoming slow reduces my effective damage for its duration", () => {
  const slowEv: InterferenceEvent = { eventId: "s1", kind: "slow", fromTeam: 1, atMs: 0, magnitude: 1000 };
  const slowed = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, [slowEv]) });
  const clean = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  slowed.tick(me(400), 1000);
  clean.tick(me(400), 1000);
  expect(slowed.state.gauge.pos).toBeLessThan(clean.state.gauge.pos);
  expect(slowed.state.myTeamRawDamage).toBeCloseTo(400 * SLOW_DAMAGE_MULT, 6);
});

test("slow expires after its magnitude window", () => {
  const slowEv: InterferenceEvent = { eventId: "s1", kind: "slow", fromTeam: 1, atMs: 0, magnitude: 500 };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, [slowEv]) });
  // 감속은 "도착 시점 + magnitude"까지 지속된다 (발신자 시계를 믿지 않는다)
  b.tick(me(400), 100); // elapsed 100, slowUntilMs 600 → 감속 중
  expect(b.state.myTeamRawDamage).toBeCloseTo(400 * SLOW_DAMAGE_MULT, 6);
  b.tick(me(400), 600); // elapsed 700 > 600 → 해제
  expect(b.state.myTeamRawDamage).toBe(400);
});

test("incoming gauge_drain pushes the gauge toward the opponent", () => {
  const drain: InterferenceEvent = { eventId: "d1", kind: "gauge_drain", fromTeam: 1, atMs: 0, magnitude: 0.2 };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, [drain]) });
  b.tick(me(0), 16);
  expect(b.state.gauge.pos).toBeCloseTo(-0.2, 6);
});

test("spawn_adds passes through as an event without touching the gauge (연출 전용)", () => {
  const evs: InterferenceEvent[] = [
    { eventId: "a1", kind: "spawn_adds", fromTeam: 1, atMs: 0, magnitude: 3 },
  ];
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, evs) });
  const s = b.tick(me(0), 100);
  expect(s.pendingEvents).toHaveLength(1);
  expect(s.gauge.pos).toBe(0);
});

/**
 * ── `blind`는 **시전 창**을 닫는다 (2026-08-06)
 *
 * 예전 이 파일은 `blind`를 `spawn_adds`와 같은 칸에 넣고 "게이지를 건드리지
 * 않는다"만 확인했다. 그게 맞는 확인이었지만 **그것만** 확인했기 때문에,
 * blind가 어떤 수치도 바꾸지 않는다는 사실이 검사 통과와 구별되지 않았다.
 *
 * 지금은 `blindUntilMs`가 코어 상태다. 게이지를 직접 밀지 않는 것은 여전히
 * 맞으므로(딜을 깎는 `slow`와 다른 축) 두 가지를 **따로** 묻는다:
 * 창이 열렸는가, 그리고 게이지는 그대로인가.
 */
test("blind opens a cast-denial window in core state, without pushing the gauge", () => {
  const evs: InterferenceEvent[] = [
    { eventId: "b1", kind: "blind", fromTeam: 1, atMs: 0, magnitude: 2500 },
  ];
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0, evs) });
  const s = b.tick(me(0), 100);
  expect(s.pendingEvents).toHaveLength(1);
  // magnitude(ms)만큼 앞으로 — 이 창을 세션·AI가 시전 차단으로 읽는다
  expect(s.blindUntilMs).toBeCloseTo(s.elapsedMs + 2500, 6);
  expect(s.blindUntilMs).toBeGreaterThan(s.elapsedMs);
  // 게이지는 그대로다 — `slow`(딜)와 다른 축이라는 것이 칸이 둘인 이유다
  expect(s.gauge.pos).toBe(0);
});

/** 창은 **연장만** 된다 — 짧은 실명이 이미 걸린 긴 실명을 잘라내면 안 된다 */
test("a shorter blind never shortens an active one", () => {
  let batch = 0;
  const opponent: OpponentSource = {
    poll(nowMs: number): OpponentUpdate {
      batch += 1;
      const events: InterferenceEvent[] =
        batch === 1
          ? [{ eventId: "long", kind: "blind", fromTeam: 1, atMs: nowMs, magnitude: 5000 }]
          : batch === 2
            ? [{ eventId: "short", kind: "blind", fromTeam: 1, atMs: nowMs, magnitude: 100 }]
            : [];
      return { snapshot: { rawDamage: 0, atMs: nowMs }, events };
    },
  };
  const b = new Battle({ seed: 1, teamSize: 2, opponent });
  const first = b.tick(me(0), 16).blindUntilMs;
  const second = b.tick(me(0), 16).blindUntilMs;
  expect(second).toBe(first);
});

test("forfeit ends the battle with the other team as winner (spec section 7-1)", () => {
  const b = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  const s = b.forfeit(1);
  expect(s.phase).toBe("finished");
  expect(s.winner).toBe(0);
});

test("forfeit after finish is ignored", () => {
  const b = new Battle({ seed: 1, teamSize: 2, winThreshold: 0.05, opponent: constantOpponent(0) });
  while (b.state.phase === "running") b.tick(me(10_000), 100);
  expect(b.forfeit(0).winner).toBe(0);
});

test("windowMs normalizes the opponent snapshot to a per-second rate", () => {
  // 같은 초당 딜(1000dps)을 서로 다른 배치 크기로 보고한다.
  // 200ms에 200딜을 모아 보내는 사람 상대와 16ms에 16딜을 보내는 AI는
  // 게이지에 똑같이 작용해야 한다 — 그러지 않으면 배치가 큰 쪽이 강해 보인다.
  const batched: OpponentSource = {
    poll: (nowMs) => ({ snapshot: { rawDamage: 200, atMs: nowMs, windowMs: 200 }, events: [] }),
  };
  const perTick: OpponentSource = {
    poll: (nowMs) => ({ snapshot: { rawDamage: 16, atMs: nowMs, windowMs: 16 }, events: [] }),
  };
  const a = new Battle({ seed: 1, teamSize: 2, opponent: batched });
  const c = new Battle({ seed: 1, teamSize: 2, opponent: perTick });
  a.tick(me(16), 16);
  c.tick(me(16), 16);
  expect(a.state.theirDps).toBeCloseTo(1000, 6);
  expect(c.state.theirDps).toBeCloseTo(1000, 6);
  expect(a.state.gauge.pos).toBeCloseTo(c.state.gauge.pos, 10);
});

test("my own damage is converted to dps so the gauge is dt-independent", () => {
  // 같은 1000dps를 다른 타임스텝으로 넣으면 게이지 이동량은 dt에 비례해야 한다
  // (dt^1.5가 아니다 — 그러면 60fps에서 게이지가 거의 안 움직인다)
  const a = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  const c = new Battle({ seed: 1, teamSize: 2, opponent: constantOpponent(0) });
  a.tick(me(100), 100);
  c.tick(me(200), 200);
  expect(a.state.myDps).toBeCloseTo(1000, 6);
  expect(c.state.myDps).toBeCloseTo(1000, 6);
  expect(c.state.gauge.pos).toBeCloseTo(a.state.gauge.pos * 2, 10);
});

test("a null snapshot keeps the last known opponent damage", () => {
  let n = 0;
  const src: OpponentSource = {
    poll: (nowMs) => (n++ === 0
      ? { snapshot: { rawDamage: 900, atMs: nowMs }, events: [] }
      : { snapshot: null, events: [] }),
  };
  const b = new Battle({ seed: 1, teamSize: 2, opponent: src });
  b.tick(me(0), 100);
  b.tick(me(0), 100);
  expect(b.state.theirTeamRawDamage).toBe(900);
});
