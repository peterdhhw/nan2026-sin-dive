/**
 * 싱글(하강 모드) 웨이브 생성기. 층 번호 기준으로 적 무리를 만든다.
 *
 * 설계 문서: docs/WORLD.md §2, docs/GAPS.md §2, docs/SINGLE-BRIEF.md §4
 *
 * ## `core/waves.ts`와 별개인 이유
 *
 * PvP의 `generateWaves`는 40층 한 판 전제이고, 그 상수(1.12 성장·5층 보스)에
 * PvP 밸런스가 실측으로 묶여 있다(`docs/specs/2026-08-02-battle-balance.md`).
 * 싱글은 (a) 9,999층을 다루고 (b) 보스 주기가 기획서 기준(100층 네임드 보스,
 * 10층 미니보스 — 2026-08-03 정호 확정)이라 규칙 자체가 다르다. 그 파일을
 * 고치지 않고 새로 만든다.
 *
 * ## 층당 성장률이 1.12가 아니라 1.06인 이유
 *
 * 1.12는 "120초에 20층" 페이스로 실측된 PvP용 값이다. 싱글은 수십 분에 걸쳐
 * 수백 층을 내려가는 방치형이고, 성장(강화)이 따라잡아야 하는 곡선이므로 층당
 * 복리를 절반으로 낮춘다. 1.12를 그대로 쓰면 100층 잡몹이 1층의 7.3만 배가
 * 되어 사전과제 데모(5~10분)에서 100층 보스를 만날 수 없다.
 * (GAPS.md §2 미정 2의 선택지 중 "층당 성장률을 낮춘다"를 택한 것.)
 *
 * ## 청크(윈도) 생성과 결정론
 *
 * 9,999층을 배열 하나로 만들 수 없으므로 세션이 필요한 구간만 잘라 만든다.
 * 층 하나의 적 구성은 `mixFloorSeed(seed, floor)`에서 파생한 독립 RNG로만
 * 결정되므로 **어느 구간으로 잘라 생성해도 같은 층은 같은 무리가 나온다**
 * (청크 경계 무관 — 테스트가 고정한다).
 */

import { createRng } from "../rng";
import type { EnemyDef, WaveDef } from "../types";
import {
  clampFloor,
  localFloorOf,
  phaseOf,
  FINAL_FLOOR,
  HP_GROWTH_PER_FLOOR,
} from "./floors";

/**
 * 싱글 층당 HP 성장률 (페이즈 안에서 복리). 1.12가 아닌 이유는 파일 머리 주석.
 *
 * **`floors.ts`에서 가져온다 — 여기에 1.06을 다시 적지 않는다.** 두 곳에 적으면
 * 한쪽만 고쳤을 때 `floorHpMul`(진단·문서용)과 실제 적 HP가 조용히 갈라진다.
 */
export const SINGLE_HP_GROWTH = HP_GROWTH_PER_FLOOR;

/** phase 0 잡몹 기준 HP. PvP 1층과 같은 체감으로 시작한다 */
export const SINGLE_MINION_BASE_HP = 100;

/** 10층마다 미니보스 — 방치형의 단기 목표 리듬 (2026-08-03 확정) */
export const MINIBOSS_EVERY = 10;

/** 100층마다 네임드 보스 — 기획서 §5.4의 보스 스크립트 지점 */
export const NAMED_BOSS_EVERY = 100;

/** 미니보스 HP = 그 층 잡몹 기준 HP × 이 값 */
export const MINIBOSS_HP_MULT = 6;

/** 네임드 보스 HP = 그 층 잡몹 기준 HP × 이 값 */
export const NAMED_BOSS_HP_MULT = 20;

/**
 * 싱글 1인의 적 표시 HP 배율. **골드에는 곱하지 않는다**(`EnemyDef.goldHp`).
 *
 * 0.7의 유도(40분 시뮬레이션, 100F 도달 시각):
 *
 * | 조건 | 30F | 50F | 100F | 200F | 기준선 대비 |
 * |---|---|---|---|---|---|
 * | 기준선 2인 | 25s | 45s | 106s | 284s | — |
 * | 1인 무보정 | 33s | 60s | 153s | 422s | +44% |
 * | 1인 ×0.8 + 골드 분리 | 27s | 48s | 122s | 339s | +15% |
 * | **1인 ×0.7 + 골드 분리** | 23s | 43s | **108s** | 298s | **+2%** |
 * | 1인 ×0.6 + 골드 분리 | 18s | 36s | 91s | 255s | −14% |
 *
 * 네 지점 전부 ±10% 안에 드는 것이 0.7뿐이다. 골드를 분리하지 않으면 어떤 값도
 * 안 된다 — hp×0.5에서도 100F가 133s다.
 *
 * 대안으로 검토하고 기각한 것: 평타 ×2.2(100F 106s로 맞지만 "혼자 두 배 센
 * 캐릭터"가 되어 `ROLE_TEMPLATES` 캐릭터별 스탯표와 어긋난다 — 캐릭터를 바꿔도
 * 딜이 같아진다), 골드 ×2(100F 81s로 **오히려 빨라진다** — 강화 곡선을 건드려
 * 후반이 과열).
 *
 * **PvP는 이 배율을 안 쓴다**(`core/waves.ts`) — 2:2 팀 크기가 안 바뀐다.
 */
export const SOLO_HP_SCALE = 0.7;

/**
 * 도입부에 층 HP를 몇 배로 덧대는가 (유저 신고: "1층부터 10층까지 너무 빨리 넘어가").
 *
 * **왜 이게 필요한가 — 실측.** 프로덕션 상수로 seed 42를 돌리면 1층부터 7층까지가
 * **0.4초**에 지나간다. 원인은 페이스 상수가 아니라 **개막 일제 사격**이다: 레벨 0
 * 스킬 셋(quick 210 · combo 390 · burst 700)이 첫 프레임에 전부 시전되어 1초에
 * 누적 1,383 딜이 들어가는데, 1~7층 표시 HP 총합이 1,058이다. 층이 "빨리
 * 지나가는" 것이 아니라 **한 번의 사격이 일곱 층을 관통한다.**
 *
 * 그래서 손잡이를 딜 쪽에 걸지 않는다 — 개막 사격을 깎으면 첫 타격의 쾌감이
 * 사라지고, 그건 방치형이 유일하게 확실히 주는 것이다
 * (`balance-knob-cant-replace-missing-structure`: 스칼라 하나로 두 계약을 못 맞춘다).
 * 대신 **도입부에만 HP를 덧대** 사격이 관통하지 못하게 한다.
 *
 * 값은 시뮬레이션 스윕으로 잡았다(`tests/singlePacing.test.ts`의 모델, seed 42,
 * 아래 한 마리 규칙 포함). 표시 시각은 **전투 시간만**이고 층 전환 슬라이드
 * (1.2초/층)는 여기 없다:
 *
 * | 배수 | 11층 | 30층 | 3분 도달 | 100층 |
 * |---|---|---|---|---|
 * | 1 (덧댐 없음) | 2.7s | 17.8s | 175F | 82s |
 * | 4 | 9.2s | 23.5s | 175F | 85s |
 * | 7 | 15.1s | 32.7s | 174F | 87s |
 * | **10** | **18.9s** | **40.2s** | **173F** | **89s** |
 *
 * 10을 고른 이유: 도입 10층이 전투만 19초(슬라이드까지 31초)라 "뭐지?" 하고 볼
 * 시간이 생기고, 100층이 89초로 데모 게이트(10분)에 여유가 그대로다.
 *
 * **골드에도 같이 곱한다** (`goldHp`를 통과한다). HP만 올리면 초반 골드 수입이
 * 배수만큼 줄어 강화가 늦어지고, 그 지연이 뒤 구간까지 끌고 간다 —
 * 도입부만 늦추려던 것이 게임 전체를 늦춘다.
 */
export const EARLY_RAMP_MULT = 10;

/**
 * 도입부 HP 덧댐 배수 — 1층 `EARLY_RAMP_MULT`배에서 시작해 자연 성장이 따라잡는
 * 층에서 1배가 된다.
 *
 * **감쇠꼴이 아니라 평탄꼴이다.** 처음엔 배수를 층에 따라 깎아 내렸다
 * (곱셈 `MULT^(1-k)`, 다음엔 덧셈 `1+(MULT-1)(1-k)`). 둘 다 같은 병을 앓는다:
 * 1층을 10배로 들어 올렸는데 어딘가에서 1배로 돌아와야 하므로 **층 HP가 도중에
 * 내려간다.** 곱셈꼴은 층당 1.28배씩 빠지는데 성장은 1.06배뿐이어서 8·9층이 앞
 * 층보다 얇아졌고(실측 체류 0.10s·0.08s — 고치려던 증상 그대로), 덧셈꼴은 그보다
 * 완만했지만 20→21층에서 **27% 절벽**이 남았다. 완만하게 만든 구간 바로 다음 층이
 * 가장 빠른 층이 되면, 고친 것이 옆으로 밀려난 것뿐이다.
 *
 * 평탄꼴은 그 절벽이 **구조적으로 없다.** 배수를 성장률의 역수로 두어 층 HP를
 * 도입 구간 내내 **일정하게** 잡고, 자연 곡선이 그 높이에 닿는 층에서 배수가
 * 1이 되어 스스로 합류한다(`Math.max(1, ...)`). 층 HP가 떨어지는 층이 하나도
 * 없다 — 최대 하락폭 0 (테스트가 고정한다).
 *
 * **구간 길이는 고를 값이 아니라 유도되는 값이다.** 합류 층은
 * `1 + ln(MULT)/ln(growth)` = 약 41층이다. 이걸 별도 상수로 두면 배수를 고칠 때
 * 한쪽만 고쳐서 경계에 절벽이 다시 생긴다 (`derived-constants-need-their-derivation`).
 *
 * 도입 구간에서 층 체류가 **점점 짧아지는 것은 의도다** — HP가 일정한 동안 강화가
 * 자라므로, 플레이어는 같은 적이 점점 빨리 녹는 것으로 성장을 본다.
 */
export function earlyRampHpMul(floor: number): number {
  const f = clampFloor(floor);
  return Math.max(1, EARLY_RAMP_MULT / Math.pow(SINGLE_HP_GROWTH, f - 1));
}

/**
 * 이 층까지는 잡몹이 **한 마리**만 나온다 (유저 판단 요청: "10층까지는 몬스터
 * 1개씩만 나와도 될 것 같은데").
 *
 * 채택한다. 넷이 동시에 서 있으면 첫 화면에서 데미지 숫자 넷·HP바 넷이 겹쳐
 * "무엇을 때리면 무엇이 줄어드는가"가 안 읽힌다. 도입부의 일은 규칙을 보여
 * 주는 것이고, 한 마리면 타격 → HP바 → 사망 → 골드가 한 줄로 보인다.
 * 무리 전투는 11층부터 시작된다 — 그때는 이미 루프를 안다.
 *
 * **덧댐 구간(약 41층)보다 짧다.** 마리 수와 HP는 같은 손잡이가 아니다 —
 * 한 마리 규칙은 "읽히는가"의 문제라 유저가 말한 10층에서 끝내고, HP 덧댐은
 * "관통당하는가"의 문제라 자연 곡선에 닿을 때까지 간다. 위 스윕 표는 이 규칙이
 * 켜진 상태로 쟀다.
 */
export const SOLO_MINION_FLOORS = 10;

/**
 * 새 페이즈 첫 층의 체감 = 직전 페이즈의 이 local 층.
 *
 * 페이즈 경계에서 HP가 떨어지는 것은 의도다(WORLD.md §2 — 성장이 체감되는
 * 지점). 얼마나 떨어지느냐를 "직전 페이즈 몇 층 수준으로 되돌아가는가"로
 * 표현한다: `BASE[p+1] = BASE[p] × growth^PHASE_RESET_FEEL_FLOOR`이므로
 * 1,001층은 801층과 같은 체감이고, 경계에서 `growth^199`(≈10만 배)만큼
 * 쉬워진다. **페이즈 1부터는 사전과제 데모 지평 밖이라 잠정값이다**
 * (GAPS.md §2 미정 1 — 깊은 페이즈 밸런스는 본선에서 재조정).
 */
export const PHASE_RESET_FEEL_FLOOR = 800;

/** 층의 종류. 우선순위: 네임드 보스 > 미니보스 > 잡몹 (100층은 10의 배수이기도 하다) */
export type FloorKind = "minions" | "miniboss" | "boss";

export function floorKindOf(floor: number): FloorKind {
  const f = clampFloor(floor);
  if (f % NAMED_BOSS_EVERY === 0) return "boss";
  if (f % MINIBOSS_EVERY === 0) return "miniboss";
  return "minions";
}

/** 이 층의 HP 배율. 페이즈 첫 층이 항상 1배 (floors.ts의 floorHpMul과 같은 꼴, 성장률만 다름) */
export function singleFloorHpMul(floor: number): number {
  return Math.pow(SINGLE_HP_GROWTH, localFloorOf(floor) - 1);
}

/** 이 페이즈의 잡몹 기준 HP. `BASE[p] = 100 × growth^(800p)` — PHASE_RESET_FEEL_FLOOR 주석 */
export function singleMinionBaseHpOf(phase: number): number {
  return (
    SINGLE_MINION_BASE_HP *
    Math.pow(SINGLE_HP_GROWTH, PHASE_RESET_FEEL_FLOOR * Math.max(0, phase))
  );
}

/** 이 층의 잡몹 기준 HP (편차·보스 배율 적용 전) */
export function minionHpAtFloor(floor: number): number {
  return singleMinionBaseHpOf(phaseOf(floor)) * singleFloorHpMul(floor);
}

/**
 * (seed, floor) → 그 층 전용 RNG 시드. 층마다 독립 스트림이라 생성 구간을
 * 어디서 자르든 같은 층은 같은 결과가 나온다. `Math.imul`로 32비트 곱을
 * 고정해 플랫폼 무관 결정론을 지킨다.
 */
export function mixFloorSeed(seed: number, floor: number): number {
  return ((seed >>> 0) ^ Math.imul(clampFloor(floor), 0x9e3779b1)) >>> 0;
}

/**
 * 층 하나의 적 무리. 잡몹 층은 1~4마리 ±15% 편차(PvP와 같은 리듬),
 * 보스 층은 편차 없는 1마리.
 *
 * id 형식: `f<층>-m<i>` / `f<층>-mini` / `f<층>-boss`. `pickEnemySlug`가
 * id 해시로 종을 고르므로 층이 다르면 같은 슬롯이라도 다른 종이 나온다.
 */
export function generateFloorEnemies(seed: number, floor: number): EnemyDef[] {
  const f = clampFloor(floor);
  const kind = floorKindOf(f);
  /**
   * 도입부 덧댐은 **성장 곡선에서 분리해 둔다** — `minionHpAtFloor`에 접어 넣으면
   * "100층은 1층의 322배"라는 곡선의 성질을 잴 수 없게 된다. 여기서 곱하면
   * 곡선과 덧댐이 각자의 검사를 가진다.
   */
  const baseHp = minionHpAtFloor(f) * earlyRampHpMul(f);

  if (kind === "boss") {
    return [soloEnemy(`f${f}-boss`, true, baseHp * NAMED_BOSS_HP_MULT)];
  }
  if (kind === "miniboss") {
    return [soloEnemy(`f${f}-mini`, true, baseHp * MINIBOSS_HP_MULT)];
  }

  const rng = createRng(mixFloorSeed(seed, f));
  // 도입부는 한 마리 — 겹친 HP바 넷보다 한 줄로 읽히는 루프가 먼저다
  const n = f <= SOLO_MINION_FLOORS ? 1 : 1 + rng.int(4);
  const enemies: EnemyDef[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = 0.85 + rng.next() * 0.3; // ±15%
    enemies.push(soloEnemy(`f${f}-m${i}`, false, baseHp * jitter));
  }
  return enemies;
}

/**
 * 표시 HP = 배율 전 HP × `SOLO_HP_SCALE`. **한 곳에서만 곱한다** — 생성 지점
 * 세 곳이 각자 곱하면 한 곳을 놓친 것이 "보스만 안 깎였다"로만 드러난다.
 *
 * `Math.max(1, ...)`: 1층 잡몹 HP가 낮으면 ×0.7 후 0으로 반올림될 수 있고,
 * **0 HP인 적은 이미 죽은 슬롯이다**(`core/waves.ts`의 같은 방어).
 */
function soloEnemy(id: string, isBoss: boolean, goldHp: number): EnemyDef {
  const raw = Math.round(goldHp);
  return {
    id,
    isBoss,
    hp: Math.max(1, Math.round(raw * SOLO_HP_SCALE)),
    goldHp: raw,
  };
}

/** 이 웨이브 배열에서 waveIndex가 가리키는 실제 층 번호 */
export function floorOfWaveIndex(startFloor: number, waveIndex: number): number {
  return clampFloor(clampFloor(startFloor) + Math.max(0, Math.floor(waveIndex)));
}

/**
 * `startFloor`부터 `count`개 층의 웨이브 창(window)을 만든다.
 *
 * - `WaveDef.index`는 배열 위치가 아니라 **실제 층 번호**다. `battleField.setWave`가
 *   `wave.index`를 층으로 읽는다(몬스터 풀 해금·배경 시드) — 배열 위치를 넣으면
 *   9,000층에서도 1층 몬스터만 나온다.
 * - 9,999층을 넘는 요청은 거기서 잘린다. 마지막 층(9,999)에 도달한 러너는
 *   그 층을 반복(loops)하고, 엔딩 처리는 세션 몫이다.
 * - 반환 길이는 최소 1 (startFloor가 9,999라도 그 층 하나는 나온다).
 */
export function generatePhaseWaves(seed: number, startFloor: number, count: number): WaveDef[] {
  const start = clampFloor(startFloor);
  const n = Math.max(1, Math.min(Math.max(1, Math.floor(count)), FINAL_FLOOR - start + 1));
  const waves: WaveDef[] = [];
  for (let i = 0; i < n; i++) {
    const floor = start + i;
    waves.push({ index: floor, enemies: generateFloorEnemies(seed, floor) });
  }
  return waves;
}
