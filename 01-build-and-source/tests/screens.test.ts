import { expect, test } from "vitest";
// screens.ts는 pixi.js를 import하므로 순수 문구 함수만 분리한 screenText를 테스트한다.
import { matchStatusText, resultHeadline } from "../src/pvp/matchText";
import { MATCH_WAIT_MS } from "../src/net/matchmaking";
import type { SessionResult } from "../src/pvp/session";

const res = (over: Partial<SessionResult> = {}): SessionResult => ({
  winner: 0,
  elapsedMs: 45_000,
  myKills: 12,
  gaugePos: 0.8,
  reason: "threshold",
  ...over,
});

test("winning, losing and drawing produce different headlines", () => {
  const win = resultHeadline(res({ winner: 0 }));
  const lose = resultHeadline(res({ winner: 1 }));
  const draw = resultHeadline(res({ winner: null }));
  expect(new Set([win, lose, draw]).size).toBe(3);
});

test("a forfeit win says the opponent disconnected (spec 7-1)", () => {
  expect(resultHeadline(res({ winner: 0, reason: "forfeit" }))).toContain("연결");
});

test("headlines are never empty for any reason and winner combination", () => {
  for (const winner of [0, 1, null] as const) {
    for (const reason of ["threshold", "timeLimit", "forfeit"] as const) {
      expect(resultHeadline(res({ winner, reason })).length).toBeGreaterThan(0);
    }
  }
});

test("match status counts down the remaining wait", () => {
  // 리터럴 대신 MATCH_WAIT_MS에서 파생한다 — 대기 시간 튜닝에 테스트가 깨지지 않게
  expect(matchStatusText(0, 1)).toContain(String(MATCH_WAIT_MS / 1000));
  expect(matchStatusText(MATCH_WAIT_MS - 1_000, 1)).toContain("1");
});

test("match status never shows a negative countdown", () => {
  const t = matchStatusText(MATCH_WAIT_MS + 5_000, 1);
  expect(t).not.toContain("-");
});

test("match status reports how many humans joined", () => {
  expect(matchStatusText(3_000, 2)).toContain("2");
});
