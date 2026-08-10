import { expect, test } from "vitest";
import { createWaveRunner } from "../src/core/waveRunner";
import { generateWaves } from "../src/core/waves";
import type { WaveDef } from "../src/core/types";

const wave = (index: number, hps: number[]): WaveDef => ({
  index,
  // 러너는 골드를 안 준다 — 픽스처는 배율 없는 세계(`goldHp === hp`)다
  enemies: hps.map((hp, i) => ({
    id: `w${index}-m${i}`,
    isBoss: false,
    hp,
    goldHp: hp,
  })),
});

test("throws on an empty wave list", () => {
  expect(() => createWaveRunner([])).toThrow();
});

test("starts on wave 0 with full hp", () => {
  const r = createWaveRunner([wave(0, [100, 100])]);
  expect(r.state.waveIndex).toBe(0);
  expect(r.state.enemyHp).toEqual([100, 100]);
  expect(r.state.killCount).toBe(0);
});

test("damage goes to the frontmost living enemy only", () => {
  const r = createWaveRunner([wave(0, [100, 100])]);
  const hits = r.applyDamage(40);
  expect(hits).toEqual([
    { enemyIndex: 0, killed: false, dealt: 40, hpRatio: 0.6 },
  ]);
  expect(r.state.enemyHp).toEqual([60, 100]);
});

test("overkill spills onto the next enemy in the same tick", () => {
  const r = createWaveRunner([wave(0, [100, 100])]);
  const hits = r.applyDamage(150);
  expect(hits).toEqual([
    { enemyIndex: 0, killed: true, dealt: 100, hpRatio: 0 },
    { enemyIndex: 1, killed: false, dealt: 50, hpRatio: 0.5 },
  ]);
  expect(r.state.enemyHp).toEqual([0, 50]);
  expect(r.state.killCount).toBe(1);
});

// 데미지 숫자는 요청 딜이 아니라 실제로 들어간 딜을 찍는다 —
// 10 남은 적에게 9999를 넣고 "9999"가 뜨면 숫자가 거짓말을 한다 (설계 문서 07-4-4)
test("dealt is clamped to the remaining hp, never the requested damage", () => {
  const r = createWaveRunner([wave(0, [10]), wave(1, [10])]);
  const hits = r.applyDamage(9999);
  expect(hits).toEqual([{ enemyIndex: 0, killed: true, dealt: 10, hpRatio: 0 }]);
});

// hpRatio는 웨이브 시작 시점의 최대 HP 기준이다. 웨이브가 넘어가면 새 기준으로 리셋된다
test("hpRatio is measured against the wave's own starting hp", () => {
  const r = createWaveRunner([wave(0, [100]), wave(1, [400])]);
  r.applyDamage(100);
  const hits = r.applyDamage(100);
  expect(hits).toEqual([
    { enemyIndex: 0, killed: false, dealt: 100, hpRatio: 0.75 },
  ]);
});

test("clearing a wave advances to the next one with fresh hp", () => {
  const r = createWaveRunner([wave(0, [100]), wave(1, [300])]);
  r.applyDamage(100);
  expect(r.state.waveIndex).toBe(1);
  expect(r.state.enemyHp).toEqual([300]);
  expect(r.currentWave.index).toBe(1);
});

test("damage never crosses a wave boundary in one tick", () => {
  // 웨이브 경계에서 딜이 새면 순간에 여러 웨이브가 날아가 연출이 따라가지 못한다
  const r = createWaveRunner([wave(0, [100]), wave(1, [10])]);
  r.applyDamage(100_000);
  expect(r.state.waveIndex).toBe(1);
  expect(r.state.enemyHp).toEqual([10]);
});

test("running out of waves loops the final wave and counts the loop", () => {
  const r = createWaveRunner([wave(0, [100])]);
  r.applyDamage(100);
  expect(r.state.waveIndex).toBe(0);
  expect(r.state.loops).toBe(1);
  expect(r.state.enemyHp).toEqual([100]);
});

test("zero or negative damage changes nothing", () => {
  const r = createWaveRunner([wave(0, [100])]);
  expect(r.applyDamage(0)).toEqual([]);
  expect(r.applyDamage(-5)).toEqual([]);
  expect(r.state.enemyHp).toEqual([100]);
});

test("both teams on the same seed clear waves in the same order", () => {
  const waves = generateWaves(777, 6);
  const a = createWaveRunner(waves);
  const b = createWaveRunner(waves);
  for (let i = 0; i < 40; i++) {
    a.applyDamage(137);
    b.applyDamage(137);
  }
  expect(a.state).toEqual(b.state);
});

// 디버그 진입(`?wave=3`)으로 심연 테마를 스크린샷 검증할 수 있어야 한다 (설계 문서 09-3)
test("a start wave index is honoured and clamped", () => {
  const waves = [wave(0, [10]), wave(1, [20]), wave(2, [30])];
  expect(createWaveRunner(waves, 2).currentWave).toBe(waves[2]);
  expect(createWaveRunner(waves, 2).state.waveIndex).toBe(2);
  // 범위 밖은 접는다 — 마지막 웨이브보다 뒤를 요구하면 마지막을 준다
  expect(createWaveRunner(waves, 99).state.waveIndex).toBe(2);
  expect(createWaveRunner(waves, -5).state.waveIndex).toBe(0);
  expect(createWaveRunner(waves, 1.9).state.waveIndex).toBe(1);
  expect(createWaveRunner(waves, Number.NaN).state.waveIndex).toBe(0);
});

// 시작 웨이브의 HP도 그 웨이브 기준이어야 한다 — 0번 웨이브 HP가 남으면
// HP바가 첫 타격에 엉뚱한 비율로 튄다
test("a start wave loads its own enemy hp, not wave 0's", () => {
  const waves = [wave(0, [10]), wave(1, [200])];
  const r = createWaveRunner(waves, 1);
  expect(r.state.enemyHp).toEqual([200]);
  expect(r.applyDamage(50)[0]!.hpRatio).toBeCloseTo(0.75);
});

// ── 상/하 필드 층 동기 (설계 문서 07-8 "공용 웨이브이므로 동기")

test("autoAdvance: false인 러너는 무리를 다 쓸어도 층을 안 넘긴다", () => {
  const waves = [wave(0, [10]), wave(1, [999])];
  const r = createWaveRunner(waves, 0, { autoAdvance: false });
  r.applyDamage(500);
  expect(r.state.waveIndex).toBe(0);
  expect(r.state.enemyHp).toEqual([0]);
  // 쓸어낸 것 자체는 세어야 한다 — 층만 안 넘어간다
  expect(r.state.killCount).toBe(1);
  // 다 죽은 층에 더 때려도 아무 일이 없다 (버려진다)
  expect(r.applyDamage(500)).toEqual([]);
  expect(r.state.waveIndex).toBe(0);
});

test("기본 러너는 그대로 스스로 넘긴다 — 옵션이 기존 동작을 안 바꾼다", () => {
  const waves = [wave(0, [10]), wave(1, [999])];
  expect(createWaveRunner(waves, 0).applyDamage(500).length).toBe(1);
  expect(createWaveRunner(waves, 0, {}).state.waveIndex).toBe(0);
  const r = createWaveRunner(waves, 0, {});
  r.applyDamage(500);
  expect(r.state.waveIndex).toBe(1);
});

test("syncTo가 그 층의 만피로 다시 깐다", () => {
  const waves = [wave(0, [10]), wave(1, [200]), wave(2, [30])];
  const r = createWaveRunner(waves, 0, { autoAdvance: false });
  r.applyDamage(4);
  r.syncTo(1);
  expect(r.state.waveIndex).toBe(1);
  expect(r.state.enemyHp).toEqual([200]);
  // 범위 밖·망가진 값은 접는다 (러너 생성과 같은 규칙)
  r.syncTo(99);
  expect(r.state.waveIndex).toBe(2);
  r.syncTo(-3);
  expect(r.state.waveIndex).toBe(0);
  r.syncTo(Number.NaN);
  expect(r.state.waveIndex).toBe(0);
});

test("같은 인덱스로 syncTo하면 HP가 다시 깔린다 — 마지막 층 반복이 이 경로다", () => {
  const waves = [wave(0, [100])];
  const r = createWaveRunner(waves, 0, { autoAdvance: false });
  r.applyDamage(60);
  expect(r.state.enemyHp).toEqual([40]);
  r.syncTo(0, 1);
  expect(r.state.enemyHp).toEqual([100]);
  expect(r.state.loops).toBe(1);
  // 처치 수는 층을 맞추는 것과 무관하다 — 실제로 쓰러뜨린 수다
  expect(r.state.killCount).toBe(0);
});

test("따라가는 러너를 매 층 맞추면 두 필드가 같은 층을 본다", () => {
  const waves = generateWaves(555, 8);
  const lead = createWaveRunner(waves);
  const follow = createWaveRunner(waves, 0, { autoAdvance: false });
  for (let i = 0; i < 200; i++) {
    lead.applyDamage(200);
    // 따라가는 쪽은 두 배로 빠르게 때린다 — 그래도 층이 벌어져선 안 된다
    follow.applyDamage(400);
    follow.syncTo(lead.state.waveIndex, lead.state.loops);
    expect(follow.state.waveIndex).toBe(lead.state.waveIndex);
    expect(follow.currentWave).toBe(lead.currentWave);
  }
});
