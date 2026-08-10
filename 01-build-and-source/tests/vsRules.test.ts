import { describe, expect, it } from "vitest";
import {
  THEIRS_TINT_MIX,
  VS_CELL_GAP,
  VS_FLOOR_AT_MS,
  VS_NAMES_FROM_MS,
  VS_NAMES_TO_MS,
  VS_PANEL_ALPHA,
  VS_PILL_W,
  VS_POSE_AT_MS,
  VS_SLIDE_MS,
  VS_STAMP_AT_MS,
  VS_STRIPE_ALPHA,
  VS_TOTAL_MS,
  VS_WIPE_AT_MS,
  VS_WIPE_MS,
  fadeBetween,
  floorAlpha,
  namesAlpha,
  posesNow,
  screenShake,
  showsWaitRing,
  slideOffset,
  stampFlash,
  stampScale,
  vsHolds,
  wipeGate,
  wipeProgress,
} from "../src/pvp/vsRules";

describe("slideOffset", () => {
  it("화면 밖에서 시작해 제자리에 멈춘다", () => {
    expect(slideOffset(0)).toBe(1);
    expect(slideOffset(VS_SLIDE_MS)).toBe(0);
    expect(slideOffset(VS_SLIDE_MS + 400)).toBe(0);
  });

  it("easeOutBack이라 중간에 살짝 넘어간다 (오버슈트)", () => {
    const offsets: number[] = [];
    for (let t = 0; t <= VS_SLIDE_MS; t += 10) offsets.push(slideOffset(t));
    expect(Math.min(...offsets)).toBeLessThan(0);
  });

  it("음수·NaN은 시작 위치로 본다", () => {
    expect(slideOffset(-10)).toBe(1);
    expect(slideOffset(NaN)).toBe(1);
  });
});

describe("stampScale", () => {
  it("260ms에 찍히기 전에는 보이지 않는다 (§06-1)", () => {
    expect(stampScale(0)).toBe(0);
    expect(stampScale(VS_STAMP_AT_MS - 1)).toBe(0);
  });

  it("2.2에서 1.0으로 줄어든다", () => {
    expect(stampScale(VS_STAMP_AT_MS)).toBeCloseTo(2.2, 5);
    expect(stampScale(VS_STAMP_AT_MS + 300)).toBe(1);
    expect(stampScale(VS_TOTAL_MS)).toBe(1);
  });

  it("플래시·흔들림은 스탬프와 같은 프레임에 시작한다", () => {
    expect(stampFlash(VS_STAMP_AT_MS - 1)).toBe(0);
    expect(stampFlash(VS_STAMP_AT_MS)).toBe(1);
    expect(screenShake(VS_STAMP_AT_MS - 1)).toBe(0);
    // 흔들림은 감쇠해서 끝난다
    expect(screenShake(VS_STAMP_AT_MS + 300)).toBe(0);
  });
});

describe("fadeBetween", () => {
  it("구간 밖에서 0과 1로 고정된다", () => {
    expect(fadeBetween(0, 100, 200)).toBe(0);
    expect(fadeBetween(150, 100, 200)).toBeCloseTo(0.5, 5);
    expect(fadeBetween(999, 100, 200)).toBe(1);
  });

  it("길이가 0인 구간도 나누기 오류를 내지 않는다", () => {
    expect(fadeBetween(50, 100, 100)).toBe(0);
    expect(fadeBetween(100, 100, 100)).toBe(1);
  });

  it("이름은 스탬프와 함께, 층 라벨은 900ms에 뜬다 (§06-1)", () => {
    expect(namesAlpha(VS_NAMES_FROM_MS - 1)).toBe(0);
    expect(namesAlpha(VS_NAMES_FROM_MS + 320)).toBe(1);
    expect(floorAlpha(VS_FLOOR_AT_MS - 1)).toBe(0);
    expect(floorAlpha(VS_FLOOR_AT_MS + 240)).toBe(1);
    // 이름이 층보다 먼저 다 올라와 있어야 순서대로 읽힌다
    expect(namesAlpha(VS_FLOOR_AT_MS)).toBe(1);
  });
});

describe("wipeGate", () => {
  it("세션이 준비되기 전에는 커튼을 열지 않는다 (§06-5)", () => {
    expect(wipeGate(VS_WIPE_AT_MS, false)).toBe(false);
    expect(wipeGate(VS_WIPE_AT_MS + 5_000, false)).toBe(false);
    expect(wipeGate(VS_WIPE_AT_MS, true)).toBe(true);
  });

  it("준비가 끝났어도 1200ms 전에는 열지 않는다", () => {
    expect(wipeGate(VS_WIPE_AT_MS - 1, true)).toBe(false);
  });

  it("준비가 늦으면 대기 링을 돈다", () => {
    expect(showsWaitRing(VS_WIPE_AT_MS - 1, false)).toBe(false);
    expect(showsWaitRing(VS_WIPE_AT_MS, false)).toBe(true);
    expect(showsWaitRing(VS_WIPE_AT_MS, true)).toBe(false);
  });
});

describe("wipeProgress / vsHolds", () => {
  it("와이프 경과로만 진행한다 — 전체 경과와 분리돼 있다", () => {
    expect(wipeProgress(0)).toBe(0);
    expect(wipeProgress(VS_WIPE_MS)).toBe(1);
    expect(wipeProgress(VS_WIPE_MS + 999)).toBe(1);
  });

  it("와이프가 끝날 때까지 씬을 유지한다", () => {
    expect(vsHolds(0, 0)).toBe(true);
    expect(vsHolds(VS_TOTAL_MS, 0)).toBe(true);
    expect(vsHolds(VS_TOTAL_MS, VS_WIPE_MS)).toBe(false);
  });

  it("준비가 3초 늦어도 커튼이 다 열린 뒤에 넘긴다 (빈 전장 방지)", () => {
    // 4.2초가 지났지만 와이프는 아직 200ms만 흘렀다 → 유지
    expect(vsHolds(4_200, 200)).toBe(true);
    expect(vsHolds(4_600, VS_WIPE_MS)).toBe(false);
  });

  it("타임라인 마디 순서가 어긋나지 않았다 (§06-1)", () => {
    expect(VS_SLIDE_MS).toBeLessThan(VS_STAMP_AT_MS);
    expect(VS_STAMP_AT_MS).toBeLessThan(VS_FLOOR_AT_MS);
    expect(VS_FLOOR_AT_MS).toBeLessThan(VS_WIPE_AT_MS);
    expect(VS_WIPE_AT_MS + VS_WIPE_MS).toBe(VS_TOTAL_MS);
  });
});

describe("THEIRS_TINT_MIX", () => {
  it("미러 로드아웃을 색으로 갈라야 한다 (§06-4)", () => {
    expect(THEIRS_TINT_MIX).toBeGreaterThan(0);
    expect(THEIRS_TINT_MIX).toBeLessThan(1);
  });
});

describe("사선 무늬 불투명도", () => {
  it("무늬 판은 반투명이다 — 배경을 완전히 덮으면 층이 안 보인다", () => {
    // 실측 캡처에서 이 값이 1이라 배경이 한 픽셀도 안 보였다
    expect(VS_PANEL_ALPHA).toBeLessThan(0.85);
    // 너무 옅으면 팀색이 배경에 먹힌다 — 이 씬은 "누가 어느 쪽"을 색으로 말한다
    expect(VS_PANEL_ALPHA).toBeGreaterThan(0.5);
  });

  it("줄무늬는 판보다 진하다 — 아니면 그냥 색면이다", () => {
    expect(VS_STRIPE_ALPHA).toBeGreaterThan(0);
    expect(VS_STRIPE_ALPHA).toBeLessThan(1);
  });
});

describe("이름 Pill 배치", () => {
  it("Pill 폭이 칸 간격보다 좁다 — 2인 팀에서 이름이 겹치면 안 된다", () => {
    // 예전 값(간격 170 / 폭 150)은 여백 20px뿐이어서 캡처에서 두 이름이 붙어 읽혔다
    expect(VS_PILL_W).toBeLessThan(VS_CELL_GAP);
    // 여백이 최소 한 글자(≈16px)는 있어야 두 칸이 별개로 읽힌다
    expect(VS_CELL_GAP - VS_PILL_W).toBeGreaterThanOrEqual(16);
  });

  it("2인 팀이 화면 안에 들어온다", () => {
    // 칸 중심은 ±간격/2, Pill은 그 중심에서 ±폭/2까지 뻗는다
    const halfSpan = VS_CELL_GAP / 2 + VS_PILL_W / 2;
    // 진영은 화면 폭의 38%·62%에 놓인다 — 좁은 쪽(38%)이 왼쪽으로 안 넘쳐야 한다
    expect(halfSpan).toBeLessThan(720 * 0.38);
  });
});

describe("posesNow", () => {
  it("흰 플래시가 걷힌 뒤에 벼른다 — 플래시 아래서 재생하면 안 보인다", () => {
    // stampFlash는 VS_STAMP_AT_MS부터 180ms간 화면을 덮는다
    expect(VS_POSE_AT_MS).toBeGreaterThan(VS_STAMP_AT_MS + 180);
    expect(stampFlash(VS_POSE_AT_MS)).toBe(0);
  });

  it("이름이 다 뜨기 전에, 커튼이 열리기 전에 끝난다", () => {
    expect(VS_POSE_AT_MS).toBeLessThan(VS_NAMES_TO_MS);
    expect(VS_POSE_AT_MS).toBeLessThan(VS_WIPE_AT_MS);
  });

  it("시각 전에는 안 하고, 지나면 한 번만 한다", () => {
    expect(posesNow(VS_POSE_AT_MS - 1, false)).toBe(false);
    expect(posesNow(VS_POSE_AT_MS, false)).toBe(true);
    // 이미 했으면 다시 하지 않는다 — 매 프레임 재생하면 첫 프레임에 얼어붙는다
    expect(posesNow(VS_POSE_AT_MS, true)).toBe(false);
    expect(posesNow(VS_TOTAL_MS, true)).toBe(false);
  });
});
