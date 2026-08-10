import type { SkillDef } from "./types";

export interface CooldownTracker {
  isReady(skillId: string, nowMs: number): boolean;
  /** 스킬을 사용 처리해 쿨다운을 시작한다. 알 수 없는 id는 무시. */
  trigger(skillId: string, nowMs: number): void;
  /** 남은 쿨다운(ms). 준비됐거나 알 수 없는 id면 0. */
  remainingMs(skillId: string, nowMs: number): number;
  /** 지금 쓸 수 있는 스킬 목록 (등록 순서 유지). */
  readySkills(nowMs: number): SkillDef[];
}

export function createCooldownTracker(
  skills: readonly SkillDef[],
): CooldownTracker {
  const defs = new Map<string, SkillDef>();
  for (const s of skills) defs.set(s.id, s);
  /** skillId → 쿨다운이 끝나는 시각(ms) */
  const readyAt = new Map<string, number>();
  const remainingMs = (skillId: string, nowMs: number): number => {
    if (!defs.has(skillId)) return 0;
    const at = readyAt.get(skillId) ?? 0;
    return Math.max(0, at - nowMs);
  };

  return {
    isReady(skillId: string, nowMs: number): boolean {
      if (!defs.has(skillId)) return false;
      return nowMs >= (readyAt.get(skillId) ?? 0);
    },
    trigger(skillId: string, nowMs: number): void {
      const def = defs.get(skillId);
      if (!def) return;
      readyAt.set(skillId, nowMs + def.cooldownMs);
    },
    remainingMs,
    readySkills(nowMs: number): SkillDef[] {
      return skills.filter((s) => nowMs >= (readyAt.get(s.id) ?? 0));
    },
  };
}
