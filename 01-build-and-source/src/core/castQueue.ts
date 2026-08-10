import type { MemberDamage } from "./team";

/**
 * 스킬 딜을 이 시간에 걸쳐 분산시킨다.
 * 한 틱에 전부 몰아넣으면 게이지가 초당 값으로 환산할 때 스파이크가
 * 1/60초 × 60 = 60배로 부풀어(650딜 → 39,000dps) 스킬 한 번이 승패를 결정해버린다.
 */
export const SKILL_SPREAD_MS = 400;

interface CastEntry {
  memberId: string;
  remaining: number;
  leftMs: number;
}

/**
 * 시전 큐. 우리 팀(세션)과 AI 상대가 **같은 인스턴스 구현**을 써야
 * 스킬 딜 곡선이 대칭이 된다 — 한쪽만 몰아치면 그쪽이 일방적으로 이긴다.
 */
export interface CastQueue {
  /** 스킬 딜 `power`를 spreadMs 동안 분산 적립하도록 등록한다. */
  push(memberId: string, power: number, spreadMs?: number): void;
  /** 이번 틱에 방출할 몫. 다 쓴 항목은 큐에서 사라진다. */
  drain(dtMs: number): MemberDamage[];
  /** 아직 방출되지 않은 딜 총합 (디버그·테스트용). */
  readonly pendingDamage: number;
}

export function createCastQueue(): CastQueue {
  const entries: CastEntry[] = [];

  return {
    push(memberId, power, spreadMs = SKILL_SPREAD_MS): void {
      if (!(power > 0)) return;
      const leftMs = spreadMs > 0 ? spreadMs : SKILL_SPREAD_MS;
      entries.push({ memberId, remaining: power, leftMs });
    },

    drain(dtMs): MemberDamage[] {
      const dt = Math.max(0, dtMs);
      const out: MemberDamage[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        // 남은 시간보다 dt가 크면 잔량을 전부 방출한다 (딜이 유실되면 안 된다)
        const portion =
          e.leftMs <= dt ? e.remaining : (e.remaining / e.leftMs) * dt;
        e.remaining -= portion;
        e.leftMs -= dt;
        out.push({ memberId: e.memberId, rawDamage: portion });
        if (e.leftMs <= 0 || e.remaining <= 0) entries.splice(i, 1);
      }
      return out;
    },

    get pendingDamage(): number {
      let total = 0;
      for (const e of entries) total += e.remaining;
      return total;
    },
  };
}
