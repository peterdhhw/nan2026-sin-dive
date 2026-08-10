import { describe, expect, it } from "vitest";
import {
  CHOICE_CORRUPTION,
  CORRUPTION_FLOOR_CAP,
  CORRUPTION_MAX,
  CORRUPTION_SKILL_STAGE,
  STAGE_ATK_MULT,
  STAGE_NAMES,
  STAGE_THRESHOLDS,
  clampCorruption,
  corruptionAtkMul,
  corruptionFromFloor,
  corruptionOf,
  corruptionSkillUnlocked,
  stageNameOf,
  stageOf,
} from "../src/core/corruption/corruption";

describe("stageOf — 5단계 경계 (경계값은 그 단계에 속한다)", () => {
  it("0~29 일반 / 30 각성 / 50 중간타락 / 70 타락 / 100 완전타락", () => {
    expect(stageOf(0)).toBe(0);
    expect(stageOf(29)).toBe(0);
    expect(stageOf(30)).toBe(1);
    expect(stageOf(49)).toBe(1);
    expect(stageOf(50)).toBe(2);
    expect(stageOf(69)).toBe(2);
    expect(stageOf(70)).toBe(3);
    expect(stageOf(99)).toBe(3);
    expect(stageOf(100)).toBe(4);
  });

  it("단계 이름은 기획서 표기 그대로다", () => {
    expect(stageNameOf(0)).toBe("일반");
    expect(stageNameOf(30)).toBe("각성");
    expect(stageNameOf(50)).toBe("중간타락");
    expect(stageNameOf(70)).toBe("타락");
    expect(stageNameOf(100)).toBe("완전타락");
    expect(STAGE_NAMES.length).toBe(STAGE_THRESHOLDS.length + 1);
  });
});

describe("corruptionAtkMul — 기획서 §4 배율", () => {
  it("일반 1.0 / 각성 1.15 / 중간 1.30 / 타락 1.50 / 완전 2.0(잠정)", () => {
    expect(corruptionAtkMul(0)).toBe(1);
    expect(corruptionAtkMul(30)).toBeCloseTo(1.15);
    expect(corruptionAtkMul(50)).toBeCloseTo(1.3);
    expect(corruptionAtkMul(70)).toBeCloseTo(1.5);
    expect(corruptionAtkMul(100)).toBe(2);
    expect(STAGE_ATK_MULT.length).toBe(STAGE_NAMES.length);
  });
});

describe("corruptionFromFloor — 깊이 성분", () => {
  it("층이 깊을수록 오르고, 캡(60)에서 멈춘다", () => {
    expect(corruptionFromFloor(0)).toBe(0);
    expect(corruptionFromFloor(100)).toBe(12); // sqrt(100) × 1.2
    expect(corruptionFromFloor(400)).toBe(24);
    expect(corruptionFromFloor(2500)).toBe(CORRUPTION_FLOOR_CAP);
    expect(corruptionFromFloor(9999)).toBe(CORRUPTION_FLOOR_CAP);
  });

  it("단조 증가한다 (1..9999 표본)", () => {
    let prev = -1;
    for (const f of [1, 10, 100, 500, 1000, 3000, 9999]) {
      const c = corruptionFromFloor(f);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it("음수·NaN은 0으로 본다", () => {
    expect(corruptionFromFloor(-5)).toBe(0);
    expect(corruptionFromFloor(Number.NaN)).toBe(0);
  });
});

describe("corruptionOf — 깊이 + 선택", () => {
  it("수용 1회당 +10이다", () => {
    expect(corruptionOf(100, 0)).toBe(12);
    expect(corruptionOf(100, 1)).toBe(12 + CHOICE_CORRUPTION);
    expect(corruptionOf(100, 3)).toBe(12 + 3 * CHOICE_CORRUPTION);
  });

  /** 깊이만으로는 60 — 완전타락(100)은 선택이 쌓여야 도달한다 (듀얼 엔딩의 축) */
  it("깊이만으로는 완전타락에 못 간다, 선택을 더하면 100에서 잘린다", () => {
    expect(corruptionOf(9999, 0)).toBe(CORRUPTION_FLOOR_CAP);
    expect(corruptionOf(9999, 99)).toBe(CORRUPTION_MAX);
  });

  it("음수·NaN 선택 횟수는 0으로 본다", () => {
    expect(corruptionOf(100, -3)).toBe(12);
    expect(corruptionOf(100, Number.NaN)).toBe(12);
  });
});

/**
 * 6번째 스킬 칸의 해금 (3단계).
 *
 * **단계로 묻는다.** 경계값 30은 `STAGE_THRESHOLDS`가 갖고 있으므로 여기서
 * 숫자를 다시 적으면 두 벌이 된다 — 그래서 문턱을 옮겼을 때 이 수가 같이
 * 따라오도록 `STAGE_THRESHOLDS`에서 읽는다.
 */
describe("corruptionSkillUnlocked — 6번째 칸 해금", () => {
  /** 각성 문턱. 코어가 가진 값에서 읽는다 (숫자를 두 벌로 만들지 않는다) */
  const AWAKEN = STAGE_THRESHOLDS[CORRUPTION_SKILL_STAGE - 1]!;

  it("각성 문턱 아래는 잠겨 있다", () => {
    expect(corruptionSkillUnlocked(0)).toBe(false);
    expect(corruptionSkillUnlocked(AWAKEN - 1)).toBe(false);
  });

  it("문턱값 자체에서 열린다 — 경계는 그 단계에 속한다", () => {
    expect(corruptionSkillUnlocked(AWAKEN)).toBe(true);
    expect(corruptionSkillUnlocked(CORRUPTION_MAX)).toBe(true);
  });

  /**
   * **비유한 값은 잠금이다.** 열림 쪽으로 떨어지면 저장이 깨진 사람이
   * 잠금을 건너뛴 채 칸을 얻는다 — 실패는 안전한 쪽으로 가야 한다.
   */
  it("NaN·음수는 잠긴 쪽이다", () => {
    expect(corruptionSkillUnlocked(Number.NaN)).toBe(false);
    expect(corruptionSkillUnlocked(-50)).toBe(false);
  });

  /**
   * 데모 한 판에 **실제로 열리는가**. 깊이만으로는 625층이 필요해서
   * (`corruptionFromFloor` = √층 × 1.2 ≥ 30) 열리는 경로는 '심연의 선택'이다 —
   * 열리지 않는 잠금은 화면에서 잠금인지 버그인지 구분되지 않는다.
   */
  it("100층 + 선택 두 번이면 열린다 (데모에서 도달 가능한 경로)", () => {
    expect(corruptionSkillUnlocked(corruptionOf(100, 0))).toBe(false);
    expect(corruptionSkillUnlocked(corruptionOf(100, 1))).toBe(false);
    expect(corruptionSkillUnlocked(corruptionOf(100, 2))).toBe(true);
  });
});

describe("clampCorruption", () => {
  it("0..100으로 접고, 비유한 값은 0이다", () => {
    expect(clampCorruption(-1)).toBe(0);
    expect(clampCorruption(101)).toBe(100);
    expect(clampCorruption(55.9)).toBe(55);
    expect(clampCorruption(Number.NaN)).toBe(0);
    expect(clampCorruption(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
