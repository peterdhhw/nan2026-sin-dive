export interface GaugeState {
  /** -1 = 상대 완승, 0 = 균형, +1 = 우리 완승 */
  pos: number;
}

/**
 * push 차이 1당 초당 게이지 이동량 (튜닝 상수).
 * 프리셋 로드아웃 + 기본 AI 난이도로 시뮬레이션해 맞춘 값이다:
 * 스킬을 쿨마다 쓰면 약 61초에 임계치 0.8로 승리하고, **방치하면 120초 판정에서
 * 진다**(게이지 -0.49~-0.32) — 스킬 조작이 승패를 뒤집는 구간이다.
 * (회귀 테스트: tests/pacing.test.ts)
 *
 * 방치가 이기던 것을 2026-08-06에 뒤집었다. 그때 만진 것은 이 상수가 아니라
 * 상대 팀 인원 + 난이도 스칼라다 — 근거는 `ai/aiOpponentSource.ts`의 결정 기록.
 * 이 상수는 **판의 길이**를 정하고, 난이도는 그쪽 스칼라가 정한다.
 */
export const GAUGE_RATE = 0.0025;
/**
 * 화면 점유율 하한/상한.
 *
 * 0.28은 "모든 정보를 유지할 수 있는 최소 필드 높이"에서 역산한 값이다:
 * 가변 구간 840px × 0.28 = 235px → 아군 키 129px + 머리 위 HP바 12px +
 * 데미지 숫자 25px가 지면(h×0.88) 위에 다 들어간다.
 *
 * 이전 값 0.1(=84px)은 캐릭터를 그릴 수 없어서, 밀리는 쪽이 게임을 읽는 수단을
 * 잃고 역전 시도가 불가능해졌다 — PvP에서 가장 나쁜 데스 스파이럴이다.
 * 밀림의 압박은 2.6배 진폭(235↔605px) + 게이지 바 수치·색으로 충분히 전달된다.
 * (설계 문서 07-1)
 */
export const RATIO_MIN = 0.28;
export const RATIO_MAX = 0.72;
/** 승리 임계치 (플레이테스트 튜닝 대상) */
export const DEFAULT_WIN_THRESHOLD = 0.8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 초당 딜(dps)을 push로 환산한다. sqrt 체감이라 dps 4배 → push 2배.
 * 레벨 격차가 즉사로 이어지지 않게 스노우볼을 억제한다.
 *
 * **입력은 반드시 초당 값이다.** 틱당 딜을 그대로 넣으면 (a) push가 sqrt(dt)만큼
 * 작아져 게이지가 거의 안 움직이고, (b) dt가 다른 클라이언트끼리 값이 어긋난다.
 */
export function dpsToPush(dps: number): number {
  return Math.sqrt(Math.max(0, dps));
}

/**
 * @param startPos 시작 위치. 기본 0(균형). 범위 밖은 접는다.
 *   0이 아닌 값은 디버그 진입(`?gauge=`)만 쓴다 — 설계 문서 09-3.
 */
export function createGauge(startPos = 0): GaugeState {
  return { pos: Number.isFinite(startPos) ? clamp(startPos, -1, 1) : 0 };
}

/** 새 GaugeState를 반환한다 (입력 불변). */
export function applyPush(
  gauge: GaugeState,
  myPush: number,
  theirPush: number,
  dtMs: number,
): GaugeState {
  const delta = (myPush - theirPush) * GAUGE_RATE * (dtMs / 1000);
  return { pos: clamp(gauge.pos + delta, -1, 1) };
}

/** 임계치에 도달한 팀 번호, 아직이면 null. */
export function gaugeWinner(
  gauge: GaugeState,
  threshold: number,
): 0 | 1 | null {
  if (gauge.pos >= threshold) return 0;
  if (gauge.pos <= -threshold) return 1;
  return null;
}

/** 게이지 위치 → 우리 팀 화면 점유율 (상단 비율). */
export function gaugeToViewportRatio(pos: number): number {
  const p = clamp(pos, -1, 1);
  const half = (RATIO_MAX - RATIO_MIN) / 2;
  // 출력도 clamp한다 — 부동소수점 오차로 경계를 미세하게 넘는 것을 막는다.
  return clamp(0.5 + p * half, RATIO_MIN, RATIO_MAX);
}
