/**
 * 삽화 쇼케이스 오버레이의 순수 규칙 — 타임라인·크기·게이트.
 *
 * ## 왜 `pvp/resultRules`에서 옮겨 왔나 (2026-08-09)
 *
 * 원래 PvP 결과 화면 전용이었다. 유저 신고로 싱글에도 같은 연출이 필요해졌다:
 * "10층 내려갈 때마다 pvp 이겼을 때처럼 캐릭터 보여주고, 카드 얻어달라고 했는데,
 * 반영 안 된 것 같아."
 *
 * `single`이 `pvp`를 import하게 두지 않는다 — 두 모드는 서로를 모르는 것이
 * 이 코드베이스의 경계고(`core/waves.ts`를 안 고치고 `phaseWaves.ts`를 새로
 * 만든 것과 같은 근거), 한쪽이 다른 쪽을 부르기 시작하면 PvP 타임라인을 고친
 * 날 싱글 연출이 같이 변한다.
 *
 * **PvP 쪽 이름은 그대로 재export한다** (`resultRules`). 88군데가 그 경로로
 * 이 값들을 부르고 있고, 그중 대부분이 테스트다 — 경로를 갈아치우면 이 이동이
 * "옮겼다"가 아니라 "다시 썼다"가 된다.
 *
 * `showsVictory`는 여기 없다 — 그건 승패(몰수 승리 제외)를 묻는 PvP 규칙이라
 * `resultRules`에 남는다.
 *
 * Pixi를 import하지 않는다 (`showcaseOverlay.ts`가 쓴다).
 */

import { easeOutBack, easeOutCubic } from "../tween";
import { DESIGN_H, DESIGN_W } from "../viewport";
import type { PortraitVariant } from "../portraitManifest";

/* ────────────────────────────────────────────────────────────────────────────
 * 승리 삽화 오버레이 (§08-8, 이 절과 함께 추가)
 *
 * 유저 지시: "이겼을 때 내가 고른 캐릭터의 이미지랑 그 위에 Victory라는 메세지
 * 오버레이 애니메이션으로 올려줘."
 *
 * ## 왜 결과 화면 **위**에 따로 띄우는가 (결정 기록)
 *
 * 결과 화면에 삽화를 끼워 넣을 자리가 없다. y를 재 봤다: 스탬프 282 · 부제 371 ·
 * 전적 패널 486~858 · 다시 대전 922~1018 · 타이틀로 1056~1132 · 힌트 1164.
 * 승리 삽화(`win`)는 435px이고 이 오버레이 크기로는 최대 666px인데, 1280px에
 * 그만한 빈 띠가 없다. 패널을 줄이면 §08-4의 지표 네 줄이 안 들어가고, 삽화를
 * 띠에 맞춰 줄이면 얼굴이 안 읽힌다(카드 삽화 93px의 근거와 같은 문제다).
 *
 * 그래서 **덮는다.** 기존 타임라인은 그 아래에서 그대로 돌고(딤·스탬프·패널·
 * 지표·버튼), 오버레이가 걷힐 때는 결과 화면이 이미 다 조립돼 있다 — 즉
 * 결과를 보기까지 걸리는 시간은 늘지만 **결과 화면의 마디는 하나도 안 바뀐다.**
 * 타임라인 상수를 밀어 넣는 안(삽화 뒤에 스탬프를 시작하는 안)을 접은 이유가
 * 이것이다: `R_BUTTONS_AT_MS`까지 전부 밀리면 §08-1의 마디가 다시 정해지고
 * 그 값을 근거로 쓰는 테스트·캡처가 전부 다른 화면을 보게 된다.
 *
 * 덮는 대신 두 가지를 지킨다.
 * 1. 오버레이가 **탭을 삼킨다.** 버튼은 1400ms에 살아나는데(`buttonsLive`)
 *    그때 화면에는 오버레이가 있다 — 안 삼키면 안 보이는 버튼이 눌린다.
 * 2. **탭하면 걷힌다** (`victorySkippable`). 축하를 2.6초 동안 강제로 보게 만들면
 *    재대전이 그만큼 늦어진다. 두 번째 판부터는 이미 본 연출이다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 삽화가 올라오기 시작하는 시각. 스탬프(200ms)보다 늦다 — 아래에서 딤이 먼저 깔린다 */
export const V_ART_AT_MS = 120;
export const V_ART_MS = 420;
/** 삽화가 아래에서 올라오는 거리(px). 크게 주면 "떨어졌다"로 보인다 */
export const V_ART_RISE_PX = 90;
/** `VICTORY` 워드마크가 찍히는 시각 — 삽화가 자리를 잡은 뒤다 */
export const V_WORD_AT_MS = 420;
export const V_WORD_MS = 320;
/** 획득 카드 한 줄이 뜨는 시각 (#19). 워드마크가 멈춘 뒤다 */
export const V_CARD_AT_MS = 900;
export const V_CARD_MS = 320;
/** 이 시각까지 유지하고, 그 뒤 `V_FADE_MS` 동안 걷힌다 */
export const V_HOLD_MS = 2_200;
export const V_FADE_MS = 400;
export const V_TOTAL_MS = V_HOLD_MS + V_FADE_MS;

/**
 * 탭으로 걷어도 되는 시각. 워드마크가 멈춘 직후다.
 *
 * 0으로 두면 결과가 확정되는 순간 화면에 있던 손가락이 축하를 건너뛴다 —
 * 전투 마지막 프레임의 스킬 연타가 그대로 여기로 들어온다(§08-1이 버튼을
 * 1400ms까지 잠그는 것과 같은 이유).
 */
export const V_SKIP_AT_MS = V_WORD_AT_MS + V_WORD_MS;

export function victorySkippable(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= V_SKIP_AT_MS;
}

/**
 * 오버레이 전체 알파. 유지 구간에서는 1, `V_HOLD_MS`부터 걷힌다.
 *
 * `skipAtMs`는 탭이 들어온 시각(음수 = 없음)이다. 탭하면 그 자리에서 페이드를
 * 시작한다 — 즉 걷히는 **모양은 한 가지**다. 탭에 즉시 사라지게 하면 결과
 * 화면이 튀어나오고, 그게 "내가 뭘 잘못 눌렀나"로 읽힌다.
 */
export function victoryAlpha(elapsedMs: number, skipAtMs = -1): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  const from =
    Number.isFinite(skipAtMs) && skipAtMs >= 0
      ? Math.min(skipAtMs, V_HOLD_MS)
      : V_HOLD_MS;
  const t = elapsedMs - from;
  if (t <= 0) return 1;
  if (t >= V_FADE_MS) return 0;
  return 1 - t / V_FADE_MS;
}

/** 오버레이가 아직 화면에 있는가 — 알파와 같은 소스여야 "안 보이는데 탭을 먹는다"가 없다 */
export function victoryLive(elapsedMs: number, skipAtMs = -1): boolean {
  return victoryAlpha(elapsedMs, skipAtMs) > 0;
}

/** 삽화 등장 진행률 0..1 */
export function victoryArtProgress(elapsedMs: number): number {
  const t = elapsedMs - V_ART_AT_MS;
  if (t <= 0) return 0;
  if (t >= V_ART_MS) return 1;
  return easeOutCubic(t / V_ART_MS);
}

/** 삽화의 y 오프셋 — 아래에서 올라온다 */
export function victoryArtRise(elapsedMs: number): number {
  return V_ART_RISE_PX * (1 - victoryArtProgress(elapsedMs));
}

/** `VICTORY` 워드마크 scale 2.4 → 1.0. 결과 스탬프(2.0)보다 크게 찍힌다 */
export function victoryWordScale(elapsedMs: number): number {
  const t = elapsedMs - V_WORD_AT_MS;
  if (t < 0) return 0;
  if (t >= V_WORD_MS) return 1;
  return 2.4 + (1 - 2.4) * easeOutBack(t / V_WORD_MS, 1.5);
}

/** 워드마크가 찍히는 순간의 흰 플래시 */
export function victoryWordFlash(elapsedMs: number): number {
  const t = elapsedMs - V_WORD_AT_MS;
  if (t < 0 || t >= 200) return 0;
  return (1 - t / 200) * 0.8;
}

/** 획득 카드 한 줄의 알파 (#19). 카드가 없으면 호출자가 아예 안 그린다 */
export function victoryCardAlpha(elapsedMs: number): number {
  const t = elapsedMs - V_CARD_AT_MS;
  if (t <= 0) return 0;
  if (t >= V_CARD_MS) return 1;
  return t / V_CARD_MS;
}

/** 오버레이 삽화가 쓸 수 있는 최대 크기 (§08-8) */
export const V_ART_MAX_W = DESIGN_W * 0.92;
export const V_ART_MAX_H = DESIGN_H * 0.52;
/** 삽화 발밑(아래 끝)이 놓이는 y */
export const V_ART_BOTTOM_Y = DESIGN_H * 0.74;
/** 워드마크 띠의 중심 y — 삽화의 가슴 높이를 지난다 */
export const V_WORD_Y = DESIGN_H * 0.3;
/** 획득 카드 줄의 y */
export const V_CARD_Y = DESIGN_H * 0.82;

/**
 * 삽화 표시 크기 — **높이와 폭 둘 다** 상한을 지킨다.
 *
 * 높이만 맞추면 안 된다: `win` 삽화의 폭은 302~701px로 두 배 넘게 벌어지고
 * (`portraits.json` 실측), 가장 넓은 캐릭터를 높이 상한(666px)에 맞추면
 * 1073px이 되어 화면(720px) 밖으로 팔이 나간다. 종횡비는 지킨다 —
 * 폭을 잘라 맞추면 인물이 눌린다.
 */
export function victoryArtSize(w: number, h: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(V_ART_MAX_H / h, V_ART_MAX_W / w);
  return { w: w * k, h: h * k };
}


/**
 * 오버레이가 쓸 삽화 variant. 승리 전용이므로 `win` 하나다.
 *
 * 상수로 두는 이유: `loadPortraits`는 셋 다 받으면 16.4MB인데 그중 11MB가 끝까지
 * 안 쓰인다(`portraits.ts` 주석). 씬이 문자열을 직접 적으면 나중에 `lose`를
 * 더할 때 "일단 셋 다 받자"가 되기 쉽다 — 필요한 것만 여기서 말한다.
 */
export const V_ART_VARIANT: PortraitVariant = "win";
