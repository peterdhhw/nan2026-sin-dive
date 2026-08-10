/**
 * 딜을 창(window) 안에서 평균한 초당 값.
 *
 * **왜 필요한가 — `sqrt`는 스파이크를 깎는다.**
 * 게이지는 `dpsToPush(dps) = sqrt(dps)`를 쓴다. 그런데 딜을 **프레임 단위로**
 * 재서 프레임마다 `sqrt`를 걸면, 같은 총딜이라도 몰아서 낼수록 push가 작아진다
 * (Jensen 부등식: `mean(sqrt(x)) ≤ sqrt(mean(x))`).
 *
 * 실측(시드 7, 60초, 쿨마다 스킬):
 * - 총딜 18635 = 평균 dps 311 → 고르게 냈다면 push 17.62
 * - 프레임별 `sqrt` 평균 push는 **14.11 (−20.0%)**
 *
 * 즉 스킬을 쓸수록 손해였다. 자동 공격은 dps 98로 매 프레임 평평한데 스킬은
 * 400ms에 몰려 1848까지 튀므로, **스파이크가 큰 쪽이 더 많이 깎인다.** 유저가
 * "몬스터한테 들어가는 데미지가 줄다리기 바에 제대로 반영이 안 된다"고 본 것이
 * 이것이다 — 큰 숫자가 뜨는데 바는 그만큼 움직이지 않는다.
 *
 * **비대칭도 있었다.** 사람 상대는 200ms를 모아 보내므로(`SNAPSHOT_INTERVAL_MS`)
 * 이미 200ms 평균이 되어 도착한다. 우리 팀만 프레임 단위로 깎이고 있었다 —
 * 같은 실력이면 원격 상대가 유리한 구조다.
 *
 * 그래서 **양 팀 dps를 같은 창으로 평균한 뒤** push로 환산한다.
 * 창을 200ms로 두는 이유: 사람 상대의 스냅샷 주기와 같아야 두 경로가 같은
 * 평활도를 갖는다. 더 길게 잡으면 게이지 반응이 늦어져 인과가 끊긴다.
 *
 * 부수 효과로 바의 흐름 표시도 살아난다. 프레임 단위로는 `pushDiff`가
 * 프레임의 50%에서 정확히 0이었다(양쪽이 자동 공격만 낸 프레임) — 스트라이프가
 * 절반의 시간 동안 멈춰 있었다는 뜻이다.
 *
 * Pixi도 게임 계층도 import하지 않는다 — L1 순수 모듈이다.
 */

/**
 * 평활 창. 사람 상대의 스냅샷 주기(`SNAPSHOT_INTERVAL_MS = 200`)와 같은 값이다.
 * 두 상수를 잇지 않는 이유: L1은 `src/net`을 import할 수 없다. 대신 여기서
 * 근거를 적고 `tests/dpsWindow.test.ts`가 두 값이 같은지 고정한다.
 */
export const DPS_WINDOW_MS = 200;

interface Sample {
  /** 이 표본이 덮은 원시 딜 */
  readonly raw: number;
  /** 그 딜이 몇 ms 구간의 것인지 */
  readonly dtMs: number;
}

export interface DpsWindow {
  /**
   * 표본을 넣고 창 전체의 초당 딜을 돌려준다.
   *
   * @param raw 이 구간의 원시 딜 합
   * @param dtMs 그 구간의 길이. 0 이하면 창을 바꾸지 않고 현재 값만 준다
   */
  push(raw: number, dtMs: number): number;
  /** 지금 창의 초당 딜. 표본이 없으면 0 */
  value(): number;
}

export function createDpsWindow(windowMs = DPS_WINDOW_MS): DpsWindow {
  const cap = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DPS_WINDOW_MS;
  const samples: Sample[] = [];
  let sumRaw = 0;
  let sumDt = 0;

  const value = (): number => (sumDt > 0 ? (sumRaw / sumDt) * 1000 : 0);

  return {
    push(raw: number, dtMs: number): number {
      const dt = Number.isFinite(dtMs) ? dtMs : 0;
      if (!(dt > 0)) return value();
      const r = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      samples.push({ raw: r, dtMs: dt });
      sumRaw += r;
      sumDt += dt;
      // 창을 넘긴 오래된 표본을 앞에서 버린다. **가장 최근 표본은 남긴다** —
      // dt가 창보다 긴 한 방(탭 복귀 등)에 창이 비면 그 딜이 사라진다
      while (samples.length > 1 && sumDt - samples[0]!.dtMs >= cap) {
        const old = samples.shift()!;
        sumRaw -= old.raw;
        sumDt -= old.dtMs;
      }
      return value();
    },
    value,
  };
}
