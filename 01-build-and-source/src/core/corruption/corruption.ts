/**
 * 타락도(Corruption) — 0~100, 5단계. 순수 결정론 계산만 담는다.
 *
 * 설계 문서: docs/WORLD.md §3, docs/GAPS.md §4, 기획서 §4(타락도 5구간)
 *
 * ## 사전과제 범위의 결정 (2026-08-03 정호 확정 — GAPS.md §4의 미정을 채운다)
 *
 * - **무엇이 올리는가**: 도달 최고 층(깊이) + '심연의 선택' 수용 횟수. 깊이만으로는
 *   `CORRUPTION_FLOOR_CAP`(60)까지만 오른다 — 완전타락(100)은 유저의 선택이
 *   쌓여야만 도달한다. 기획서의 듀얼 엔딩(성녀/여신)이 "선택"으로 갈리는
 *   구조와 맞물리게 한 설계다.
 * - **게임플레이 효과**: 단계별 ATK 배율만 적용한다. 기획서의 HP 페널티는
 *   적용할 곳이 없다 — 이 게임의 아군에는 HP가 없다(몬스터는 위협이 아니라
 *   자원, game-spec §10). 리스크 축은 본선에서 벨리알 추격(특수 웨이브)으로
 *   구현할 몫으로 남긴다.
 * - **완전타락 배율 2.0은 잠정값**이다 — 기획서가 "극강"이라고만 적었다.
 * - 시각 표현(오라·틴트)은 여기 없다. 색은 프레젠테이션이므로 씬/Rules 몫이다.
 *
 * 심문관 벨리알 추격(50% 초과), 5단계 의상 교체(에셋 35세트)는 사전과제
 * 범위 밖 — GAPS.md §4에 남아 있다.
 */

/** 타락도 상한 */
export const CORRUPTION_MAX = 100;

/** 깊이(도달 최고 층)만으로 오를 수 있는 상한 — 그 위는 선택의 몫 */
export const CORRUPTION_FLOOR_CAP = 60;

/**
 * 깊이 → 타락도 계수. `sqrt(층) × 1.2`라 초반이 가파르다 — 사전과제 데모
 * (100~400층)에서 각성(30) 진입이 보여야 시스템이 있는 줄 안다.
 * 100층 ≈ 12, 400층 ≈ 24, 2,500층 ≈ 60(캡).
 */
export const CORRUPTION_FLOOR_RATE = 1.2;

/** '심연의 선택' 수용 1회당 타락도 */
export const CHOICE_CORRUPTION = 10;

/** 단계 진입 경계 (이상). 0~29 일반 / 30 각성 / 50 중간타락 / 70 타락 / 100 완전타락 */
export const STAGE_THRESHOLDS = [30, 50, 70, 100] as const;

/** 단계 이름 — 기획서 §4의 표기 그대로 */
export const STAGE_NAMES = ["일반", "각성", "중간타락", "타락", "완전타락"] as const;

/**
 * 단계별 ATK 배율. 기획서 §4: 각성 +15% / 중간타락 +30% / 타락 +50% /
 * 완전타락 "극강"(잠정 ×2.0).
 */
export const STAGE_ATK_MULT = [1, 1.15, 1.3, 1.5, 2] as const;

export type CorruptionStage = 0 | 1 | 2 | 3 | 4;

/**
 * **타락이 게임플레이에 처음 나타나는 단계** — 각성(1). ATK 배율이 여기서
 * 1.0을 벗어난다(`STAGE_ATK_MULT[1]` = 1.15).
 *
 * 단계로 적고 타락도 숫자로 안 적는 이유: 경계값(30)은 `STAGE_THRESHOLDS`가
 * 이미 갖고 있고, 두 곳에 적으면 경계를 옮긴 날 이쪽만 옛 값에 남는다.
 *
 * ## 왜 각성(30)인가 — 깊이만으로는 못 닿는다
 *
 * `corruptionFromFloor`는 `sqrt(층) × 1.2`라서 30에 닿으려면 **625층**이다.
 * 데모에서 실제로 닿는 경로는 선택이다: 100층(≈12) + '심연의 선택' 두 번
 * (+20) = 32. 즉 이 단계는 **깊이가 아니라 선택으로 열린다** — 기획서의
 * "타락을 받아들이면 강해진다"가 수치로 화면에 나오는 자리다.
 *
 * ## 스킬 칸이 아니라 배율이 걸린다 (2026-08-10)
 *
 * 예전에는 스킬바 6번째 칸(타락 버프)이 이 값 하나로 열렸다. 그 칸은 지웠다 —
 * 근거는 `loadout/preset.presetSkillsFor`의 결정 기록에 있다(데모 한 판에서
 * 거의 열리지 않아 100층 내내 회색 원이었다). **이 상수는 남긴다**: 도달성
 * 계약(`tests/singleSessionRules.test.ts`)이 세 상수를 한 부등식으로 묶는데,
 * 그 계약은 칸이 아니라 "타락을 받아들인 판에서 각성에 닿는가"를 묻는다.
 * 배율·엔딩 분기가 그 단계에 걸려 있으므로 닿지 못하면 타락 시스템 전체가
 * 데모에서 안 보인다 — 지웠던 칸이 아니라 그쪽이 원래의 이유였다.
 */
export const CORRUPTION_SKILL_STAGE: CorruptionStage = 1;

/** 0..100으로 접는다. 유한하지 않은 값은 0으로 본다 */
export function clampCorruption(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CORRUPTION_MAX, Math.floor(value)));
}

/** 깊이(도달 최고 층)에서 오는 타락도. `CORRUPTION_FLOOR_CAP`에서 멈춘다 */
export function corruptionFromFloor(maxFloor: number): number {
  const f = Number.isFinite(maxFloor) ? Math.max(0, Math.floor(maxFloor)) : 0;
  return Math.min(CORRUPTION_FLOOR_CAP, Math.round(Math.sqrt(f) * CORRUPTION_FLOOR_RATE));
}

/** 최종 타락도 = 깊이 성분 + 선택 성분. 저장에는 이 결과가 아니라 재료(층·횟수)를 둔다 */
export function corruptionOf(maxFloor: number, acceptedChoices: number): number {
  const accepted = Number.isFinite(acceptedChoices)
    ? Math.max(0, Math.floor(acceptedChoices))
    : 0;
  return clampCorruption(corruptionFromFloor(maxFloor) + accepted * CHOICE_CORRUPTION);
}

/** 타락 단계. 경계값은 그 단계에 속한다 (30 = 각성 진입) */
export function stageOf(corruption: number): CorruptionStage {
  const c = clampCorruption(corruption);
  let stage = 0;
  for (const threshold of STAGE_THRESHOLDS) {
    if (c >= threshold) stage += 1;
  }
  return stage as CorruptionStage;
}

export function stageNameOf(corruption: number): string {
  return STAGE_NAMES[stageOf(corruption)] as string;
}

/** 이 타락도의 ATK 배율 — 세션이 팀 딜에 곱한다 */
export function corruptionAtkMul(corruption: number): number {
  return STAGE_ATK_MULT[stageOf(corruption)] as number;
}

/**
 * 타락이 게임플레이에 나타나는 단계에 닿았는가 (`CORRUPTION_SKILL_STAGE` 이상).
 *
 * **지금 이걸 부르는 것은 도달성 계약뿐이다** (`tests/singleSessionRules.test.ts`).
 * 함수를 남긴 이유는 그 계약이 세 상수(대전 해금 층·선택 제안 주기·이 단계)를
 * 한 부등식으로 묶는 유일한 검사이기 때문이다 — 상수 셋은 각자 옳으면서 서로를
 * 배제할 수 있고, 그게 실제로 한 번 일어났다(2026-08-06). 부등식을 손으로
 * 풀어 쓰면 그 결함이 조용히 돌아온다.
 *
 * 이름의 "Unlocked"는 스킬 칸이 이 단계에서 열렸던 시절의 것이다. 칸은 지웠고
 * (`presetSkillsFor`) 열리는 것은 이제 ATK 배율과 엔딩 분기다.
 */
export function corruptionSkillUnlocked(corruption: number): boolean {
  return stageOf(corruption) >= CORRUPTION_SKILL_STAGE;
}
