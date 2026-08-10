/**
 * 층 → 페이즈 → 적 HP. 9,999층을 유한한 수로 다루는 규칙.
 *
 * 설계 문서: docs/WORLD.md §2, docs/GAPS.md §2
 *
 * ## 왜 이 파일이 필요한가
 *
 * 층당 복리 곡선은 층수가 커지면 `Infinity`가 된다 — 1.12로는 n=2726, 1.06으로도
 * `10^253`이라 배정수 범위를 한참 넘는다. SIN DIVE는 9,999층이므로 지수를
 * 페이즈마다 리셋한다.
 *
 * ## 성장률을 `core/waves.ts`에서 더 이상 가져오지 않는다 (2026-08-05)
 *
 * 예전에는 `HP_GROWTH_PER_FLOOR = HP_GROWTH_PER_WAVE`(1.12)로 PvP 상수를
 * 가져왔고, 근거는 "phase 0에서 두 식이 같은 수를 내야 PvP 실측 밸런스가
 * 보존된다"였다. **그 근거는 이미 사실이 아니었다** — 싱글의 실제 적 HP는
 * `phaseWaves.singleFloorHpMul`이 1.06으로 따로 계산하고 있었고(그 파일 머리
 * 주석이 1.12를 쓰지 않는 이유를 적어 뒀다), 여기의 `floorHpMul`은 프로덕션에서
 * 아무도 부르지 않는 진단·문서용 함수였다. 즉 import는 "두 모드가 같은 곡선을
 * 쓴다"고 말하면서 실제로는 어느 쪽도 그 값을 안 쓰는 상태였다.
 *
 * PvP가 층 **예산** 모델로 바뀌면서(`core/waves.ts` 머리 주석) 그 파일에는
 * 이제 "개체 HP의 층당 배율"이라는 개념이 없다. 그래서 이 파일이 싱글의
 * 성장률을 **직접 소유**한다 — 싱글 전용 모듈이므로 그게 제 자리다.
 * `phaseWaves`가 여기서 가져가 쓰므로 정의는 여전히 한 곳뿐이다.
 */

/** 페이즈 하나의 층수 */
export const FLOORS_PER_PHASE = 1000;

/** 마지막 층. 9,999층이 제로 프론티어 코어다 */
export const FINAL_FLOOR = 9999;

/** 페이즈 수 (0..9) */
export const PHASE_COUNT = 10;

/**
 * 층 성장률 (페이즈 안에서 복리) — **싱글의 값이다.**
 *
 * 여기가 정의 지점이고 `phaseWaves.SINGLE_HP_GROWTH`가 이걸 가져간다. 두 곳에
 * 적으면 한쪽만 고쳤을 때 테스트는 통과하면서 근거만 사라진다. 1.06을 고른
 * 이유(방치형 수십 분 × 수백 층, 강화가 따라잡아야 하는 곡선)는
 * `phaseWaves.ts` 머리 주석에 있다.
 */
export const HP_GROWTH_PER_FLOOR = 1.06;

/**
 * 페이즈 인덱스. **1층이 phase 0의 첫 층이다.**
 *
 * `floor(층 / 1000)`이 아니라 `floor((층-1) / 1000)`이다. 앞의 식은 1,000층에서
 * phase 1 / local 0을 내는데, `local`은 1..1000이어야 하고 1,000층은 표(WORLD.md
 * §2)에서 phase 0의 마지막 층이다. 경계 한 층이 다음 페이즈의 0번째 층으로
 * 새면 그 층의 HP가 `BASE × 1.12^(-1)`이 되어 **직전 층보다 약해진다** —
 * 페이즈 경계의 의도된 HP 하락과 섞여서 눈으로는 구별되지 않는다.
 */
export function phaseOf(floor: number): number {
  const f = clampFloor(floor);
  return Math.floor((f - 1) / FLOORS_PER_PHASE);
}

/** 페이즈 안에서의 층 번호. **1..1000** (0이 아니다 — `phaseOf` 주석) */
export function localFloorOf(floor: number): number {
  const f = clampFloor(floor);
  return f - phaseOf(f) * FLOORS_PER_PHASE;
}

/** 1..9999로 접는다. 유한하지 않은 값은 1층으로 본다 */
export function clampFloor(floor: number): number {
  if (!Number.isFinite(floor)) return 1;
  return Math.max(1, Math.min(FINAL_FLOOR, Math.floor(floor)));
}

/** 이 페이즈의 첫 층 (1-based) */
export function firstFloorOf(phase: number): number {
  return clampPhase(phase) * FLOORS_PER_PHASE + 1;
}

/** 이 페이즈의 마지막 층. 마지막 페이즈만 9,999층으로 끝난다 (1,000층이 아니다) */
export function lastFloorOf(phase: number): number {
  const p = clampPhase(phase);
  return Math.min(FINAL_FLOOR, (p + 1) * FLOORS_PER_PHASE);
}

/** 0..9로 접는다 */
export function clampPhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(phase)));
}

/**
 * 이 층의 HP 배율. `HP_GROWTH_PER_FLOOR^(local-1)`이다 — 페이즈의 첫 층이 항상 1배다.
 *
 * @param floor 1..9999
 */
export function floorHpMul(floor: number): number {
  return Math.pow(HP_GROWTH_PER_FLOOR, localFloorOf(floor) - 1);
}

/**
 * 이 층의 HP가 정확한 정수 범위를 넘는가.
 *
 * **페이즈 리셋은 `Infinity`를 없애지만 정밀도는 못 살린다.** `baseHp = 100`
 * (지금의 `SINGLE_MINION_BASE_HP`)이면 `local`이 553쯤에서
 * `Number.MAX_SAFE_INTEGER`를 넘고, 그 뒤의 HP는 정수 단위가 어긋나는
 * 부동소수다 — 딜 100을 넣어도 남은 HP가 그대로인 층이 생긴다. 페이즈 하나가
 * 1,000층이므로 후반 450층이 그 구간이다.
 *
 * 지금은 프로덕션에서 아무도 부르지 않는다 — **싱글이 깊은 층을 굴리기
 * 시작하면 여기가 참이 되는 지점에서 딜 계산이 조용히 틀린다.** 그 전에
 * 알아채기 위한 물음이고, 경계를 상수로 박지 않은 이유는 그 값이 `baseHp`에
 * 딸려 있어서다(`BASE[1..9]`가 미정이므로 상수로 적으면 곧 거짓이 된다).
 *
 * 이 함수가 참이 되는 층이 존재한다는 것 자체가 미결 항목이다 — `BASE[1..9]`를
 * 정할 때 표현 방식(큰 수 표기 / 층당 성장률 완화)을 같이 정해야 한다
 * → `docs/GAPS.md` §2.
 */
export function exceedsExactRange(baseHp: number, floor: number): boolean {
  return baseHp * floorHpMul(floor) > Number.MAX_SAFE_INTEGER;
}

/**
 * `baseHp`로 정확히 표현할 수 있는 마지막 `local` 층. 없으면 `FLOORS_PER_PHASE`.
 *
 * 상수로 적지 않고 유도한다 — 유래(`baseHp`, 성장률)가 바뀌면 값도 따라와야
 * 하고, 값만 남으면 "테스트는 통과하는데 의미만 달라진" 상태가 된다.
 */
export function lastExactLocalFloor(baseHp: number): number {
  for (let local = 1; local <= FLOORS_PER_PHASE; local++) {
    if (baseHp * Math.pow(HP_GROWTH_PER_FLOOR, local - 1) > Number.MAX_SAFE_INTEGER) {
      return local - 1;
    }
  }
  return FLOORS_PER_PHASE;
}

/** 페이즈 한 칸의 서사·환경 (WORLD.md §2 표). 표시 문자열이므로 계산엔 안 쓴다 */
export interface PhaseInfo {
  index: number;
  firstFloor: number;
  lastFloor: number;
  /** 환경 이름 — 기획서 §3.3 */
  name: string;
}

/**
 * 10페이즈 표. **배경 그림은 2종뿐이다** — 이 표가 10칸이라는 것이 배경이
 * 10종 있다는 뜻은 아니다 (`docs/GAPS.md` §3).
 */
export const PHASES: readonly PhaseInfo[] = [
  "표층 지각 & 달콤한 환청 지대",
  "붉은 증기의 온천 & 고열 구역",
  "체렌코프 네온 광원 지대",
  "흑염의 이온 폭풍 구역",
  "몽마의 독안개 & 무의식 층",
  "서리 여왕의 영원 빙하 층",
  "심연의 속박 & 중력 챔버",
  "시공간 환영 무도회",
  "에테르 승천 경계 Zone",
  "제로 프론티어 코어",
].map((name, index) => ({
  index,
  firstFloor: firstFloorOf(index),
  lastFloor: lastFloorOf(index),
  name,
}));

export function phaseInfoOf(floor: number): PhaseInfo {
  // `phaseOf`가 0..9로 접으므로 항상 존재한다
  return PHASES[phaseOf(floor)] as PhaseInfo;
}
