import { describe, expect, it, test } from "vitest";
// 계획서는 ../src/pvp/session 을 import하지만 그 모듈은 pixi.js를 끌어온다.
// fxMapping·skillRules·loopMath와 같은 이유로 순수 규칙만 분리한 모듈을 테스트한다.
import {
  myTeamSlots,
  aiTeammateIds,
  castActorLabel,
  castBannerKind,
  finishReason,
  interferenceNotice,
  waveProgress,
  celebrateAttacker,
  CELEBRATE_PERIOD_MS,
} from "../src/pvp/sessionRules";
import { BANNER_COLOR } from "../src/shared/ui/bannerRules";
import { LocalMatchmaking } from "../src/net/matchmaking";
import { DEFAULT_TIME_LIMIT_MS } from "../src/core/battle";

const match = async (teamSize: number) =>
  new LocalMatchmaking({ seed: 1 }).findMatch({ teamSize, levelBracket: 0 });

test("my team slots are exactly the teamSize slots on team 0", async () => {
  const m = await match(3);
  const mine = myTeamSlots(m);
  expect(mine).toHaveLength(3);
  expect(mine.every((s) => s.team === 0)).toBe(true);
});

test("my own slot is excluded from the ai teammate list", async () => {
  const m = await match(2);
  const ids = aiTeammateIds(m);
  expect(ids).not.toContain(m.mySlotId);
  expect(ids).toHaveLength(1);
});

test("a solo match has no ai teammates", async () => {
  const m = await match(1);
  expect(aiTeammateIds(m)).toEqual([]);
});

describe("interferenceNotice", () => {
  it("방해 종류마다 다른 문구를 준다 — 같으면 무엇을 맞았는지 모른다", () => {
    // `blind`가 여기 없으면 실명이 기본 문구("방해당했다!")로 떨어진다 —
    // 스킬바가 잠긴 몇 초가 버튼 고장으로 읽히는 유일한 종류다
    const kinds = ["slow", "blind", "gauge_drain", "spawn_adds"];
    const texts = kinds.map(interferenceNotice);
    expect(new Set(texts).size).toBe(kinds.length);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
  });

  it("모르는 종류에도 빈 배너를 띄우지 않는다", () => {
    expect(interferenceNotice("wat")).toBe("방해당했다!");
    expect(interferenceNotice("")).toBe("방해당했다!");
  });
});

/**
 * **누가 시전했는지가 화면에 남아야 한다.**
 *
 * `castSkill`은 나와 AI 팀원이 공용이다(`session.step` 1단계가 팀원 판단을 같은
 * 함수로 넘긴다). 갈라 주지 않으면 팀원의 방해가 내가 누른 것과 글자 하나
 * 다르지 않은 배너로 뜬다 — 입력 0회로 118초를 돌린 캡처에 `심연의 장막 → 상대`가
 * 찍혀 있었다. 그게 "AUTO를 안 켰는데 자동으로 동작한다"로 읽힌 것의 큰 몫이다.
 */
describe("시전 주체 표기", () => {
  it("팀원 시전에만 접두사가 붙는다 — 내 것은 군더더기 없이 그대로다", () => {
    expect(castActorLabel(true)).toBe("");
    expect(castActorLabel(false)).not.toBe("");
  });

  it("두 표기가 실제로 다르다 — 같으면 화면에서 주체를 알 수 없다", () => {
    const name = "심연의 장막";
    expect(`${castActorLabel(true)}${name}`).not.toBe(
      `${castActorLabel(false)}${name}`,
    );
  });

  it("접두사가 스킬 이름을 가리지 않는다 — 이름이 그대로 남는다", () => {
    for (const mine of [true, false]) {
      expect(`${castActorLabel(mine)}심해 세례`).toContain("심해 세례");
    }
  });

  it("배너 종류가 주체마다 갈린다 — 종류당 한 장이라 색과 자리가 같이 갈린다", () => {
    expect(castBannerKind(true)).toBe("myCast");
    expect(castBannerKind(false)).toBe("teammate");
    expect(castBannerKind(true)).not.toBe(castBannerKind(false));
  });

  /**
   * **`interference`를 재사용하면 안 된다.** 그 종류는 *도착한* 방해가 쓰고
   * 있고(§`interferenceNotice`), `bannerAction`이 종류당 화면 슬롯 하나를
   * 주므로 내가 거는 순간 도착 공지를 덮어쓴다.
   */
  it("도착한 방해와 같은 종류를 쓰지 않는다 — 슬롯이 하나라 서로를 덮는다", () => {
    for (const mine of [true, false]) {
      expect(castBannerKind(mine)).not.toBe("interference");
    }
  });

  it("두 종류의 색이 색표에 있고 서로 다르다", () => {
    const mine = BANNER_COLOR[castBannerKind(true)];
    const mate = BANNER_COLOR[castBannerKind(false)];
    expect(typeof mine).toBe("number");
    expect(typeof mate).toBe("number");
    expect(mine).not.toBe(mate);
  });
});

describe("waveProgress", () => {
  const runner = (max: number[], left: number[]) => ({
    state: { enemyHp: left },
    currentWave: { enemies: max.map((hp) => ({ hp })) },
  });

  it("아무도 안 죽었으면 0, 전멸이면 1", () => {
    expect(waveProgress(runner([100, 100], [100, 100]))).toBe(0);
    expect(waveProgress(runner([100, 100], [0, 0]))).toBe(1);
  });

  it("처치 수가 아니라 남은 HP로 센다 — 마커가 부드럽게 움직인다", () => {
    // 4마리 웨이브에서 첫 마리가 절반만 깎였어도 진행률이 0이 아니다
    const p = waveProgress(runner([100, 100, 100, 100], [50, 100, 100, 100]));
    expect(p).toBeCloseTo(0.125, 6);
  });

  it("보스 1마리 웨이브도 죽기 전에 진행률이 오른다", () => {
    expect(waveProgress(runner([800], [200]))).toBeCloseTo(0.75, 6);
  });

  it("음수 HP를 0으로 접는다 — 오버킬이 진행률을 1 넘게 밀지 않는다", () => {
    expect(waveProgress(runner([100, 100], [-500, 0]))).toBe(1);
  });

  it("빈 웨이브·HP 0 웨이브에서 0으로 나누지 않는다", () => {
    expect(waveProgress(runner([], []))).toBe(0);
    expect(waveProgress(runner([0, 0], [0, 0]))).toBe(0);
  });

  it("항상 0..1 안에 있다", () => {
    for (const left of [[300, 300], [1, 0], [0, 1], [150, 150]]) {
      const p = waveProgress(runner([300, 300], left));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

test("finish reason distinguishes threshold from the time backstop", () => {
  expect(finishReason({ elapsedMs: 5_000, timeLimitMs: DEFAULT_TIME_LIMIT_MS })).toBe(
    "threshold",
  );
  expect(
    finishReason({
      elapsedMs: DEFAULT_TIME_LIMIT_MS,
      timeLimitMs: DEFAULT_TIME_LIMIT_MS,
    }),
  ).toBe("timeLimit");
});

describe("celebrateAttacker (§08-1)", () => {
  it("아군을 순서대로 돌린다 — 동시에 치면 한 덩어리로 보인다", () => {
    expect(celebrateAttacker(0, 2)).toBe(0);
    expect(celebrateAttacker(1, 2)).toBe(1);
    expect(celebrateAttacker(2, 2)).toBe(0);
    expect(celebrateAttacker(5, 3)).toBe(2);
  });

  it("항상 0..count-1 안에 있다 — 배열 밖을 짚으면 축하가 사라진다", () => {
    for (const count of [1, 2, 3, 4]) {
      for (let turn = 0; turn < 20; turn += 1) {
        const i = celebrateAttacker(turn, count);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(count);
      }
    }
  });

  it("팀이 비었거나 비정상 값이면 0을 준다", () => {
    expect(celebrateAttacker(3, 0)).toBe(0);
    expect(celebrateAttacker(3, -2)).toBe(0);
    expect(celebrateAttacker(NaN, 2)).toBe(0);
    expect(celebrateAttacker(-4, 2)).toBe(0);
    expect(celebrateAttacker(1.9, 2)).toBe(1);
  });

  it("주기가 사람이 알아볼 만큼 떨어져 있다 — 연타는 평타로 읽힌다", () => {
    expect(CELEBRATE_PERIOD_MS).toBeGreaterThan(300);
    expect(CELEBRATE_PERIOD_MS).toBeLessThan(1_500);
  });
});
