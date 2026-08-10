/**
 * 씬 전환의 순수 규칙 — 이름 파싱, 페이드 타이밍.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C11
 *
 * Pixi를 import하지 않는다 (`sceneManager.ts`가 재export한다).
 */

/**
 * 씬 이름. `?scene=`로 직행할 수 있는 값이며, 전환 로그에도 그대로 쓴다.
 *
 * `battle`이 있는 이유: 매칭 5초 + VS 1.6초를 기다리면 전투 스크린샷 검증이
 * 매번 7초를 낭비한다 (설계 문서 09-3).
 */
export const SCENE_NAMES = [
  "boot",
  "title",
  "match",
  "vs",
  "battle",
  "result",
  "dive",
  "pick",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export function parseSceneName(raw: string | null): SceneName | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return (SCENE_NAMES as readonly string[]).includes(v)
    ? (v as SceneName)
    : null;
}

/**
 * 전환 페이드. 덮는 쪽(out)이 걷는 쪽(in)보다 짧다 —
 * 다음 씬은 이미 준비돼 있으므로 빨리 덮고 천천히 보여주는 게 자연스럽다.
 */
export const SCENE_FADE_OUT_MS = 160;
export const SCENE_FADE_IN_MS = 220;

export type FadeDir = "out" | "in";

/**
 * 전환 막(veil)의 알파. `out` = 0→1(덮는다), `in` = 1→0(걷는다).
 *
 * 범위 밖 시간에서도 끝점 값을 준다 — 전환이 끝난 뒤 한 프레임 늦게 호출돼도
 * 막이 어중간하게 남지 않아야 한다.
 */
export function veilAlpha(
  elapsedMs: number,
  durationMs: number,
  dir: FadeDir,
): number {
  if (durationMs <= 0) return dir === "out" ? 1 : 0;
  const t = Number.isFinite(elapsedMs)
    ? Math.max(0, Math.min(1, elapsedMs / durationMs))
    : 1;
  return dir === "out" ? t : 1 - t;
}
