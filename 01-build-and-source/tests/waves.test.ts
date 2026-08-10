import { expect, test } from "vitest";
import {
  BOSS_EVERY,
  BOSS_HP_MULT,
  FLOOR_TARGET_MS,
  FLOOR_TIME_SPAN,
  HP_GROWTH_PER_WAVE,
  MINION_JITTER,
  TEAM_DPS_REF,
  WAVES_PER_MATCH,
  WAVE_BASE_TOTAL_HP,
  generateWaves,
  waveTotalHp,
} from "../src/core/waves";
import { ADV_TOTAL_MS } from "../src/shared/advanceRules";

const totalHpOf = (enemies: readonly { hp: number }[]): number =>
  enemies.reduce((a, e) => a + e.hp, 0);

test("same seed produces identical waves (AC-4)", () => {
  expect(generateWaves(1234, 10)).toEqual(generateWaves(1234, 10));
});

test("different seeds produce different waves", () => {
  expect(generateWaves(1, 10)).not.toEqual(generateWaves(2, 10));
});

test("returns exactly count waves with sequential indices", () => {
  const waves = generateWaves(7, 12);
  expect(waves).toHaveLength(12);
  expect(waves.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test("every BOSS_EVERY-th wave is a single boss", () => {
  const waves = generateWaves(7, 15);
  for (const w of waves) {
    const isBossWave = (w.index + 1) % BOSS_EVERY === 0;
    if (isBossWave) {
      expect(w.enemies).toHaveLength(1);
      expect(w.enemies[0]!.isBoss).toBe(true);
    } else {
      expect(w.enemies.every((e) => !e.isBoss)).toBe(true);
    }
  }
});

test("non-boss waves have 1..4 minions", () => {
  for (const w of generateWaves(99, 40)) {
    if ((w.index + 1) % BOSS_EVERY === 0) continue;
    expect(w.enemies.length).toBeGreaterThanOrEqual(1);
    expect(w.enemies.length).toBeLessThanOrEqual(4);
  }
});

test("hp scales up with wave depth", () => {
  const waves = generateWaves(5, 11);
  expect(totalHpOf(waves[10]!.enemies)).toBeGreaterThan(
    totalHpOf(waves[0]!.enemies),
  );
});

test("boss waves are heavier than the neighbouring minion floors", () => {
  const waves = generateWaves(5, 6);
  const boss = totalHpOf(waves[4]!.enemies);
  expect(boss).toBeGreaterThan(totalHpOf(waves[3]!.enemies));
  expect(boss).toBeGreaterThan(totalHpOf(waves[5]!.enemies));
});

test("enemy ids are unique across the whole run", () => {
  const ids = generateWaves(11, 20).flatMap((w) => w.enemies.map((e) => e.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test("count of 0 returns empty array", () => {
  expect(generateWaves(1, 0)).toEqual([]);
});

/**
 * ── 층 예산 모델 (2026-08-05)
 *
 * 이 아래가 `catchup`(층 건너뛰기)을 고친 근거다. 예전 식은 개체 HP에 마리
 * 수를 **곱해서** 같은 깊이의 층이 4배까지 벌어졌고, 그래서 1~4층이 0.1초에
 * 지나가며 전진 연출(1.2초)을 밀어냈다.
 */

test("층의 총 HP가 마리 수와 무관하다 — 예산을 나눈다 (곱하지 않는다)", () => {
  // 마리 수가 다른 층들을 모아 같은 깊이 대비 총량을 본다. 40층 × 여러 시드면
  // 1~4마리가 모두 나온다
  const counts = new Set<number>();
  for (const seed of [3, 7, 11, 42, 99]) {
    for (const w of generateWaves(seed, 40)) {
      if ((w.index + 1) % BOSS_EVERY === 0) continue;
      counts.add(w.enemies.length);
      // 예산 대비 오차는 개체별 반올림뿐 — 마리당 0.5 미만이다
      expect(
        Math.abs(totalHpOf(w.enemies) - waveTotalHp(w.index)),
      ).toBeLessThanOrEqual(w.enemies.length * 0.5);
    }
  }
  // 위 검사가 1마리 층만 보고 통과하면 의미가 없다
  expect([...counts].sort()).toEqual([1, 2, 3, 4]);
});

test("개체 편차는 살아 있다 — 총량만 고정이고 HP바 길이는 서로 다르다", () => {
  let sawUneven = false;
  for (const w of generateWaves(42, 40)) {
    if (w.enemies.length < 2) continue;
    const hps = w.enemies.map((e) => e.hp);
    if (new Set(hps).size > 1) sawUneven = true;
    // 편차 폭 안에 있다 — 균등 분배(전부 같은 값)도, 폭을 넘는 쏠림도 아니다
    const mean = totalHpOf(w.enemies) / w.enemies.length;
    for (const hp of hps) {
      expect(hp).toBeGreaterThanOrEqual(
        Math.floor((mean * (1 - MINION_JITTER)) / (1 + MINION_JITTER)),
      );
      expect(hp).toBeLessThanOrEqual(
        Math.ceil((mean * (1 + MINION_JITTER)) / (1 - MINION_JITTER)),
      );
    }
  }
  expect(sawUneven).toBe(true);
});

test("HP가 0인 적을 만들지 않는다 — 이미 죽은 슬롯이 된다", () => {
  for (const seed of [1, 2, 3, 7, 11, 42, 99]) {
    for (const w of generateWaves(seed, 40)) {
      for (const e of w.enemies) expect(e.hp).toBeGreaterThanOrEqual(1);
    }
  }
});

/**
 * **이것이 `catchup`을 막는 하한이다.**
 *
 * 층의 총 HP가 전진 연출 동안 낼 수 있는 최대 딜보다 작으면, 연출이 끝나기
 * 전에 다음 층이 넘어가 `session.tickAdvance`가 층을 건너뛴다. 실측 최대치는
 * 판 시작 직후 2,604딜(쿨다운 5개 동시 준비, 40시드)이다.
 *
 * 숫자를 손으로 적지 않고 상수에서 유도한다 — 딜이나 목표 시간을 만지면
 * 이 검사가 따라와야 한다.
 */
test("가장 얕은 층도 전진 연출보다 오래 걸린다 — catchup의 하한", () => {
  const shallowest = waveTotalHp(0);
  const burstCeiling = (ADV_TOTAL_MS / 1000) * TEAM_DPS_REF;
  expect(shallowest).toBeGreaterThan(burstCeiling);
  // 여유가 실제로 있는지도 본다 — 간신히 넘으면 시드 하나에 다시 터진다
  expect(shallowest / burstCeiling).toBeGreaterThan(2);
});

test("1층 예산이 목표 시간 × 기준 dps다", () => {
  expect(WAVE_BASE_TOTAL_HP).toBe(
    Math.round((FLOOR_TARGET_MS / 1000) * TEAM_DPS_REF),
  );
  expect(waveTotalHp(0)).toBe(WAVE_BASE_TOTAL_HP);
});

test("성장률이 층 시간 폭에서 유도된다 — 손으로 적은 값이 아니다", () => {
  expect(Math.pow(HP_GROWTH_PER_WAVE, WAVES_PER_MATCH - 1)).toBeCloseTo(
    FLOOR_TIME_SPAN,
    10,
  );
  // 마지막 층이 첫 층의 정확히 그 배수만큼 걸린다 (보스 배율 제외)
  const first = waveTotalHp(0);
  const last = WAVE_BASE_TOTAL_HP * Math.pow(HP_GROWTH_PER_WAVE, WAVES_PER_MATCH - 1);
  expect(last / first).toBeCloseTo(FLOOR_TIME_SPAN, 10);
});

test("깊이 성장이 완만하다 — 예전 1.12는 20층에서 5배였다", () => {
  // 층 시간이 폭발하지 않는다: 한 판 깊이 안에서 첫 층의 2배를 넘지 않는다
  expect(waveTotalHp(WAVES_PER_MATCH - 1) / waveTotalHp(0)).toBeLessThan(2);
  // 그래도 단조 증가다 — 깊이가 체감되지 않으면 하강의 의미가 없다
  for (let i = 1; i < 40; i++) {
    if ((i + 1) % BOSS_EVERY === 0 || i % BOSS_EVERY === 0) continue;
    expect(waveTotalHp(i)).toBeGreaterThan(waveTotalHp(i - 1));
  }
});

test("보스 층은 그 깊이 예산의 BOSS_HP_MULT배다", () => {
  const bossIndex = BOSS_EVERY - 1;
  const budget = WAVE_BASE_TOTAL_HP * Math.pow(HP_GROWTH_PER_WAVE, bossIndex);
  expect(waveTotalHp(bossIndex)).toBeCloseTo(budget * BOSS_HP_MULT, 6);
  // 앞 층의 3~5배였던 것이 문제였다 — 5층마다 페이스가 끊겼다
  expect(BOSS_HP_MULT).toBeLessThan(2);
  expect(BOSS_HP_MULT).toBeGreaterThan(1);
});

test("waveTotalHp는 망가진 인덱스를 접는다", () => {
  expect(waveTotalHp(-3)).toBe(waveTotalHp(0));
  expect(waveTotalHp(2.9)).toBe(waveTotalHp(2));
});

/**
 * **PvP에는 표시 HP 배율이 없다.** 싱글 1인은 `SOLO_HP_SCALE`을 `hp`에만 곱하고
 * 골드는 `goldHp`로 준다(`phaseWaves.generateFloorEnemies`). PvP는 2:2로 팀 크기가
 * 안 바뀌므로 깎을 이유가 없다 — 두 값이 같다는 이 한 줄이 그것을 코드에 남긴다.
 * `goldHp`를 옵셔널로 두면 이 사실이 `?? hp`에 숨는다.
 */
test("PvP는 배율이 없다 — goldHp가 hp와 같다", () => {
  for (const w of generateWaves(7, 20)) {
    for (const e of w.enemies) expect(e.goldHp, e.id).toBe(e.hp);
  }
});

