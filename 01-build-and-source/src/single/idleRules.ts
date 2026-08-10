/**
 * 오프라인 방치 보상 — "꺼 놔도 진행"의 순수 계산.
 *
 * 설계 문서: docs/SINGLE-BRIEF.md §3-5, docs/SAVE-SCHEMA.md §2-4
 *
 * ## 규칙 (2026-08-03 정호 확정)
 *
 * - **경과 시간은 인자로 받는다.** 이 파일은 `Date.now()`를 모른다 — 호출자
 *   (씬/main)가 지금 시각과 저장된 `lastTickMs`를 넘긴다. 그래야 방치 보상처럼
 *   눈으로 검증할 수 없는 계산에 테스트를 붙일 수 있다.
 * - 자동 하강: **2분에 1층**, 한 번의 부재당 최대 120층. 능동 플레이(초반 몇
 *   초에 여러 층)보다 훨씬 느리다 — 방치는 따라가는 것이지 앞지르는 것이
 *   아니다.
 * - **네임드 보스(100층 단위) 앞에서 멈춘다.** 보스는 직접 싸워야 한다 —
 *   보스 대사(스토리 연출)를 자리 비운 사이에 소비하지 않게 하는 장치이기도
 *   하다.
 * - 골드: 전진한 층들의 잡몹 기대 처치(층당 2.5마리)에 효율 60%를 곱한다.
 *   층을 못 전진하는 상황(보스 벽·최종층)에서는 현재 층을 파밍한 것으로
 *   친다(5초에 1마리).
 * - 1분 미만의 부재는 보상이 없다 — 새로고침 반복으로 긁는 것을 막는다.
 */

import { clampFloor, FINAL_FLOOR } from "../core/phase/floors";
import { minionHpAtFloor, NAMED_BOSS_EVERY } from "../core/phase/phaseWaves";
import { goldForKill, type UpgradeLevels } from "./economyRules";

/** 이보다 짧은 부재는 보상 없음 (새로고침 긁기 방지) */
export const IDLE_MIN_MS = 60_000;

/** 보상으로 인정하는 최대 부재 시간 (8시간) */
export const IDLE_CAP_MS = 8 * 60 * 60 * 1000;

/** 자동 하강 속도 — 이 시간마다 1층 */
export const IDLE_FLOOR_MS = 120_000;

/** 한 번의 부재로 내려갈 수 있는 최대 층수 */
export const IDLE_MAX_FLOORS = 120;

/** 층당 잡몹 기대 마리수 (1~4 균등의 평균) */
export const IDLE_KILLS_PER_FLOOR = 2.5;

/** 방치 골드 효율 — 능동 파밍보다 박하다 */
export const IDLE_GOLD_EFFICIENCY = 0.6;

/** 층을 못 전진할 때(보스 벽·최종층)의 제자리 파밍 속도 — 이 시간마다 1마리 */
export const IDLE_FARM_KILL_MS = 5_000;

/** 제자리 파밍으로 인정하는 최대 마리수 */
export const IDLE_FARM_KILL_CAP = 500;

export interface IdleReward {
  /** 보상 계산에 실제로 쓰인 경과 시간 (캡 적용 후) */
  elapsedMs: number;
  fromFloor: number;
  toFloor: number;
  gold: number;
}

/** fromFloor 다음에 오는 네임드 보스 층 (fromFloor가 100의 배수면 그 다음 것) */
export function nextNamedBossFloor(fromFloor: number): number {
  const f = clampFloor(fromFloor);
  return Math.min(FINAL_FLOOR, (Math.floor(f / NAMED_BOSS_EVERY) + 1) * NAMED_BOSS_EVERY);
}

/**
 * 방치 보상. `lastTickMs`가 없거나(첫 방문·기록 실패) 부재가 1분 미만이면 null.
 * 반환된 `toFloor`·`gold`의 반영과 저장은 호출자 몫이다 (계산과 저장 분리).
 */
export function computeIdleReward(opts: {
  nowMs: number;
  lastTickMs: number | null;
  floor: number;
  upgrades: UpgradeLevels;
}): IdleReward | null {
  const { nowMs, lastTickMs, floor, upgrades } = opts;
  if (lastTickMs === null || !Number.isFinite(nowMs)) return null;
  const elapsedMs = Math.min(IDLE_CAP_MS, Math.max(0, nowMs - lastTickMs));
  if (elapsedMs < IDLE_MIN_MS) return null;

  const fromFloor = clampFloor(floor);
  // 네임드 보스 직전 층까지만 자동 하강한다 — 보스는 직접 싸운다.
  // 지금 서 있는 층이 미격파 보스 층이면(저장 floor = "재개 시 다시 싸울 층")
  // 한 층도 못 내려간다 — 벽을 fromFloor 자신으로 두면 제자리 파밍이 된다.
  const bossWall =
    fromFloor % NAMED_BOSS_EVERY === 0 ? fromFloor : nextNamedBossFloor(fromFloor) - 1;
  const wanted = Math.min(IDLE_MAX_FLOORS, Math.floor(elapsedMs / IDLE_FLOOR_MS));
  const toFloor = Math.min(clampFloor(fromFloor + wanted), Math.max(fromFloor, bossWall));

  let gold = 0;
  if (toFloor > fromFloor) {
    // 방치 중 실제로 클리어한 층은 {fromFloor .. toFloor-1}이다 — 저장된
    // floor는 "재개 시 다시 싸울 층"이라 toFloor는 재개 후 실전에서 골드를
    // 받는다. toFloor까지 세면 착지 층이 이중 지급되고 fromFloor가 누락된다.
    for (let f = fromFloor; f < toFloor; f++) {
      gold += IDLE_KILLS_PER_FLOOR * goldForKill(minionHpAtFloor(f), upgrades);
    }
  } else {
    // 벽 앞 제자리 파밍 — 전진은 없지만 빈손으로 돌려보내지 않는다
    const kills = Math.min(IDLE_FARM_KILL_CAP, Math.floor(elapsedMs / IDLE_FARM_KILL_MS));
    gold = kills * goldForKill(minionHpAtFloor(fromFloor), upgrades);
  }

  return {
    elapsedMs,
    fromFloor,
    toFloor,
    gold: Math.round(gold * IDLE_GOLD_EFFICIENCY),
  };
}
