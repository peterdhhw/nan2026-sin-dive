import { expect, test } from "vitest";
import {
  BEAM_FADE_MS,
  BEAM_MS,
  BEAM_TAIL_RATIO,
  beamPoint,
  beamPose,
  castBeamShown,
} from "../src/shared/ui/castBeamRules";
import { PRESET_SKILLS } from "../src/loadout/preset";
import { skillMelee } from "../src/shared/skillMeleeRules";

test("the beam starts at the slot and ends at the target", () => {
  const a = beamPose(0);
  expect(a.from).toBe(0);
  expect(a.to).toBe(0);
  expect(a.alpha).toBe(1);
  expect(a.done).toBe(false);

  // 설계 문서 §7의 180ms에 목표에 닿는다
  const arrive = beamPose(BEAM_MS);
  expect(arrive.to).toBe(1);
  expect(arrive.done).toBe(false);
});

test("the head never overshoots or reverses", () => {
  let prev = 0;
  for (let t = 0; t <= BEAM_MS; t += 4) {
    const p = beamPose(t);
    expect(p.to).toBeGreaterThanOrEqual(prev);
    expect(p.to).toBeLessThanOrEqual(1);
    prev = p.to;
  }
});

test("the tail always trails the head", () => {
  for (let t = 0; t <= BEAM_MS + BEAM_FADE_MS; t += 5) {
    const p = beamPose(t);
    expect(p.from).toBeLessThanOrEqual(p.to);
  }
});

test("the tail is absorbed into the head during the fade", () => {
  const mid = beamPose(BEAM_MS + BEAM_FADE_MS * 0.5);
  expect(mid.to).toBe(1);
  expect(mid.from).toBeGreaterThan(1 - BEAM_TAIL_RATIO);
  expect(mid.from).toBeLessThan(1);
  expect(mid.alpha).toBeLessThan(1);
  expect(mid.alpha).toBeGreaterThan(0);
});

test("the beam reports done exactly once its whole life is over", () => {
  expect(beamPose(BEAM_MS + BEAM_FADE_MS - 1).done).toBe(false);
  expect(beamPose(BEAM_MS + BEAM_FADE_MS).done).toBe(true);
  expect(beamPose(99999).done).toBe(true);
});

// -1은 "아직 시작 안 함" 센티넬이다 — 살아있다고 보고하면 풀이 새어나간다
test("a negative elapsed is inert, not a live beam", () => {
  const p = beamPose(-1);
  expect(p.alpha).toBe(0);
  expect(p.done).toBe(true);
});

test("the curve passes exactly through both endpoints", () => {
  const a = { x: 100, y: 1100 };
  const b = { x: 500, y: 400 };
  expect(beamPoint(a, b, 0, 1)).toEqual(a);
  const end = beamPoint(a, b, 1, 1);
  expect(end.x).toBeCloseTo(b.x);
  expect(end.y).toBeCloseTo(b.y);
});

// 직선이면 UI 요소처럼 보인다 — 실제로 휘는지 확인한다
test("the midpoint bows off the straight line", () => {
  const a = { x: 100, y: 1100 };
  const b = { x: 500, y: 400 };
  const mid = beamPoint(a, b, 0.5, 1);
  const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  expect(Math.hypot(mid.x - straight.x, mid.y - straight.y)).toBeGreaterThan(
    20,
  );
});

// 슬롯마다 방향을 갈라 놓으므로 부호가 실제로 반대편으로 휘어야 한다
test("the bow sign mirrors the curve across the straight line", () => {
  const a = { x: 100, y: 1100 };
  const b = { x: 500, y: 400 };
  const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const pos = beamPoint(a, b, 0.5, 1);
  const neg = beamPoint(a, b, 0.5, -1);
  expect(pos.x - straight.x).toBeCloseTo(-(neg.x - straight.x));
  expect(pos.y - straight.y).toBeCloseTo(-(neg.y - straight.y));
});

test("a zero-length beam degenerates without NaN", () => {
  const a = { x: 300, y: 300 };
  const p = beamPoint(a, a, 0.5, 1);
  expect(p.x).toBe(300);
  expect(p.y).toBe(300);
});

test("out-of-range t clamps instead of extrapolating", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  expect(beamPoint(a, b, -5, 1)).toEqual(beamPoint(a, b, 0, 1));
  expect(beamPoint(a, b, 5, 1)).toEqual(beamPoint(a, b, 1, 1));
  expect(beamPoint(a, b, Number.NaN, 1)).toEqual(beamPoint(a, b, 0, 1));
});

/**
 * 공격은 아군이 달려가 때리는 것이 인과다(`skillMeleeRules`). 광선을 같이
 * 그리면 버튼에서 먼저 뭔가 날아가 적을 맞히고 그 다음에 캐릭터가 달려가는
 * 그림이 된다 — 한 번 누른 것이 두 번 때린 것으로 보인다.
 */
test("공격 스킬에는 광선이 없다 — 캐릭터가 직접 간다", () => {
  expect(castBeamShown("attack")).toBe(false);
});

/**
 * 방해·버프는 캐릭터를 움직이지 않는다. 광선까지 빼면 눌렀다는 증거가
 * 화면에서 사라진다 — 특히 방해는 **상대 필드**에 작용해서 내 캐릭터가
 * 대신 보여줄 방법이 없다.
 */
test("돌진하지 않는 스킬은 광선을 유지한다 — 아니면 누른 증거가 없다", () => {
  expect(castBeamShown("interference")).toBe(true);
  expect(castBeamShown("buff")).toBe(true);
});

/**
 * 두 모듈이 같은 갈림을 서로 모르게 정의한다. 어긋나면 광선도 없고 돌진도
 * 없는 스킬(누른 것이 화면에 전혀 안 남음)이나, 광선과 돌진이 동시에 나는
 * 스킬(두 번 때림)이 조용히 생긴다.
 */
test("광선과 돌진 연출이 정확히 상보다 — 어느 스킬도 둘 다거나 둘 다 아니지 않다", () => {
  for (const s of PRESET_SKILLS) {
    expect(castBeamShown(s.kind), s.id).toBe(skillMelee(s.id) === null);
  }
});

test("모르는 종류는 광선을 준다 — 새 스킬이 아무 연출 없이 나가는 것보다 낫다", () => {
  expect(castBeamShown("wat")).toBe(true);
  expect(castBeamShown("")).toBe(true);
});
