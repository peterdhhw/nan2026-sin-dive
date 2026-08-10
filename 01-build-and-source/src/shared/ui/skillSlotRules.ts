/**
 * 원형 스킬 슬롯의 순수 규칙 — 아이콘 선택·쿨다운 표기·완료 펄스.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C4
 *
 * Pixi를 import하지 않는다 (`ui/skillSlot.ts`가 재export한다).
 */

import type { SkillDef } from "../../core/types";
import type { SkillIconRegion } from "../fxManifest";

export type SlotState = "ready" | "cooling" | "locked";

/**
 * 스킬 → 아이콘 region.
 *
 * `kind`만으로는 부족하다: 스킬바 6칸 중 **공격이 넷, 방해가 둘**이라 kind로
 * 가르면 네 칸이 같은 그림이 된다. 그러면 라벨을 읽어야 무엇인지 알게 되고,
 * 그건 아이콘의 존재 이유와 반대다.
 *
 * 공격은 쿨다운으로 넷으로 가른다 — 쿨다운이 곧 한 방의 무게이고(`ROLE_NUMBERS`),
 * 스킬 id를 보고 가르면 캐릭터 슬러그가 붙은 28개를 여기에 다시 적어야 한다.
 * 방해는 `interferenceKind`로 가른다 — 늦추는 것과 시야를 막는 것은 상대에게
 * 다른 일이 벌어지는 것이라, 같은 아이콘이면 눌러 보고 알아내야 한다.
 *
 * ## 문턱값이 4000/7000에서 내려온 이유 (2026-08-10)
 *
 * 이 세 상수는 `ROLE_NUMBERS`에서 **유도된 값**이다. 그쪽 쿨이 오토 박자에
 * 맞춰 2.5/5/9초에서 1.8/2.5/3.4/4.5초로 내려오자 옛 문턱(4000/7000)은 네 칸
 * 중 셋을 `skill_attack` 하나로 뭉쳤다 — 아이콘이 칸을 가르지 못하는 상태다.
 * 상수는 기준이 바뀌면 조용히 의미가 달라진다는 그 형태이므로, 유래를 여기
 * 적고 문턱을 각 역할 쿨의 **바로 아래**에 놓는다:
 *
 * | 역할 | 쿨 | 받는 아이콘 |
 * |---|---|---|
 * | quick | 1800 | `skill_attack` |
 * | combo | 2500 | `skill_combo` (≥ 2200) |
 * | burst | 3400 | `skill_burst` (≥ 3000) |
 * | ult | 4500 | `skill_ult` (≥ 4000) |
 *
 * 문턱을 쿨의 중간(2150·2950·3950)이 아니라 조금 아래로 잡은 이유: 밸런스를
 * 만질 때 쿨은 대개 내려간다(박자를 빠르게 하려는 방향이다). 아래쪽 여유가
 * 크면 한 칸이 옆 등급으로 떨어지는 일이 늦게 온다 — 그리고 그 일이 오면
 * `uiRules.test.ts`가 "여섯 칸이 서로 다른 아이콘이다"로 잡는다.
 */
/** 이 쿨다운 이상이면 연격 아이콘 (combo 2500 바로 아래) */
export const COMBO_COOLDOWN_MS = 2200;
/** 이 쿨다운 이상이면 파열 아이콘 (burst 3400 바로 아래) */
export const BURST_COOLDOWN_MS = 3000;
/** 이 쿨다운 이상이면 네 번째 칸 아이콘 (ult 4500 바로 아래) */
export const ULT_COOLDOWN_MS = 4000;

export function iconRegionFor(skill: SkillDef): SkillIconRegion {
  if (skill.kind === "interference") {
    // 시야를 막는 것만 갈라낸다 — 나머지(늦추기·게이지·소집)는 전부 수치를
    // 건드리는 방해라서 사슬 하나로 묶어도 화면에서 헷갈리지 않는다
    return skill.interferenceKind === "blind"
      ? "skill_blind"
      : "skill_interference";
  }
  if (skill.kind === "buff") return "skill_buff";
  if (skill.cooldownMs >= ULT_COOLDOWN_MS) return "skill_ult";
  if (skill.cooldownMs >= BURST_COOLDOWN_MS) return "skill_burst";
  return skill.cooldownMs >= COMBO_COOLDOWN_MS ? "skill_combo" : "skill_attack";
}

/** 슬롯 지름 = 스킬바 높이 × 이 비율 (§07-7: 약 142px) */
export const SLOT_DIAMETER_RATIO = 0.62;

/** hitArea 반경 관용 — 엄지 입력 오차를 흡수한다 (§C4) */
export const HIT_SLACK_PX = 10;

/** 쿨다운 파이 알파 (§C4) */
export const COOL_PIE_ALPHA = 0.62;

/** ready 상태의 초록 링 두께 (§C4) */
export const READY_RING_W = 3;

/**
 * 쿨다운 중앙에 찍는 남은 초.
 *
 * **올림한다.** 내림하면 0.4초 남았을 때 "0"이 떠서 이미 준비된 것처럼 보인다.
 * 준비 완료면 빈 문자열 — "0"을 남기면 그게 상태인지 값인지 알 수 없다.
 */
export function cooldownLabel(remainingMs: number): string {
  if (!(remainingMs > 0)) return "";
  return String(Math.ceil(remainingMs / 1000));
}

/** 쿨다운 완료 펄스 (§4: scale 1.0→1.08→1.0, 220ms) */
export const READY_PULSE_MS = 220;
export const READY_PULSE_SCALE = 1.08;

export function readyPulse(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= READY_PULSE_MS) return 1;
  const t = elapsedMs / READY_PULSE_MS;
  return 1 + (READY_PULSE_SCALE - 1) * Math.sin(t * Math.PI);
}

/** 완료 순간의 흰 플래시 알파 (펄스와 같은 시간축에서 사라진다) */
export function readyFlashAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= READY_PULSE_MS) return 0;
  return 1 - elapsedMs / READY_PULSE_MS;
}

/**
 * AUTO 시전 시 슬롯에 주는 링 펄스 (§07-7).
 *
 * 완료 펄스보다 짧고 약하다 — 내가 누른 것과 AUTO가 쓴 것이 같은 세기로
 * 반짝이면 무엇이 내 조작인지 구분되지 않는다.
 */
export const AUTO_PULSE_MS = 160;

export function autoPulseAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= AUTO_PULSE_MS) return 0;
  return (1 - elapsedMs / AUTO_PULSE_MS) * 0.7;
}

/** 0 = 준비완료, 1 = 방금 사용. 쿨다운 파이가 덮는 비율 */
export function slotState(remainingMs: number, locked = false): SlotState {
  if (locked) return "locked";
  return remainingMs > 0 ? "cooling" : "ready";
}
