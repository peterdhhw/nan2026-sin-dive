import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  FOOTER_SCRIM_ALPHA,
  FOOTER_SCRIM_FULL,
  FOOTER_SCRIM_TOP,
  FOOTER_TEXT_RATIOS,
  UI_BG_KEYS,
  UI_BG_LOW_LUM_SCRIMMED_MAX,
  UI_BG_MANIFEST_URL,
  UI_BG_MID_LUM_MAX,
  backdropCover,
  footerScrimBands,
  isUsableUiBg,
  scrimAlphaAt,
  scrimmedLum,
  type UiBgEntry,
} from "../src/shared/uiBackdropRules";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";

/**
 * 로딩(S0)·타이틀(S1)의 전면 키 아트.
 *
 * 이 파일이 지키는 것은 **"그 화면만 조용히 옛 배경으로 돌아가는 일이 없다"** 다.
 * `createUiBackdrop`은 항목이 못 쓸 것이면 배경 없이 화면을 세운다 — 화면은
 * 굴러가지만 유저가 고치라고 한 그 미완성 화면이 그대로 돌아온다. 그러니 항목이
 * 빠졌는지·PNG가 실제로 있는지는 런타임 폴백이 아니라 여기가 묻는다.
 *
 * Pixi를 안 부른다 — 매니페스트는 순수 데이터고 규칙도 그렇다(node 테스트가
 * pixi를 못 불러온다).
 */

const manifest: Record<string, unknown> = JSON.parse(
  readFileSync(`public/${UI_BG_MANIFEST_URL}`, "utf-8"),
) as Record<string, unknown>;

/** PNG 헤더에서 크기만 읽는다 — 디코더를 붙이지 않는다 (`meleeFx.test.ts`와 같다) */
const pngSize = (path: string): { w: number; h: number } => {
  const buf = readFileSync(path);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

describe("ui.json이 두 화면을 다 덮는다", () => {
  // `BG_ATLASES`와 같은 취급이다: 부분집합이 아니라 **정확히 같은 집합**을 요구한다.
  // 한 장이 없으면 그 화면만 배경 없이 뜨고, 그게 이번에 고친 결함이다
  test("최상위 키가 UI_BG_KEYS와 정확히 같다", () => {
    expect(Object.keys(manifest).sort()).toEqual([...UI_BG_KEYS].sort());
  });

  test.each([...UI_BG_KEYS])("%s 항목을 런타임이 쓸 수 있다", (key) => {
    expect(isUsableUiBg(manifest[key]), key).toBe(true);
  });

  test.each([...UI_BG_KEYS])("%s의 PNG가 있고 크기가 매니페스트와 맞다", (key) => {
    const e = manifest[key] as UiBgEntry;
    // 배율은 매니페스트의 w/h로 계산한다(`uiBackdrop.ts`) — 그 값이 실제 그림과
    // 다르면 지평선이 어긋나 타이틀의 캐릭터가 허공에 서거나 땅에 묻힌다
    expect(pngSize(`public/${e.url}`), key).toEqual({ w: e.w, h: e.h });
  });

  test.each([...UI_BG_KEYS])("%s의 지평선이 그림 안에 있다", (key) => {
    const e = manifest[key] as UiBgEntry;
    // 0이나 1이면 캐릭터가 화면 밖 경계에 선다 — 폴백(0.66)보다 나쁜 화면이다
    expect(e.groundRatio, key).toBeGreaterThan(0.2);
    expect(e.groundRatio, key).toBeLessThan(1);
  });

  /**
   * 위젯이 앉는 띠(30~70%)가 어두운지. **전체 중앙값(`medLum`)으로는 못 묻는다** —
   * 가장자리가 어두우면 가운데가 밝아도 중앙값이 끌려 내려간다(그 근거는
   * `UI_BG_MID_LUM_MAX` 주석에 있다).
   */
  test.each([...UI_BG_KEYS])("%s의 위젯 띠가 글자를 먹지 않는다", (key) => {
    const e = manifest[key] as UiBgEntry;
    expect(e.midLum, key).toBeLessThanOrEqual(UI_BG_MID_LUM_MAX);
    // 상한만 걸면 새까만 그림도 통과한다 — 그건 "배경을 새로 뽑았다"가 아니다
    expect(e.midLum, key).toBeGreaterThan(0.02);
  });

  /**
   * 바닥 띠. 위 시험(`midLum`)이 **이 자리를 못 잰다** — 30~70% 밖이라
   * 두 그림의 가장 밝은 곳이 그 지표에서 조용히 빠졌고, 로딩의 팁(84%)이
   * 밝은 자갈에 먹힌 것을 캡처에서 봤다. 그래서 여기는 스크림을 덮은 뒤의
   * 값으로 묻는다 — 그림 자체는 밝아도 된다.
   */
  test.each([...UI_BG_KEYS])("%s의 바닥이 스크림을 덮으면 어둡다", (key) => {
    const e = manifest[key] as UiBgEntry;
    expect(e.lowLum, `${key} 측정값이 있다`).toBeGreaterThan(0);
    /**
     * **줄마다 묻는다.** 최대 알파로 한 번만 재면 램프 도중에 앉은 줄을
     * 놓친다 — 처음 판이 정확히 그 결함이었다(팁이 0.84에서 알파 0.23만
     * 받아 캡처에서 자갈에 먹혔는데, "바닥이 어둡다" 시험은 통과했다).
     */
    for (const r of FOOTER_TEXT_RATIOS) {
      expect(
        scrimmedLum(e.lowLum, scrimAlphaAt(r)),
        `${key} @${r}`,
      ).toBeLessThanOrEqual(UI_BG_LOW_LUM_SCRIMMED_MAX);
    }
  });

  // 스크림이 필요한 이유가 데이터에 남아 있는지. 바닥이 위젯 띠보다 밝지 않다면
  // 스크림은 그림만 지우는 군더더기다 — 그때는 이 시험이 깨져서 알려야 한다
  test.each([...UI_BG_KEYS])("%s의 바닥이 위젯 띠보다 밝다", (key) => {
    const e = manifest[key] as UiBgEntry;
    expect(e.lowLum, key).toBeGreaterThan(e.midLum);
  });
});

describe("scrimAlphaAt", () => {
  /**
   * **글자 줄은 램프가 끝난 뒤에 앉아야 한다.** 이 시험이 이 파일의 핵심이다 —
   * 첫 판은 0.76에서 화면 끝까지 선형으로 올렸고, 그러면 팁(0.84)이 최대의
   * 1/3만 받는다. 캡처로만 잡히고 어떤 숫자 지표도 침묵했다.
   */
  test.each([...FOOTER_TEXT_RATIOS])("%s 줄은 최대 알파를 받는다", (r) => {
    expect(r).toBeGreaterThanOrEqual(FOOTER_SCRIM_FULL);
    expect(scrimAlphaAt(r)).toBeCloseTo(FOOTER_SCRIM_ALPHA, 6);
  });

  test("램프 위쪽은 그림을 건드리지 않는다", () => {
    expect(scrimAlphaAt(FOOTER_SCRIM_TOP)).toBe(0);
    expect(scrimAlphaAt(0.5)).toBe(0);
    // 캐릭터가 서는 선(타이틀 0.66)은 덮이면 안 된다 — 그 위가 그림의 주역이다
    expect(scrimAlphaAt(0.66)).toBe(0);
  });

  test("램프 안에서는 단조증가한다", () => {
    let prev = -1;
    for (let r = FOOTER_SCRIM_TOP; r <= FOOTER_SCRIM_FULL + 1e-9; r += 0.005) {
      const a = scrimAlphaAt(r);
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(prev).toBeCloseTo(FOOTER_SCRIM_ALPHA, 6);
  });
});

describe("footerScrimBands", () => {
  test("바닥 글자 자리를 빈틈없이 덮는다", () => {
    const bands = footerScrimBands(1280);
    // 정수로 접히므로 반올림 1px까지만 요구한다 — 정수 경계 자체는 아래에서 묻는다
    expect(Math.abs(bands[0]!.y - 1280 * FOOTER_SCRIM_TOP)).toBeLessThanOrEqual(1);
    // 로딩의 팁(84%)·느린 안내(89%), 타이틀의 요약(93%)이 다 덮여야 한다
    for (const r of FOOTER_TEXT_RATIOS) {
      const y = 1280 * r;
      const hit = bands.filter((b) => y >= b.y && y <= b.y + b.h);
      expect(hit.length, `${r}`).toBeGreaterThan(0);
      // 층이 아니라 **알파**를 묻는다 — 덮였는지만 보면 옅게 덮인 줄을 놓친다
      expect(Math.max(...hit.map((b) => b.alpha)), `${r}`).toBeCloseTo(
        FOOTER_SCRIM_ALPHA,
        6,
      );
    }
    const last = bands[bands.length - 1]!;
    expect(last.y + last.h).toBeGreaterThanOrEqual(1280);
  });

  /**
   * 층으로 쪼개는 이유는 **경계가 선으로 안 보이게** 하는 것이다. 사각형 하나로
   * 두면 그 위쪽 변이 화면을 가로지르는 실선이 되고, 그게 이 브랜치에서 지운
   * 타이틀의 지면 밴드와 같은 결함이다. 한 층의 알파 증가가 그 눈금이다.
   */
  test("층 사이 알파 차이가 눈에 안 잡힐 만큼 작다", () => {
    const bands = footerScrimBands(1280);
    expect(bands.length).toBeGreaterThanOrEqual(6);
    let prev = 0;
    for (const b of bands) {
      expect(b.alpha - prev).toBeLessThanOrEqual(0.1);
      prev = b.alpha;
    }
    // 맨 아래가 가장 진하다 — 글자가 거기 앉는다
    expect(prev).toBeCloseTo(FOOTER_SCRIM_ALPHA, 6);
  });

  /**
   * 층은 **겹치지도 벌어지지도 않는다.**
   *
   * 겹침이 왜 결함인가: 알파 합성은 곱셈이라 두 번 덮인 줄만 더 어두워진다 —
   * 지우려던 가로줄이 층 경계마다 생긴다(캡처에서 확인했고, 그래서 처음의
   * 0.5px 겹침을 버렸다). 빈틈이 왜 결함인가: 그 줄로 밝은 그림이 그대로 비친다.
   */
  test("층이 겹치지도 벌어지지도 않는다", () => {
    const bands = footerScrimBands(1280);
    for (let i = 1; i < bands.length; i += 1) {
      const prev = bands[i - 1]!;
      expect(prev.y + prev.h, `층 ${i} 경계`).toBeCloseTo(bands[i]!.y, 9);
    }
  });

  // 도트 격자를 지킨다 — 반픽셀 경계는 렌더러가 알파로 뭉개서 그 줄만 흐려진다
  test("층 경계가 정수 px이다", () => {
    for (const b of footerScrimBands(1280)) {
      expect(Number.isInteger(b.y), `y=${b.y}`).toBe(true);
      expect(Number.isInteger(b.h), `h=${b.h}`).toBe(true);
    }
  });
});

describe("scrimmedLum", () => {
  // **곱셈이다** — 스크림은 밝게 만들 수 없다. 알파를 올려도 0 아래로는 안 간다
  test("알파가 오르면 어두워진다", () => {
    expect(scrimmedLum(0.25, 0)).toBeCloseTo(0.25, 6);
    expect(scrimmedLum(0.25, 0.62)).toBeCloseTo(0.095, 6);
    expect(scrimmedLum(0.25, 1)).toBeCloseTo(0, 6);
  });

  test("망가진 입력에도 0~1에 머문다", () => {
    for (const [l, a] of [
      [Number.NaN, 0.5],
      [-1, 0.5],
      [0.5, Number.NaN],
      [0.5, 2],
      [0.5, -1],
    ] as const) {
      const v = scrimmedLum(l, a);
      expect(Number.isFinite(v), `${l},${a}`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("backdropCover", () => {
  /**
   * **cover다(`max`).** contain(`min`)이면 짧은 축에 검은 띠가 남고 그 띠가
   * 정확히 "덜 만든 화면"으로 읽힌다. `min`으로 바꾸면 이 시험이 깨져야 한다 —
   * 그래서 두 축의 배율이 **다른** 크기로 묻는다(같으면 max와 min이 같다).
   */
  test("짧은 축이 아니라 긴 쪽 배율을 고른다", () => {
    const k = backdropCover(288, 504, DESIGN_W, DESIGN_H);
    expect(k).toBeCloseTo(DESIGN_H / 504, 6);
    expect(k).toBeGreaterThan(DESIGN_W / 288);
  });

  test("어느 방향이든 화면을 다 덮는다", () => {
    for (const [tw, th] of [
      [288, 504],
      [504, 288],
      [720, 1280],
      [1000, 300],
    ] as const) {
      const k = backdropCover(tw, th, DESIGN_W, DESIGN_H);
      expect(tw * k, `${tw}x${th} 가로`).toBeGreaterThanOrEqual(DESIGN_W - 1e-6);
      expect(th * k, `${tw}x${th} 세로`).toBeGreaterThanOrEqual(DESIGN_H - 1e-6);
    }
  });

  // 0이 들어오면 나눗셈이 Infinity가 되어 화면 하나를 픽셀 몇 개로 덮는다.
  // 여기서 유한한 값으로 떨어뜨려 두고, 그런 항목 자체는 `isUsableUiBg`가 막는다
  test("망가진 크기에도 유한한 값을 준다", () => {
    for (const [tw, th] of [
      [0, 504],
      [288, 0],
      [Number.NaN, 504],
    ] as const) {
      expect(Number.isFinite(backdropCover(tw, th, DESIGN_W, DESIGN_H))).toBe(
        true,
      );
    }
  });
});

describe("isUsableUiBg", () => {
  const good: UiBgEntry = {
    url: "assets/bg/ui_boot.png",
    w: 288,
    h: 504,
    groundRatio: 0.88,
    medLum: 0.13,
    midLum: 0.12,
    lowLum: 0.25,
  };

  // 대조군: 성한 항목이 통과하는지 먼저 본다 — 없으면 아래 거부 시험은
  // "전부 거부한다"로도 통과한다
  test("성한 항목은 통과한다", () => {
    expect(isUsableUiBg(good)).toBe(true);
  });

  test.each([
    ["url이 빈 문자열", { ...good, url: "" }],
    ["url이 없다", { ...good, url: undefined }],
    ["폭이 0", { ...good, w: 0 }],
    ["높이가 음수", { ...good, h: -504 }],
    ["폭이 NaN", { ...good, w: Number.NaN }],
    ["객체가 아니다", "assets/bg/ui_boot.png"],
    ["null", null],
  ])("%s면 거부한다", (_label, e) => {
    expect(isUsableUiBg(e)).toBe(false);
  });
});
