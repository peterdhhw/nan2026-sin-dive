import { expect, test } from "vitest";
import {
  BAR_H,
  DANGER_POS,
  FLASH_MS,
  STRIPE_MAX_SPEED,
  STRIPE_MIN_SPEED,
  STRIPE_PERIOD_PX,
  SURGE_COOLDOWN_MS,
  SURGE_MIN_DEALT,
  SURGE_MS,
  WIN_THRESHOLD,
  advanceStripe,
  fadeOut,
  fillSpan,
  glowStrength,
  isDanger,
  posToX,
  pushDiff,
  shouldSurge,
  stripeSpeed,
  surgePose,
  thresholdPulse,
  trackRect,
} from "../src/pvp/gaugeBarRules";
import { PresetLoadoutProvider } from "../src/loadout/preset";
import { GAUGE_BAR_H } from "../src/pvp/splitLayout";
import { DEFAULT_WIN_THRESHOLD, dpsToPush } from "../src/core/gauge";

// 두 값이 갈라지면 프레임이 트랙 밖으로 새거나 트랙이 잘린다
test("bar height matches the layout band exactly", () => {
  expect(BAR_H).toBe(GAUGE_BAR_H);
});

// 눈금과 실제 승패가 어긋나면 유저는 "다 밀었는데 안 이겼다"를 경험한다
test("the threshold tick uses the core win threshold", () => {
  expect(WIN_THRESHOLD).toBe(DEFAULT_WIN_THRESHOLD);
});

test("the danger pulse starts before the win threshold", () => {
  expect(DANGER_POS).toBeLessThan(WIN_THRESHOLD);
});

// 바가 "우리가 밀고 있다"고 그리는 동안 게이지가 반대로 가면 안 된다.
// 코어(applyPush)와 같은 sqrt 환산을 쓰는지 고정한다
test("pushDiff matches the core dps→push conversion", () => {
  expect(pushDiff(100, 25)).toBeCloseTo(dpsToPush(100) - dpsToPush(25));
  expect(pushDiff(25, 100)).toBeCloseTo(-(dpsToPush(100) - dpsToPush(25)));
  expect(pushDiff(50, 50)).toBe(0);
});

test("pushDiff treats negative and garbage dps as zero", () => {
  expect(pushDiff(-100, 0)).toBe(0);
  expect(pushDiff(Number.NaN, 0)).toBe(0);
  expect(pushDiff(0, Number.POSITIVE_INFINITY)).toBe(0);
});

test("stripe flows toward whoever is winning", () => {
  expect(stripeSpeed(5)).toBeGreaterThan(0);
  expect(stripeSpeed(-5)).toBeLessThan(0);
  expect(stripeSpeed(0)).toBe(0);
});

// 미세한 우위에서도 흐름이 보여야 "밀고 있다"가 읽힌다
test("even a tiny advantage produces a visible stripe speed", () => {
  expect(Math.abs(stripeSpeed(0.01))).toBe(STRIPE_MIN_SPEED);
});

// 상한이 없으면 스트로보처럼 보여서 오히려 정보가 죽는다
test("stripe speed is capped", () => {
  expect(Math.abs(stripeSpeed(9999))).toBe(STRIPE_MAX_SPEED);
  expect(Math.abs(stripeSpeed(-9999))).toBe(STRIPE_MAX_SPEED);
});

test("stripe offset wraps into one period and never goes negative", () => {
  let o = 0;
  for (let i = 0; i < 200; i++) {
    o = advanceStripe(o, -120, 16);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThan(STRIPE_PERIOD_PX);
  }
});

test("stripe offset advances proportionally to dt", () => {
  // 1초에 speed만큼 — 주기 안으로 접힌 값을 비교한다
  const a = advanceStripe(0, 10, 1000);
  expect(a).toBeCloseTo(10 % STRIPE_PERIOD_PX);
  expect(advanceStripe(5, 10, 0)).toBe(5);
});

test("stripe offset survives garbage input", () => {
  expect(advanceStripe(Number.NaN, 10, 16)).toBeGreaterThanOrEqual(0);
  expect(advanceStripe(0, Number.NaN, 16)).toBe(0);
  expect(advanceStripe(5, 10, -100)).toBe(5);
});

test("glow saturates at 1 and is direction-agnostic", () => {
  expect(glowStrength(0)).toBe(0);
  expect(glowStrength(9999)).toBe(1);
  expect(glowStrength(-9999)).toBe(1);
  expect(glowStrength(-5)).toBeCloseTo(glowStrength(5));
  expect(glowStrength(Number.NaN)).toBe(0);
});

test("the track sits inside the bar on every side", () => {
  const t = trackRect(720, BAR_H);
  expect(t.x).toBeGreaterThan(0);
  expect(t.y).toBeGreaterThan(0);
  expect(t.x + t.w).toBeLessThan(720);
  expect(t.y + t.h).toBeLessThan(BAR_H);
});

test("a degenerate bar size never produces a negative track", () => {
  const t = trackRect(4, 4);
  expect(t.w).toBe(0);
  expect(t.h).toBe(0);
});

// pos 0이 정확히 중앙이 아니면 "균형"이 균형으로 안 보인다
test("gauge zero maps to the exact track centre", () => {
  const t = trackRect(720, BAR_H);
  expect(posToX(0, t)).toBeCloseTo(t.x + t.w / 2);
  expect(posToX(1, t)).toBeCloseTo(t.x + t.w);
  expect(posToX(-1, t)).toBeCloseTo(t.x);
});

test("gauge positions outside -1..1 clamp to the track ends", () => {
  const t = trackRect(720, BAR_H);
  expect(posToX(5, t)).toBeCloseTo(t.x + t.w);
  expect(posToX(-5, t)).toBeCloseTo(t.x);
  expect(posToX(Number.NaN, t)).toBeCloseTo(t.x);
});

test("fill grows from the centre toward the leading side", () => {
  const t = trackRect(720, BAR_H);
  const centre = t.x + t.w / 2;

  const ours = fillSpan(0.5, t);
  expect(ours.ours).toBe(true);
  expect(ours.x).toBeCloseTo(centre);
  expect(ours.w).toBeCloseTo(t.w * 0.25);

  const theirs = fillSpan(-0.5, t);
  expect(theirs.ours).toBe(false);
  expect(theirs.x + theirs.w).toBeCloseTo(centre);
  expect(theirs.w).toBeCloseTo(t.w * 0.25);
});

test("a balanced gauge draws no fill at all", () => {
  const t = trackRect(720, BAR_H);
  expect(fillSpan(0, t).w).toBe(0);
});

// 채움이 마커를 지나치거나 못 미치면 두 요소가 다른 얘기를 하게 된다
test("the fill edge always lands exactly on the marker", () => {
  const t = trackRect(720, BAR_H);
  for (const p of [-1, -0.8, -0.3, 0.3, 0.8, 1]) {
    const span = fillSpan(p, t);
    const edge = p >= 0 ? span.x + span.w : span.x;
    expect(edge).toBeCloseTo(posToX(p, t));
  }
});

test("threshold pulse stays in 0..1 and oscillates", () => {
  let min = 1;
  let max = 0;
  for (let t = 0; t <= 2000; t += 13) {
    const v = thresholdPulse(t);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  expect(max - min).toBeGreaterThan(0.8);
});

test("danger only trips at or past the danger position", () => {
  expect(isDanger(DANGER_POS)).toBe(true);
  expect(isDanger(-DANGER_POS)).toBe(true);
  expect(isDanger(DANGER_POS - 0.01)).toBe(false);
  expect(isDanger(0)).toBe(false);
});

// -1은 "아직 시작 안 함" 센티넬이다. 여기서 1을 돌려주면 판 시작에 흰 화면이 뜬다
test("fadeOut is silent for the not-started sentinel", () => {
  expect(fadeOut(-1, FLASH_MS)).toBe(0);
  expect(fadeOut(0, FLASH_MS)).toBe(1);
  expect(fadeOut(FLASH_MS, FLASH_MS)).toBe(0);
  expect(fadeOut(FLASH_MS * 2, FLASH_MS)).toBe(0);
  expect(fadeOut(10, 0)).toBe(0);
});

/**
 * 파동은 `데미지 → 게이지` 인과를 잇는 유일한 시각 장치다 (README §3-2).
 *
 * **처치에만 주고 있었다.** 실측(시드 7, 60초): 처치 46회 / 20딜 넘는 타격 410회
 * — 큰 숫자가 뜨는 사건의 89%가 바 쪽에서 아무 반응도 얻지 못했다. 스킬 한 방이
 * 잡몹을 못 죽이면 화면에 700이 뜨는데 바는 조용하다.
 */
test("처치는 크기·간격과 무관하게 항상 파동을 준다", () => {
  expect(shouldSurge(1, true, 0)).toBe(true);
  expect(shouldSurge(0, true, 0)).toBe(true);
  // 마지막 한 방이 조용하면 안 된다 — 간격이 안 찼어도 준다
  expect(shouldSurge(1, true, 1)).toBe(true);
});

test("큰 타격은 처치가 아니어도 파동을 준다", () => {
  expect(shouldSurge(SURGE_MIN_DEALT, false, SURGE_COOLDOWN_MS)).toBe(true);
  expect(shouldSurge(SURGE_MIN_DEALT - 1, false, SURGE_COOLDOWN_MS)).toBe(false);
});

// 매 타격에 주면 파동이 상시 켜져 있어 정보가 사라진다 (처치 전용이었던 이유다)
test("간격이 안 차면 큰 타격도 건너뛴다", () => {
  expect(shouldSurge(9999, false, 0)).toBe(false);
  expect(shouldSurge(9999, false, SURGE_COOLDOWN_MS - 1)).toBe(false);
  expect(shouldSurge(9999, false, SURGE_COOLDOWN_MS)).toBe(true);
  // 센티넬(-1 = 아직 파동 없음)은 "충분히 지났다"로 읽는다
  expect(shouldSurge(9999, false, -1)).toBe(true);
  expect(shouldSurge(9999, false, Number.NaN)).toBe(true);
});

test("망가진 딜은 파동을 주지 않는다", () => {
  expect(shouldSurge(Number.NaN, false, 9999)).toBe(false);
  expect(shouldSurge(Number.POSITIVE_INFINITY, false, 9999)).toBe(false);
});

/**
 * 임계값이 두 사건을 갈라야 한다: 스킬은 반드시 넘고, 자동 공격 한 덩어리는
 * 넘지 않는다. 이 순서가 뒤집히면 파동이 상시 켜지거나 스킬이 조용해진다.
 */
test("임계값은 스킬과 자동 공격 사이에 있다", () => {
  const loadout = new PresetLoadoutProvider().load(2);
  const attacks = loadout.skills.filter((s) => s.kind === "attack");
  expect(attacks.length).toBeGreaterThan(0);
  for (const s of attacks) {
    expect(s.power, s.id).toBeGreaterThan(SURGE_MIN_DEALT);
  }
  // 자동 공격은 250ms(FLUSH_MS)에 묶여 뜬다 — 그 덩어리는 넘지 않아야 한다
  for (const c of loadout.characters) {
    const perFlush = (c.stats.attack / c.stats.attackIntervalMs) * 250;
    expect(perFlush, c.memberId).toBeLessThan(SURGE_MIN_DEALT);
  }
});

test("surge expands then fades and reports done", () => {
  const a = surgePose(0);
  expect(a.radius).toBe(0);
  expect(a.alpha).toBe(1);
  expect(a.done).toBe(false);

  const mid = surgePose(SURGE_MS * 0.5);
  expect(mid.radius).toBeGreaterThan(0);
  expect(mid.alpha).toBeLessThan(1);

  const end = surgePose(SURGE_MS);
  expect(end.alpha).toBe(0);
  expect(end.done).toBe(true);
});

test("surge radius is monotonic", () => {
  let prev = -1;
  for (let t = 0; t <= SURGE_MS; t += 8) {
    const r = surgePose(t).radius;
    expect(r).toBeGreaterThanOrEqual(prev);
    prev = r;
  }
});

test("surge is inert for the not-started sentinel", () => {
  expect(surgePose(-1)).toEqual({ radius: 0, alpha: 0, done: true });
});
