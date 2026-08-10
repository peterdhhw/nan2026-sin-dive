/**
 * 게이지 탈취 연출의 순수 규칙 — **상대가 있어야 성립하는 것만** 남았다.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §9
 *
 * 걸린 상태를 그리는 규칙(감속 모션·채도·사슬·해제 토스트)은
 * `shared/statusFx.ts`로 나갔다 — 공용인 `battleField.ts`가 그걸 쓰는데,
 * 공용 모듈이 `pvp/`를 import하면 싱글이 `pvp/`를 통째로 끌고 오게 된다.
 * 아래로 재export하므로 PvP 코드의 임포트는 그대로 둔다.
 *
 * Pixi를 import하지 않는다 (`gaugeBar.ts`가 재export한다).
 */

export {
  CHAIN_BREAK_WARN_MS,
  CHAIN_WRAP_MS,
  SLOW_MOTION_SCALE,
  SLOW_SATURATE_DROP,
  chainAlpha,
  chainStrain,
  interferenceEndNotice,
  slowSaturate,
} from "../shared/statusFx";

/**
 * 게이지 탈취 입자의 개수·수명 (§9: 마커에서 상대 쪽으로 흐른다).
 *
 * 게이지가 줄어드는 것은 숫자로도 보이지만(§C6의 붉은 숫자), **어디로 갔는지**는
 * 방향이 있는 움직임만 말할 수 있다.
 */
export const DRAIN_PARTICLES = 10;
export const DRAIN_PARTICLE_MS = 520;
/** 입자별 출발 간격 — 한꺼번에 나가면 흐름이 아니라 한 덩어리로 보인다 */
export const DRAIN_STAGGER_MS = 26;

/**
 * 연출 전체 길이. 마지막 입자가 도착할 때까지다 — 스태거 때문에 입자
 * 수명보다 길다. 호출부가 이 계산을 다시 하면 한쪽만 고쳐서 마지막 입자가
 * 화면 중간에서 사라진다.
 */
export const DRAIN_TOTAL_MS =
  DRAIN_PARTICLE_MS + (DRAIN_PARTICLES - 1) * DRAIN_STAGGER_MS;

/** i번째 입자의 진행률 0..1. 시작 시각을 인덱스로 흩는다 (결정론) */
export function drainParticleT(elapsedMs: number, index: number): number {
  const stagger = (index % DRAIN_PARTICLES) * DRAIN_STAGGER_MS;
  const t = (elapsedMs - stagger) / DRAIN_PARTICLE_MS;
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(1, t);
}

/** 입자가 궤도에서 벗어나는 정도 (px). 일직선이면 하나의 굵은 선으로 보인다 */
export function drainParticleSpread(index: number): number {
  // −1, +1을 번갈아 곱해 위아래로 갈라 놓는다
  const side = index % 2 === 0 ? 1 : -1;
  return side * (4 + (index % 3) * 5);
}
