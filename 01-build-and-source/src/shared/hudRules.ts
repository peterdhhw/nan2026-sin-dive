/**
 * HUD의 순수 규칙 — 타이머 경고·게이지 방향 표기·플래시 시간.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §3
 *
 * Pixi를 import하지 않는다 (`hud.ts`가 재export한다).
 */

import { formatGauge } from "./format";

/** 남은 시간이 이 이하면 붉게 + 매초 펄스 (§3) */
export const TIMER_WARN_MS = 10_000;

export function timerWarning(remainingMs: number): boolean {
  return Number.isFinite(remainingMs) && remainingMs <= TIMER_WARN_MS;
}

/** 매초 펄스 (§3: scale 1.12) */
export const TIMER_PULSE_MS = 260;
export const TIMER_PULSE_SCALE = 1.12;

export function timerPulse(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= TIMER_PULSE_MS) return 1;
  const t = elapsedMs / TIMER_PULSE_MS;
  return 1 + (TIMER_PULSE_SCALE - 1) * Math.sin(t * Math.PI);
}

/**
 * 게이지 수치 표기 — 방향 삼각 + 절대값 (§3).
 *
 * **색만으로 우열을 말하지 않는다** (§01-6 색맹 대응). `▲`는 우리가 밀고 있다,
 * `▼`는 밀리고 있다. `formatGauge`의 부호를 그대로 쓰지 않는 이유는 `+0.32`가
 * "게이지 좌표"로 읽혀서 무엇이 좋은 건지 알 수 없기 때문이다.
 */
export function gaugeReadout(pos: number): string {
  const v = Number.isFinite(pos) ? pos : 0;
  const abs = formatGauge(v).slice(1);
  if (abs === "0.00") return `= ${abs}`;
  return `${v > 0 ? "▲" : "▼"} ${abs}`;
}

/** 방해 피격 시 HUD 전체 플래시 (§3: 60ms) */
export const HUD_FLASH_MS = 60;

export function hudFlashAlpha(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= HUD_FLASH_MS) return 0;
  return 1 - elapsedMs / HUD_FLASH_MS;
}

/**
 * `?debug=1`의 dps 표기.
 *
 * `chars`를 주면 살아 있는 캐릭터 스프라이트 수를 뒤에 붙인다 — 재대전이
 * 리로드가 아니라서(§08-5) `destroy()`를 한 번 빼먹으면 판마다 캐릭터가
 * 쌓이는데, 화면만 봐서는 절대 보이지 않는다 (§09-4 누수 위험).
 */
export function dpsReadout(
  myDps: number,
  theirDps: number,
  chars?: number,
): string {
  const f = (n: number): string => (Number.isFinite(n) ? n.toFixed(0) : "0");
  const base = `${f(myDps)} / ${f(theirDps)}`;
  return chars === undefined ? base : `${base}  ch ${f(chars)}`;
}
