import type { SkillDef } from "../core/types";

/**
 * 스킬 바가 따르는 순수 규칙. skillBar.ts와 분리한 이유는 fxMapping.ts와 같다 —
 * Pixi를 import하는 모듈은 node 테스트 환경에서 불러올 수 없다.
 */

/** 0 = 준비완료, 1 = 방금 사용. 쿨다운 링이 덮는 비율. */
export function cooldownSweep(remainingMs: number, cooldownMs: number): number {
  if (cooldownMs <= 0) return 0;
  return Math.max(0, Math.min(1, remainingMs / cooldownMs));
}

/**
 * AUTO가 고를 스킬. 공격 우선(강한 것부터), 없으면 아무거나.
 * 방해 스킬은 유저 수동 조작의 재미 지점이라 AUTO가 선점하지 않는다.
 */
export function pickAutoSkill(ready: readonly SkillDef[]): SkillDef | null {
  if (ready.length === 0) return null;
  let best: SkillDef | null = null;
  for (const s of ready) {
    if (s.kind !== "attack") continue;
    if (best === null || s.power > best.power) best = s;
  }
  if (best !== null) return best;
  for (const s of ready) {
    if (s.kind !== "interference") return s;
  }
  return ready[0]!;
}
