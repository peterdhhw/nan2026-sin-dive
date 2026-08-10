/**
 * 게이지 바의 순수 규칙 — 치수, 채움 범위, 스트라이프 속도, 발광 세기.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §5
 *
 * Pixi를 import하지 않는다 (`gaugeBar.ts`가 재export한다).
 *
 * **왜 순수로 떼는가**: 스트라이프 흐름 방향과 발광 색은 "지금 누가 밀고 있는가"라는
 * 게임 상태를 직접 주장한다. 부호를 한 번 뒤집으면 유저는 이기는 중에 지는 것처럼
 * 읽는다 — 스크린샷으로는 절대 못 잡는 종류의 버그라 테스트로 고정한다.
 */

import { DEFAULT_WIN_THRESHOLD, dpsToPush } from "../core/gauge";

/** 바 높이. `layout.GAUGE_BAR_H`와 반드시 같아야 한다 (테스트로 고정) */
export const BAR_H = 56;

/** 좌우 끝 사선 폭 (§5 프레임) */
export const FRAME_SLANT = 12;
/** 어두운 아웃라인 두께 (§5) */
export const OUTLINE_W = 5;
/** 트랙 좌우 여백 — 사선 안쪽에 들어가야 한다 */
export const TRACK_PAD_X = FRAME_SLANT + OUTLINE_W;
export const TRACK_PAD_Y = 7;

/** 승리 임계치. 코어 값을 그대로 쓴다 — 눈금과 실제 승패가 어긋나면 안 된다 */
export const WIN_THRESHOLD = DEFAULT_WIN_THRESHOLD;
/** 임계선 펄스가 시작되는 게이지 절대값 (§5 동적 반응) */
export const DANGER_POS = 0.7;

// ── 사선 스트라이프 (§5: "밀고 있다"가 보이게)
/** 스트라이프 반복 주기(px) */
export const STRIPE_PERIOD_PX = 26;
/** 스트라이프 폭 */
export const STRIPE_W = 11;
/** push 차이 1당 스트라이프 속도(px/s) */
export const STRIPE_GAIN = 7;
/**
 * 0이 아닌 차이에 주는 최소 속도. 미세한 우위에서도 흐름이 보여야
 * "지금 밀고 있다"가 읽힌다.
 */
export const STRIPE_MIN_SPEED = 14;
/** 상한. 이보다 빠르면 스트로보처럼 보여서 오히려 정보가 죽는다 */
export const STRIPE_MAX_SPEED = 130;

/** 이 push 차이에서 마커 발광이 최대가 된다 */
export const GLOW_FULL_DIFF = 14;

/**
 * 파동을 줄 만한 한 방의 크기 (원시 딜).
 *
 * **처치에만 파동을 주고 있었다.** 실측(시드 7, 60초)하면 60초에 처치 46회,
 * 20딜 넘는 타격 410회다 — 큰 숫자가 뜨는 사건의 89%가 게이지 쪽에서
 * 아무 반응도 얻지 못했다. 스킬 한 방(power 700)이 잡몹을 못 죽이면
 * 화면에 700이 뜨는데 바는 조용하다. 그게 "데미지가 바에 반영이 안 된다"다.
 *
 * 값의 근거: 자동 공격 한 방은 40~58딜이고 `FLUSH_MS`(250ms)에 묶여 뜨므로
 * 한 덩어리가 대략 12~21딜이다. 이 값은 그 위에 있어야 자동 공격만으로 파동이
 * 상시 켜지지 않고, **가장 약한 스킬 밑에** 있어야 스킬이 조용해지지 않는다.
 * 두 부등식은 `gaugeBarRules.test.ts`가 프리셋에서 다시 계산해 지킨다.
 *
 * ## 120 → 80 (2026-08-10)
 *
 * 스킬 쿨을 오토 박자에 맞춰 줄이면서(`ROLE_NUMBERS`의 결정 기록) 시전 횟수가
 * 2.07배가 됐고, 층 예산을 지키려면 한 방의 `power`가 같이 내려가야 했다 —
 * 가장 약한 칸이 210 → **110**이다. 120은 그 사이에 끼어서, 연타 칸을 누르면
 * 화면에 110이 뜨는데 게이지는 조용한 상태가 됐다. 그게 위에 적힌 그 결함
 * ("데미지가 바에 반영이 안 된다")의 되돌아옴이다.
 *
 * 80은 자동 덩어리 최대(21 = 리제 58/700×250)의 3.8배이고 가장 약한 스킬
 * 110의 0.73배다 — 양쪽에 여유가 남는다. 딜을 다시 만질 때 이 값도 같이
 * 움직여야 한다는 것을 테스트가 알려 준다.
 */
export const SURGE_MIN_DEALT = 80;

/**
 * 파동 최소 간격. 큰 타격이 연달아 들어와도 파동은 이 주기로만 새로 시작한다 —
 * 매 타격에 주면 상시 켜져 있어 정보가 사라진다(원래 처치 전용이었던 이유다).
 */
export const SURGE_COOLDOWN_MS = 260;

/**
 * 이 타격이 파동을 일으키는가.
 *
 * @param dealt 이 타격의 원시 딜 (`hitAccumulator`가 묶어 준 값)
 * @param killed 처치했는가 — 크기와 무관하게 항상 준다
 * @param sinceLastMs 지난 파동 이후 경과. 음수/비유한이면 "처음"으로 본다
 */
export function shouldSurge(
  dealt: number,
  killed: boolean,
  sinceLastMs: number,
): boolean {
  const cooled =
    !Number.isFinite(sinceLastMs) || sinceLastMs < 0
      ? true
      : sinceLastMs >= SURGE_COOLDOWN_MS;
  // 처치는 결정적 사건이므로 간격을 무시한다 — 마지막 한 방이 조용하면 안 된다
  if (killed) return true;
  if (!Number.isFinite(dealt)) return false;
  return dealt >= SURGE_MIN_DEALT && cooled;
}

/** 임계선 펄스 주기 */
export const PULSE_PERIOD_MS = 720;
/** 큰 딜(처치)이 들어갔을 때 마커에서 퍼지는 파동 */
export const SURGE_MS = 380;
export const SURGE_MAX_R = 34;
/** 임계 도달 시 전체 흰 플래시 */
export const FLASH_MS = 240;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 양 팀 초당 딜 → push 차이.
 *
 * **코어(`applyPush`)와 같은 수식을 쓴다.** 여기서 다른 환산을 쓰면 바가
 * "우리가 밀고 있다"고 그리는 동안 게이지는 반대로 움직일 수 있다.
 */
export function pushDiff(myDps: number, theirDps: number): number {
  const a = Number.isFinite(myDps) ? Math.max(0, myDps) : 0;
  const b = Number.isFinite(theirDps) ? Math.max(0, theirDps) : 0;
  return dpsToPush(a) - dpsToPush(b);
}

/**
 * 스트라이프 속도(px/s, 부호 = 흐르는 방향).
 * 양수 = 우리 진영(오른쪽)으로 흐른다.
 */
export function stripeSpeed(diff: number): number {
  if (!Number.isFinite(diff) || diff === 0) return 0;
  const mag = clamp(
    Math.abs(diff) * STRIPE_GAIN,
    STRIPE_MIN_SPEED,
    STRIPE_MAX_SPEED,
  );
  return diff > 0 ? mag : -mag;
}

/** 스트라이프 오프셋을 dt만큼 전진시키고 주기 안으로 접는다 */
export function advanceStripe(
  offsetPx: number,
  speedPxPerSec: number,
  dtMs: number,
): number {
  const base = Number.isFinite(offsetPx) ? offsetPx : 0;
  const v = Number.isFinite(speedPxPerSec) ? speedPxPerSec : 0;
  const next = base + v * (Math.max(0, dtMs) / 1000);
  const m = next % STRIPE_PERIOD_PX;
  return m < 0 ? m + STRIPE_PERIOD_PX : m;
}

/** 마커 발광 세기 0..1 */
export function glowStrength(diff: number): number {
  if (!Number.isFinite(diff)) return 0;
  return Math.min(1, Math.abs(diff) / GLOW_FULL_DIFF);
}

export interface TrackRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 프레임 안쪽 트랙 사각형 */
export function trackRect(barW: number, barH: number): TrackRect {
  return {
    x: TRACK_PAD_X,
    y: TRACK_PAD_Y,
    w: Math.max(0, barW - TRACK_PAD_X * 2),
    h: Math.max(0, barH - TRACK_PAD_Y * 2),
  };
}

/** 게이지 위치 → 트랙 안 x. pos 0이 정확히 중앙이다 */
export function posToX(pos: number, track: TrackRect): number {
  return track.x + track.w / 2 + (track.w / 2) * clamp(pos, -1, 1);
}

export interface FillSpan {
  x: number;
  w: number;
  /** true = 우리 색으로 칠한다 */
  ours: boolean;
}

/** 중앙에서 마커까지의 채움 범위 */
export function fillSpan(pos: number, track: TrackRect): FillSpan {
  const p = clamp(pos, -1, 1);
  const center = track.x + track.w / 2;
  const half = (track.w / 2) * Math.abs(p);
  return p >= 0
    ? { x: center, w: half, ours: true }
    : { x: center - half, w: half, ours: false };
}

/** 임계선 펄스 0..1 */
export function thresholdPulse(elapsedMs: number): number {
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  return 0.5 + 0.5 * Math.sin((t / PULSE_PERIOD_MS) * Math.PI * 2);
}

/** 임계선을 펄스시켜야 하는 상태인지 (§5: |pos| ≥ 0.7) */
export function isDanger(pos: number): boolean {
  return Math.abs(clamp(pos, -1, 1)) >= DANGER_POS;
}

/**
 * 남은 수명 비율 1 → 0. 음수 경과(미시작 센티넬 -1)와 초과는 0이다.
 * 흰 플래시처럼 "한 번 터지고 사라지는" 연출 전부가 이걸 쓴다.
 */
export function fadeOut(elapsedMs: number, durationMs: number): number {
  if (!(elapsedMs >= 0) || !(durationMs > 0)) return 0;
  if (elapsedMs >= durationMs) return 0;
  return 1 - elapsedMs / durationMs;
}

export interface SurgePose {
  /** 마커에서 퍼지는 반지름(px) */
  radius: number;
  alpha: number;
  done: boolean;
}

/**
 * 처치 등 큰 딜 직후 마커에서 퍼지는 파동.
 *
 * 이게 `데미지 → 게이지` 연결의 유일한 시각 장치다 (README §3-2). 없으면
 * 유저는 적을 죽인 것과 게이지가 움직인 것을 별개 사건으로 본다.
 */
export function surgePose(elapsedMs: number): SurgePose {
  if (!(elapsedMs >= 0)) return { radius: 0, alpha: 0, done: true };
  const t = Math.min(1, elapsedMs / SURGE_MS);
  const ease = 1 - (1 - t) ** 3;
  return {
    radius: SURGE_MAX_R * ease,
    alpha: 1 - t,
    done: t >= 1,
  };
}
