import type { AttackClip } from "./meleeRules";

/**
 * **시전 사이의 최소 간격** — 방금 지른 모션의 임팩트를 다음 입력이 잡아먹지
 * 않게 막는 공용 게이트.
 *
 * ## 왜 쿨다운으로는 못 막는가
 *
 * 쿨다운은 **칸마다 따로** 돈다(`core/cooldown`의 `readyAt` 맵). 그래서 1번을
 * 누른 다음 프레임에 2번을 누르면 2번은 자기 쿨이 다 돌아 있으므로 통과하고,
 * `battleField.onAllyAttack`은 **진행 중인 사이클을 끊고 갈아탄다** — 1번의
 * 임팩트 프레임이 오기 전에 그 클립이 사라진다. 즉 쿨다운 값을 아무리 길게
 * 잡아도 "칸 사이의 연타"는 통과한다: 쿨은 **한 칸의 연타**만 막는다.
 *
 * 유저 지시가 "모션 안 끊기면서 제일 짧은 수치"였으므로 두 가지가 다 필요하다.
 * 쿨다운은 `ROLE_NUMBERS`가 자기 역할의 최악 임팩트 위에 놓이게 잡았고
 * (`loadout/preset.ts`), 칸 사이는 이 게이트가 잡는다.
 *
 * ## 왜 `onAllyAttack`의 끊기를 없애지 않는가
 *
 * 끊기 자체는 고쳐서 넣은 것이다: 예전에는 대기 중일 때만 돌진해서, 스킬을
 * 다섯 번 눌러 **스킬 돌진이 한 번도 안 서는** 것을 헤드리스에서 확인했다
 * (`battleField.onAllyAttack`의 결정 기록). 끊기를 되돌리면 그 결함이 돌아온다.
 * 그래서 끊기는 남기고 **끊길 만큼 이른 입력을 막는다** — 순서가 반대면 눌러도
 * 아무 일이 없는 화면이 되고, 그건 유저가 고치라고 한 것보다 나쁘다.
 *
 * ## 왜 시전을 버리지 않고 막는가
 *
 * 게이트에 걸린 입력은 **쿨다운을 소모하지 않는다**(`castSkill`이 `trigger`
 * 앞에서 돌아간다). 걸린 입력을 소모로 처리하면 빠르게 두 번 누른 유저가 쿨은
 * 잃고 딜은 못 얻는다 — 화면에는 "눌렀는데 아무 일도 없고 쿨만 돈다"로 보인다.
 *
 * Pixi를 import하지 않는다 — node 테스트가 이 규칙을 직접 부른다.
 */

/**
 * 클립 하나의 임팩트까지 걸리는 시간(ms) = **접근 + 임팩트 프레임**.
 *
 * 복귀(`returnMs`)를 안 세는 것이 핵심이다. 임팩트가 지난 뒤의 끊기는 타격을
 * 지우지 않는다 — 되돌아오다 말고 다시 뛰어나가는 것은 오히려 연격으로 읽힌다.
 * 클립 **길이**로 재면(임팩트가 아니라) 게이지가 필요 이상으로 길어져서, 짧게
 * 잡으라는 지시와 반대로 간다: 셀린 `special`은 25프레임 2083ms인데 임팩트는
 * 18프레임 1500ms다.
 */
export function timeToImpactMs(
  approachMs: number,
  approachScale: number,
  impactFrame: number,
  fps: number,
  minApproachMs: number,
): number {
  const ap = Math.max(minApproachMs, Math.round(approachMs * approachScale));
  const f = Number.isFinite(fps) && fps > 0 ? fps : 1;
  const frame = Number.isFinite(impactFrame) ? Math.max(0, impactFrame) : 0;
  return ap + (frame / f) * 1000;
}

/**
 * 게이트의 상한(ms). 임팩트가 이보다 늦은 클립이 있어도 여기서 멈춘다.
 *
 * 근거는 **입력이 삼켜진 것으로 읽히는 한계**다. 로스터 최악은 셀린 `special`의
 * 1643ms인데, 그만큼 잠그면 네 칸을 다 눌러도 초당 0.6회가 되어 유저가 고치라고
 * 한 "수동이 느리다"로 되돌아간다. 380ms는 가장 이른 임팩트(리제 `attack2`
 * 임팩트 2프레임 = 143ms + 접근 124ms ≈ 267ms)보다 크고, 한 번의 탭을 두 번으로
 * 오인할 만큼 길지는 않은 값이다.
 *
 * **상한에 걸린 칸은 여전히 끊길 수 있다.** 그것을 감수하는 이유: 늦은 임팩트를
 * 다 기다리면 박자가 죽고, 끊기는 쪽은 "빠르게 몰아쳤다"로도 읽힌다. 못 막는
 * 구간이 있다는 것을 숨기지 않으려고 상한을 상수로 남긴다.
 */
export const CAST_GATE_MAX_MS = 380;

/** 게이트가 실제로 잠그는 시간 — 임팩트까지의 시간을 상한으로 접는다 */
export function castGateMs(timeToImpact: number): number {
  if (!Number.isFinite(timeToImpact) || timeToImpact <= 0) return 0;
  return Math.min(CAST_GATE_MAX_MS, timeToImpact);
}

/** 한 시전자의 게이트 상태. 세션이 캐스터마다 하나씩 들고 있다 */
export interface CastGate {
  /** 지금 시전해도 되는가 — 앞 모션의 임팩트를 지나왔는가 */
  canCast(nowMs: number): boolean;
  /** 시전했다고 표시한다. `clipImpactMs`는 그 클립의 임팩트까지 시간 */
  mark(nowMs: number, clipImpactMs: number): void;
  /** 남은 잠금(ms) — 테스트·디버그용 */
  remainingMs(nowMs: number): number;
}

export function createCastGate(): CastGate {
  /** 다음 시전이 허용되는 시각. 0이면 아직 아무것도 안 질렀다 */
  let openAt = 0;
  return {
    canCast(nowMs: number): boolean {
      return !Number.isFinite(nowMs) ? false : nowMs >= openAt;
    },
    mark(nowMs: number, clipImpactMs: number): void {
      if (!Number.isFinite(nowMs)) return;
      openAt = nowMs + castGateMs(clipImpactMs);
    },
    remainingMs(nowMs: number): number {
      if (!Number.isFinite(nowMs)) return 0;
      return Math.max(0, openAt - nowMs);
    },
  };
}

/**
 * 스킬 하나의 임팩트까지 시간을 표에서 찾는다. 표에 없으면(방해·버프처럼
 * 돌진하지 않는 스킬) 0 — 게이트를 걸지 않는다는 뜻이다.
 *
 * 광선으로 나가는 스킬에 게이트를 걸면 안 되는 이유: 그건 몸이 움직이지 않으므로
 * 끊길 모션이 없다. 걸면 방해 두 칸이 서로를, 그리고 공격 칸을 막는다.
 */
export function skillImpactMs(
  table: ReadonlyMap<string, number>,
  skillId: string | undefined,
): number {
  if (skillId === undefined) return 0;
  return table.get(skillId) ?? 0;
}

/** 표를 세울 때 쓰는 한 줄 — 캐릭터의 클립 실측과 역할의 접근 배율이 만난다 */
export interface ImpactRow {
  skillId: string;
  clip: AttackClip;
  approachMs: number;
  approachScale: number;
  impactFrame: number;
  fps: number;
}

/** `ImpactRow` 목록 → `skillId → 임팩트까지 시간` 표 */
export function buildImpactTable(
  rows: readonly ImpactRow[],
  minApproachMs: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(
      r.skillId,
      timeToImpactMs(r.approachMs, r.approachScale, r.impactFrame, r.fps, minApproachMs),
    );
  }
  return out;
}
