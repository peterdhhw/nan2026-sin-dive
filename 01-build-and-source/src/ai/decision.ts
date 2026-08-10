import type { Rng } from "../core/rng";
import type { SkillDef, SkillKind } from "../core/types";
import type { AiStrategy } from "./strategy";

export interface AiView {
  elapsedMs: number;
  /** 게이지 위치. +면 사람 쪽이 이기는 중 = AI가 지는 중 */
  gaugePos: number;
  readySkills: readonly SkillDef[];
}

export type AiAction = { type: "idle" } | { type: "cast"; skill: SkillDef };

/** 지고 있을 때 방해 가중치에 곱하는 최대 배율 */
const DESPERATION_MAX = 2.0;

function weightFor(
  kind: SkillKind,
  strategy: AiStrategy,
  desperation: number,
): number {
  switch (kind) {
    case "attack":
      return strategy.aggression;
    case "interference":
      return strategy.harass * desperation;
    case "buff":
      return strategy.support;
  }
}

/**
 * 순수 함수. 같은 (view, strategy, rng)면 같은 결정이 나온다.
 * 준비된 스킬들에 성향 가중치를 매겨 룰렛 방식으로 하나를 뽑는다.
 */
export function decideNextAction(
  view: AiView,
  strategy: AiStrategy,
  rng: Rng,
): AiAction {
  if (view.readySkills.length === 0) return { type: "idle" };

  // AI가 지고 있을수록(gaugePos가 클수록) 방해 스킬에 매달린다
  const losing = Math.max(0, view.gaugePos);
  const desperation = 1 + losing * (DESPERATION_MAX - 1);

  const weights = view.readySkills.map((s) =>
    Math.max(0, weightFor(s.kind, strategy, desperation)),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return { type: "idle" };

  let roll = rng.next() * total;
  for (let i = 0; i < view.readySkills.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return { type: "cast", skill: view.readySkills[i]! };
  }
  // 부동소수 오차로 루프를 빠져나온 경우 마지막 스킬
  return { type: "cast", skill: view.readySkills[view.readySkills.length - 1]! };
}
