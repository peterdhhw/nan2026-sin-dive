import { describe, expect, it } from "vitest";
import {
  GOLD_HP_EXP,
  SPD_MAX_LEVEL,
  UPGRADE_DEFS,
  UPGRADE_IDS,
  atkMulOf,
  attackIntervalMulOf,
  canBuy,
  clampLevel,
  clampLevels,
  emptyLevels,
  goldForKill,
  goldMulOf,
  skillMulOf,
  upgradeCost,
  upgradeDefOf,
  upgradeEffectMul,
} from "../src/single/economyRules";

describe("UPGRADE_DEFS — 정의 무결성", () => {
  it("UPGRADE_IDS와 1:1이다", () => {
    expect(UPGRADE_DEFS.map((d) => d.id)).toEqual([...UPGRADE_IDS]);
    for (const id of UPGRADE_IDS) {
      expect(upgradeDefOf(id).id).toBe(id);
    }
  });

  it("spd만 효과가 1보다 작고(간격 배율) 상한이 있다", () => {
    for (const def of UPGRADE_DEFS) {
      if (def.id === "spd") {
        expect(def.effectGrowth).toBeLessThan(1);
        expect(def.maxLevel).toBe(SPD_MAX_LEVEL);
      } else {
        expect(def.effectGrowth).toBeGreaterThan(1);
        expect(def.maxLevel).toBeNull();
      }
    }
  });
});

describe("upgradeCost — 복리 비용", () => {
  it("레벨 0 비용은 기본가, 레벨이 오르면 1.14 복리다", () => {
    expect(upgradeCost("atk", 0)).toBe(60);
    expect(upgradeCost("atk", 1)).toBe(Math.round(60 * 1.14));
    expect(upgradeCost("atk", 10)).toBe(Math.round(60 * Math.pow(1.14, 10)));
  });

  it("spd 만렙에서는 null이다 (버튼 비활성 신호)", () => {
    expect(upgradeCost("spd", SPD_MAX_LEVEL)).toBeNull();
    expect(upgradeCost("spd", SPD_MAX_LEVEL - 1)).not.toBeNull();
  });
});

describe("효과 배율", () => {
  it("atk/skill은 레벨당 +8%, gold는 +6% 복리다", () => {
    expect(atkMulOf({ ...emptyLevels(), atk: 10 })).toBeCloseTo(Math.pow(1.08, 10));
    expect(skillMulOf({ ...emptyLevels(), skill: 5 })).toBeCloseTo(Math.pow(1.08, 5));
    expect(goldMulOf({ ...emptyLevels(), gold: 7 })).toBeCloseTo(Math.pow(1.06, 7));
  });

  it("spd는 공격 간격에 곱하는 1 이하 배율이고 만렙에서 절반 밑으로 안 내려간다", () => {
    expect(attackIntervalMulOf(emptyLevels())).toBe(1);
    const atMax = attackIntervalMulOf({ ...emptyLevels(), spd: SPD_MAX_LEVEL });
    expect(atMax).toBeCloseTo(Math.pow(0.99, SPD_MAX_LEVEL));
    expect(atMax).toBeGreaterThan(0.5);
  });

  it("레벨 0이면 전부 배율 1이다", () => {
    for (const id of UPGRADE_IDS) {
      expect(upgradeEffectMul(id, 0)).toBe(1);
    }
  });
});

describe("goldForKill — 처치 골드", () => {
  it("HP^0.8이라 수입이 HP보다 느리게 자란다 (완만한 벽)", () => {
    const g100 = goldForKill(100, emptyLevels());
    const g10000 = goldForKill(10000, emptyLevels());
    expect(g100).toBe(Math.ceil(Math.pow(100, GOLD_HP_EXP))); // 40
    // HP 100배 → 골드는 100^0.8 ≈ 40배
    expect(g10000 / g100).toBeLessThan(100);
    expect(g10000 / g100).toBeGreaterThan(30);
  });

  it("골드 획득 강화가 곱해진다", () => {
    const levels = { ...emptyLevels(), gold: 10 };
    expect(goldForKill(100, levels)).toBe(
      Math.ceil(Math.pow(100, GOLD_HP_EXP) * Math.pow(1.06, 10)),
    );
  });

  it("HP가 0 이하거나 숫자가 아니면 0골드다", () => {
    expect(goldForKill(0, emptyLevels())).toBe(0);
    expect(goldForKill(-5, emptyLevels())).toBe(0);
    expect(goldForKill(Number.NaN, emptyLevels())).toBe(0);
  });
});

describe("canBuy — 잔고 실패 방어", () => {
  it("잔고를 모르면(null) 절대 못 산다 — 모르는 잔고에서 차감 금지", () => {
    expect(canBuy(null, "atk", 0)).toBe(false);
    expect(canBuy(Number.NaN, "atk", 0)).toBe(false);
  });

  it("잔고가 비용 이상이면 산다", () => {
    expect(canBuy(60, "atk", 0)).toBe(true);
    expect(canBuy(59, "atk", 0)).toBe(false);
  });

  it("만렙(spd)은 잔고가 아무리 많아도 못 산다", () => {
    expect(canBuy(1e9, "spd", SPD_MAX_LEVEL)).toBe(false);
  });
});

describe("clampLevel / clampLevels", () => {
  it("음수·NaN·소수는 접는다", () => {
    expect(clampLevel("atk", -3)).toBe(0);
    expect(clampLevel("atk", Number.NaN)).toBe(0);
    expect(clampLevel("atk", 2.9)).toBe(2);
    expect(clampLevel("spd", SPD_MAX_LEVEL + 10)).toBe(SPD_MAX_LEVEL);
  });

  it("부분 객체·null도 완전한 레벨 표로 만든다", () => {
    expect(clampLevels(null)).toEqual(emptyLevels());
    expect(clampLevels({ atk: 3 })).toEqual({ ...emptyLevels(), atk: 3 });
  });
});
