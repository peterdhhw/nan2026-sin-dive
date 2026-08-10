/**
 * 데미지 숫자의 순수 규칙 — 풀 인덱스·모션 곡선·합산 판정.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C6
 *
 * Pixi를 import하지 않는다 (`damageText.ts`가 이걸 재export한다).
 * 링버퍼가 언제 산 숫자를 덮어쓰는지 같은 건 눈으로 확인할 수 없으므로
 * 반드시 테스트 가능한 형태로 떼어놨다.
 */

export type DamageKind = "normal" | "crit" | "interference";

/** 링버퍼 크기. 양 필드 합쳐 초당 ~40개 (§C6) */
export const POOL_SIZE = 40;

/** 한 프레임에 이 개수 이상이면 합산해서 하나로 띄운다 (§07-4-4) */
export const MERGE_THRESHOLD = 8;
/** 상대 필드는 더 이른 시점에 합산한다 — 정보 밀도가 낮아도 된다 (§C6) */
export const MERGE_THRESHOLD_THEIRS = 4;

export const LIFE_MS = 700;
/** 위로 떠오르는 거리 */
export const RISE_PX = 60;
/** 방해 숫자는 반대로 내려간다 — 방향이 곧 "누가 준 것인지"다 (§C6) */
export const INTERFERENCE_DROP_PX = 40;
/** 상대 필드 숫자는 작게 (§C6) */
export const THEIRS_SCALE = 0.85;

/** 크리티컬의 추가 배율 */
export const CRIT_SCALE = 1.3;
/** 크리티컬 x 흔들림 진폭(px)과 주기 */
export const CRIT_SHAKE_PX = 4;
export const CRIT_SHAKE_PERIOD_MS = 90;

/**
 * 링버퍼 다음 슬롯.
 *
 * 살아있는 숫자를 덮어쓰는 것을 **허용한다** — 초당 40개를 넘으면 가장 오래된
 * 것이 사라지는 게, 풀을 늘려 GC를 흔드는 것보다 낫다. 어차피 그 상황에서는
 * 개별 숫자를 읽을 수 없다.
 */
export function nextSlot(cursor: number): number {
  return (cursor + 1) % POOL_SIZE;
}

/** 합산할지 판정. 이번 프레임에 이미 몇 개 띄웠는지로 결정한다 */
export function shouldMerge(countThisFrame: number, mine: boolean): boolean {
  const limit = mine ? MERGE_THRESHOLD : MERGE_THRESHOLD_THEIRS;
  return countThisFrame >= limit;
}

export interface DamageMotion {
  /** 시작점 기준 오프셋 */
  dx: number;
  dy: number;
  alpha: number;
  scale: number;
}

/**
 * 경과 시간에 대한 모션. 필드 미러링·필드 좌표 변환은 호출자가 한다.
 *
 * @param jitterX 발생 시 한 번 뽑은 좌우 지터. `waveRng` 결정론 (§C6)
 */
export function motionAt(
  elapsedMs: number,
  kind: DamageKind,
  jitterX: number,
): DamageMotion {
  const raw = LIFE_MS > 0 ? elapsedMs / LIFE_MS : 1;
  const t = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));

  // 위로 떠오르는 건 감속(easeOutCubic) — 처음에 확 튀고 끝에서 멈춘다
  const ease = 1 - (1 - t) ** 3;
  const rise = kind === "interference" ? -INTERFERENCE_DROP_PX : RISE_PX;

  // 알파는 뒤쪽 40%에서만 빠진다. 처음부터 흐려지면 읽을 시간이 없다
  const fadeStart = 0.6;
  const alpha = t <= fadeStart ? 1 : 1 - (t - fadeStart) / (1 - fadeStart);

  let scale = 1;
  let dx = jitterX;
  if (kind === "crit") {
    // 튀어나오는 팝. 앞 25%에서 CRIT_SCALE까지 갔다가 1.0으로 안정된다
    const pop = t < 0.25 ? t / 0.25 : 1;
    scale =
      1 +
      (CRIT_SCALE - 1) * (t < 0.25 ? pop : Math.max(0, 1 - (t - 0.25) / 0.35));
    // 결정론 흔들림 — Math.random() 금지 (§C6)
    dx +=
      Math.sin((elapsedMs / CRIT_SHAKE_PERIOD_MS) * Math.PI * 2) *
      CRIT_SHAKE_PX *
      (1 - t);
  }

  return { dx, dy: -rise * ease, alpha: Math.max(0, alpha), scale };
}

/** 수명이 끝났는지 */
export function isExpired(elapsedMs: number): boolean {
  return !(elapsedMs < LIFE_MS);
}

// ── 겹침 회피
/** 이 거리 안에 있으면 "같은 자리"로 본다 */
export const CROWD_RADIUS_PX = 34;
/** 겹칠 때 한 단계당 위로 밀어내는 거리 */
export const STAGGER_PX = 26;
/** 계단을 쌓는 최대 단계. 그 이상은 화면 밖으로 나간다 */
export const STAGGER_MAX = 3;

/**
 * 같은 자리에 이미 뜬 숫자 개수 → y 오프셋.
 *
 * 왜 필요한가: 누적기가 적당 250ms마다 숫자를 내보내지만 숫자 수명은 700ms라
 * 한 적 머리 위에 최대 3개가 동시에 존재한다. 지터(±14px)만으로는 겹쳐서
 * 한 덩어리로 읽힌다 — 첫 스크린샷에서 확인했다.
 *
 * **아래로** 밀어낸다. 위로 쌓으면 머리 위 HP바를 침범한다 (§C5의 바 위치와
 * 충돌) — 두 번째 스크린샷에서 확인했다. 숫자는 이미 위로 떠오르므로
 * 아래에서 출발해도 결국 같은 궤적을 그린다.
 */
export function staggerOffset(crowd: number): number {
  const n = Math.max(0, Math.min(STAGGER_MAX, Math.floor(crowd)));
  return STAGGER_PX * n;
}
