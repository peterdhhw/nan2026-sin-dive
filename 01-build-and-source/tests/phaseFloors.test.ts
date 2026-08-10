import { describe, expect, it } from "vitest";
import {
  FINAL_FLOOR,
  FLOORS_PER_PHASE,
  HP_GROWTH_PER_FLOOR,
  PHASES,
  PHASE_COUNT,
  clampFloor,
  clampPhase,
  exceedsExactRange,
  firstFloorOf,
  floorHpMul,
  lastExactLocalFloor,
  lastFloorOf,
  localFloorOf,
  phaseInfoOf,
  phaseOf,
} from "../src/core/phase/floors";
import {
  SINGLE_HP_GROWTH,
  SINGLE_MINION_BASE_HP,
} from "../src/core/phase/phaseWaves";

describe("phaseOf / localFloorOf", () => {
  it("1층은 phase 0의 첫 층이다", () => {
    expect(phaseOf(1)).toBe(0);
    expect(localFloorOf(1)).toBe(1);
  });

  /**
   * `floor(층/1000)`으로 짜면 여기서 phase 1 / local 0이 나온다. `local`은
   * 1..1000이어야 하고 1,000층은 phase 0의 마지막 층이다 (WORLD.md §2 표).
   */
  it("1,000층은 phase 0의 **마지막** 층이다 (phase 1의 0번째가 아니다)", () => {
    expect(phaseOf(1000)).toBe(0);
    expect(localFloorOf(1000)).toBe(FLOORS_PER_PHASE);
  });

  it("1,001층이 phase 1의 첫 층이다", () => {
    expect(phaseOf(1001)).toBe(1);
    expect(localFloorOf(1001)).toBe(1);
  });

  it("9,999층은 phase 9다", () => {
    expect(phaseOf(FINAL_FLOOR)).toBe(PHASE_COUNT - 1);
    expect(localFloorOf(FINAL_FLOOR)).toBe(999);
  });

  it("모든 층의 local이 1..1000 안에 있다", () => {
    for (const floor of [1, 999, 1000, 1001, 4999, 5000, 5001, 9998, 9999]) {
      const local = localFloorOf(floor);
      expect(local).toBeGreaterThanOrEqual(1);
      expect(local).toBeLessThanOrEqual(FLOORS_PER_PHASE);
    }
  });

  it("층 → (phase, local)이 되돌려진다", () => {
    for (const floor of [1, 500, 1000, 1001, 2500, 7777, 9999]) {
      expect(phaseOf(floor) * FLOORS_PER_PHASE + localFloorOf(floor)).toBe(
        floor,
      );
    }
  });
});

describe("clampFloor", () => {
  it("범위 밖을 접는다", () => {
    expect(clampFloor(0)).toBe(1);
    expect(clampFloor(-50)).toBe(1);
    expect(clampFloor(10_000)).toBe(FINAL_FLOOR);
    expect(clampFloor(1.9)).toBe(1);
  });

  it("유한하지 않은 값은 1층으로 본다", () => {
    expect(clampFloor(Number.NaN)).toBe(1);
    expect(clampFloor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("firstFloorOf / lastFloorOf", () => {
  it("페이즈 경계가 1,000층 단위로 맞는다", () => {
    expect(firstFloorOf(0)).toBe(1);
    expect(lastFloorOf(0)).toBe(1000);
    expect(firstFloorOf(1)).toBe(1001);
    expect(lastFloorOf(1)).toBe(2000);
  });

  /** 마지막 페이즈만 999층이다 — 10,000층은 없다 */
  it("마지막 페이즈는 9,999층에서 끝난다", () => {
    expect(firstFloorOf(9)).toBe(9001);
    expect(lastFloorOf(9)).toBe(FINAL_FLOOR);
  });

  it("경계가 겹치거나 비지 않는다", () => {
    for (let p = 0; p < PHASE_COUNT - 1; p++) {
      expect(firstFloorOf(p + 1)).toBe(lastFloorOf(p) + 1);
    }
  });

  it("clampPhase가 범위 밖을 접는다", () => {
    expect(clampPhase(-1)).toBe(0);
    expect(clampPhase(99)).toBe(PHASE_COUNT - 1);
    expect(clampPhase(Number.NaN)).toBe(0);
  });
});

describe("floorHpMul", () => {
  it("페이즈의 첫 층은 배율 1이다", () => {
    for (let p = 0; p < PHASE_COUNT; p++) {
      expect(floorHpMul(firstFloorOf(p))).toBeCloseTo(1, 10);
    }
  });

  /**
   * phase 0은 `local === 층`이므로 배율이 곧 층당 복리다.
   *
   * 전에는 이 자리에서 `core/waves.ts`의 `HP_GROWTH_PER_WAVE`(1.12)와 같은지를
   * 물었고 근거는 "PvP 실측 밸런스 보존"이었다. 그 근거는 사실이 아니었다 —
   * 싱글의 실제 적 HP는 `singleFloorHpMul`(1.06)이 계산하고 있었다. 지금은
   * 싱글이 이 상수를 소유하므로, **싱글의 실제 곡선과** 같은지를 묻는다.
   */
  it("phase 0에서 싱글 실제 곡선과 같다", () => {
    for (const floor of [1, 2, 10, 40, 200, 1000]) {
      expect(floorHpMul(floor)).toBeCloseTo(
        Math.pow(SINGLE_HP_GROWTH, floor - 1),
        6,
      );
    }
  });

  it("성장률 정의가 `phaseWaves`와 갈라지지 않는다", () => {
    expect(SINGLE_HP_GROWTH).toBe(HP_GROWTH_PER_FLOOR);
  });

  /**
   * 이걸 하려고 페이즈를 나눴다. 1.12 시절에는 리셋 없는 값이 `Infinity`여서
   * 이 검사가 `toBe(Infinity)`였는데, 1.06은 `10^253`으로 유한하다 — 그래서
   * "무한이 아니다"가 아니라 **자릿수 차이**로 묻는다.
   *
   * 리셋한 값도 정확한 정수 범위는 넘는다(1.8×10^25) — 그건 없앤 문제가 아니고
   * 아래 "정밀도 경계"가 표식으로 남긴 미결 항목이다 (docs/GAPS.md §2).
   */
  it("9,999층에서도 유한하다 — 리셋이 자릿수를 200자리 넘게 깎는다", () => {
    expect(Number.isFinite(floorHpMul(FINAL_FLOOR))).toBe(true);
    const withReset = Math.log10(floorHpMul(FINAL_FLOOR));
    const without = (FINAL_FLOOR - 1) * Math.log10(SINGLE_HP_GROWTH);
    expect(without - withReset).toBeGreaterThan(200);
    // 지수가 local(1..1000)로 접혔다는 뜻 — 층수가 아니라 페이즈 안 위치다
    expect(withReset).toBeCloseTo(
      (FLOORS_PER_PHASE - 2) * Math.log10(SINGLE_HP_GROWTH),
      6,
    );
  });

  it("페이즈 안에서는 단조 증가한다", () => {
    for (let local = 2; local <= 50; local++) {
      expect(floorHpMul(1000 + local)).toBeGreaterThan(
        floorHpMul(1000 + local - 1),
      );
    }
  });

  /** 의도된 하락이다 — 새 페이즈는 성장이 체감되는 지점이다 (WORLD.md §2) */
  it("페이즈 경계에서 배율이 1로 떨어진다", () => {
    expect(floorHpMul(1000)).toBeGreaterThan(floorHpMul(1001));
    expect(floorHpMul(1001)).toBeCloseTo(1, 10);
  });
});

describe("정밀도 경계 — 미결 항목의 표식", () => {
  /**
   * 페이즈 리셋은 `Infinity`를 없앴지만 정밀도는 못 살렸다. 이 사실이
   * 조용히 잊히지 않도록 테스트로 남긴다 (docs/GAPS.md §2).
   */
  it("잡몹 기본 HP로도 페이즈 후반은 정확한 정수 범위를 넘는다", () => {
    expect(exceedsExactRange(SINGLE_MINION_BASE_HP, 1)).toBe(false);
    // 1.06에서는 553층쯤이 경계다 (1.12 시절엔 285층). 층 번호를 손으로
    // 적지 않고 유도한 값 뒤를 쓴다 — 성장률을 만지면 따라와야 한다
    expect(
      exceedsExactRange(
        SINGLE_MINION_BASE_HP,
        lastExactLocalFloor(SINGLE_MINION_BASE_HP) + 1,
      ),
    ).toBe(true);
    // 그리고 그 경계가 페이즈 안에 실제로 존재한다 (1,000층 밖으로 밀려나면
    // 이 미결 항목 자체가 사라진 것이므로 표식이 거짓이 된다)
    expect(lastExactLocalFloor(SINGLE_MINION_BASE_HP)).toBeLessThan(
      FLOORS_PER_PHASE,
    );
  });

  it("경계가 baseHp에 딸려 있다 — 클수록 빨리 넘는다", () => {
    const small = lastExactLocalFloor(SINGLE_MINION_BASE_HP);
    const large = lastExactLocalFloor(SINGLE_MINION_BASE_HP * 1000);
    expect(large).toBeLessThan(small);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(FLOORS_PER_PHASE);
  });

  it("그 층까지는 정확하고 그 다음 층에서 넘는다", () => {
    const last = lastExactLocalFloor(SINGLE_MINION_BASE_HP);
    expect(exceedsExactRange(SINGLE_MINION_BASE_HP, last)).toBe(false);
    expect(exceedsExactRange(SINGLE_MINION_BASE_HP, last + 1)).toBe(true);
  });
});

describe("PHASES 표", () => {
  it("10칸이고 이름이 비어 있지 않다", () => {
    expect(PHASES).toHaveLength(PHASE_COUNT);
    for (const p of PHASES) expect(p.name.length).toBeGreaterThan(0);
  });

  it("표의 층 범위가 계산과 일치한다", () => {
    PHASES.forEach((p, i) => {
      expect(p.index).toBe(i);
      expect(p.firstFloor).toBe(firstFloorOf(i));
      expect(p.lastFloor).toBe(lastFloorOf(i));
    });
  });

  it("phaseInfoOf가 그 층이 속한 칸을 준다", () => {
    expect(phaseInfoOf(1).index).toBe(0);
    expect(phaseInfoOf(1000).index).toBe(0);
    expect(phaseInfoOf(1001).index).toBe(1);
    expect(phaseInfoOf(FINAL_FLOOR).index).toBe(9);
    // 범위 밖도 접힌다 (씬이 잘못된 층을 넘겨도 화면이 죽지 않는다)
    expect(phaseInfoOf(99_999).index).toBe(9);
  });
});
