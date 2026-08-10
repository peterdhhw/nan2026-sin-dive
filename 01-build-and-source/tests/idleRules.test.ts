import { describe, expect, it } from "vitest";
import {
  IDLE_CAP_MS,
  IDLE_FARM_KILL_MS,
  IDLE_FLOOR_MS,
  IDLE_GOLD_EFFICIENCY,
  IDLE_KILLS_PER_FLOOR,
  IDLE_MAX_FLOORS,
  IDLE_MIN_MS,
  computeIdleReward,
  nextNamedBossFloor,
} from "../src/single/idleRules";
import { minionHpAtFloor } from "../src/core/phase/phaseWaves";
import { goldForKill, emptyLevels } from "../src/single/economyRules";
import { FINAL_FLOOR } from "../src/core/phase/floors";

const T0 = 1_754_200_000_000; // 임의의 기준 epoch ms — 테스트는 절대 시각을 모른다

describe("nextNamedBossFloor", () => {
  it("다음 100의 배수 층이다 (100의 배수에서는 그 다음 것)", () => {
    expect(nextNamedBossFloor(1)).toBe(100);
    expect(nextNamedBossFloor(99)).toBe(100);
    expect(nextNamedBossFloor(100)).toBe(200);
    expect(nextNamedBossFloor(101)).toBe(200);
  });

  it("9,999층을 넘지 않는다", () => {
    expect(nextNamedBossFloor(FINAL_FLOOR)).toBe(FINAL_FLOOR);
  });
});

describe("computeIdleReward — 문지방", () => {
  it("lastTickMs가 없으면(첫 방문·기록 실패) 보상 없음", () => {
    expect(
      computeIdleReward({ nowMs: T0, lastTickMs: null, floor: 50, upgrades: emptyLevels() }),
    ).toBeNull();
  });

  it("1분 미만 부재는 보상 없음 (새로고침 긁기 방지)", () => {
    expect(
      computeIdleReward({
        nowMs: T0 + IDLE_MIN_MS - 1,
        lastTickMs: T0,
        floor: 50,
        upgrades: emptyLevels(),
      }),
    ).toBeNull();
  });

  it("시계가 거꾸로 가도(now < last) 죽지 않고 보상 없음", () => {
    expect(
      computeIdleReward({ nowMs: T0 - 1000, lastTickMs: T0, floor: 50, upgrades: emptyLevels() }),
    ).toBeNull();
  });
});

describe("computeIdleReward — 하강과 골드", () => {
  it("2분에 1층 내려간다", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_FLOOR_MS * 5,
      lastTickMs: T0,
      floor: 21,
      upgrades: emptyLevels(),
    });
    expect(r).not.toBeNull();
    expect(r?.fromFloor).toBe(21);
    expect(r?.toFloor).toBe(26);
  });

  it("부재가 아무리 길어도 캡(8시간·120층)에서 멈춘다", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_CAP_MS * 10,
      lastTickMs: T0,
      floor: 101,
      upgrades: emptyLevels(),
    });
    expect(r?.elapsedMs).toBe(IDLE_CAP_MS);
    // 8시간 / 2분 = 240층이지만 층 캡 120이 먼저 걸린다 — 단 보스 벽이 더 먼저다
    expect(r?.toFloor).toBe(199); // 101 → 다음 보스 200 직전
  });

  it("네임드 보스(100층 단위) 앞에서 멈춘다 — 보스는 직접 싸운다", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_FLOOR_MS * 50,
      lastTickMs: T0,
      floor: 95,
      upgrades: emptyLevels(),
    });
    expect(r?.toFloor).toBe(99);
  });

  /**
   * 클리어한 층은 {from..to-1}이다 — 저장된 floor는 "재개 시 다시 싸울 층"이라
   * 착지 층(to)은 재개 후 실전에서 골드를 받는다. to까지 세면 이중 지급된다
   * (2026-08-03 리뷰에서 확정된 실결함을 고정).
   */
  it("전진 골드 = 클리어한 층({from..to-1})의 기대 처치 × 효율 60%", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_FLOOR_MS * 2,
      lastTickMs: T0,
      floor: 11,
      upgrades: emptyLevels(),
    });
    expect(r?.toFloor).toBe(13);
    const expected =
      (IDLE_KILLS_PER_FLOOR * goldForKill(minionHpAtFloor(11), emptyLevels()) +
        IDLE_KILLS_PER_FLOOR * goldForKill(minionHpAtFloor(12), emptyLevels())) *
      IDLE_GOLD_EFFICIENCY;
    expect(r?.gold).toBe(Math.round(expected));
  });

  /** 저장 floor가 미격파 네임드 보스 층이면 방치가 그 보스를 건너뛰면 안 된다 */
  it("보스 층에서 저장하고 나가면 방치는 제자리 파밍이다 (보스 스킵 금지)", () => {
    const elapsed = IDLE_FLOOR_MS * 10;
    const r = computeIdleReward({
      nowMs: T0 + elapsed,
      lastTickMs: T0,
      floor: 100,
      upgrades: emptyLevels(),
    });
    expect(r?.toFloor).toBe(100);
    expect(r?.gold).toBeGreaterThan(0); // 빈손은 아니다 — 제자리 파밍
  });

  it("보스 벽 바로 앞(전진 0층)에서는 제자리 파밍 골드를 준다", () => {
    const elapsed = IDLE_FLOOR_MS * 3;
    const r = computeIdleReward({
      nowMs: T0 + elapsed,
      lastTickMs: T0,
      floor: 99,
      upgrades: emptyLevels(),
    });
    expect(r?.toFloor).toBe(99);
    const kills = Math.floor(elapsed / IDLE_FARM_KILL_MS);
    expect(r?.gold).toBe(
      Math.round(kills * goldForKill(minionHpAtFloor(99), emptyLevels()) * IDLE_GOLD_EFFICIENCY),
    );
    expect(r?.gold).toBeGreaterThan(0);
  });

  it("최종층(9,999)에서도 죽지 않고 제자리 파밍이다", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_FLOOR_MS * 10,
      lastTickMs: T0,
      floor: FINAL_FLOOR,
      upgrades: emptyLevels(),
    });
    expect(r?.toFloor).toBe(FINAL_FLOOR);
    expect(r?.gold).toBeGreaterThan(0);
  });

  it("같은 입력이면 같은 보상이다 (결정론 — Date.now를 모른다)", () => {
    const opts = {
      nowMs: T0 + IDLE_FLOOR_MS * 7,
      lastTickMs: T0,
      floor: 42,
      upgrades: emptyLevels(),
    };
    expect(computeIdleReward(opts)).toEqual(computeIdleReward(opts));
  });

  it("IDLE_MAX_FLOORS 캡이 보스 벽보다 가까우면 캡에서 멈춘다", () => {
    const r = computeIdleReward({
      nowMs: T0 + IDLE_CAP_MS,
      lastTickMs: T0,
      floor: 501,
      upgrades: emptyLevels(),
    });
    // 501 → 보스 벽 599, 층 캡 501+120=621 → 벽이 먼저
    expect(r?.toFloor).toBe(599);

    const r2 = computeIdleReward({
      nowMs: T0 + IDLE_CAP_MS,
      lastTickMs: T0,
      floor: 401,
      upgrades: emptyLevels(),
    });
    // 401 → 보스 벽 499, 층 캡 521 — 벽 499가 먼저다
    expect(r2?.toFloor).toBe(499);
    expect(IDLE_MAX_FLOORS).toBe(120);
  });
});
