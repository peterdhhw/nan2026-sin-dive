import { expect, test } from "vitest";
import { AppSyncMatchmaking } from "../src/net/appsync/matchmaking";
import { AppSyncOpponentSource } from "../src/net/appsync/opponentSource";
import { opponentClientIds } from "../src/net/appsync/protocol";
import { createPublisher, SNAPSHOT_INTERVAL_MS } from "../src/net/publisher";
import type { ChannelHandle } from "../src/net/appsync/client";
import type { ChannelMsg } from "../src/net/appsync/protocol";
import type { AppSyncEnv } from "../src/net/appsync/config";
import type { MatchResult } from "../src/net/matchmaking";
import type { SkillDef } from "../src/core/types";

/**
 * 서버 없는 매칭 합의와 양방향 프로토콜을 AWS 없이 끝까지 돌린다.
 * 두 클라이언트가 같은 채널 버스를 공유하며, 서로를 상대로 인식하고
 * 딜 스냅샷·방해를 주고받는 전 경로를 한 테스트에서 검증한다.
 */

const ENV: AppSyncEnv = {
  endpoint: "https://x/event",
  region: "ap-northeast-2",
  apiKey: "k",
};

/** 메시지를 발신자 외 전원에게 배달하는 인메모리 채널 버스 */
function createBus() {
  const subscribers: { clientId: string; onMessage(m: ChannelMsg): void }[] = [];
  const log: ChannelMsg[] = [];
  return {
    log,
    open(clientId: string, onMessage: (m: ChannelMsg) => void): ChannelHandle {
      subscribers.push({ clientId, onMessage });
      return {
        async publish(msg: ChannelMsg): Promise<void> {
          log.push(msg);
          // 자기 자신에게는 되돌려주지 않는다 — 자기 딜을 상대 딜로 세면 안 된다
          for (const s of subscribers) {
            if (s.clientId !== msg.clientId) s.onMessage(msg);
          }
        },
        close(): void {},
        connected: true,
      };
    },
  };
}

/** 가상 타이머. 두 findMatch를 결정론적으로 교대 실행한다 (실제 10초를 기다리지 않는다). */
function createClock() {
  let now = 0;
  const queue: { at: number; resolve: () => void }[] = [];
  return {
    now: () => now,
    sleep: (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        queue.push({ at: now + ms, resolve });
      }),
    /** 대기 중인 타이머를 시간순으로 소진한다 */
    async pump(maxSteps = 200): Promise<void> {
      for (let i = 0; i < maxSteps && queue.length > 0; i++) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue.shift()!;
        now = Math.max(now, next.at);
        next.resolve();
        // 깨어난 쪽이 다음 sleep까지 진행할 틈을 준다
        for (let j = 0; j < 4; j++) await Promise.resolve();
      }
    },
  };
}

async function matchTwoClients(): Promise<{
  bus: ReturnType<typeof createBus>;
  a: { mm: AppSyncMatchmaking; result: MatchResult };
  b: { mm: AppSyncMatchmaking; result: MatchResult };
}> {
  const bus = createBus();
  const clock = createClock();

  const make = (clientId: string): AppSyncMatchmaking =>
    new AppSyncMatchmaking({
      env: ENV,
      fallbackSeed: 999,
      deps: {
        openChannel: (async (o: {
          onMessage(m: ChannelMsg): void;
        }): Promise<ChannelHandle> => bus.open(clientId, o.onMessage)) as never,
        now: clock.now,
        sleep: clock.sleep,
        clientId,
      },
    });

  const mmA = make("alpha");
  const mmB = make("bravo");
  const pA = mmA.findMatch({ teamSize: 2, levelBracket: 0 });
  const pB = mmB.findMatch({ teamSize: 2, levelBracket: 0 });
  await clock.pump();
  const [ra, rb] = await Promise.all([pA, pB]);
  return { bus, a: { mm: mmA, result: ra }, b: { mm: mmB, result: rb } };
}

test("two clients agree on one match without any server", async () => {
  const { a, b } = await matchTwoClients();
  expect(a.result.matchId).toBe(b.result.matchId);
  expect(a.result.seed).toBe(b.result.seed);
  // 각자 자기를 상단(team 0)으로 본다 — 미러링이 성립해야 화면이 맞는다
  expect(a.result.mySlotId).toBe("t0-s0");
  expect(b.result.mySlotId).toBe("t0-s0");
  expect(a.result.slots.filter((s) => s.kind === "human")).toHaveLength(2);
  expect(b.result.slots.filter((s) => s.kind === "human")).toHaveLength(2);
});

test("both clients keep the lobby channel and see each other as the opponent", async () => {
  const { a, b } = await matchTwoClients();
  expect(a.mm.lobby).not.toBeNull();
  expect(b.mm.lobby).not.toBeNull();
  expect(opponentClientIds(a.mm.globalMatch!, "alpha")).toEqual(["bravo"]);
  expect(opponentClientIds(b.mm.globalMatch!, "bravo")).toEqual(["alpha"]);
});

test("damage snapshots and interference cross between the two clients", async () => {
  const { a, b } = await matchTwoClients();

  const srcA = new AppSyncOpponentSource({
    peerIds: opponentClientIds(a.mm.globalMatch!, "alpha"),
  });
  const srcB = new AppSyncOpponentSource({
    peerIds: opponentClientIds(b.mm.globalMatch!, "bravo"),
  });
  a.mm.route((m) => srcA.accept(m));
  b.mm.route((m) => srcB.accept(m));

  const pubA = createPublisher({
    channel: a.mm.lobby,
    clientId: "alpha",
    myTeam: 0,
  });
  const pubB = createPublisher({
    channel: b.mm.lobby,
    clientId: "bravo",
    myTeam: 0,
  });

  pubA.recordDamage(400);
  pubB.recordDamage(150);
  pubA.tick(SNAPSHOT_INTERVAL_MS);
  pubB.tick(SNAPSHOT_INTERVAL_MS);

  // 각자 상대 딜만 본다 — 자기 딜이 섞이면 게이지가 영원히 균형이 된다
  expect(srcB.poll(SNAPSHOT_INTERVAL_MS).snapshot?.rawDamage).toBe(400);
  expect(srcA.poll(SNAPSHOT_INTERVAL_MS).snapshot?.rawDamage).toBe(150);

  const chains: SkillDef = {
    id: "chains",
    name: "타락의 사슬",
    kind: "interference",
    cooldownMs: 8_000,
    power: 0.4,
    interferenceKind: "slow",
    durationMs: 3_000,
  };
  pubA.publishInterference(chains, 500);
  const arrived = srcB.poll(500).events;
  expect(arrived).toHaveLength(1);
  expect(arrived[0]!.kind).toBe("slow");
  // 발신자 관점의 team 0이 수신자에게도 그대로 온다. 코어는 도착한 방해를
  // 무조건 "상대가 나에게 건 것"으로 다루므로 fromTeam은 연출 태그일 뿐이다.
  expect(srcA.poll(500).events).toHaveLength(0);
});

test("a bye ends the opponent's match immediately", async () => {
  const { a, b } = await matchTwoClients();
  const srcB = new AppSyncOpponentSource({
    peerIds: opponentClientIds(b.mm.globalMatch!, "bravo"),
  });
  b.mm.route((m) => srcB.accept(m));

  const pubA = createPublisher({
    channel: a.mm.lobby,
    clientId: "alpha",
    myTeam: 0,
  });
  pubA.bye();
  srcB.poll(10);
  expect(srcB.disconnected).toBe(true);
});
