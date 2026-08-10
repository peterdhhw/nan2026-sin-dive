/**
 * 고정 타임스텝 누적 계산. loop.ts와 분리한 이유는 fxMapping·skillRules와 같다 —
 * Pixi Ticker를 import하는 모듈은 node 테스트 환경에서 불러올 수 없다.
 */

/** 60fps 고정 스텝. 프레임레이트와 무관하게 전투가 같은 속도로 흐른다. */
export const FIXED_STEP_MS = 1000 / 60;

/** 한 프레임에 몰아 처리할 최대 스텝 수 (탭 백그라운드 복귀 시 폭주 방지) */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * 누적 시간에서 실행할 스텝 수와 남길 잔여를 계산한다.
 * 클램프에 걸리면 잔여를 **버린다** — 남기면 다음 프레임도 계속 클램프에 걸려
 * 게임이 영구히 슬로모션이 된다.
 */
export function accumulateSteps(
  accMs: number,
  dtMs: number,
): { steps: number; restMs: number } {
  if (dtMs <= 0) return { steps: 0, restMs: accMs };
  let acc = accMs + dtMs;
  const steps = Math.floor(acc / FIXED_STEP_MS);
  if (steps > MAX_STEPS_PER_FRAME)
    return { steps: MAX_STEPS_PER_FRAME, restMs: 0 };
  acc -= steps * FIXED_STEP_MS;
  return { steps, restMs: acc };
}
