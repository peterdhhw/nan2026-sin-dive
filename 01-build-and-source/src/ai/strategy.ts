/** AI 성향 가중치. Bedrock(Plan 2)이 이 값만 갈아끼운다. 각 0~1. */
export interface AiStrategy {
  /** 공격 스킬 선호도 */
  aggression: number;
  /** 방해 스킬 선호도 */
  harass: number;
  /** 버프 스킬 선호도 */
  support: number;
}

export const DEFAULT_STRATEGY: AiStrategy = {
  aggression: 0.6,
  harass: 0.25,
  support: 0.15,
};

export const STRATEGY_PRESETS: Record<
  "balanced" | "rush" | "harasser",
  AiStrategy
> = {
  balanced: DEFAULT_STRATEGY,
  rush: { aggression: 0.85, harass: 0.1, support: 0.05 },
  harasser: { aggression: 0.3, harass: 0.6, support: 0.1 },
};

/** 값이 0~1을 벗어나면 잘라낸다. Bedrock 응답 검증용. */
export function sanitizeStrategy(s: AiStrategy): AiStrategy {
  const c = (v: number): number =>
    Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  return { aggression: c(s.aggression), harass: c(s.harass), support: c(s.support) };
}
