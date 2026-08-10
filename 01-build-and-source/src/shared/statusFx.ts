/**
 * "나는 지금 걸려 있다"를 화면으로 말하는 순수 규칙 — 감속 모션·채도·사슬.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §9
 *
 * `pvp/interferenceRules.ts`에서 갈라져 나왔다. **누가 걸었는지는 PvP 개념이지만,
 * 걸린 상태를 그리는 것은 아니다.** 싱글에서 함정·몬스터가 감속을 걸어도
 * 필요한 건 똑같이 이 값들이다 — `battleField.ts`(공용)가 쓰는 게 이쪽뿐이라
 * 나눴다. 게이지를 빼앗기는 연출(`DRAIN_*`)은 상대가 있어야 성립하므로
 * `pvp/`에 남았다.
 *
 * Pixi를 import하지 않는다 (`battleField.ts`가 재export한다).
 */

/** 감속 중 아군 모션 재생속도 (§9). 딜 배율(`SLOW_DAMAGE_MULT` 0.6)과 같은 값 */
export const SLOW_MOTION_SCALE = 0.6;

/** 감속 중 우리 필드 채도 감소분 (§9: −20%) */
export const SLOW_SATURATE_DROP = 0.2;

export function slowSaturate(slowed: boolean): number {
  return slowed ? 1 - SLOW_SATURATE_DROP : 1;
}

/** 사슬이 감기는 시간 — 도착 즉시 꽉 감기면 무엇이 나타났는지 못 본다 */
export const CHAIN_WRAP_MS = 220;

export function chainAlpha(elapsedMs: number, slowed: boolean): number {
  if (!slowed) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= CHAIN_WRAP_MS) return 1;
  return elapsedMs / CHAIN_WRAP_MS;
}

/**
 * 사슬이 남은 지속시간에 맞춰 떨리는 강도 0..1.
 *
 * 끝나기 직전에 떨림이 커지면 "곧 풀린다"가 보인다 — 타이머 숫자를 필드에
 * 띄우는 것보다 조용하고, 정보량은 같다.
 */
export const CHAIN_BREAK_WARN_MS = 600;

export function chainStrain(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  if (remainingMs >= CHAIN_BREAK_WARN_MS) return 0;
  return 1 - remainingMs / CHAIN_BREAK_WARN_MS;
}

/** 지속 방해가 풀렸을 때 띄우는 토스트 문구 (§9) */
export function interferenceEndNotice(kind: string): string {
  switch (kind) {
    case "slow":
      return "감속 해제";
    case "blind":
      return "시야 회복";
    default:
      return "방해 해제";
  }
}
