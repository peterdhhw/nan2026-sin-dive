/**
 * `?scene=` / `?result=` 직행에 필요한 가짜 데이터.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §3 (스크린샷 회귀)
 *
 * 결과 씬 하나를 보려고 매번 2분 대전을 끝까지 돌 수는 없다. `?result=lose`가
 * 즉시 그 화면을 띄우게 하려면 `SessionResult`가 필요한데, 그걸 씬에서 즉석으로
 * 만들면 각 씬이 조금씩 다른 가짜 값을 갖게 된다 — 한곳에 모은다.
 *
 * Pixi를 import하지 않는다. `net/`은 **타입만** 가져온다 (런타임 의존 없음).
 */

import type { DebugResult } from "../shared/debugEntry";
import type { SessionResult } from "./session";
import type { MatchResult } from "../net/matchmaking";

/**
 * 스크린샷이 매번 같은 그림이 되도록 값을 고정한다.
 * 흔들리는 값(경과 시간 등)을 쓰면 diff가 늘 지저분해진다.
 */
export const PREVIEW_KILLS = 37;
export const PREVIEW_ELAPSED_MS = 84_300;
export const PREVIEW_GAUGE = 0.82;

export function debugSessionResult(kind: DebugResult): SessionResult {
  switch (kind) {
    case "win":
      return {
        winner: 0,
        elapsedMs: PREVIEW_ELAPSED_MS,
        myKills: PREVIEW_KILLS,
        gaugePos: PREVIEW_GAUGE,
        reason: "threshold",
      };
    case "lose":
      return {
        winner: 1,
        elapsedMs: PREVIEW_ELAPSED_MS,
        myKills: 21,
        gaugePos: -PREVIEW_GAUGE,
        reason: "threshold",
      };
    case "draw":
      // 무승부는 시간 만료로만 나온다 — 임계선에 닿았으면 승자가 있다
      return {
        winner: null,
        elapsedMs: 120_000,
        myKills: 29,
        gaugePos: 0,
        reason: "timeLimit",
      };
    case "forfeit":
      // 몰수는 **이긴 쪽**으로 띄운다 — 재연결 안내(§08-3)를 확인해야 하는 화면은
      // 패배 쪽이지만, 승리 쪽이 파티클 억제(§08-3)를 검증하는 유일한 경로다
      return {
        winner: 0,
        elapsedMs: 31_500,
        myKills: 12,
        gaugePos: 0.24,
        reason: "forfeit",
      };
  }
}

/**
 * `?scene=vs|battle|result` 직행에서 쓸 매치.
 *
 * 슬롯 라벨·색이 다 걸린 화면을 보려면 사람 슬롯이 하나는 있어야 한다 —
 * 전부 AI면 `matchSlotLabel`의 사람 분기가 스크린샷에 안 잡힌다.
 */
export function debugMatch(seed: number, teamSize: number): MatchResult {
  const slots: MatchResult["slots"] = [];
  for (const team of [0, 1] as const) {
    for (let i = 0; i < teamSize; i += 1) {
      const isMe = team === 0 && i === 0;
      // 상대 0번은 사람으로 둔다 (§06-4 색 구분·§08-4 상대 표기 검증)
      const human = isMe || (team === 1 && i === 0);
      slots.push({
        slotId: `t${team}-s${i}`,
        team,
        kind: human ? "human" : "ai",
        displayName: isMe ? "나" : human ? "플레이어 B" : "AI",
      });
    }
  }
  return {
    matchId: `debug-${seed}`,
    seed,
    mySlotId: "t0-s0",
    slots,
    waitedMs: 0,
  };
}
