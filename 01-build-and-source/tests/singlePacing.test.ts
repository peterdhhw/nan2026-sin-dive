import { describe, expect, it } from "vitest";
import { createCastQueue } from "../src/core/castQueue";
import { createCooldownTracker } from "../src/core/cooldown";
import { autoAttackDamage, sumTeamRawDamage } from "../src/core/team";
import { createWaveRunner, type WaveRunner } from "../src/core/waveRunner";
import type { WaveDef } from "../src/core/types";
import { FINAL_FLOOR } from "../src/core/phase/floors";
import {
  SOLO_HP_SCALE,
  floorOfWaveIndex,
  generatePhaseWaves,
} from "../src/core/phase/phaseWaves";
import { PICK_SLUGS } from "../src/shared/charManifest";
import { defaultPick } from "../src/shared/scenes/pickRules";
import { corruptionOf, corruptionAtkMul } from "../src/core/corruption/corruption";
import { PresetLoadoutProvider } from "../src/loadout/preset";
import {
  UPGRADE_IDS,
  atkMulOf,
  attackIntervalMulOf,
  canBuy,
  emptyLevels,
  goldForKill,
  skillMulOf,
  upgradeCost,
  type UpgradeId,
  type UpgradeLevels,
} from "../src/single/economyRules";
import {
  SINGLE_TEAM_SIZE,
  WINDOW_FLOORS,
  comboGoldMul,
  needsWindowRebuild,
  nextCombo,
} from "../src/single/sessionRules";

/**
 * 싱글 데모 페이스 시뮬레이션 — 세션의 core 조립을 Pixi 없이 재현한다.
 *
 * economyRules의 수치(성장률·비용·골드 지수)가 이 페이스를 만든다. 상수를
 * 바꾸면 이 테스트가 새 페이스를 말하게 다시 못 박아라 — "데모에서 100층
 * 보스를 만난다"가 사전과제의 요구다 (SINGLE_HP_GROWTH 주석).
 *
 * 플레이 모델: 스킬은 쿨 도는 대로 전부(밸런스 문서 B-2 — 쿨 대비 효율이
 * 같아 이게 정답), 강화는 살 수 있으면 즉시(공격력 우선). 스와이프 러시·
 * 심연의 선택 수용은 뺀 **보수적** 페이스다 — 실제 유저는 이보다 빠르다.
 */
/**
 * @param teamSize 시뮬레이션할 팀 크기. 기본은 프로덕션(`SINGLE_TEAM_SIZE`).
 * @param hpScale  적 표시 HP 배율. 기본은 프로덕션(`SOLO_HP_SCALE`).
 *   1을 주면 "배율 없는" 세계가 되고, 그것이 2인 기준선을 재는 방법이다.
 *
 * **함수를 복사하지 않는다.** 기준선용 사본을 만들면 두 벌이 갈라지고
 * (`probe-baseline-must-equal-production`: 대조 시트의 "현재 결과" 열이
 * 프로덕션과 0px인지 재라), 갈라진 기준선은 아무것도 안 지킨다. 바꿀 값만
 * 인자로 뺀다.
 */
function simulate(
  minutes: number,
  opts: { teamSize?: number; hpScale?: number } = {},
): {
  floor: number;
  gold: number;
  teamSize: number;
  floorAtMs: (f: number) => number;
} {
  const STEP = 1000 / 60;
  const steps = Math.floor((minutes * 60 * 1000) / STEP);
  const seed = 42;
  const teamSize = opts.teamSize ?? SINGLE_TEAM_SIZE;
  const hpScale = opts.hpScale ?? SOLO_HP_SCALE;

  /**
   * 생성기가 이미 `SOLO_HP_SCALE`을 곱해 놨다. 기준선(2인·배율 없음)을 재려면
   * 그것을 되돌려야 하는데, **다시 나누지 않고 비율을 곱한다** —
   * `goldHp * hpScale`. 나눗셈으로 되돌리면 `SOLO_HP_SCALE`을 바꾼 날 반올림
   * 오차가 기준선에만 들어간다.
   */
  const rescale = (ws: WaveDef[]): WaveDef[] =>
    hpScale === SOLO_HP_SCALE
      ? ws
      : ws.map((w) => ({
          ...w,
          enemies: w.enemies.map((e) => ({
            ...e,
            hp: Math.max(1, Math.round(e.goldHp * hpScale)),
          })),
        }));

  /** 층 → 처음 도달한 시각(ms). 게이트가 "100F를 언제 찍었나"를 묻는다 */
  const reachedMs = new Map<number, number>();

  const loadout = new PresetLoadoutProvider().load(teamSize);
  const skills = loadout.skills.filter((s) => s.kind !== "interference");
  const cooldowns = createCooldownTracker(skills);
  const casts = createCastQueue();

  let upgrades: UpgradeLevels = emptyLevels();
  let gold = 0;
  let combo = 0;
  let lastClearMs = Number.NEGATIVE_INFINITY;
  let maxFloor = 1;
  let windowStart = 1;
  let waves: WaveDef[] = rescale(
    generatePhaseWaves(seed, windowStart, WINDOW_FLOORS),
  );
  let runner: WaveRunner = createWaveRunner(waves, 0);
  let shownFloor = 1;

  const dmgChars = (): { memberId: string; stats: { attack: number; attackIntervalMs: number } }[] => {
    const atkMul = atkMulOf(upgrades);
    const intervalMul = attackIntervalMulOf(upgrades);
    return loadout.characters.slice(0, teamSize).map((c) => ({
      memberId: c.memberId,
      stats: {
        attack: c.stats.attack * atkMul,
        attackIntervalMs: c.stats.attackIntervalMs * intervalMul,
      },
    }));
  };
  let chars = dmgChars();

  /** 공격력 우선 탐욕 구매 — 강화 연타의 코드화 */
  const buyGreedy = (): void => {
    const order: UpgradeId[] = ["atk", "skill", "spd", "gold"];
    let bought = true;
    while (bought) {
      bought = false;
      for (const id of order) {
        if (!canBuy(gold, id, upgrades[id])) continue;
        gold -= upgradeCost(id, upgrades[id]) as number;
        upgrades = { ...upgrades, [id]: upgrades[id] + 1 };
        bought = true;
      }
    }
    chars = dmgChars();
  };

  let nowMs = 0;
  for (let i = 0; i < steps; i++) {
    nowMs += STEP;
    // 스킬: 준비된 것 전부 시전 (조작 캐릭터 기준)
    for (const skill of cooldowns.readySkills(nowMs)) {
      cooldowns.trigger(skill.id, nowMs);
      casts.push("me", skill.power * skillMulOf(upgrades));
    }
    const members = [...autoAttackDamage(chars, STEP), ...casts.drain(STEP)];
    const mult = corruptionAtkMul(corruptionOf(maxFloor, 0));
    const total = sumTeamRawDamage(members) * mult;

    const waveBefore = runner.currentWave;
    for (const hit of runner.applyDamage(total)) {
      if (!hit.killed) continue;
      const enemy = waveBefore.enemies[hit.enemyIndex];
      // **프로덕션(`session.ts`)과 같은 필드를 읽는다** — `hp`를 읽으면
      // 시뮬만 배율 후 HP로 골드를 줘서 기준선이 프로덕션과 갈라진다
      if (enemy) {
        gold += Math.round(
          goldForKill(enemy.goldHp, upgrades) * comboGoldMul(combo),
        );
      }
    }

    const coreFloor = floorOfWaveIndex(windowStart, runner.state.waveIndex);
    if (coreFloor !== shownFloor) {
      combo = nextCombo(combo, nowMs - lastClearMs);
      lastClearMs = nowMs;
      shownFloor = coreFloor;
      if (coreFloor > maxFloor) maxFloor = coreFloor;
      if (!reachedMs.has(coreFloor)) reachedMs.set(coreFloor, nowMs);
      if (needsWindowRebuild(runner.state.waveIndex, waves.length) && coreFloor < FINAL_FLOOR) {
        windowStart = coreFloor;
        waves = rescale(generatePhaseWaves(seed, windowStart, WINDOW_FLOORS));
        runner = createWaveRunner(waves, 0);
      }
      buyGreedy();
    }
  }
  return {
    floor: maxFloor,
    gold,
    teamSize,
    floorAtMs: (f) => reachedMs.get(f) ?? Number.POSITIVE_INFINITY,
  };
}

describe("싱글 데모 페이스 (결정론 시뮬레이션)", () => {
  it("3분 안에 30층을 넘는다 — 심사자가 첫 미니보스 리듬을 충분히 본다", () => {
    const r = simulate(3);
    expect(r.floor).toBeGreaterThanOrEqual(30);
  });

  it("10분 안에 100층 네임드 보스에 도달한다 — 데모의 목표 지점", () => {
    const r = simulate(10);
    expect(r.floor).toBeGreaterThanOrEqual(100);
  });

  it("40분에도 진행이 멈추지 않는다 (완만한 벽 — 수입 지수 0.8의 검증)", () => {
    const r10 = simulate(10);
    const r40 = simulate(40);
    expect(r40.floor).toBeGreaterThan(r10.floor + 30);
    expect(r40.floor).toBeLessThan(FINAL_FLOOR); // 벽이 아예 없어도 안 된다 — 9,999층이 한 시간이면 안 된다
  });

  /**
   * 유저 신고: "처음에 뭐지? 싶으니까 조금 천천히 진행되도록 해줘. 특히 1층부터
   * 10층까지 너무 빨리 넘어가."
   *
   * 신고 당시 실측이 **1~7층 0.4초**였다 — 개막 스킬 일제 사격(1초에 1,383 딜)이
   * 그 구간 표시 HP 총합(1,058)보다 커서 한 번에 관통했다. 이 검사는 그 구간에
   * **시간이 실제로 흐르는지**를 묻는다.
   *
   * 상한도 같이 둔다. 도입부를 늦추는 것은 3분/10분 게이트와 반대 방향이라,
   * 한쪽만 검사하면 배수를 키워 이 검사를 통과시키면서 데모를 망칠 수 있다.
   */
  it("도입 10층이 눈으로 따라갈 만큼 걸린다 (신고 당시 0.4초)", () => {
    const r = simulate(3);
    const at10 = r.floorAtMs(10);
    expect(Number.isFinite(at10)).toBe(true);
    // 하한 8초: 층당 0.8초 이상. 층 전환 슬라이드(1.2초/층)가 여기 없으므로
    // 화면에서는 이 값에 12초가 더 붙는다
    expect(at10).toBeGreaterThan(8_000);
    // 상한 40초: 이 이상이면 3분에 30층 게이트를 도입부가 먹기 시작한다
    expect(at10).toBeLessThan(40_000);
  });

  it("강화 종류 표가 시뮬 구매 순서와 어긋나지 않는다 (탐욕 순서가 전부 실존)", () => {
    expect([...UPGRADE_IDS].sort()).toEqual(["atk", "gold", "skill", "spd"].sort());
  });
});

describe("1인 페이싱이 2인 기준선과 같은 리듬이다 (§3-2·§3-3)", () => {
  /**
   * **기준선을 하드코딩하지 않는다.** 시뮬레이션을 2인·배율 1로 한 번 더 돌려
   * 그 자리에서 잰다. 초로 박으면 `economyRules`를 만진 날 이 검사가 옛 기준선을
   * 지키게 된다(`derived-constants-need-their-derivation`).
   *
   * 기존 두 게이트(3분 30F·10분 100F)는 이 작업을 **못 본다** — 여유가 3.5배라
   * 1인 무보정(3분 108F·10분 233F)도 통과한다
   * (`ratio-gates-need-normalized-denominator`: 분모가 느슨하면 설계된 변화까지
   * 삼킨다). 그래서 분모를 기준선 자신으로 바꾼다.
   */
  it("100F 도달 시각이 2인 기준선의 0.8~1.2배 안이다", () => {
    const baseline = simulate(10, { teamSize: 2, hpScale: 1 });
    const solo = simulate(10);
    const b = baseline.floorAtMs(100);
    const s = solo.floorAtMs(100);
    expect(b, "기준선이 100F를 못 찍었다 — 기준선 자체가 틀렸다").toBeLessThan(
      10 * 60 * 1000,
    );
    expect(s / b).toBeGreaterThan(0.8);
    expect(s / b).toBeLessThan(1.2);
  });

  /**
   * **배선을 묻는다.** §3-1의 상수 검사는 상수만 보므로 프로바이더가 두 명을
   * 돌려주는 날에도 조용하다(`mocks-hide-the-mocked-function`: 대역은 대역 밖을
   * 못 잰다).
   */
  it("프로바이더가 실제로 1명을 준다 — 그 1명이 고른 캐릭터다", () => {
    /**
     * **인자 없는 생성자로 슬러그를 묻지 않는다.** 그쪽은 `ROLE_TEMPLATES` 순서
     * (첫 칸 실비아)를 쓰고, 프로덕션은 항상 고른 캐릭터를 넘긴다
     * (`main.ts`: `readPick(pickStore())` → 저장값 없으면 `PICK_SLUGS[0]`).
     * 인자 없는 쪽에 격자 첫 칸을 기대하면 프로덕션에 없는 계약을 검사하는 것이고,
     * 그건 도달 불가능한 경우를 세는 것이다(`only-reachable-cases-count`).
     *
     * 그래서 **두 가지를 따로 묻는다**: 팀이 1명인 것(팀 크기 배선)과, 저장값이
     * 없을 때 하강하는 그 1명이 격자 첫 칸인 것(선택 배선). 둘째가 깨지면 리제를
     * 고른 사람이 실비아로 하강한다.
     */
    const anyLead = new PresetLoadoutProvider().load(SINGLE_TEAM_SIZE).characters;
    expect(anyLead).toHaveLength(1);

    const asProduction = new PresetLoadoutProvider(defaultPick(null)).load(
      SINGLE_TEAM_SIZE,
    ).characters;
    expect(asProduction).toHaveLength(1);
    expect(asProduction[0]!.charSlug).toBe(PICK_SLUGS[0]);
  });

  /**
   * 기준선 비교만 있으면 **둘이 같이 느려져도 통과한다.** 절대 시각도 남긴다 —
   * 사전과제 요구가 "데모(5~10분)에서 100F 보스를 만난다"다.
   */
  it("1인도 10분 안에 100F를 찍는다 — 절대 요구는 그대로다", () => {
    expect(simulate(10).floorAtMs(100)).toBeLessThan(10 * 60 * 1000);
  });
});

