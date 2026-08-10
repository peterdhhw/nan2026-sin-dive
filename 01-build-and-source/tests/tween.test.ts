import { expect, test } from "vitest";
import {
  Tween,
  approach,
  easeInCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  floatOffset,
  linear,
} from "../src/shared/tween";

const EASES = { linear, easeOutQuad, easeOutCubic, easeInCubic, easeInOutCubic };

test("every ease maps 0 to 0 and 1 to 1", () => {
  for (const [name, fn] of Object.entries(EASES)) {
    expect(fn(0), name).toBeCloseTo(0, 10);
    expect(fn(1), name).toBeCloseTo(1, 10);
  }
  // easeOutBack도 양 끝은 정확히 맞아야 한다 (중간에만 넘어간다)
  expect(easeOutBack(0)).toBeCloseTo(0, 10);
  expect(easeOutBack(1)).toBeCloseTo(1, 10);
});

test("every ease is monotonically non-decreasing", () => {
  for (const [name, fn] of Object.entries(EASES)) {
    let prev = fn(0);
    for (let i = 1; i <= 100; i++) {
      const v = fn(i / 100);
      expect(v, `${name} at ${i}`).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  }
});

test("eases clamp out-of-range and non-finite progress", () => {
  for (const [name, fn] of Object.entries(EASES)) {
    expect(fn(-1), name).toBeCloseTo(0, 10);
    expect(fn(2), name).toBeCloseTo(1, 10);
    expect(fn(Number.NaN), name).toBeCloseTo(0, 10);
  }
});

// easeOut 계열은 앞이 빠르다. 이게 뒤집히면 모션이 늘어져 보인다
test("easeOut curves are ahead of linear in the first half", () => {
  expect(easeOutQuad(0.25)).toBeGreaterThan(0.25);
  expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
  expect(easeInCubic(0.25)).toBeLessThan(0.25);
});

// 목표를 넘어가는 게 팝업 등장의 핵심이다 — 호출부에서 clamp하면 의미가 없다
test("easeOutBack overshoots past 1 before settling", () => {
  const peak = Math.max(...Array.from({ length: 99 }, (_, i) => easeOutBack((i + 1) / 100)));
  expect(peak).toBeGreaterThan(1);
});

test("tween interpolates from start to end and reports done", () => {
  const t = new Tween(0, 100, 200, linear);
  expect(t.value).toBeCloseTo(0, 6);
  expect(t.done).toBe(false);

  t.update(100);
  expect(t.value).toBeCloseTo(50, 6);

  t.update(100);
  expect(t.value).toBeCloseTo(100, 6);
  expect(t.done).toBe(true);
});

// 끝난 뒤에도 값이 흔들리면 UI가 미세하게 떨린다
test("tween holds its end value after finishing", () => {
  const t = new Tween(10, 20, 100, linear);
  t.update(500);
  expect(t.value).toBeCloseTo(20, 6);
  t.update(500);
  expect(t.value).toBeCloseTo(20, 6);
});

// 결과 화면의 순차 카운트업(설계 문서 08-1)이 지연을 쓴다
test("tween holds the start value through its delay", () => {
  const t = new Tween(0, 100, 100, linear, 200);
  t.update(150);
  expect(t.value).toBeCloseTo(0, 6);
  expect(t.done).toBe(false);
  t.update(100); // 250ms: 지연 200 + 진행 50
  expect(t.value).toBeCloseTo(50, 6);
  t.update(50);
  expect(t.done).toBe(true);
});

// 데미지 숫자 40개 링버퍼가 매번 새 객체를 만들지 않아야 한다
test("restart rewinds a tween for pooled reuse", () => {
  const t = new Tween(0, 1, 100, linear);
  t.update(100);
  expect(t.done).toBe(true);

  t.restart(5, 10, 50);
  expect(t.done).toBe(false);
  expect(t.value).toBeCloseTo(5, 6);
  t.update(25);
  expect(t.value).toBeCloseTo(7.5, 6);
});

test("finish jumps straight to the end", () => {
  const t = new Tween(0, 100, 1_000, linear);
  t.finish();
  expect(t.done).toBe(true);
  expect(t.value).toBeCloseTo(100, 6);
});

test("zero duration is immediately complete", () => {
  const t = new Tween(0, 100, 0, linear);
  expect(t.progress).toBe(1);
  expect(t.done).toBe(true);
  expect(t.value).toBeCloseTo(100, 6);
});

// 결정론: 같은 elapsedMs 순서면 같은 값이 나와야 스크린샷 회귀가 재현된다
test("tween is deterministic for the same update sequence", () => {
  const run = () => {
    const t = new Tween(0, 100, 300, easeOutCubic);
    const out: number[] = [];
    for (let i = 0; i < 20; i++) {
      t.update(16.67);
      out.push(t.value);
    }
    return out;
  };
  expect(run()).toEqual(run());
});

test("approach halves the remaining distance every half-life", () => {
  expect(approach(0, 100, 180, 180)).toBeCloseTo(50, 6);
  expect(approach(0, 100, 360, 180)).toBeCloseTo(75, 6);
});

// 프레임레이트에 독립적이어야 한다 — dt가 커도 목표를 지나치지 않는다
test("approach never overshoots for any dt", () => {
  for (const dt of [1, 16, 100, 1_000, 100_000]) {
    const v = approach(0, 100, dt, 180);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  }
});

test("approach with zero dt holds and with zero half-life snaps", () => {
  expect(approach(30, 100, 0, 180)).toBe(30);
  expect(approach(30, 100, 16, 0)).toBe(100);
});

test("float offset oscillates within its amplitude and repeats each period", () => {
  expect(floatOffset(0, 6, 3_200)).toBeCloseTo(0, 6);
  expect(floatOffset(800, 6, 3_200)).toBeCloseTo(6, 6);
  expect(floatOffset(2_400, 6, 3_200)).toBeCloseTo(-6, 6);
  expect(floatOffset(3_200, 6, 3_200)).toBeCloseTo(0, 6);

  for (let ms = 0; ms < 6_400; ms += 37) {
    expect(Math.abs(floatOffset(ms, 6, 3_200))).toBeLessThanOrEqual(6 + 1e-9);
  }
});

test("float offset phase shifts independent props apart", () => {
  expect(floatOffset(0, 6, 3_200, Math.PI / 2)).toBeCloseTo(6, 6);
  expect(floatOffset(0, 6, 0)).toBe(0);
});
