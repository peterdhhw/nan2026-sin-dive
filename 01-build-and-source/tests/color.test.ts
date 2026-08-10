import { describe, expect, it } from "vitest";
import {
  darken,
  lighten,
  luminance,
  mixColor,
  readableText,
  saturateDelta,
} from "../src/shared/color";

describe("mixColor", () => {
  it("t=0/1에서 양 끝 색을 그대로 준다", () => {
    expect(mixColor(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
    expect(mixColor(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
  });

  it("채널별로 독립 보간한다", () => {
    // 0x00 → 0xff의 절반은 0x80 (반올림)
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x00ff00, 0.5)).toBe(0x808000);
  });

  it("범위 밖 t를 접는다", () => {
    expect(mixColor(0x000000, 0xffffff, -3)).toBe(0x000000);
    expect(mixColor(0x000000, 0xffffff, 9)).toBe(0xffffff);
  });

  it("NaN t를 0으로 본다 — 색이 사라지지 않는다", () => {
    expect(mixColor(0x336699, 0xffffff, NaN)).toBe(0x336699);
  });

  it("결과가 항상 24비트 안에 있다", () => {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      const v = mixColor(0xffffff, 0x000000, t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe("lighten / darken", () => {
  it("lighten은 흰색으로, darken은 검정으로 간다", () => {
    expect(lighten(0x808080, 1)).toBe(0xffffff);
    expect(darken(0x808080, 1)).toBe(0x000000);
  });

  it("amount 0은 원색을 유지한다", () => {
    expect(lighten(0x4a6b4c, 0)).toBe(0x4a6b4c);
    expect(darken(0x4a6b4c, 0)).toBe(0x4a6b4c);
  });

  it("§3-3의 셰이딩 혼합비가 실제로 명암을 만든다", () => {
    const base = 0x504030;
    expect(luminance(lighten(base, 0.22))).toBeGreaterThan(luminance(base));
    expect(luminance(darken(base, 0.25))).toBeLessThan(luminance(base));
  });
});

describe("luminance", () => {
  it("검정 0, 흰색 1", () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBeCloseTo(1, 5);
  });

  it("녹색이 청색보다 밝게 잡힌다 (지각 가중)", () => {
    expect(luminance(0x00ff00)).toBeGreaterThan(luminance(0x0000ff));
  });
});

describe("readableText", () => {
  it("어두운 바탕에는 onDark, 밝은 바탕에는 onLight", () => {
    expect(readableText(0x211c2e, 0xffffff, 0x3a2c1e)).toBe(0xffffff);
    expect(readableText(0xffc94a, 0xffffff, 0x3a2c1e)).toBe(0x3a2c1e);
  });

  it("우리 팔레트의 배너 색들이 갈라진다", () => {
    // 금색 배너(웨이브)만 어두운 글자를 받는다
    expect(readableText(0xd8486a, 1, 0)).toBe(1);
    expect(readableText(0x30a858, 1, 0)).toBe(1);
    expect(readableText(0xffc94a, 1, 0)).toBe(0);
    expect(readableText(0x404058, 1, 0)).toBe(1);
  });
});

describe("saturateDelta", () => {
  it("배율 1은 아무것도 바꾸지 않는다", () => {
    // Pixi의 saturate(0)이 항등이다 — 1을 넘기면 채도가 두 배가 된다
    expect(saturateDelta(1)).toBe(0);
  });

  it("흑백은 −1", () => {
    expect(saturateDelta(0)).toBe(-1);
  });

  it("채도 −20%는 −0.2", () => {
    expect(saturateDelta(0.8)).toBeCloseTo(-0.2, 10);
    expect(saturateDelta(0.4)).toBeCloseTo(-0.6, 10);
  });

  it("이상한 입력은 항등으로 접는다 — 화면이 흑백으로 죽는 것보다 낫다", () => {
    expect(saturateDelta(NaN)).toBe(0);
    expect(saturateDelta(Infinity)).toBe(0);
  });

  it("음수 배율은 흑백까지만 내려간다", () => {
    expect(saturateDelta(-3)).toBe(-1);
  });
});
