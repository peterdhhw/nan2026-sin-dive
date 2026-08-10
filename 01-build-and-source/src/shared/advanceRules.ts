/**
 * 웨이브 클리어 → 전진 연출의 순수 규칙.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §8
 *
 * Pixi를 import하지 않는다 (`waveAdvance.ts`가 재export한다).
 *
 * **왜 순수 모듈인가**: 이 연출의 전부가 시각(ms) → 값의 매핑이다. 스크롤이
 * 240px/s로 올라갔다가 12로 못 돌아오면 배경이 영구히 흐르는데, 스크린샷
 * 한 장으로는 "배경이 좀 흐르네"로만 보인다 — 시간축 버그는 테스트로 잡는다.
 */

import { SCROLL_ADVANCE_PX_S, SCROLL_IDLE_PX_S } from "./backgroundRules";
import { THEME_FADE_MS } from "./theme";

/**
 * §8 타임라인 (0ms = 마지막 적 사망).
 *
 * | 0ms | `WAVE n 클리어` 배너 |
 * | 200ms | 스크롤 12 → 240px/s, 아군 `run` |
 * | 200~1000ms | 배경이 흐른다. 테마가 바뀌면 여기서 크로스페이드 |
 * | 1000ms | 감속 240 → 12 (400ms), 아군 `idle` |
 * | 1200ms | 다음 웨이브 스폰 + `WAVE n+1` 배너 |
 */
export const ADV_ACCEL_AT_MS = 200;
export const ADV_ACCEL_MS = 200;
export const ADV_CRUISE_UNTIL_MS = 1_000;
export const ADV_DECEL_MS = 400;
export const ADV_SPAWN_AT_MS = 1_200;
/** 연출 전체 길이. 감속이 스폰보다 늦게 끝나므로 둘 중 큰 값이다 */
export const ADV_TOTAL_MS = Math.max(
  ADV_SPAWN_AT_MS,
  ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS,
);

/**
 * 크로스페이드를 시작하는 시각.
 *
 * 배경이 **빠르게 흐르는 동안** 테마가 바뀌어야 "다른 곳에 도착했다"가 된다.
 * 정지 중에 바뀌면 색이 그냥 변하는 것으로 보인다 (§8: 200~1000ms 구간).
 * 600ms 페이드가 순항 구간(200~1000ms) 안에서 끝나도록 시작점을 잡는다.
 */
export const ADV_THEME_AT_MS = Math.max(
  ADV_ACCEL_AT_MS,
  ADV_CRUISE_UNTIL_MS - THEME_FADE_MS,
);

export type AdvancePhase = "banner" | "accel" | "cruise" | "decel" | "done";

export function advancePhase(elapsedMs: number): AdvancePhase {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "done";
  if (elapsedMs < ADV_ACCEL_AT_MS) return "banner";
  if (elapsedMs < ADV_ACCEL_AT_MS + ADV_ACCEL_MS) return "accel";
  if (elapsedMs < ADV_CRUISE_UNTIL_MS) return "cruise";
  if (elapsedMs < ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS) return "decel";
  return "done";
}

/**
 * 그 시각의 배경 스크롤 속도(px/s).
 *
 * 가감속을 선형으로 둔다 — ease를 걸면 "출발했다"는 순간이 뭉개진다.
 * 끝값은 **반드시** `SCROLL_IDLE_PX_S`로 돌아온다.
 */
export function advanceScrollSpeed(elapsedMs: number): number {
  switch (advancePhase(elapsedMs)) {
    case "banner":
      return SCROLL_IDLE_PX_S;
    case "accel": {
      const t = (elapsedMs - ADV_ACCEL_AT_MS) / ADV_ACCEL_MS;
      return SCROLL_IDLE_PX_S + (SCROLL_ADVANCE_PX_S - SCROLL_IDLE_PX_S) * t;
    }
    case "cruise":
      return SCROLL_ADVANCE_PX_S;
    case "decel": {
      const t = (elapsedMs - ADV_CRUISE_UNTIL_MS) / ADV_DECEL_MS;
      return SCROLL_ADVANCE_PX_S + (SCROLL_IDLE_PX_S - SCROLL_ADVANCE_PX_S) * t;
    }
    default:
      return SCROLL_IDLE_PX_S;
  }
}

/**
 * 아군이 달리는 구간인가 (제자리 `run` 모션).
 *
 * 스크롤이 빠른 동안만 달린다. 배경이 멈춘 채로 달리면 러닝머신이 된다.
 */
export function advanceRunning(elapsedMs: number): boolean {
  const p = advancePhase(elapsedMs);
  return p === "accel" || p === "cruise" || p === "decel";
}

/**
 * 다음 웨이브를 스폰할 시각을 지났는가.
 *
 * 호출부가 "한 번만" 실행하도록 직전 시각과 비교한다 — `elapsed >= 1200`만
 * 보면 매 프레임 스폰된다.
 */
export function advanceCrossed(
  prevMs: number,
  nextMs: number,
  atMs: number,
): boolean {
  return prevMs < atMs && nextMs >= atMs;
}

/**
 * 클리어한 웨이브 번호를 담은 배너 문구.
 *
 * `waveLabel`(`WAVE 3`)과 따로 두는 이유: 클리어 배너는 **끝난 웨이브**를,
 * 진입 배너는 **시작하는 웨이브**를 말한다. 한 함수로 만들면 호출부가 ±1을
 * 계산하게 되고 그건 한쪽만 틀리는 종류의 실수다.
 */
/**
 * 화면에 배치된 웨이브의 신분.
 *
 * `waveIndex`만으로는 부족하다: 마지막 웨이브를 반복할 때는(`loops`가 오르고
 * 인덱스는 그대로) 코어의 적 HP가 꽉 찬 새 무리인데 인덱스가 같아서 화면은
 * 시체만 남은 필드를 계속 보여준다.
 */
export interface WaveStamp {
  waveIndex: number;
  loops: number;
}

export function sameWave(a: WaveStamp, b: WaveStamp): boolean {
  return a.waveIndex === b.waveIndex && a.loops === b.loops;
}

export function waveClearLabel(clearedWaveIndex: number): string {
  const n = Number.isFinite(clearedWaveIndex)
    ? Math.max(0, Math.floor(clearedWaveIndex))
    : 0;
  return `WAVE ${n + 1} 클리어`;
}
