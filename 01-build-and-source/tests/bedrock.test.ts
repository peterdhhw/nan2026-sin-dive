import { expect, test, vi } from "vitest";
import {
  createStrategyAdapter,
  parseStrategyResponse,
  presetForSituation,
  STRATEGY_TIMEOUT_MS,
} from "../src/ai/bedrock";
import { DEFAULT_STRATEGY } from "../src/ai/strategy";

test("parses bare json", () => {
  expect(
    parseStrategyResponse('{"aggression":0.7,"harass":0.2,"support":0.1}'),
  ).toEqual({
    aggression: 0.7,
    harass: 0.2,
    support: 0.1,
  });
});

test("parses json wrapped in a markdown code fence", () => {
  // 실측: Haiku가 ```json 펜스로 감싸 응답했다
  const text = '```json\n{"aggression":0.5,"harass":0.3,"support":0.2}\n```';
  expect(parseStrategyResponse(text)).toEqual({
    aggression: 0.5,
    harass: 0.3,
    support: 0.2,
  });
});

test("parses json embedded in prose", () => {
  const text =
    'Sure! Here is the strategy: {"aggression":1,"harass":0,"support":0} Hope this helps.';
  expect(parseStrategyResponse(text)?.aggression).toBe(1);
});

test("out-of-range numbers are clamped, not rejected", () => {
  const s = parseStrategyResponse('{"aggression":5,"harass":-2,"support":0.5}')!;
  expect(s.aggression).toBe(1);
  expect(s.harass).toBe(0);
});

test("junk, missing fields and non-numeric values return null", () => {
  expect(parseStrategyResponse("no json here")).toBeNull();
  expect(parseStrategyResponse("")).toBeNull();
  expect(parseStrategyResponse('{"aggression":0.5}')).toBeNull();
  expect(
    parseStrategyResponse('{"aggression":"high","harass":0,"support":0}'),
  ).toBeNull();
});

test("the ai rushes when it is behind and harasses when it is ahead", () => {
  // gaugePos는 사람 팀(team0) 기준이다. +면 사람이 이기는 중 = AI가 뒤처진 상태.
  // 뒤처진 AI가 몰아친다. 앞서는 AI는 방해로 굳힌다 — 이기는 쪽이 더 세게
  // 때리면 스노우볼이 되어 역전이 사라진다.
  const aiBehind = presetForSituation({
    gaugePos: 0.7,
    elapsedMs: 60_000,
    myDps: 300,
    theirDps: 100,
  });
  const aiAhead = presetForSituation({
    gaugePos: -0.7,
    elapsedMs: 60_000,
    myDps: 100,
    theirDps: 300,
  });
  expect(aiBehind.aggression).toBeGreaterThan(aiAhead.aggression);
  expect(aiAhead.harass).toBeGreaterThan(aiBehind.harass);
});

test("local presets always return valid weights", () => {
  for (const gaugePos of [-1, -0.5, 0, 0.5, 1]) {
    const s = presetForSituation({
      gaugePos,
      elapsedMs: 1_000,
      myDps: 1,
      theirDps: 1,
    });
    for (const v of [s.aggression, s.harass, s.support]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
});

test("a successful fetch applies the returned strategy", async () => {
  const applied: unknown[] = [];
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          text: '{"aggression":0.9,"harass":0.05,"support":0.05}',
        }),
      ),
  );
  const a = createStrategyAdapter({
    apply: (s) => applied.push(s),
    enabled: true,
    fetchImpl: fetchImpl as never,
  });
  a.report({ gaugePos: 0, elapsedMs: 0, myDps: 10, theirDps: 10 });
  await a.refreshNow();
  expect(applied).toEqual([{ aggression: 0.9, harass: 0.05, support: 0.05 }]);
});

test("a failing fetch falls back to the local preset and never throws", async () => {
  const applied: unknown[] = [];
  const a = createStrategyAdapter({
    apply: (s) => applied.push(s),
    enabled: true,
    fetchImpl: (async () => {
      throw new Error("network down");
    }) as never,
  });
  a.report({ gaugePos: -0.8, elapsedMs: 0, myDps: 1, theirDps: 9 });
  await expect(a.refreshNow()).resolves.toBeUndefined();
  expect(applied).toHaveLength(1);
});

test("a non-ok response falls back too", async () => {
  const applied: unknown[] = [];
  const a = createStrategyAdapter({
    apply: (s) => applied.push(s),
    enabled: true,
    fetchImpl: (async () => new Response("boom", { status: 500 })) as never,
  });
  a.report({ gaugePos: 0, elapsedMs: 0, myDps: 1, theirDps: 1 });
  await a.refreshNow();
  expect(applied).toHaveLength(1);
});

test("disabled adapters use only local presets and never fetch", async () => {
  const fetchImpl = vi.fn();
  const applied: unknown[] = [];
  const a = createStrategyAdapter({
    apply: (s) => applied.push(s),
    enabled: false,
    fetchImpl: fetchImpl as never,
  });
  a.report({ gaugePos: 0.3, elapsedMs: 0, myDps: 1, theirDps: 1 });
  await a.refreshNow();
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(applied).toHaveLength(1);
});

test("refreshing before any report applies the default strategy", async () => {
  const applied: unknown[] = [];
  const a = createStrategyAdapter({
    apply: (s) => applied.push(s),
    enabled: false,
  });
  await a.refreshNow();
  expect(applied).toEqual([DEFAULT_STRATEGY]);
});

test("the request timeout is short enough not to stall a 2 minute match", () => {
  expect(STRATEGY_TIMEOUT_MS).toBeLessThan(3_000);
});
