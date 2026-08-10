import { dpsToPush } from "./gauge";

export interface MemberDamage {
  memberId: string;
  /** 이번 틱에 이 멤버가 낸 원시 딜 */
  rawDamage: number;
}

/** 음수 딜은 0으로 취급한다 (버그·부정 입력 방어). */
export function sumTeamRawDamage(members: readonly MemberDamage[]): number {
  let total = 0;
  for (const m of members) total += Math.max(0, m.rawDamage);
  return total;
}

/**
 * 팀 합산 push. 합산 후 한 번만 환산한다 —
 * 멤버별로 환산해 더하면 인원수가 sqrt 체감을 우회해 3:3에서 밸런스가 깨진다.
 */
export function teamPush(members: readonly MemberDamage[]): number {
  return dpsToPush(sumTeamRawDamage(members));
}

/**
 * 자동 공격 딜 산출에 필요한 최소 형태.
 * `CharacterLoadout`이 구조적으로 이걸 만족하므로 코어가 로드아웃을 import하지 않는다
 * (L1 의존성 0 불변식 유지).
 */
export interface AutoAttacker {
  memberId: string;
  stats: { attack: number; attackIntervalMs: number };
}

/**
 * dt에 비례해 자동 공격 딜을 적립한다. 초당 attack/attackIntervalMs 회 공격하는 셈.
 * 우리 팀(세션)과 AI 상대가 같은 수식을 써야 밸런스가 대칭이 된다.
 */
export function autoAttackDamage(
  chars: readonly AutoAttacker[],
  dtMs: number,
): MemberDamage[] {
  const dt = Math.max(0, dtMs);
  return chars.map((c) => {
    const interval = c.stats.attackIntervalMs;
    const dps = interval > 0 ? c.stats.attack / interval : 0;
    return { memberId: c.memberId, rawDamage: Math.max(0, dps * dt) };
  });
}
