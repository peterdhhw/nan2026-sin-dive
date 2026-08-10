import { describe, expect, it } from "vitest";
import {
  ADV_ACCEL_AT_MS,
  ADV_ACCEL_MS,
  ADV_CRUISE_UNTIL_MS,
  ADV_DECEL_MS,
  ADV_SPAWN_AT_MS,
  ADV_THEME_AT_MS,
  ADV_TOTAL_MS,
  advanceCrossed,
  advancePhase,
  advanceRunning,
  advanceScrollSpeed,
  sameWave,
  waveClearLabel,
} from "../src/shared/advanceRules";
import {
  SCROLL_ADVANCE_PX_S,
  SCROLL_IDLE_PX_S,
} from "../src/shared/backgroundRules";
import { THEME_FADE_MS } from "../src/shared/theme";

describe("전진 타임라인 (§8)", () => {
  it("스펙의 시각 표와 일치한다", () => {
    expect(advancePhase(0)).toBe("banner");
    expect(advancePhase(199)).toBe("banner");
    expect(advancePhase(ADV_ACCEL_AT_MS)).toBe("accel");
    expect(advancePhase(ADV_ACCEL_AT_MS + ADV_ACCEL_MS - 1)).toBe("accel");
    expect(advancePhase(ADV_ACCEL_AT_MS + ADV_ACCEL_MS)).toBe("cruise");
    expect(advancePhase(ADV_CRUISE_UNTIL_MS - 1)).toBe("cruise");
    expect(advancePhase(ADV_CRUISE_UNTIL_MS)).toBe("decel");
    expect(advancePhase(ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS - 1)).toBe("decel");
    expect(advancePhase(ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS)).toBe("done");
  });

  it("이상한 입력은 연출 없음으로 접는다", () => {
    expect(advancePhase(-1)).toBe("done");
    expect(advancePhase(NaN)).toBe("done");
  });

  it("스폰(1200ms)이 끝나기 전에 감속이 시작되어 있다", () => {
    // 적이 스폰될 때 배경이 이미 느려져 있어야 "도착했다"가 된다
    expect(advancePhase(ADV_SPAWN_AT_MS)).toBe("decel");
    expect(ADV_TOTAL_MS).toBeGreaterThanOrEqual(ADV_SPAWN_AT_MS);
  });

  it("테마 크로스페이드가 순항 구간 안에서 끝난다", () => {
    // 배경이 멈춘 뒤에 색이 바뀌면 "도착"이 아니라 "색 변화"로 보인다
    expect(ADV_THEME_AT_MS).toBeGreaterThanOrEqual(ADV_ACCEL_AT_MS);
    expect(ADV_THEME_AT_MS + THEME_FADE_MS).toBeLessThanOrEqual(
      ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS,
    );
    expect(advanceRunning(ADV_THEME_AT_MS)).toBe(true);
  });
});

describe("advanceScrollSpeed (§8)", () => {
  it("12 → 240 → 12로 돌아온다", () => {
    expect(advanceScrollSpeed(0)).toBe(SCROLL_IDLE_PX_S);
    expect(advanceScrollSpeed(ADV_ACCEL_AT_MS)).toBe(SCROLL_IDLE_PX_S);
    expect(advanceScrollSpeed(ADV_ACCEL_AT_MS + ADV_ACCEL_MS)).toBe(
      SCROLL_ADVANCE_PX_S,
    );
    expect(advanceScrollSpeed(ADV_CRUISE_UNTIL_MS - 1)).toBe(
      SCROLL_ADVANCE_PX_S,
    );
    expect(advanceScrollSpeed(ADV_CRUISE_UNTIL_MS)).toBe(SCROLL_ADVANCE_PX_S);
    // **끝값이 정확히 idle이어야 한다** — 아니면 배경이 영구히 흐른다
    expect(advanceScrollSpeed(ADV_TOTAL_MS)).toBe(SCROLL_IDLE_PX_S);
    expect(advanceScrollSpeed(ADV_TOTAL_MS + 5_000)).toBe(SCROLL_IDLE_PX_S);
  });

  it("가속·감속 중간값이 두 끝값 사이에 있다", () => {
    const mid = advanceScrollSpeed(ADV_ACCEL_AT_MS + ADV_ACCEL_MS / 2);
    expect(mid).toBeGreaterThan(SCROLL_IDLE_PX_S);
    expect(mid).toBeLessThan(SCROLL_ADVANCE_PX_S);
    const dec = advanceScrollSpeed(ADV_CRUISE_UNTIL_MS + ADV_DECEL_MS / 2);
    expect(dec).toBeGreaterThan(SCROLL_IDLE_PX_S);
    expect(dec).toBeLessThan(SCROLL_ADVANCE_PX_S);
  });

  it("속도가 idle 아래로 내려가지 않는다", () => {
    for (let t = 0; t <= ADV_TOTAL_MS + 100; t += 17) {
      expect(advanceScrollSpeed(t)).toBeGreaterThanOrEqual(SCROLL_IDLE_PX_S);
      expect(advanceScrollSpeed(t)).toBeLessThanOrEqual(SCROLL_ADVANCE_PX_S);
    }
  });
});

describe("advanceRunning (§8)", () => {
  it("배경이 흐르는 동안만 달린다 — 멈춘 채로 달리면 러닝머신이다", () => {
    expect(advanceRunning(0)).toBe(false);
    expect(advanceRunning(ADV_ACCEL_AT_MS - 1)).toBe(false);
    expect(advanceRunning(ADV_ACCEL_AT_MS)).toBe(true);
    expect(advanceRunning(ADV_CRUISE_UNTIL_MS)).toBe(true);
    expect(advanceRunning(ADV_TOTAL_MS)).toBe(false);
  });
});

describe("advanceCrossed", () => {
  it("경계를 넘는 스텝에서만 한 번 true", () => {
    expect(advanceCrossed(1_190, 1_207, ADV_SPAWN_AT_MS)).toBe(true);
    expect(advanceCrossed(1_207, 1_224, ADV_SPAWN_AT_MS)).toBe(false);
    expect(advanceCrossed(1_100, 1_190, ADV_SPAWN_AT_MS)).toBe(false);
  });

  it("고정 스텝으로 전체를 훑으면 정확히 한 번 발화한다", () => {
    let fired = 0;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      const next = prev + 16.6667;
      if (advanceCrossed(prev, next, ADV_SPAWN_AT_MS)) fired += 1;
      prev = next;
    }
    expect(fired).toBe(1);
  });

  it("경계값에 정확히 떨어져도 한 번만 발화한다", () => {
    expect(advanceCrossed(1_100, ADV_SPAWN_AT_MS, ADV_SPAWN_AT_MS)).toBe(true);
    expect(advanceCrossed(ADV_SPAWN_AT_MS, 1_300, ADV_SPAWN_AT_MS)).toBe(false);
  });
});

describe("waveClearLabel", () => {
  it("클리어 배너는 **끝난** 웨이브를 말한다 (0-based → 1-based)", () => {
    expect(waveClearLabel(0)).toBe("WAVE 1 클리어");
    expect(waveClearLabel(2)).toBe("WAVE 3 클리어");
  });

  it("이상한 입력에도 문구가 깨지지 않는다", () => {
    expect(waveClearLabel(-3)).toBe("WAVE 1 클리어");
    expect(waveClearLabel(NaN)).toBe("WAVE 1 클리어");
    expect(waveClearLabel(1.7)).toBe("WAVE 2 클리어");
  });
});

describe("sameWave", () => {
  it("인덱스와 반복 횟수가 모두 같아야 같은 웨이브다", () => {
    expect(sameWave({ waveIndex: 2, loops: 0 }, { waveIndex: 2, loops: 0 })).toBe(
      true,
    );
    expect(sameWave({ waveIndex: 2, loops: 0 }, { waveIndex: 3, loops: 0 })).toBe(
      false,
    );
    // 마지막 웨이브 반복 — 인덱스는 그대로인데 적은 새 무리다
    expect(sameWave({ waveIndex: 9, loops: 0 }, { waveIndex: 9, loops: 1 })).toBe(
      false,
    );
  });
});
