import { describe, expect, it } from "vitest";
import {
  HUD_FLASH_MS,
  TIMER_PULSE_MS,
  TIMER_PULSE_SCALE,
  TIMER_WARN_MS,
  dpsReadout,
  gaugeReadout,
  hudFlashAlpha,
  timerPulse,
  timerWarning,
} from "../src/shared/hudRules";

describe("timerWarning", () => {
  it("10초 이하에서 경고다 (§3)", () => {
    expect(TIMER_WARN_MS).toBe(10_000);
    expect(timerWarning(10_001)).toBe(false);
    expect(timerWarning(10_000)).toBe(true);
    expect(timerWarning(0)).toBe(true);
  });

  it("시간이 다 지나 음수가 되어도 경고 상태를 유지한다", () => {
    expect(timerWarning(-500)).toBe(true);
  });

  it("NaN은 경고가 아니다 — 계산 사고로 화면이 붉어지지 않게", () => {
    expect(timerWarning(NaN)).toBe(false);
  });
});

describe("timerPulse", () => {
  it("구간 밖에서 1", () => {
    expect(timerPulse(-1)).toBe(1);
    expect(timerPulse(TIMER_PULSE_MS)).toBe(1);
  });

  it("중간에서 스펙 배율 (§3: 1.12)", () => {
    expect(timerPulse(TIMER_PULSE_MS / 2)).toBeCloseTo(TIMER_PULSE_SCALE, 5);
  });

  it("절대 1보다 작아지지 않는다 — 타이머가 작아지면 다급함이 안 읽힌다", () => {
    for (let t = 0; t < TIMER_PULSE_MS; t += 5) {
      expect(timerPulse(t)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("gaugeReadout", () => {
  it("우세는 ▲, 열세는 ▼ — 색만으로 우열을 말하지 않는다 (§01-6)", () => {
    expect(gaugeReadout(0.32)).toBe("▲ 0.32");
    expect(gaugeReadout(-0.32)).toBe("▼ 0.32");
  });

  it("0은 = 로 표기한다 — 방향 없는 상태를 방향으로 속이지 않는다", () => {
    expect(gaugeReadout(0)).toBe("= 0.00");
    expect(gaugeReadout(-0.001)).toBe("= 0.00");
  });

  it("양 끝 값을 접는다", () => {
    expect(gaugeReadout(3)).toBe("▲ 1.00");
    expect(gaugeReadout(-3)).toBe("▼ 1.00");
  });

  it("항상 부호 없는 절대값만 보여준다", () => {
    for (const v of [-1, -0.5, 0.5, 1]) {
      expect(gaugeReadout(v)).not.toContain("-");
      expect(gaugeReadout(v)).not.toContain("+");
    }
  });

  it("NaN을 0으로 본다", () => {
    expect(gaugeReadout(NaN)).toBe("= 0.00");
  });
});

describe("hudFlashAlpha", () => {
  it("60ms 안에 사라진다 (§3)", () => {
    expect(HUD_FLASH_MS).toBe(60);
    expect(hudFlashAlpha(0)).toBe(1);
    expect(hudFlashAlpha(HUD_FLASH_MS)).toBe(0);
    expect(hudFlashAlpha(-1)).toBe(0);
  });

  it("단조 감소한다", () => {
    let prev = 2;
    for (let t = 0; t <= HUD_FLASH_MS; t += 5) {
      const v = hudFlashAlpha(t);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("dpsReadout", () => {
  it("정수 두 값을 슬래시로 잇는다", () => {
    expect(dpsReadout(1234.7, 980.2)).toBe("1235 / 980");
  });

  it("비정상 값에서도 문자열이 깨지지 않는다", () => {
    expect(dpsReadout(NaN, Infinity)).toBe("0 / 0");
  });

  it("스켈레톤 수를 주면 뒤에 붙는다 — 누수 검증용 (§09-4)", () => {
    expect(dpsReadout(100, 90, 8)).toBe("100 / 90  ch 8");
    // 안 주면 표기가 그대로여야 한다 (기존 스크린샷 회귀)
    expect(dpsReadout(100, 90)).toBe("100 / 90");
  });
});
