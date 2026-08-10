import { describe, expect, it } from "vitest";
import {
  CHAIN_BREAK_WARN_MS,
  CHAIN_WRAP_MS,
  DRAIN_PARTICLES,
  DRAIN_PARTICLE_MS,
  DRAIN_STAGGER_MS,
  DRAIN_TOTAL_MS,
  SLOW_MOTION_SCALE,
  SLOW_SATURATE_DROP,
  chainAlpha,
  chainStrain,
  drainParticleSpread,
  drainParticleT,
  interferenceEndNotice,
  slowSaturate,
} from "../src/pvp/interferenceRules";
import { SLOW_DAMAGE_MULT } from "../src/core/battle";

describe("감속 표현 (§9)", () => {
  it("모션 배율이 딜 배율과 같다 — 화면과 수치가 같은 이야기를 해야 한다", () => {
    expect(SLOW_MOTION_SCALE).toBe(SLOW_DAMAGE_MULT);
  });

  it("채도는 스펙대로 −20%", () => {
    expect(SLOW_SATURATE_DROP).toBeCloseTo(0.2, 10);
    expect(slowSaturate(true)).toBeCloseTo(0.8, 10);
    expect(slowSaturate(false)).toBe(1);
  });
});

describe("chainAlpha (§9)", () => {
  it("감속이 아니면 0", () => {
    expect(chainAlpha(0, false)).toBe(0);
    expect(chainAlpha(9_999, false)).toBe(0);
  });

  it("0에서 1까지 감긴다", () => {
    expect(chainAlpha(0, true)).toBe(0);
    expect(chainAlpha(CHAIN_WRAP_MS / 2, true)).toBeCloseTo(0.5, 10);
    expect(chainAlpha(CHAIN_WRAP_MS, true)).toBe(1);
    expect(chainAlpha(CHAIN_WRAP_MS * 10, true)).toBe(1);
  });

  it("이상한 입력은 0", () => {
    expect(chainAlpha(NaN, true)).toBe(0);
    expect(chainAlpha(-100, true)).toBe(0);
  });

  it("도착 즉시 꽉 감기지 않는다 — 무엇이 나타났는지 보여야 한다", () => {
    expect(CHAIN_WRAP_MS).toBeGreaterThan(100);
    expect(CHAIN_WRAP_MS).toBeLessThan(600);
  });
});

describe("chainStrain (§9 해제 임박)", () => {
  it("경고 구간 밖에서는 떨지 않는다", () => {
    expect(chainStrain(CHAIN_BREAK_WARN_MS)).toBe(0);
    expect(chainStrain(CHAIN_BREAK_WARN_MS + 1_000)).toBe(0);
  });

  it("끝에 가까워지면 커진다", () => {
    const half = chainStrain(CHAIN_BREAK_WARN_MS / 2);
    expect(half).toBeCloseTo(0.5, 10);
    expect(chainStrain(60)).toBeGreaterThan(half);
    expect(chainStrain(0)).toBe(0);
  });

  it("0..1 범위를 벗어나지 않는다", () => {
    for (const ms of [-100, 0, 1, 300, 600, 5_000, NaN]) {
      const s = chainStrain(ms);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("interferenceEndNotice (§9)", () => {
  it("종류별 해제 문구", () => {
    expect(interferenceEndNotice("slow")).toBe("감속 해제");
    expect(interferenceEndNotice("blind")).toBe("시야 회복");
  });

  it("모르는 종류도 빈 문자열이 되지 않는다", () => {
    expect(interferenceEndNotice("spawn_adds").length).toBeGreaterThan(0);
    expect(interferenceEndNotice("")).toBe("방해 해제");
  });
});

describe("게이지 탈취 입자 (§9)", () => {
  it("스태거 때문에 마지막 입자가 입자 수명보다 늦게 도착한다", () => {
    expect(DRAIN_TOTAL_MS).toBeGreaterThan(DRAIN_PARTICLE_MS);
    expect(DRAIN_TOTAL_MS).toBe(
      DRAIN_PARTICLE_MS + (DRAIN_PARTICLES - 1) * DRAIN_STAGGER_MS,
    );
  });

  it("연출이 끝나는 시각에 모든 입자가 도착해 있다", () => {
    for (let i = 0; i < DRAIN_PARTICLES; i++) {
      expect(drainParticleT(DRAIN_TOTAL_MS, i)).toBe(1);
    }
  });

  it("시작 시점에는 0번 입자만 막 출발한다", () => {
    expect(drainParticleT(0, 0)).toBe(0);
    expect(drainParticleT(1, 0)).toBeGreaterThan(0);
    // 뒷 입자는 아직 출발하지 않았다 — 한꺼번에 나가면 한 덩어리로 보인다
    expect(drainParticleT(1, 5)).toBe(0);
  });

  it("진행률은 0..1로 잠긴다", () => {
    for (let i = 0; i < DRAIN_PARTICLES; i++) {
      for (const ms of [-50, 0, 100, 400, 900, NaN]) {
        const t = drainParticleT(ms, i);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it("입자가 위아래로 갈라진다 — 일직선이면 굵은 선 하나로 보인다", () => {
    const spreads = Array.from({ length: DRAIN_PARTICLES }, (_, i) =>
      drainParticleSpread(i),
    );
    expect(spreads.some((s) => s > 0)).toBe(true);
    expect(spreads.some((s) => s < 0)).toBe(true);
    for (const s of spreads) expect(Math.abs(s)).toBeLessThanOrEqual(20);
  });
});
