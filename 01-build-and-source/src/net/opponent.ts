import type {
  OpponentSource,
  OpponentUpdate,
  OpponentSnapshot,
} from "../core/battle";
import type { InterferenceEvent } from "../core/types";

/** 스크립트 1스텝. `fromTeam`은 소스가 채운다. */
export interface ScriptedStep {
  atMs: number;
  rawDamage?: number;
  event?: Omit<InterferenceEvent, "fromTeam">;
}

/**
 * 로컬 개발·테스트용 상대. 정해진 스크립트를 시간에 맞춰 재생한다.
 * AppSync 없이 전투 전체를 검증할 수 있게 하는 것이 목적이다.
 */
export class FakeOpponentSource implements OpponentSource {
  private readonly steps: ScriptedStep[];
  private cursor = 0;

  constructor(script: readonly ScriptedStep[]) {
    this.steps = [...script].sort((a, b) => a.atMs - b.atMs);
  }

  poll(nowMs: number): OpponentUpdate {
    let snapshot: OpponentSnapshot | null = null;
    const events: InterferenceEvent[] = [];

    while (this.cursor < this.steps.length) {
      const step = this.steps[this.cursor]!;
      if (step.atMs > nowMs) break;
      this.cursor++;
      if (step.rawDamage !== undefined) {
        snapshot = { rawDamage: step.rawDamage, atMs: nowMs };
      }
      if (step.event) {
        events.push({ ...step.event, fromTeam: 1 });
      }
    }

    return { snapshot, events };
  }
}
