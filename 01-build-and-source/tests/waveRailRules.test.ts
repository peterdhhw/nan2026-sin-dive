import { describe, expect, it } from "vitest";
import {
  BOSS_PULSE_MS,
  LABEL_PULSE_MS,
  LABEL_PULSE_SCALE,
  PASSED_ALPHA,
  REMAIN_ALPHA,
  RAIL_H,
  WAVE_COUNT,
  bossPulse,
  isBossIndex,
  isPassed,
  labelFlashAlpha,
  labelPulse,
  markerX,
  railIndex,
  tickX,
  waveLabel,
} from "../src/shared/ui/waveRailRules";
import { GAUGE_BAR_H } from "../src/pvp/splitLayout";
import { BOSS_EVERY } from "../src/core/waves";
import { DEFAULT_WAVE_COUNT } from "../src/core/battle";

describe("tickX", () => {
  it("양 끝에 칸이 붙는다 (§C7)", () => {
    expect(tickX(0)).toBe(0);
    expect(tickX(WAVE_COUNT - 1)).toBe(1);
  });

  it("칸 간격이 균등하다", () => {
    const xs = Array.from({ length: WAVE_COUNT }, (_, i) => tickX(i));
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 10);
  });

  it("범위 밖 인덱스를 접는다 — 마커가 레일 밖으로 나가지 않는다", () => {
    expect(tickX(-4)).toBe(0);
    expect(tickX(99)).toBe(1);
  });

  it("칸이 1개면 0 (0으로 나누지 않는다)", () => {
    expect(tickX(0, 1)).toBe(0);
    expect(tickX(3, 1)).toBe(0);
  });
});

describe("markerX", () => {
  it("진행률 0은 현재 칸, 1은 다음 칸", () => {
    expect(markerX(1, 0)).toBeCloseTo(tickX(1), 10);
    expect(markerX(1, 1)).toBeCloseTo(tickX(2), 10);
  });

  it("칸 사이를 연속으로 움직인다 — 이산 점프면 레일을 볼 이유가 없다", () => {
    const a = markerX(1, 0.25);
    const b = markerX(1, 0.5);
    expect(a).toBeGreaterThan(tickX(1));
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(tickX(2));
  });

  it("마지막(보스) 칸에서는 1을 넘지 않는다", () => {
    expect(markerX(WAVE_COUNT - 1, 1)).toBe(1);
    expect(markerX(WAVE_COUNT + 5, 1)).toBe(1);
  });

  it("이상한 진행률을 0으로 본다", () => {
    expect(markerX(2, NaN)).toBeCloseTo(tickX(2), 10);
    expect(markerX(2, -1)).toBeCloseTo(tickX(2), 10);
    expect(markerX(2, 4)).toBeCloseTo(tickX(3), 10);
  });

  it("전체 구간에서 0..1 안에 머문다", () => {
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      for (const p of [0, 0.33, 0.66, 1]) {
        const x = markerX(i, p);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("isBossIndex / isPassed", () => {
  it("마지막 칸만 보스다", () => {
    for (let i = 0; i < WAVE_COUNT; i += 1) {
      expect(isBossIndex(i)).toBe(i === WAVE_COUNT - 1);
    }
  });

  it("현재 칸도 도달로 센다 — 지금 싸우는 칸이 흐리면 위치를 잃는다", () => {
    expect(isPassed(2, 2)).toBe(true);
    expect(isPassed(1, 2)).toBe(true);
    expect(isPassed(3, 2)).toBe(false);
  });
});

describe("railIndex", () => {
  it("레일 칸 수가 코어 보스 주기와 같다 — 다르면 해골 칸이 보스가 아니다", () => {
    expect(WAVE_COUNT).toBe(BOSS_EVERY);
  });

  it("첫 주기는 그대로다", () => {
    for (let i = 0; i < WAVE_COUNT; i += 1) expect(railIndex(i)).toBe(i);
  });

  it("주기를 넘으면 처음으로 되돌아온다 — 오른쪽 끝에 박히지 않는다", () => {
    expect(railIndex(WAVE_COUNT)).toBe(0);
    expect(railIndex(WAVE_COUNT + 2)).toBe(2);
  });

  it("코어의 40웨이브 전체가 유효한 칸에 들어간다", () => {
    for (let i = 0; i < DEFAULT_WAVE_COUNT; i += 1) {
      const c = railIndex(i);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(WAVE_COUNT);
    }
  });

  it("보스 웨이브가 반드시 해골 칸에 온다", () => {
    for (let i = 0; i < DEFAULT_WAVE_COUNT; i += 1) {
      // 코어: (index + 1) % BOSS_EVERY === 0 이 보스
      const isBossWave = (i + 1) % BOSS_EVERY === 0;
      expect(isBossIndex(railIndex(i))).toBe(isBossWave);
    }
  });

  it("이상한 입력을 0으로 접는다", () => {
    expect(railIndex(-3)).toBe(0);
    expect(railIndex(NaN)).toBe(0);
  });
});

describe("레일 비중", () => {
  it("게이지 바보다 얇다 — 시각 비중을 겨루면 안 된다 (§C7 결정 기록)", () => {
    expect(RAIL_H).toBeLessThan(GAUGE_BAR_H);
  });

  it("지나온 칸이 남은 칸보다 진하다", () => {
    expect(PASSED_ALPHA).toBeGreaterThan(REMAIN_ALPHA);
  });
});

describe("bossPulse", () => {
  it("0..1 범위를 유지하고 완전히 사라지지 않는다", () => {
    for (let t = 0; t < BOSS_PULSE_MS * 2; t += 17) {
      const v = bossPulse(t);
      expect(v).toBeGreaterThanOrEqual(0.35);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("주기적으로 반복한다", () => {
    expect(bossPulse(123)).toBeCloseTo(bossPulse(123 + BOSS_PULSE_MS), 10);
  });

  it("음수 시간은 0", () => {
    expect(bossPulse(-1)).toBe(0);
  });
});

describe("labelPulse / labelFlashAlpha", () => {
  it("구간 밖에서 각각 1 / 0", () => {
    expect(labelPulse(-1)).toBe(1);
    expect(labelPulse(LABEL_PULSE_MS)).toBe(1);
    expect(labelFlashAlpha(-1)).toBe(0);
    expect(labelFlashAlpha(LABEL_PULSE_MS)).toBe(0);
  });

  it("중간에서 최대 배율", () => {
    expect(labelPulse(LABEL_PULSE_MS / 2)).toBeCloseTo(LABEL_PULSE_SCALE, 5);
  });

  it("플래시는 단조 감소한다", () => {
    let prev = 2;
    for (let t = 0; t < LABEL_PULSE_MS; t += 8) {
      const v = labelFlashAlpha(t);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("waveLabel", () => {
  it("1-based로 보여준다 — 내부 인덱스를 유저에게 노출하지 않는다", () => {
    expect(waveLabel(0)).toBe("WAVE 1");
    expect(waveLabel(4)).toBe("WAVE 5");
  });

  it("이상한 입력에서도 유효한 라벨이 나온다", () => {
    expect(waveLabel(-3)).toBe("WAVE 1");
    expect(waveLabel(NaN)).toBe("WAVE 1");
  });
});
