export type SkillKind = "attack" | "interference" | "buff";

export interface SkillDef {
  id: string;
  /** UI 표시용 한글 이름 */
  name: string;
  kind: SkillKind;
  cooldownMs: number;
  /** 공격: 딜량 계수 / 방해: 효과 강도 / 버프: 강화 계수 */
  power: number;
  /** kind === "interference"일 때 어떤 방해를 유발하는지 */
  interferenceKind?: InterferenceKind;
  /** 버프·방해 지속시간(ms). 공격 스킬은 없음 */
  durationMs?: number;
}

export interface EnemyDef {
  id: string;
  isBoss: boolean;
  /** 화면·전투가 쓰는 HP. 싱글 1인에서는 `SOLO_HP_SCALE`이 곱해져 있다 */
  hp: number;
  /**
   * **골드 산정용 HP — 배율이 곱해지기 전의 값.**
   *
   * `goldForKill(hp^0.8 × 배율)`이 `hp`를 보면 HP를 깎을 때 수입도 깎이고,
   * 그 상쇄가 페이싱 손잡이를 먹는다 — 실측으로 hp×0.5에서도 100F가 133s에서
   * 안 내려갔다(기준선 2인 106s). 배율 전 HP로 골드를 주면 hp×0.7에서 108s(+2%)다.
   *
   * **옵셔널이 아니다.** `?? hp`로 떨어지게 두면 새 생성부가 조용히 배율 후 HP로
   * 골드를 주고, 그게 정확히 위의 포화다(`only-reachable-cases-count`: 도달
   * 가능한 경우만 세되, 도달 가능하면 반드시 세라). PvP(`core/waves.ts`)는 배율이
   * 없으므로 `goldHp === hp`이고, 그 한 줄이 "PvP에는 배율이 없다"를 코드에 남긴다.
   */
  goldHp: number;
}

export interface WaveDef {
  index: number;
  enemies: EnemyDef[];
}

export const INTERFERENCE_KINDS = [
  "slow",
  "spawn_adds",
  "gauge_drain",
  "blind",
] as const;

export type InterferenceKind = (typeof INTERFERENCE_KINDS)[number];

/**
 * **지속형 방해** — `magnitude`가 지속시간(ms)이다. 그 외는 세기(0~1)다.
 *
 * 이 구분이 함수로 있는 이유: 같은 규칙이 네 곳에 손으로 적혀 있었다
 * (`ai/aiOpponentSource.poll`·`net/publisher.publishInterference`·
 * `appRuntime.onInterferenceCast`·`tests/pacing.test.ts`의 `cast`). `blind`가
 * 연출 전용이던 동안에는 갈라져도 아무 일이 없어서(그 magnitude를 코어가 읽지
 * 않았다) 실제로 갈라져 있었다 — 테스트만 `blind`에 지속시간을 실었다.
 * `blind`가 수치를 갖는 순간 그 불일치는 "AI전에서만 실명이 2.5초, 사람전에서는
 * 0.6ms"가 된다. 한 곳으로 모아 둔다.
 */
export const LASTING_INTERFERENCE_KINDS: readonly InterferenceKind[] = [
  "slow",
  "blind",
];

/** 방해 이벤트에 실을 `magnitude`. 지속형은 ms, 즉발형은 세기. */
export function interferenceMagnitude(skill: SkillDef): number {
  const kind = skill.interferenceKind;
  if (kind !== undefined && LASTING_INTERFERENCE_KINDS.includes(kind)) {
    return skill.durationMs ?? 0;
  }
  return skill.power;
}

export interface InterferenceEvent {
  /** 중복 수신 dedupe용 고유 ID (네트워크 재전송 대비) */
  eventId: string;
  kind: InterferenceKind;
  /** 이벤트를 보낸 팀 (0=우리, 1=상대) */
  fromTeam: 0 | 1;
  /** 전투 시작 기준 발생 시각(ms) */
  atMs: number;
  /** 효과 강도 (0~1 정규화) */
  magnitude: number;
}

export function isInterferenceEvent(v: unknown): v is InterferenceEvent {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.eventId === "string" &&
    typeof o.kind === "string" &&
    (INTERFERENCE_KINDS as readonly string[]).includes(o.kind) &&
    (o.fromTeam === 0 || o.fromTeam === 1) &&
    typeof o.atMs === "number" &&
    typeof o.magnitude === "number"
  );
}
