/**
 * 이징 함수와 트위너.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §4 (모션)
 *
 * **모든 트윈은 결정론적이다** — `elapsedMs`를 누적해서 계산하고 `Date.now()`를
 * 쓰지 않는다. 스크린샷 회귀 검증(`tools/shot.mjs`)이 재현 가능해야 하기 때문이다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

/** 0..1 밖으로 나간 진행도를 접는다. 모든 ease 함수의 입구에서 쓴다 */
function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function linear(t: number): number {
  return clamp01(t);
}

/** 버튼 눌림 (§4) */
export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

/** 데미지 숫자 상승·패널 등장 (§4) */
export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/**
 * 팝업 등장 — 목표를 살짝 넘어갔다 돌아온다 (§4).
 *
 * `overshoot`는 기본 1.7(스펙값). 1.0을 넘겨서 반환하는 건 의도다 —
 * 호출부에서 clamp하면 이 이징의 의미가 없어진다.
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const x = clamp01(t);
  const c = overshoot + 1;
  return 1 + c * (x - 1) ** 3 + overshoot * (x - 1) ** 2;
}

export type EaseFn = (t: number) => number;

/**
 * 반감기 방식 추종. `layout.lerpRatio`와 같은 계산이며,
 * HP 바 감소(180ms)처럼 "목표가 계속 바뀌는" 값에 쓴다.
 *
 * 프레임레이트에 독립적이다 — dt가 커도 목표를 지나치지 않는다.
 */
export function approach(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0 || dtMs <= 0) return dtMs > 0 ? target : current;
  const k = 2 ** (-dtMs / halfLifeMs);
  return target + (current - target) * k;
}

/**
 * 한 번 재생되고 끝나는 트윈.
 *
 * `update(dtMs)`로 시간을 밀어 넣고 `value`를 읽는다. 진행도가 1에 도달하면
 * `done`이 true가 되고 그 뒤로는 값이 변하지 않는다.
 *
 * 풀링을 고려해 `restart()`로 재사용 가능하게 했다 — 데미지 숫자 40개
 * 링버퍼(§C6)가 매번 새 객체를 만들지 않아야 한다.
 */
export class Tween {
  private elapsed = 0;

  constructor(
    private from: number,
    private to: number,
    private durationMs: number,
    private ease: EaseFn = easeOutCubic,
    /** 시작 전 지연. 결과 화면의 순차 카운트업(§08-1)에 쓴다 */
    private delayMs = 0,
  ) {}

  get progress(): number {
    if (this.durationMs <= 0) return 1;
    const t = (this.elapsed - this.delayMs) / this.durationMs;
    return clamp01(t);
  }

  get done(): boolean {
    return this.elapsed >= this.delayMs + this.durationMs;
  }

  /** 지연 구간에서는 시작값을 유지한다 (0으로 튀지 않게) */
  get value(): number {
    return this.from + (this.to - this.from) * this.ease(this.progress);
  }

  update(dtMs: number): void {
    if (dtMs > 0) this.elapsed += dtMs;
  }

  restart(from = this.from, to = this.to, durationMs = this.durationMs): void {
    this.from = from;
    this.to = to;
    this.durationMs = durationMs;
    this.elapsed = 0;
  }

  /** 즉시 끝 상태로. 씬 전환 중 남은 트윈을 정리할 때 쓴다 */
  finish(): void {
    this.elapsed = this.delayMs + this.durationMs;
  }
}

/**
 * `sin` 기반 아이들 부유 (§4: 배경 부유물·구름 ±6px, 주기 3.2s).
 *
 * 누적 시간만 받는 순수 함수로 둔다 — 상태를 갖지 않으므로 어디서나 쓸 수 있고
 * 같은 `elapsedMs`에 항상 같은 값이 나온다.
 */
export function floatOffset(
  elapsedMs: number,
  amplitude = 6,
  periodMs = 3200,
  phase = 0,
): number {
  if (periodMs <= 0) return 0;
  return Math.sin((elapsedMs / periodMs) * Math.PI * 2 + phase) * amplitude;
}
