import { expect, test } from "vitest";
import {
  CRIT_SCALE,
  INTERFERENCE_DROP_PX,
  STAGGER_MAX,
  STAGGER_PX,
  LIFE_MS,
  MERGE_THRESHOLD,
  MERGE_THRESHOLD_THEIRS,
  POOL_SIZE,
  RISE_PX,
  isExpired,
  motionAt,
  nextSlot,
  shouldMerge,
  staggerOffset,
} from "../src/shared/ui/damageTextRules";

test("pool is 40 as specced", () => {
  // 양 필드 합쳐 초당 ~40개 (설계 문서 02-C6)
  expect(POOL_SIZE).toBe(40);
});

test("ring buffer wraps at the pool size", () => {
  expect(nextSlot(0)).toBe(1);
  expect(nextSlot(POOL_SIZE - 1)).toBe(0);
});

test("normal numbers rise and fade out", () => {
  const start = motionAt(0, "normal", 0);
  // -0이 나온다 (-RISE_PX × 0). 렌더에서는 0과 같으므로 부호는 보지 않는다
  expect(start.dy).toBeCloseTo(0);
  expect(start.alpha).toBe(1);

  const end = motionAt(LIFE_MS, "normal", 0);
  expect(end.dy).toBeCloseTo(-RISE_PX);
  expect(end.alpha).toBeCloseTo(0);
});

// 처음부터 흐려지면 읽을 시간이 없다 — 앞 60%는 완전 불투명
test("numbers stay fully opaque for the first 60% of their life", () => {
  expect(motionAt(LIFE_MS * 0.3, "normal", 0).alpha).toBe(1);
  expect(motionAt(LIFE_MS * 0.6, "normal", 0).alpha).toBe(1);
  expect(motionAt(LIFE_MS * 0.8, "normal", 0).alpha).toBeCloseTo(0.5);
});

// 방향이 곧 "누가 준 것인지"다. 방해 숫자는 반대로 내려가야 한다 (§C6)
test("interference numbers travel downward instead", () => {
  const end = motionAt(LIFE_MS, "interference", 0);
  expect(end.dy).toBeCloseTo(INTERFERENCE_DROP_PX);
  expect(end.dy).toBeGreaterThan(0);
});

test("crit pops above 1.0 then settles", () => {
  expect(motionAt(0, "crit", 0).scale).toBeCloseTo(1);
  expect(motionAt(LIFE_MS * 0.25, "crit", 0).scale).toBeCloseTo(CRIT_SCALE);
  expect(motionAt(LIFE_MS, "crit", 0).scale).toBeCloseTo(1);
});

test("crit scale never dips below 1", () => {
  for (let t = 0; t <= LIFE_MS; t += 8) {
    expect(motionAt(t, "crit", 0).scale).toBeGreaterThanOrEqual(1 - 1e-9);
  }
});

test("jitter is carried straight into dx", () => {
  expect(motionAt(0, "normal", 11).dx).toBe(11);
  expect(motionAt(LIFE_MS, "normal", -11).dx).toBe(-11);
});

test("motion clamps past its lifetime and on garbage input", () => {
  const past = motionAt(LIFE_MS * 5, "normal", 0);
  expect(past.dy).toBeCloseTo(-RISE_PX);
  expect(past.alpha).toBe(0);
  expect(motionAt(Number.NaN, "normal", 0).alpha).toBe(0);
});

test("expiry matches the lifetime exactly", () => {
  expect(isExpired(LIFE_MS - 1)).toBe(false);
  expect(isExpired(LIFE_MS)).toBe(true);
  expect(isExpired(Number.NaN)).toBe(true);
});

// 같은 자리에 3개까지 동시에 존재한다 (누적 250ms vs 수명 700ms).
// 지터만으로는 겹쳐서 한 덩어리로 읽혔다 — 첫 스크린샷에서 확인했다.
test("crowded numbers stack downward in steps", () => {
  // 위로 쌓으면 머리 위 HP바를 침범한다 (§C5) — 스크린샷에서 확인했다
  expect(staggerOffset(0)).toBeCloseTo(0);
  expect(staggerOffset(1)).toBe(STAGGER_PX);
  expect(staggerOffset(2)).toBe(STAGGER_PX * 2);
});

test("the stack stops growing so numbers never leave the screen", () => {
  const cap = STAGGER_PX * STAGGER_MAX;
  expect(staggerOffset(STAGGER_MAX)).toBe(cap);
  expect(staggerOffset(50)).toBe(cap);
});

test("staggerOffset shrugs off garbage counts", () => {
  expect(staggerOffset(-3)).toBeCloseTo(0);
  expect(staggerOffset(1.9)).toBe(STAGGER_PX);
});

// 상대 필드는 정보 밀도가 낮아도 되므로 더 이르게 합산한다 (§C6)
test("the opponent field merges sooner than ours", () => {
  expect(MERGE_THRESHOLD_THEIRS).toBeLessThan(MERGE_THRESHOLD);
  expect(shouldMerge(MERGE_THRESHOLD_THEIRS, false)).toBe(true);
  expect(shouldMerge(MERGE_THRESHOLD_THEIRS, true)).toBe(false);
  expect(shouldMerge(MERGE_THRESHOLD, true)).toBe(true);
  expect(shouldMerge(0, true)).toBe(false);
  expect(shouldMerge(0, false)).toBe(false);
});
