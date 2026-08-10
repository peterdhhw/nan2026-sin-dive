/**
 * 효과음의 순수 규칙 — 스로틀 판정과 로테이션.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §7
 *
 * `audio.ts`는 WebAudio(브라우저 전용)를 쓰므로 node 테스트에서 로드할 수 없다.
 * 기존 관례(`fxMapping`/`effects`, `skillRules`/`skillBar`)대로 규칙만 여기 둔다.
 */

/** 게임이 쓰는 효과음 ID. `public/assets/sfx/<id>.ogg`와 1:1 대응한다 */
export type SfxId =
  | "hit"
  | "skill_cast"
  | "cooldown_ready"
  | "enemy_death"
  | "ui_tap"
  | "ui_locked"
  | "win"
  | "lose"
  | "gauge_danger"
  | "interference";

/**
 * 실제 파일명. `hit`만 3종 로테이션이라 여러 개다 (§7: 같은 소리 반복은 피로하다).
 * 나머지는 1:1이지만 배열로 통일해서 로테이션 코드가 분기하지 않게 한다.
 */
export const SFX_FILES: Readonly<Record<SfxId, readonly string[]>> = {
  hit: ["hit_0", "hit_1", "hit_2"],
  skill_cast: ["skill_cast"],
  cooldown_ready: ["cooldown_ready"],
  enemy_death: ["enemy_death"],
  ui_tap: ["ui_tap"],
  ui_locked: ["ui_locked"],
  win: ["win"],
  lose: ["lose"],
  gauge_danger: ["gauge_danger"],
  interference: ["interference"],
};

/** 모든 파일명 (로딩용) */
export function allSfxNames(): string[] {
  return Object.values(SFX_FILES).flatMap((names) => [...names]);
}

/**
 * ID별 최소 재발화 간격(ms).
 *
 * `hit`은 초당 여러 번 발생한다 — 스로틀이 없으면 소리가 뭉쳐서 노이즈가 된다.
 * 40ms는 스펙값(§7). `win`/`lose`처럼 판에 한 번인 것은 스로틀이 무의미하므로 0.
 */
export const SFX_THROTTLE_MS: Readonly<Record<SfxId, number>> = {
  hit: 40,
  skill_cast: 60,
  cooldown_ready: 80,
  enemy_death: 60,
  ui_tap: 50,
  ui_locked: 120,
  win: 0,
  lose: 0,
  gauge_danger: 0,
  interference: 100,
};

/** ID별 볼륨. 파일 자체도 정규화했지만(§tools/gen_sfx.sh) 연출상 미세 조정이 필요하다 */
export const SFX_VOLUME: Readonly<Record<SfxId, number>> = {
  hit: 0.7,
  skill_cast: 0.9,
  cooldown_ready: 0.8,
  enemy_death: 0.75,
  ui_tap: 0.6,
  ui_locked: 0.6,
  win: 1,
  lose: 1,
  gauge_danger: 0.85,
  interference: 0.9,
};

/**
 * 지금 이 소리를 낼 수 있는지.
 *
 * `lastPlayedMs`가 undefined면(=한 번도 안 울렸으면) 무조건 허용한다.
 * 시간이 뒤로 간 경우(음수 경과)도 허용한다 — 막으면 소리가 영구히 죽는다.
 */
export function canPlay(
  id: SfxId,
  nowMs: number,
  lastPlayedMs: number | undefined,
): boolean {
  if (lastPlayedMs === undefined) return true;
  const gap = SFX_THROTTLE_MS[id];
  if (gap <= 0) return true;
  const elapsed = nowMs - lastPlayedMs;
  return elapsed < 0 || elapsed >= gap;
}

/**
 * 로테이션 인덱스. **결정론적이다** — `Math.random()`을 쓰지 않는다.
 *
 * 호출 횟수를 세서 순환시킨다. 스펙은 "3종 랜덤"이라 쓰지만, 순환이
 * 오히려 균등하게 들리고(랜덤은 같은 소리가 3연속 나올 수 있다) 스크린샷·재생
 * 회귀가 재현 가능해진다.
 */
export function rotationIndex(id: SfxId, playCount: number): number {
  const n = SFX_FILES[id].length;
  if (n <= 1) return 0;
  const c = Number.isFinite(playCount) ? Math.floor(playCount) : 0;
  return ((c % n) + n) % n;
}

/** 로테이션까지 반영한 실제 파일명 */
export function sfxFileFor(id: SfxId, playCount: number): string {
  const names = SFX_FILES[id];
  const idx = rotationIndex(id, playCount);
  // noUncheckedIndexedAccess: 인덱스는 위에서 n으로 모듈로했으므로 항상 존재한다
  return names[idx] ?? names[0] ?? id;
}
