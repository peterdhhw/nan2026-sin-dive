/**
 * 싱글 경제 — 골드 획득과 강화(성장) 곡선. 순수 결정론 계산만 담는다.
 *
 * 설계 문서: docs/GAPS.md §5(재화 미정을 채운다), 기획서 §2(수익화 축의 "성장")
 *
 * ## 사전과제 범위의 결정 (2026-08-03 정호 확정)
 *
 * - 재화는 **골드 하나만** 굴린다. 젬·심연석은 결제/거래 인프라가 없는 사전과제
 *   범위 밖이다 — 저장 형식(`sin.single.currency`)은 재화가 늘어도 안 바뀌게
 *   콤마 구분으로 잡아 둔다(saveRules).
 * - 골드는 적 처치에서만 나온다: `ceil(HP^0.8 × 골드배율)`. HP에 딸려 가므로
 *   층이 깊어질수록 수입도 복리로 오르되, 지수 0.8이라 **수입이 적 HP보다
 *   조금 느리게 자란다** — 층이 깊어질수록 강화가 서서히 벅차지는 완만한
 *   벽(방치형의 페이스 조절 장치)이 이 한 줄에서 나온다.
 * - 강화 4종(공격력·공격 속도·골드 획득·스킬 위력). 효과는 레벨당 복리,
 *   비용은 `기본가 × 1.14^레벨`. 효과 성장률(8%/6%)이 층당 적 HP 성장률
 *   (`SINGLE_HP_GROWTH` 1.06)과 같은 자릿수라 "강화 1~2번 = 1층 전진"의
 *   체감이 유지된다.
 *
 * 이 수치들은 `tests/singlePacing.test.ts`의 시뮬레이션이 페이스를 고정한다 —
 * 바꿀 때는 그 테스트의 근거 주석과 같이 바꿔라.
 */

/** 강화 종류. 순서 = 강화 줄(UI)의 기본 배치 순서 */
export const UPGRADE_IDS = ["atk", "spd", "gold", "skill"] as const;
export type UpgradeId = (typeof UPGRADE_IDS)[number];

export type UpgradeLevels = Record<UpgradeId, number>;

export interface UpgradeDef {
  id: UpgradeId;
  /** UI 표시용 한글 이름 */
  name: string;
  /** 레벨 0 → 1 비용 */
  baseCost: number;
  /** 레벨당 비용 복리 */
  costGrowth: number;
  /** 레벨당 효과 복리 (spd는 공격 간격에 곱하므로 1보다 작다) */
  effectGrowth: number;
  /** 효과가 발산하면 안 되는 것만 상한을 둔다 (spd — 간격이 0에 수렴하면 안 됨) */
  maxLevel: number | null;
}

/** 공격 속도 최대 레벨 — ×0.99^60 ≈ 0.55, 간격이 절반 밑으로 안 내려가게 */
export const SPD_MAX_LEVEL = 60;

export const UPGRADE_DEFS: readonly UpgradeDef[] = [
  { id: "atk", name: "공격력", baseCost: 60, costGrowth: 1.14, effectGrowth: 1.08, maxLevel: null },
  { id: "spd", name: "공격 속도", baseCost: 90, costGrowth: 1.14, effectGrowth: 0.99, maxLevel: SPD_MAX_LEVEL },
  { id: "gold", name: "골드 획득", baseCost: 80, costGrowth: 1.14, effectGrowth: 1.06, maxLevel: null },
  { id: "skill", name: "스킬 위력", baseCost: 120, costGrowth: 1.14, effectGrowth: 1.08, maxLevel: null },
];

/** 골드 = ceil(HP^이 지수 × 배율). 1보다 작아서 수입이 HP보다 느리게 자란다 */
export const GOLD_HP_EXP = 0.8;

const DEF_BY_ID = new Map(UPGRADE_DEFS.map((d) => [d.id, d]));

export function upgradeDefOf(id: UpgradeId): UpgradeDef {
  // UPGRADE_IDS와 UPGRADE_DEFS가 1:1이므로 항상 존재한다 (테스트가 고정)
  return DEF_BY_ID.get(id) as UpgradeDef;
}

/** 레벨 0..(maxLevel)로 접는다. 비유한 값은 0 */
export function clampLevel(id: UpgradeId, level: number): number {
  if (!Number.isFinite(level)) return 0;
  const def = upgradeDefOf(id);
  const floor = Math.max(0, Math.floor(level));
  return def.maxLevel === null ? floor : Math.min(def.maxLevel, floor);
}

export function emptyLevels(): UpgradeLevels {
  return { atk: 0, spd: 0, gold: 0, skill: 0 };
}

export function clampLevels(levels: Partial<UpgradeLevels> | null | undefined): UpgradeLevels {
  const out = emptyLevels();
  if (!levels) return out;
  for (const id of UPGRADE_IDS) {
    out[id] = clampLevel(id, levels[id] ?? 0);
  }
  return out;
}

/** 이 레벨에서 다음 레벨로 가는 비용. 만렙이면 null (버튼 비활성) */
export function upgradeCost(id: UpgradeId, level: number): number | null {
  const def = upgradeDefOf(id);
  const lv = clampLevel(id, level);
  if (def.maxLevel !== null && lv >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, lv));
}

/** 이 강화의 효과 배율 (atk/skill/gold는 1 이상, spd는 1 이하 — 공격 간격에 곱한다) */
export function upgradeEffectMul(id: UpgradeId, level: number): number {
  const def = upgradeDefOf(id);
  return Math.pow(def.effectGrowth, clampLevel(id, level));
}

/** 팀 공격력 배율 */
export function atkMulOf(levels: UpgradeLevels): number {
  return upgradeEffectMul("atk", levels.atk);
}

/** 공격 간격 배율 (1 이하 — attackIntervalMs에 곱한다) */
export function attackIntervalMulOf(levels: UpgradeLevels): number {
  return upgradeEffectMul("spd", levels.spd);
}

/** 골드 획득 배율 */
export function goldMulOf(levels: UpgradeLevels): number {
  return upgradeEffectMul("gold", levels.gold);
}

/** 스킬 위력 배율 */
export function skillMulOf(levels: UpgradeLevels): number {
  return upgradeEffectMul("skill", levels.skill);
}

/**
 * 처치 골드. `enemyMaxHp`는 웨이브 정의의 HP(편차 적용 후)다 — 실제 들어간
 * 딜(오버킬 잘림)이 아니라 정의 HP 기준이라, 같은 적은 언제 잡아도 같은
 * 골드를 준다(결정론).
 */
export function goldForKill(enemyMaxHp: number, levels: UpgradeLevels): number {
  if (!Number.isFinite(enemyMaxHp) || enemyMaxHp <= 0) return 0;
  return Math.ceil(Math.pow(enemyMaxHp, GOLD_HP_EXP) * goldMulOf(levels));
}

/** 구매 가능한가. gold가 null(잔고 읽기 실패)이면 항상 false — 모르는 잔고에서 차감 금지 */
export function canBuy(gold: number | null, id: UpgradeId, level: number): boolean {
  if (gold === null || !Number.isFinite(gold)) return false;
  const cost = upgradeCost(id, level);
  return cost !== null && gold >= cost;
}
