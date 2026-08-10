/**
 * 결과 씬의 순수 규칙 — 1.4초 타임라인, 지표 카운트업 스태거.
 *
 * 설계 문서: specs/2026-07-27-ux/08-scene-result.md §1
 *
 * Pixi를 import하지 않는다 (`resultScene.ts`가 재export한다).
 */

import { easeOutBack, easeOutQuad } from "../shared/tween";
import { WIN_THRESHOLD } from "./gaugeBarRules";
import { SCRIM_SATURATE } from "../shared/ui/scrimRules";

/** 타임라인 마디 (§08-1) */
export const R_FLASH_MS = 140;
export const R_SCRIM_AT_MS = 140;
export const R_STAMP_AT_MS = 200;
export const R_STAMP_MS = 300;
export const R_PANEL_AT_MS = 600;
export const R_PANEL_MS = 320;
export const R_METRICS_AT_MS = 900;
export const R_METRIC_STAGGER_MS = 120;
export const R_BUTTONS_AT_MS = 1_400;
export const R_BUTTONS_FADE_MS = 220;

/** 승패 확정 직후 흰 플래시 */
export function finishFlash(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= R_FLASH_MS) return 0;
  return 1 - elapsedMs / R_FLASH_MS;
}

/** 딤이 다 덮이는 데 걸리는 시간 (§08-1: 140ms에 페이드 인 시작) */
export const R_SCRIM_MS = 260;
/** 최종 딤 알파. `SCRIM_ALPHA`(0.72)와 같은 값이지만 결과 씬은 필터를 따로 쓴다 */
export const R_SCRIM_ALPHA = 0.72;

/**
 * 딤 진행도 0..1 (§08-1: 140ms부터 페이드 인).
 *
 * 흰 플래시가 끝나는 시각(140ms)에 시작한다 — 플래시와 겹치면 딤이 하얗게 씻겨
 * 아무 일도 안 일어난 것처럼 보인다.
 */
export function scrimProgress(elapsedMs: number): number {
  const t = elapsedMs - R_SCRIM_AT_MS;
  if (t <= 0) return 0;
  if (t >= R_SCRIM_MS) return 1;
  return easeOutQuad(t / R_SCRIM_MS);
}

/** 결과 씬 딤의 실제 알파 */
export function scrimAlpha(elapsedMs: number): number {
  return scrimProgress(elapsedMs) * R_SCRIM_ALPHA;
}

/**
 * 뒤 전장의 채도 (§08-1: 40%. 패배는 여기서 추가로 −20%p).
 *
 * 이긴 판과 진 판의 뒷그림이 같으면 스탬프 글자만 다른 화면이 된다. 색이
 * 빠지는 정도가 다르면 스크린샷 한 장으로도 승패가 읽힌다.
 */
export const R_DEFEAT_SATURATE_DROP = 0.2;

export function fieldSaturate(elapsedMs: number, lost: boolean): number {
  const goal = lost
    ? Math.max(0, SCRIM_SATURATE - R_DEFEAT_SATURATE_DROP)
    : SCRIM_SATURATE;
  return 1 + (goal - 1) * scrimProgress(elapsedMs);
}

/**
 * 패배 시 전장이 아래로 내려앉는 양(px) (§08-1: 카메라 미세 하강).
 *
 * 크게 움직이면 전장이 "떨어지는" 사고처럼 보인다 — 12px, 900ms면 의식하지
 * 못하는 채로 무게가 실린다. 승리·무승부에서는 0이다.
 */
export const R_CAMERA_DROP_PX = 12;
export const R_CAMERA_DROP_MS = 900;

export function cameraDrop(elapsedMs: number, lost: boolean): number {
  if (!lost) return 0;
  const t = elapsedMs - R_STAMP_AT_MS;
  if (t <= 0) return 0;
  if (t >= R_CAMERA_DROP_MS) return R_CAMERA_DROP_PX;
  return R_CAMERA_DROP_PX * easeOutQuad(t / R_CAMERA_DROP_MS);
}

/** 헤드라인 스탬프 scale 2.0 → 1.0 (§08-1: 200ms, easeOutBack) */
export function stampScale(elapsedMs: number): number {
  const t = elapsedMs - R_STAMP_AT_MS;
  if (t < 0) return 0;
  if (t >= R_STAMP_MS) return 1;
  return 2.0 + (1 - 2.0) * easeOutBack(t / R_STAMP_MS, 1.4);
}

/** 스탬프와 같은 프레임에 화면 흔들림 1회 */
export function stampShake(elapsedMs: number): number {
  const t = elapsedMs - R_STAMP_AT_MS;
  if (t < 0 || t >= 200) return 0;
  return Math.sin(t / 16) * 9 * (1 - t / 200);
}

/** 결과 패널 scale 0.8 → 1.0 (§08-1: 600ms) */
export function panelScale(elapsedMs: number): number {
  const t = elapsedMs - R_PANEL_AT_MS;
  if (t < 0) return 0;
  if (t >= R_PANEL_MS) return 1;
  return 0.8 + 0.2 * easeOutBack(t / R_PANEL_MS, 1.6);
}

/**
 * 지표 행이 카운트업을 시작할 시각 (§08-1: 각 120ms 지연).
 *
 * 동시에 세 개가 돌면 눈이 한 곳에 못 머문다 — 위에서 아래로 읽히게 만든다.
 */
export function metricAtMs(row: number): number {
  const n = Number.isFinite(row) ? Math.max(0, Math.floor(row)) : 0;
  return R_METRICS_AT_MS + n * R_METRIC_STAGGER_MS;
}

/**
 * 버튼 알파 (§08-1: 1400ms에 페이드 인 + 활성화).
 *
 * **오탭 방지가 목적이다.** 결과를 읽기 전에 손가락이 이미 그 자리에 있으면
 * 무엇을 눌렀는지도 모르고 다음 판이 시작된다.
 */
export function buttonAlpha(elapsedMs: number): number {
  const t = elapsedMs - R_BUTTONS_AT_MS;
  if (t <= 0) return 0;
  if (t >= R_BUTTONS_FADE_MS) return 1;
  return t / R_BUTTONS_FADE_MS;
}

/** 버튼을 눌러도 되는가 — 알파와 같은 소스여야 "보이는데 안 먹힌다"가 없다 */
export function buttonsLive(elapsedMs: number): boolean {
  return buttonAlpha(elapsedMs) >= 1;
}

/** 승리 파티클 (§08-1: 200~700ms 상승). 몰수 승리에는 없다 (§08-3) */
export const PARTICLE_COUNT = 18;
export const PARTICLE_RISE_MS = 1_600;

/** i번째 파티클의 진행률 0..1 (루프). 씨앗은 인덱스로만 만든다 */
export function particleT(elapsedMs: number, index: number): number {
  const offset = ((index * 137) % 100) / 100;
  const t = (elapsedMs / PARTICLE_RISE_MS + offset) % 1;
  return t;
}

/** i번째 파티클의 x 비율 0..1 */
export function particleX(index: number): number {
  return ((index * 61) % 100) / 100;
}

/** 미니 게이지 바 (§08-4) */
export const MINI_GAUGE_W = 220;
export const MINI_GAUGE_H = 18;

/**
 * 게이지 위치(−1..1)를 미니 바의 0..1 비율로. `gaugeBarRules`와 같은 규칙이다 —
 * 여기서 다르게 매핑하면 전투 중 본 위치와 결과의 위치가 어긋난다.
 */
export function miniGaugeRatio(pos: number): number {
  const p = Number.isFinite(pos) ? Math.max(-1, Math.min(1, pos)) : 0;
  return (p + 1) / 2;
}

/**
 * 미니 바에 그릴 임계선 두 개의 비율.
 *
 * 숫자 `0.80`만으로는 "임계치에 도달해서 이겼다"가 안 읽힌다 — 선이 있고
 * 마커가 그 선에 닿아 있으면 한눈에 이해된다 (§08-4).
 */
export function miniThresholds(): readonly [number, number] {
  return [miniGaugeRatio(-WIN_THRESHOLD), miniGaugeRatio(WIN_THRESHOLD)];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 승리 삽화 오버레이 (§08-8)
 *
 * 규칙 본체는 `shared/scenes/showcaseRules.ts`로 옮겼다 — 싱글도 같은 연출을
 * 쓰기 때문이다(유저 신고: "10층 내려갈 때마다 pvp 이겼을 때처럼"). 옮긴 근거와
 * 원래의 설계 기록(왜 결과 화면에 끼워 넣지 않고 덮는가)은 그 파일 머리에 있다.
 *
 * **여기서 재export한다.** 이 경로로 부르는 곳이 88군데고 대부분이 테스트다 —
 * 경로를 갈아치우면 이동이 아니라 재작성이 된다.
 * ──────────────────────────────────────────────────────────────────────────── */
export {
  V_ART_AT_MS,
  V_ART_MS,
  V_ART_RISE_PX,
  V_WORD_AT_MS,
  V_WORD_MS,
  V_CARD_AT_MS,
  V_CARD_MS,
  V_HOLD_MS,
  V_FADE_MS,
  V_TOTAL_MS,
  V_SKIP_AT_MS,
  V_ART_MAX_W,
  V_ART_MAX_H,
  V_ART_BOTTOM_Y,
  V_WORD_Y,
  V_CARD_Y,
  V_ART_VARIANT,
  victorySkippable,
  victoryAlpha,
  victoryLive,
  victoryArtProgress,
  victoryArtRise,
  victoryWordScale,
  victoryWordFlash,
  victoryCardAlpha,
  victoryArtSize,
} from "../shared/scenes/showcaseRules";

/**
 * 어떤 결과에 오버레이를 띄우는가.
 *
 * `celebrate`와 **같은 소스**를 쓴다(`resultText`). 몰수 승리를 빼는 근거도
 * 그대로다 — 상대가 연결을 잃은 판은 유저가 잘한 게 없고(§08-3), 파티클도
 * 안 뜨는 판에 축하 삽화만 크게 뜨면 화면이 스스로를 부정한다.
 *
 * 카드 획득(#19)도 이 게이트를 공유한다. 몰수 승리로 카드가 나오면 연결을
 * 끊는 상대를 만나는 것이 가장 빠른 수집 경로가 된다.
 */
export function showsVictory(
  celebrate: boolean,
  winner: 0 | 1 | null,
): boolean {
  return celebrate && winner === 0;
}

