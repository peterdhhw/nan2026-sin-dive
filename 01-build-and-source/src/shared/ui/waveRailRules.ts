/**
 * 웨이브 진행 레일의 순수 규칙 — 칸 좌표·마커 위치·보스 판정.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C7
 *
 * Pixi를 import하지 않는다 (`ui/waveRail.ts`가 재export한다).
 */

/** 웨이브 수 고정 5 (§C7). 마지막 칸이 보스다 */
export const WAVE_COUNT = 5;

/** 레일 높이 — 게이지 바와 시각 비중을 겨루지 않게 14px로 못박았다 (§C7 결정 기록) */
export const RAIL_H = 14;

/**
 * 눈금 마커 크기(반 변). 도트 룩에서 눈금은 원이 아니라 사각이라 "반지름"이
 * 아니지만, 같은 값이 같은 크기를 뜻하므로 이름을 바꾸지 않는다 — 그리는 쪽이
 * 격자로 접는다(§C7의 크기 결정을 여기 한 곳에 둔다).
 */
export const TICK_R = 5;
export const MARKER_SIZE = 8;

/** 지나온 칸 / 남은 칸 알파 (§C7) */
export const PASSED_ALPHA = 0.7;
export const REMAIN_ALPHA = 0.4;

/**
 * i번째 칸의 x 좌표(0..1).
 *
 * 양 끝에 칸이 붙는다 — 첫 칸이 0, 마지막(보스)이 1. 안쪽으로 밀면 레일 선이
 * 칸보다 길게 삐져나와 "아직 남은 칸이 있다"로 오독된다.
 */
export function tickX(index: number, count: number = WAVE_COUNT): number {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return 0;
  const i = Math.max(0, Math.min(n - 1, Math.floor(index)));
  return i / (n - 1);
}

/**
 * 마커 x(0..1) — 현재 웨이브 + 웨이브 내 진행률.
 *
 * 진행률은 처치 수/총 수다. 칸 사이를 **부드럽게** 이동해야 "지금 어디쯤인가"가
 * 실시간 정보가 된다 — 칸 단위로 튀면 웨이브가 넘어갈 때만 움직이는
 * 이산 표기가 되어 레일을 볼 이유가 없어진다.
 */
export function markerX(
  waveIndex: number,
  progress: number,
  count: number = WAVE_COUNT,
): number {
  const n = Math.max(1, Math.floor(count));
  const i = Math.max(0, Math.min(n - 1, Math.floor(waveIndex)));
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const here = tickX(i, n);
  const next = tickX(i + 1, n);
  return here + (next - here) * p;
}

/** 마지막 칸 = 보스 웨이브 */
export function isBossIndex(
  index: number,
  count: number = WAVE_COUNT,
): boolean {
  const n = Math.max(1, Math.floor(count));
  return Math.floor(index) === n - 1;
}

/**
 * 절대 웨이브 인덱스 → 레일 칸 인덱스(0..count-1).
 *
 * 코어는 40웨이브를 만들고(`DEFAULT_WAVE_COUNT`) 5웨이브마다 보스다
 * (`BOSS_EVERY`). 레일 칸이 5개니까 절대 인덱스를 그대로 쓰면 6웨이브부터
 * 마커가 오른쪽 끝에 박혀서 "영원히 보스 직전"으로 보인다.
 * **보스 주기 안의 위치**를 보여준다 — 구름 라벨이 절대 번호를 말하므로
 * 어디쯤인지는 잃지 않는다.
 */
export function railIndex(
  waveIndex: number,
  count: number = WAVE_COUNT,
): number {
  const n = Math.max(1, Math.floor(count));
  const i = Number.isFinite(waveIndex) ? Math.max(0, Math.floor(waveIndex)) : 0;
  return i % n;
}

/** 지나온 칸인지 — 현재 칸도 "도달했다"로 센다 */
export function isPassed(index: number, waveIndex: number): boolean {
  return Math.floor(index) <= Math.floor(waveIndex);
}

/** 보스 칸 붉은 펄스 (도달 시에만) */
export const BOSS_PULSE_MS = 900;

export function bossPulse(elapsedMs: number): number {
  if (!(elapsedMs >= 0)) return 0;
  const t = (elapsedMs % BOSS_PULSE_MS) / BOSS_PULSE_MS;
  return 0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
}

/** 웨이브 라벨 변경 시 펄스 (§3 HUD: scale 펄스 + 금색 플래시) */
export const LABEL_PULSE_MS = 320;
export const LABEL_PULSE_SCALE = 1.16;

export function labelPulse(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= LABEL_PULSE_MS) return 1;
  const t = elapsedMs / LABEL_PULSE_MS;
  return 1 + (LABEL_PULSE_SCALE - 1) * Math.sin(t * Math.PI);
}

export function labelFlashAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= LABEL_PULSE_MS) return 0;
  return 1 - elapsedMs / LABEL_PULSE_MS;
}

/** 웨이브 번호(1-based) 라벨 */
export function waveLabel(waveIndex: number): string {
  const i = Number.isFinite(waveIndex) ? Math.max(0, Math.floor(waveIndex)) : 0;
  return `WAVE ${i + 1}`;
}
