/**
 * 층 사이 지층 배경의 순수 규칙 — 팔레트를 **현재 테마에서 유도한다.**
 *
 * ## 왜 필요했나 (2026-08-07)
 *
 * `gapBackdrop.ts`의 존재 이유는 첫 주석에 적혀 있다 — "검은 공백은 '화면이
 * 비었다'로 읽히므로" 지층을 깔아 "땅을 뚫고 내려가는 중"으로 읽히게 한다.
 * 그런데 팔레트가 `SOIL = 0x140f20`(명도 22.3)처럼 **상수 세 개로 박혀** 있었고
 * 그 근거는 옛 주석대로 "배경 테마(abyss)보다 한 단 어둡게"였다 — 심연만 보고
 * 고른 값이다.
 *
 * 배경은 심연에서 시작하지 않는다. `sessionRules.depthForFloor`가 `층/60`이라
 * **1~59층은 아직 표층**이고, 그 하늘은 명도 185.7 / 지면 106.7이다. 22층
 * 1:1 캡처에서 슬라이드 프레임의 필드 800px 중 **347px이 명도 22**로 찍혔다 —
 * 본체(132)와 **6배** 차이다. 밝기를 3.2배 올려 보면 지층 띠·잔돌·결정이 다
 * 제대로 그려져 있다: **그림은 무죄고 명도만 틀렸다.**
 *
 * 층을 깰 때마다 매번 지나가는 화면이라 노출이 크다 — 페이싱 실측이 3분에
 * 30층, 10분에 100층이므로 심사자가 볼 전환의 대부분이 이 구간에서 일어난다.
 *
 * ## 그래서 테마에서 유도한다
 *
 * `themeAtDepth`가 하늘·지면·환경광에 이미 쓰는 방식이다. 지층은 "지금 화면의
 * 흙보다 한 단 어두운 것"이므로 **테마의 `soil`을 기준으로 어둡게** 만든다 —
 * 그러면 표층에서든 심연에서든 관계가 유지된다. 상수로 박으면 지금처럼 한쪽
 * 테마에서만 맞는다.
 *
 * `soil`을 기준으로 잡는 이유(하늘이나 `ground`가 아니다): 지층은 땅속이다.
 * 하늘을 기준으로 하면 표층에서 지층이 하늘색을 띠어 "구멍을 뚫고 내려간다"가
 * 아니라 "다음 층이 벌써 보인다"로 읽힌다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

import { darken, lighten, luminance } from "../shared/color";
import type { WaveTheme } from "../shared/theme";

/**
 * 테마의 `soil`을 얼마나 어둡게 해서 지층 바탕으로 쓰는가.
 *
 * **낙차의 상한이 이 값을 정한다.** 슬라이드 중 지층과 필드 본체가 같은 화면에
 * 있으므로(위는 빠지는 층, 아래는 올라오는 층), 지층이 너무 어두우면 원래
 * 결함으로 돌아간다. 0.35면 표층 `soil`(74.7)이 48.6이 되어 하늘(185.7)의
 * 1/4쯤 — "땅속"으로는 읽히고 "빈 화면"으로는 안 읽히는 자리다.
 *
 * 1에 가깝게 두면 검은색이다(`darken`은 검정을 섞는다). 그게 고치기 전 상태다.
 */
export const STRATA_DARKEN = 0.35;

/** 지층 경계 띠 — 바탕보다 **밝게** 해서 층이 지나가는 것이 보이게 한다 */
export const STRATA_BAND_LIGHTEN = 0.14;
/** 잔돌 — 띠보다 한 단 더 밝다 */
export const STRATA_ROCK_LIGHTEN = 0.26;

/**
 * 심연 결정 색. **테마의 `prop`을 쓴다** — 표층은 풀(연두), 심연은 보라 발광이라
 * 층마다 박힌 것이 달라 보인다. 그림을 다시 굽지 않고 얻는 변화다.
 *
 * 밝게 올리는 이유: 결정은 지층에서 유일하게 "눈에 걸리는" 요소다. 어두운
 * 지층 위에서 그 역할을 하려면 바탕과의 격차가 필요하다.
 */
export const STRATA_CRYSTAL_LIGHTEN = 0.2;

export interface StrataPalette {
  /** 지층 바탕 */
  readonly soil: number;
  /** 지층 경계 띠 */
  readonly band: number;
  /** 잔돌 */
  readonly rock: number;
  /** 드물게 박히는 결정 */
  readonly crystal: number;
}

/**
 * 테마 → 지층 팔레트.
 *
 * 네 색이 **한 함수에서 같이 나온다.** 따로 계산하면 테마가 바뀌는 날 한 색만
 * 옛 기준에 남고, 그건 "지층 띠가 안 보인다"로 조용히 나타난다.
 */
export function strataPalette(theme: WaveTheme): StrataPalette {
  const soil = darken(theme.soil, STRATA_DARKEN);
  return {
    soil,
    band: lighten(soil, STRATA_BAND_LIGHTEN),
    rock: lighten(soil, STRATA_ROCK_LIGHTEN),
    crystal: lighten(theme.prop, STRATA_CRYSTAL_LIGHTEN),
  };
}

/**
 * 지층이 지금 화면에서 "빈 화면"으로 읽히는가 — **검사가 묻는 질문이다.**
 *
 * 결함을 재현한 조건을 그대로 적는다: 지층 바탕이 **그 테마의 흙보다** 몇 배
 * 어두운가. 22층 캡처에서 고치기 전 값은 표층 `soil`(82.7) 대비 4.5배였다.
 *
 * ## 왜 하늘이 기준이 아닌가
 *
 * 처음엔 `skyBottom`으로 쟀다(슬라이드 중 지층과 맞닿는 것이 그쪽이라서).
 * 그런데 **심연은 흙(24.7)이 하늘(13.5)보다 밝다** — 원본 테마의 성질이다.
 * 그 기준으로는 심연에서 배수가 0.85로 나와 "지층이 하늘보다 밝다"가 되고,
 * 어떤 값을 고르든 두 테마를 한 부등식으로 묶을 수 없다.
 *
 * 흙을 기준으로 하면 묻는 것이 **관계**가 된다: 지층은 그 층의 흙보다 한 단
 * 어둡다. 그 관계는 두 테마에서 다 성립하고, 테마를 늘려도 성립한다 —
 * 절대 명도로 물으면 밝은 테마를 추가하는 날 조용히 깨진다.
 *
 * @returns 테마 흙 대비 지층 바탕의 어두운 배수. 1이면 같은 밝기다
 */
export function strataContrastRatio(theme: WaveTheme): number {
  const strata = luminance(strataPalette(theme).soil);
  const soil = luminance(theme.soil);
  if (strata <= 0) return Number.POSITIVE_INFINITY;
  return soil / strata;
}
