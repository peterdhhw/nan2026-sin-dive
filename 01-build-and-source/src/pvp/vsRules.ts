/**
 * VS 인트로의 순수 규칙 — 1.6초 타임라인.
 *
 * 설계 문서: specs/2026-07-27-ux/06-scene-vs-intro.md §1
 *
 * Pixi를 import하지 않는다 (`vsScene.ts`가 재export한다).
 */

import { easeOutBack, easeOutCubic } from "../shared/tween";

/** 타임라인 마디 (§06-1). 값 하나만 고쳐도 전체가 따라오게 이름을 붙였다 */
export const VS_SLIDE_MS = 220;
export const VS_STAMP_AT_MS = 260;
export const VS_STAMP_MS = 300;
export const VS_NAMES_FROM_MS = 260;
export const VS_NAMES_TO_MS = 900;
export const VS_FLOOR_AT_MS = 900;
export const VS_WIPE_AT_MS = 1_200;
export const VS_WIPE_MS = 400;
export const VS_TOTAL_MS = 1_600;

/** 사선 스트라이프 각 (§06-1: −18°) */
export const VS_STRIPE_DEG = -18;
export const VS_STRIPE_W = 26;
export const VS_STRIPE_GAP = 34;

/**
 * 팀 진입 오프셋 비율. 우리 팀은 왼쪽 밖 −1, 상대 팀은 오른쪽 밖 +1에서 온다.
 *
 * `easeOutBack`으로 살짝 오버슈트한다 — 정확히 멈추면 "미끄러졌다"가 아니라
 * "위치가 갱신됐다"로 보인다.
 */
export function slideOffset(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 1;
  if (elapsedMs >= VS_SLIDE_MS) return 0;
  return 1 - easeOutBack(elapsedMs / VS_SLIDE_MS, 1.5);
}

/** VS 스탬프 스케일 2.2 → 1.0 (§06-1: 260ms에 찍힌다) */
export function stampScale(elapsedMs: number): number {
  const t = elapsedMs - VS_STAMP_AT_MS;
  if (t < 0) return 0;
  if (t >= VS_STAMP_MS) return 1;
  return 2.2 + (1 - 2.2) * easeOutCubic(t / VS_STAMP_MS);
}

/** 스탬프가 찍히는 순간의 흰 플래시 */
export function stampFlash(elapsedMs: number): number {
  const t = elapsedMs - VS_STAMP_AT_MS;
  if (t < 0 || t >= 180) return 0;
  return 1 - t / 180;
}

/** 화면 흔들림 1회 (§06-1) — 스탬프와 같은 프레임에 시작한다 */
export function screenShake(elapsedMs: number): number {
  const t = elapsedMs - VS_STAMP_AT_MS;
  if (t < 0 || t >= 220) return 0;
  const decay = 1 - t / 220;
  return Math.sin(t / 18) * 10 * decay;
}

/** 0..1 페이드 — from 이전 0, to 이후 1 */
export function fadeBetween(
  elapsedMs: number,
  from: number,
  to: number,
): number {
  if (to <= from) return elapsedMs >= to ? 1 : 0;
  const t = (elapsedMs - from) / (to - from);
  return Math.max(0, Math.min(1, t));
}

/** 이름 Pill 페이드 (§06-1: 260→900ms) */
export function namesAlpha(elapsedMs: number): number {
  // 640ms를 다 쓰면 너무 느리다 — 앞 절반에 다 올리고 나머지는 유지다
  return fadeBetween(elapsedMs, VS_NAMES_FROM_MS, VS_NAMES_FROM_MS + 320);
}

/** 층 라벨 페이드 (§06-1: 900ms) */
export function floorAlpha(elapsedMs: number): number {
  return fadeBetween(elapsedMs, VS_FLOOR_AT_MS, VS_FLOOR_AT_MS + 240);
}

/**
 * 사선 배경 와이프 진행률 (§06-1: 1200ms부터 위·아래로 갈라진다).
 *
 * 0 = 닫힘, 1 = 완전히 열림. 열린 틈으로 전장이 보인다.
 */
export function wipeProgress(wipeElapsedMs: number): number {
  if (wipeElapsedMs <= 0) return 0;
  if (wipeElapsedMs >= VS_WIPE_MS) return 1;
  return easeOutCubic(wipeElapsedMs / VS_WIPE_MS);
}

/**
 * 사선 배경을 갈라도 되는가.
 *
 * **세션 준비가 안 됐으면 열지 않는다** (§06-5). 열린 틈으로 보여야 할 전장이
 * 아직 없으면 빈 화면이 드러난다 — 이 씬의 존재 이유와 정반대다.
 */
export function wipeGate(elapsedMs: number, sessionReady: boolean): boolean {
  return elapsedMs >= VS_WIPE_AT_MS && sessionReady;
}

/**
 * 아직 이 씬을 유지해야 하는가.
 *
 * 와이프가 끝나기 전에는 무조건 유지한다. `wipeElapsedMs`는 와이프가 실제로
 * 시작한 뒤의 경과다 (준비 지연만큼 늦게 흐른다).
 */
export function vsHolds(elapsedMs: number, wipeElapsedMs: number): boolean {
  return elapsedMs < VS_TOTAL_MS || wipeElapsedMs < VS_WIPE_MS;
}

/** 대기 링을 그리는가 — 열 시점인데 세션이 아직 준비되지 않았을 때만 (§06-5) */
export function showsWaitRing(
  elapsedMs: number,
  sessionReady: boolean,
): boolean {
  return elapsedMs >= VS_WIPE_AT_MS && !sessionReady;
}

/** 상대 팀 캐릭터 틴트 혼합비 (§06-4: TEAM_THEIRS 40%) */
export const THEIRS_TINT_MIX = 0.4;

/**
 * 사선 무늬의 **불투명도**.
 *
 * 예전에는 무늬 판이 완전 불투명이었다(`darken(tint, 0.62)`를 꽉 채웠다). 그래서
 * 이 씬은 배경을 미리 맞춰 두고(`setTheme(THEME_SURFACE)`) 켜 놓는데도
 * 와이프가 열릴 때까지 그 배경이 **한 픽셀도 보이지 않았다** — 실측 캡처에서
 * 확인했다. "어디로 내려가는가"를 이 씬이 말한다는 §06-3의 전제가 화면에서
 * 성립하지 않았다는 뜻이다.
 *
 * 값의 근거: 무늬가 배경을 이겨야 팀색이 읽히고(0.5 이하면 숲이 무늬를 삼킨다),
 * 배경이 살아야 층이 읽힌다(0.85 이상이면 없는 것과 같다).
 */
export const VS_PANEL_ALPHA = 0.72;
/** 사선 줄무늬 자체는 판보다 진하게 — 무늬가 사라지면 그냥 색면이다 */
export const VS_STRIPE_ALPHA = 0.55;

/**
 * 캐릭터가 `attack`을 1회 재생하는 시각 (§06-1: 260~900ms 구간의 "attack 1회").
 *
 * 스탬프와 같은 프레임에 두지 않는다 — 흰 플래시가 덮는 180ms 동안 재생하면
 * 그 동작이 안 보인다. 플래시가 끝나고 시작한다.
 */
export const VS_POSE_AT_MS = 450;

/** 이 시각을 지났고 아직 한 번도 안 했으면 공격 포즈를 재생한다 */
export function posesNow(elapsedMs: number, alreadyPosed: boolean): boolean {
  return !alreadyPosed && elapsedMs >= VS_POSE_AT_MS;
}

/**
 * 2인 팀의 캐릭터 x 간격(디자인 px).
 *
 * 예전 값 170은 **이름 Pill 폭(150)보다 겨우 20px 넓었다** — 캡처에서 "물의 여사제 (나)"와
 * "잎의 레인저"가 한 덩어리로 읽혔다. Pill 폭 + 한 글자 여백보다 넓어야 한다.
 */
export const VS_CELL_GAP = 208;
/**
 * 이름 Pill 폭. 간격보다 좁아야 두 칸이 안 겹친다 (테스트로 고정).
 *
 * 168로 잡았다가 넓혔다: 필이 글자를 폭에 맞추기 시작하니(`pillTextWidth`)
 * 가장 긴 라벨 `물의 여사제 (나)`가 **`물의 여사제 …`로 잘렸다**. `(나)`는 §06-4가
 * 이 씬에서 전하려는 바로 그 정보다 — 그게 잘리면 넘치는 것보다 나쁘다.
 */
export const VS_PILL_W = 184;

/**
 * "사람 대전"/"AI 대전" 캡션의 y 오프셋 (스탬프 중심 기준).
 *
 * 78이었는데 스탬프 판이 ±52이고 사람 대전이면 발광 링이 반지름 124다 —
 * 캡처에서 글자가 스탬프 뒤로 들어가 읽히지 않았다. 링 밖으로 내보낸다.
 */
export const VS_KIND_DY = 150;

/**
 * 캐릭터가 서는 발밑 y 비율. 스프라이트는 **발**이 원점이므로(`spriteChar`)
 * 도형 실루엣 시절의 값(0.33·0.72 = 몸통 상단 기준)을 그대로 쓰면 뜬다.
 *
 * 우리 팀은 스탬프 위, 상대 팀은 아래 — 각 절반의 가운데다.
 */
export const VS_OURS_FEET_Y = 0.335;
export const VS_THEIRS_FEET_Y = 0.79;
/** 이름 Pill은 발밑 아래로 이만큼 내려간다 */
export const VS_PILL_DY = 34;
