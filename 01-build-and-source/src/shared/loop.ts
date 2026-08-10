import { Ticker } from "pixi.js";
import {
  accumulateSteps,
  FIXED_STEP_MS,
  MAX_STEPS_PER_FRAME,
} from "./loopMath";

export { accumulateSteps, FIXED_STEP_MS, MAX_STEPS_PER_FRAME };

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * step = 전투 로직(고정 dt). render = 연출·보간(실제 dt).
 * 둘을 나누는 이유: 게이지 계산은 결정론적이어야 하고, 애니메이션은 매끄러워야 한다.
 */
export function createLoop(opts: {
  step(stepMs: number): void;
  render(dtMs: number): void;
}): Loop {
  let accMs = 0;
  let running = false;

  const onTick = (ticker: Ticker): void => {
    const dtMs = ticker.deltaMS;
    const r = accumulateSteps(accMs, dtMs);
    accMs = r.restMs;
    for (let i = 0; i < r.steps; i++) opts.step(FIXED_STEP_MS);
    opts.render(dtMs);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      accMs = 0;
      Ticker.shared.add(onTick);
    },
    stop(): void {
      if (!running) return;
      running = false;
      Ticker.shared.remove(onTick);
    },
    get running(): boolean {
      return running;
    },
  };
}
