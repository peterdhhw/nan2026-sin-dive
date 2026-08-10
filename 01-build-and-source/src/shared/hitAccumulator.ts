/**
 * 틱 단위 딜을 읽을 수 있는 데미지 숫자로 묶는다.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §4-4 (숫자 폭포 방지)
 *
 * 왜 필요한가: 딜은 **초당 계약**이라 60fps에서 틱당 값이 소수점이 된다
 * (dps 50 → 틱당 0.83). 그대로 띄우면 초당 60개의 "1"이 쏟아지고,
 * `damageText`의 프레임 내 합산은 프레임을 넘어가는 이 경우를 못 잡는다.
 * 그래서 여기서 **시간축으로** 모아 한 덩어리로 만든다.
 *
 * 피격 반응(플래시·넉백·HP바)은 매 틱 그대로 전달한다 — 그건 연속적일수록 좋다.
 * 숫자만 묶는다.
 */

/** 이 주기마다 모아둔 딜을 하나의 숫자로 띄운다. 초당 4개 = 읽을 수 있는 상한 */
export const FLUSH_MS = 250;

export interface HitAccumulator {
  /**
   * 적별 누적 딜. 아직 안 띄운 양이다.
   * 인덱스 → { amount, lastFlushMs }
   */
  readonly pending: Map<number, { amount: number; lastFlushMs: number }>;
}

export function createHitAccumulator(): HitAccumulator {
  return { pending: new Map() };
}

/**
 * 한 틱의 피격을 넣고, 이번에 숫자로 띄울 양을 돌려준다.
 *
 * @returns 띄울 딜. 0이면 아직 모으는 중이다.
 *
 * 처치는 **즉시 플러시**한다 — 결정타 숫자가 250ms 뒤에 뜨면 인과가 끊긴다.
 */
export function accumulateHit(
  acc: HitAccumulator,
  enemyIndex: number,
  dealt: number,
  killed: boolean,
  nowMs: number,
): number {
  const amount = Number.isFinite(dealt) && dealt > 0 ? dealt : 0;
  const slot = acc.pending.get(enemyIndex) ?? { amount: 0, lastFlushMs: nowMs };
  slot.amount += amount;

  const due = killed || nowMs - slot.lastFlushMs >= FLUSH_MS;
  if (!due) {
    acc.pending.set(enemyIndex, slot);
    return 0;
  }

  const out = slot.amount;
  slot.amount = 0;
  slot.lastFlushMs = nowMs;
  acc.pending.set(enemyIndex, slot);
  // 반올림은 여기서 하지 않는다 — formatInt가 표시 시점에 한다
  return out;
}

/** 웨이브가 넘어가면 슬롯의 주인이 바뀐다. 남은 누적은 버린다 */
export function resetHitAccumulator(acc: HitAccumulator): void {
  acc.pending.clear();
}
