export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [0, maxExclusive) */
  int(maxExclusive: number): number;
  /** pick a random element */
  pick<T>(arr: readonly T[]): T;
}

/** Mulberry32 — 작고 빠른 결정론 PRNG. 외부 의존성 없음. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(arr: readonly T[]): T {
      const el = arr[Math.floor(next() * arr.length)];
      if (el === undefined) throw new Error("pick() on empty array");
      return el;
    },
  };
}
