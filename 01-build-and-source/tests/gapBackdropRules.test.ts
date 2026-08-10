import { expect, test } from "vitest";
import {
  STRATA_BAND_LIGHTEN,
  STRATA_CRYSTAL_LIGHTEN,
  STRATA_DARKEN,
  STRATA_ROCK_LIGHTEN,
  strataContrastRatio,
  strataPalette,
} from "../src/single/gapBackdropRules";
import { THEME_ABYSS, THEME_SURFACE, themeAtDepth, type WaveTheme } from "../src/shared/theme";
import { luminance } from "../src/shared/color";

/* ── 층 사이 지층 팔레트 (2026-08-07)
 *
 * 22층 1:1 캡처에서 슬라이드 프레임의 필드 800px 중 347px이 명도 0.087(8비트
 * 22)로 찍혔다 — 본체(0.52)와 6배다. 이 모듈이 존재하는 이유가 "검은 공백은
 * '화면이 비었다'로 읽힌다"인데 표층에서 바로 그게 나왔다.
 *
 * **원인은 팔레트가 상수였다는 것이다.** 그래서 이 파일은 색 하나하나를 비교
 * 하지 않는다 — 비교하면 다음에 상수를 바꿀 때 기대값만 같이 바꾸면 통과한다.
 * 묻는 것은 **테마와 지층 사이의 관계**이고, 그 관계는 두 테마에서 다 성립해야
 * 한다. 고정 팔레트가 절대로 가질 수 없는 성질이다.
 */

/** 깊이 0→1을 훑는다 — 표층·심연 끝값만 보면 중간 혼색이 검사 밖에 남는다 */
const DEPTHS = Array.from({ length: 21 }, (_, i) => i / 20);
const THEMES: WaveTheme[] = DEPTHS.map(themeAtDepth);

/**
 * 고치기 전 팔레트 — **대조군이다.**
 *
 * 이 값들이 아래 검사를 통과하면 검사는 아무것도 막지 못한다. 결함을 재현한
 * 실제 상수이므로(옛 `gapBackdrop.ts`의 `SOIL`/`SOIL_BAND`/`ROCK`/`CRYSTAL`)
 * "이 검사가 그때 있었으면 울렸는가"를 그대로 확인할 수 있다.
 */
const PRE_FIX = {
  soil: 0x140f20,
  band: 0x1f1633,
  rock: 0x2a2140,
  crystal: 0x53307c,
} as const;

const preFixRatio = (theme: WaveTheme): number =>
  luminance(theme.soil) / luminance(PRE_FIX.soil);

/**
 * 지층은 그 층의 흙보다 **어둡다** — 땅속이니까. 1이면 흙과 같은 밝기라
 * 슬라이드 중 층 경계가 사라진다.
 */
test("strata backdrop stays darker than the same theme's soil", () => {
  for (const theme of THEMES) {
    expect(strataContrastRatio(theme), theme.id).toBeGreaterThan(1);
  }
});

/**
 * **결함이 걸리는 검사다.** 흙보다 어두운 정도의 상한.
 *
 * 상한 2는 측정된 최적값이 아니라 난간이다 — 아래 두 지점 사이에 있다:
 * 1(구분 불가)과 캡처에서 "빈 화면"으로 찍힌 4.49. 실패 쪽에 붙지 않는 자리를
 * 골랐다. 지금 값은 1.50~1.56이라 여유가 있다.
 */
test("strata backdrop never becomes the black band it exists to prevent", () => {
  for (const theme of THEMES) {
    expect(strataContrastRatio(theme), theme.id).toBeLessThan(2);
  }
  // 대조군: 고정 팔레트는 표층에서 이 상한을 뚫는다 (그게 결함이었다)
  expect(preFixRatio(THEME_SURFACE)).toBeGreaterThan(2);
});

/**
 * **이게 본론이다.** 어두운 정도가 깊이마다 같아야 한다.
 *
 * 고정 팔레트의 실패 방식이 정확히 이거였다: 심연에서 1.34로 맞고 표층에서
 * 4.49로 틀렸다 — 3.4배 벌어진다. 유도된 팔레트는 배수가 관계이므로 어느
 * 깊이에서도 거의 같다.
 *
 * 허용 1.1을 상한·하한 각각에 두지 않고 **비(spread)로** 묻는다 — 절대 명도로
 * 묻는 순간 밝은 테마를 추가하는 날 조용히 깨진다.
 */
test("the darkness relationship holds at every depth, which a fixed palette cannot", () => {
  const ratios = THEMES.map(strataContrastRatio);
  const spread = Math.max(...ratios) / Math.min(...ratios);
  expect(spread).toBeLessThan(1.1);

  // 대조군: 같은 척도로 고정 팔레트를 재면 3배 넘게 벌어진다
  const preSpread =
    preFixRatio(THEME_SURFACE) / preFixRatio(THEME_ABYSS);
  expect(preSpread).toBeGreaterThan(3);
});

/**
 * 네 색의 순서 — 바탕 < 띠 < 잔돌 < 결정. **부등호가 검사의 내용이다.**
 *
 * 등호를 허용하지 않는 이유: 두 색이 같아지면 그림이 사라진다(띠가 바탕과
 * 같으면 층이 지나가는 것이 안 보이고, 잔돌이 띠와 같으면 지층이 맨 띠만
 * 남는다). 값을 안 적으므로 팔레트를 조정해도 이 검사는 그대로 유효하다.
 */
test("palette keeps its four tiers strictly separated", () => {
  for (const theme of THEMES) {
    const p = strataPalette(theme);
    const soil = luminance(p.soil);
    const band = luminance(p.band);
    const rock = luminance(p.rock);
    const crystal = luminance(p.crystal);
    expect(band, `${theme.id} band>soil`).toBeGreaterThan(soil);
    expect(rock, `${theme.id} rock>band`).toBeGreaterThan(band);
    expect(crystal, `${theme.id} crystal>rock`).toBeGreaterThan(rock);
  }
});

/**
 * 결정은 **테마의 `prop`에서** 나온다 — 표층은 풀(연두), 심연은 보라 발광이라
 * 층마다 박힌 것이 달라 보인다.
 *
 * `prop`만 바꿔서 확인한다: 결정만 따라오고 나머지 셋은 그대로여야 한다.
 * `soil`에서 유도하도록 바꿔 놓으면 이 검사가 울린다 — 그림을 다시 굽지 않고
 * 얻는 변화가 조용히 사라지는 걸 막는다.
 */
test("crystal tracks the theme prop, the other three track soil", () => {
  const base = strataPalette(THEME_SURFACE);
  const propOnly = strataPalette({ ...THEME_SURFACE, prop: THEME_ABYSS.prop });
  expect(propOnly.crystal).not.toBe(base.crystal);
  expect(propOnly.soil).toBe(base.soil);
  expect(propOnly.band).toBe(base.band);
  expect(propOnly.rock).toBe(base.rock);

  // 거꾸로: `soil`만 바꾸면 셋이 따라오고 결정은 안 움직인다
  const soilOnly = strataPalette({ ...THEME_SURFACE, soil: THEME_ABYSS.soil });
  expect(soilOnly.soil).not.toBe(base.soil);
  expect(soilOnly.band).not.toBe(base.band);
  expect(soilOnly.rock).not.toBe(base.rock);
  expect(soilOnly.crystal).toBe(base.crystal);
});

/**
 * 흙이 이미 검은 테마에서도 배수가 수가 아닌 값이 되면 안 된다.
 *
 * `NaN`/`0`이 나오면 위 상한 검사들이 **조용히 통과한다**(NaN 비교는 늘
 * 거짓이고 0은 하한에 안 걸린다) — 검사 자체가 죽는 경로라서 막아 둔다.
 */
test("contrast ratio degrades to Infinity, never NaN, on a black theme", () => {
  const black: WaveTheme = { ...THEME_ABYSS, soil: 0x000000 };
  const r = strataContrastRatio(black);
  expect(Number.isNaN(r)).toBe(false);
  expect(r).toBe(Number.POSITIVE_INFINITY);
});

/** 상수 자체의 범위 — `darken`/`lighten`은 0~1 바깥에서 색을 접는다 */
test("palette constants stay inside the mix range", () => {
  for (const [name, v] of [
    ["darken", STRATA_DARKEN],
    ["band", STRATA_BAND_LIGHTEN],
    ["rock", STRATA_ROCK_LIGHTEN],
    ["crystal", STRATA_CRYSTAL_LIGHTEN],
  ] as const) {
    expect(v, name).toBeGreaterThan(0);
    expect(v, name).toBeLessThan(1);
  }
});
