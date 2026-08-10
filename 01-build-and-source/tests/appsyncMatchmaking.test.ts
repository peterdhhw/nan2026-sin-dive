import { expect, test, vi } from "vitest";
import { AppSyncMatchmaking } from "../src/net/appsync/matchmaking";
import { MATCH_WAIT_MS } from "../src/net/matchmaking";
import type { ChannelMsg } from "../src/net/appsync/protocol";
import type { AppSyncEnv } from "../src/net/appsync/config";

const ENV: AppSyncEnv = {
  endpoint: "https://x/event",
  region: "ap-northeast-2",
  apiKey: "k",
};

/** 가짜 시계 + 가짜 채널. sleep이 시간을 앞으로 밀고, 그때 상대 hello를 주입한다. */
function harness(opts: { peerJoinsAtMs: number | null }) {
  let nowMs = 0;
  const published: ChannelMsg[] = [];
  let deliver: ((m: ChannelMsg) => void) | null = null;
  let closed = false;

  const openChannel = vi.fn(async (o: { onMessage(m: ChannelMsg): void }) => {
    deliver = o.onMessage;
    return {
      async publish(msg: ChannelMsg) {
        published.push(msg);
      },
      close() {
        closed = true;
      },
      get connected() {
        return !closed;
      },
    };
  });

  const sleep = async (ms: number): Promise<void> => {
    const before = nowMs;
    nowMs += ms;
    if (
      opts.peerJoinsAtMs !== null &&
      before <= opts.peerJoinsAtMs &&
      nowMs > opts.peerJoinsAtMs
    ) {
      deliver?.({
        t: "hello",
        clientId: "peer",
        teamSize: 2,
        atMs: opts.peerJoinsAtMs,
      });
    }
  };

  return {
    published,
    isClosed: () => closed,
    openChannelCalls: openChannel,
    make: () =>
      new AppSyncMatchmaking({
        env: ENV,
        fallbackSeed: 42,
        deps: {
          openChannel: openChannel as never,
          now: () => nowMs,
          sleep,
          clientId: "me",
        },
      }),
  };
}

test("a peer joining early yields a human match without waiting the full 10s", async () => {
  const h = harness({ peerJoinsAtMs: 1_200 });
  const r = await h.make().findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.slots.filter((s) => s.kind === "human")).toHaveLength(2);
  expect(r.waitedMs).toBeLessThan(MATCH_WAIT_MS);
});

test("nobody joining falls back to an all-ai match after the full wait", async () => {
  const h = harness({ peerJoinsAtMs: null });
  const r = await h.make().findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.slots.filter((s) => s.kind === "human")).toHaveLength(1); // 나만
  expect(r.waitedMs).toBeGreaterThanOrEqual(MATCH_WAIT_MS);
});

test("hello is broadcast repeatedly while waiting", async () => {
  const h = harness({ peerJoinsAtMs: null });
  await h.make().findMatch({ teamSize: 2, levelBracket: 0 });
  const hellos = h.published.filter((m) => m.t === "hello");
  expect(hellos.length).toBeGreaterThan(1);
});

test("the lobby channel is closed when we fall back to ai", async () => {
  const h = harness({ peerJoinsAtMs: null });
  const mm = h.make();
  await mm.findMatch({ teamSize: 2, levelBracket: 0 });
  expect(h.isClosed()).toBe(true);
  expect(mm.lobby).toBeNull();
});

test("the lobby channel is kept open for a human match", async () => {
  const h = harness({ peerJoinsAtMs: 500 });
  const mm = h.make();
  await mm.findMatch({ teamSize: 2, levelBracket: 0 });
  expect(h.isClosed()).toBe(false);
  expect(mm.lobby).not.toBeNull();
});

test("a connect failure falls back to a local ai match instead of throwing", async () => {
  const mm = new AppSyncMatchmaking({
    env: ENV,
    fallbackSeed: 7,
    deps: {
      openChannel: (async () => {
        throw new Error("connect refused");
      }) as never,
      now: () => 0,
      sleep: async () => {},
      clientId: "me",
    },
  });
  const r = await mm.findMatch({ teamSize: 2, levelBracket: 0 });
  expect(r.seed).toBe(7);
  expect(r.slots.filter((s) => s.kind === "human")).toHaveLength(1);
});

test("status callback reports elapsed wait and human count", async () => {
  const seen: [number, number][] = [];
  const h = harness({ peerJoinsAtMs: null });
  const mm = new AppSyncMatchmaking({
    env: ENV,
    fallbackSeed: 1,
    onStatus: (w, c) => seen.push([w, c]),
    deps: {
      openChannel: h.openChannelCalls as never,
      now: () => 0,
      sleep: async () => {},
      clientId: "me",
    },
  });
  await mm.findMatch({ teamSize: 2, levelBracket: 0 });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(([, count]) => count >= 1)).toBe(true);
});
