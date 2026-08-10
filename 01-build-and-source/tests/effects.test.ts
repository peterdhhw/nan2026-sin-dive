import { expect, test } from "vitest";
// effects.ts가 아니라 fxMapping.ts에서 가져온다 — Pixi import는 node 환경에서
// navigator를 요구하므로 순수 매핑만 분리해 테스트한다.
import { fxFollowAt, fxRevealAt, interferenceFx } from "../src/shared/fxMapping";
import { INTERFERENCE_KINDS } from "../src/core/types";
import { FX_SHEETS } from "../src/shared/fxManifest";

test("every interference kind has a visual mapping", () => {
  for (const kind of INTERFERENCE_KINDS) {
    const fx = interferenceFx(kind);
    expect(fx.sheet in FX_SHEETS).toBe(true);
    expect(fx.label.length).toBeGreaterThan(0);
    expect(fx.tintHex).toBeGreaterThanOrEqual(0);
    expect(fx.tintHex).toBeLessThanOrEqual(0xffffff);
  }
});

test("slow and gauge_drain look different from each other", () => {
  const a = interferenceFx("slow");
  const b = interferenceFx("gauge_drain");
  expect(`${a.sheet}${a.tintHex}`).not.toBe(`${b.sheet}${b.tintHex}`);
});

test("labels are Korean player-facing text, not raw kind names", () => {
  for (const kind of INTERFERENCE_KINDS) {
    expect(interferenceFx(kind).label).not.toBe(kind);
  }
});

// ── 지연 이펙트의 자리 (§07-4-4)

test("지연된 이펙트는 뜨는 순간의 자리로 간다 — 요청 자리에 안 남는다", () => {
  // 대기 자리에서 눌렀고(x=100) 200ms 뒤 뜰 때는 적 앞이다(x=380)
  expect(fxRevealAt({ x: 100, y: 50 }, { x: 380, y: 50 })).toEqual({
    x: 380,
    y: 50,
  });
});

test("앵커가 없으면 요청 자리 그대로 — 지연 0인 층이 이 경로다", () => {
  expect(fxRevealAt({ x: 100, y: 50 }, null)).toEqual({ x: 100, y: 50 });
});

// ── 재생 중에 따라가는 자리 (1단계-B)

test("재생 중에도 캐릭터를 따라간다 — 한 번 누른 스킬이 두 조각으로 갈라지면 안 된다", () => {
  // 대기 자리에서 떴고(x=266) 재생 도중 캐릭터는 적 앞이다(x=361, 실측 95px)
  expect(fxFollowAt({ x: 266, y: 50 }, { x: 361, y: 50 })).toEqual({
    x: 361,
    y: 50,
  });
});

test("앵커가 망가지면 지금 자리를 지킨다 — 요청 자리로 되돌리면 재생 중에 뒤로 튄다", () => {
  // `fxRevealAt`과 다른 점이다. 뜨는 순간엔 요청 자리가 최선이지만, 재생
  // 중이라면 요청 자리는 이미 지나온 자리다 — 되돌리면 이펙트가 역주행한다
  expect(fxFollowAt({ x: 361, y: 50 }, { x: NaN, y: 50 })).toEqual({
    x: 361,
    y: 50,
  });
  expect(fxFollowAt({ x: 361, y: 50 }, { x: 12, y: Infinity })).toEqual({
    x: 361,
    y: 50,
  });
  expect(fxFollowAt({ x: 361, y: 50 }, null)).toEqual({ x: 361, y: 50 });
});

test("망가진 좌표는 요청 자리로 되돌린다 — 화면 밖으로 사라지면 안 나온 것과 같다", () => {
  expect(fxRevealAt({ x: 100, y: 50 }, { x: NaN, y: 50 })).toEqual({
    x: 100,
    y: 50,
  });
  expect(fxRevealAt({ x: 100, y: 50 }, { x: 380, y: Infinity })).toEqual({
    x: 100,
    y: 50,
  });
});
