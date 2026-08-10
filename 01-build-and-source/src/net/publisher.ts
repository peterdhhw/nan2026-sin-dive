import { interferenceMagnitude } from "../core/types";
import type { SkillDef } from "../core/types";
import type { ChannelHandle } from "./appsync/client";

/** 딜 스냅샷 발행 주기 (설계 스펙 §3-6) */
export const SNAPSHOT_INTERVAL_MS = 200;

export interface Publisher {
  /** 매 틱 우리 팀이 낸 딜을 누적한다 */
  recordDamage(rawDamage: number): void;
  /** 방해 스킬은 즉시 발행한다 — 체감 실시간의 핵심 */
  publishInterference(skill: SkillDef, nowMs: number): void;
  /** 매 틱 호출. 주기가 되면 누적 딜을 발행한다 */
  tick(nowMs: number): void;
  /** 정상 종료를 알린다 — 상대가 3초를 기다리지 않아도 된다 */
  bye(): void;
}

/**
 * `channel`이 null이면 전부 no-op이다 (오프라인 AI 대전).
 * 호출부가 온라인/오프라인을 분기하지 않게 하려는 의도적 설계다.
 */
export function createPublisher(opts: {
  channel: ChannelHandle | null;
  clientId: string;
  myTeam: 0 | 1;
}): Publisher {
  const { channel, clientId, myTeam } = opts;
  let accumulated = 0;
  let nextPublishMs = SNAPSHOT_INTERVAL_MS;
  let seq = 0;
  let eventSeq = 0;

  return {
    recordDamage(rawDamage: number): void {
      if (rawDamage > 0) accumulated += rawDamage;
    },
    publishInterference(skill: SkillDef, nowMs: number): void {
      if (channel === null) return;
      if (skill.kind !== "interference" || skill.interferenceKind === undefined) {
        return;
      }
      eventSeq += 1;
      void channel.publish({
        t: "intf",
        clientId,
        event: {
          eventId: `${clientId}-${eventSeq}`,
          kind: skill.interferenceKind,
          fromTeam: myTeam,
          atMs: nowMs,
          // 지속형(slow·blind)은 ms, 즉발형은 세기 — 규칙은 코어가 갖는다
          magnitude: interferenceMagnitude(skill),
        },
      });
    },
    tick(nowMs: number): void {
      if (nowMs < nextPublishMs) return;
      nextPublishMs = nowMs + SNAPSHOT_INTERVAL_MS;
      seq += 1;
      const rawDamage = accumulated;
      accumulated = 0;
      if (channel === null) return;
      void channel.publish({ t: "snap", clientId, rawDamage, atMs: nowMs, seq });
    },
    bye(): void {
      if (channel === null) return;
      void channel.publish({ t: "bye", clientId });
    },
  };
}
