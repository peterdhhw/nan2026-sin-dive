import { describe, expect, it } from "vitest";
import {
  BOOT_STEPS,
  BOOT_TIMEOUT_MS,
  BOOT_TIPS,
  SLOW_AFTER_MS,
  TIP_AFTER_MS,
  bootErrorText,
  bootProgress,
  classifyBootError,
  expandsDetail,
  monotonic,
  pickTip,
  progressText,
  type BootStepId,
} from "../src/shared/scenes/bootRules";

const ALL: BootStepId[] = BOOT_STEPS.map((s) => s.id);

describe("bootProgress", () => {
  it("모든 단계 가중의 합이 정확히 1이다 (§03-3 표)", () => {
    const sum = BOOT_STEPS.reduce((a, s) => a + s.weight, 0);
    // 부동소수 합이라 정확 비교는 못 한다 — 표의 백분율이 100이 되는지를 본다
    expect(Math.round(sum * 100)).toBe(100);
    expect(bootProgress(ALL)).toBe(1);
  });

  it("아무것도 안 끝나면 0이다", () => {
    expect(bootProgress([])).toBe(0);
  });

  it("같은 단계를 두 번 보고해도 두 배가 되지 않는다", () => {
    expect(bootProgress(["chars", "chars"])).toBeCloseTo(0.48, 5);
  });

  it("캐릭터 시트가 절반에 가깝다 — 체감의 대부분이 여기다 (22장 순차)", () => {
    expect(bootProgress(["chars"])).toBeCloseTo(0.48, 5);
  });
});

describe("monotonic", () => {
  it("진행률은 되돌아가지 않는다 — 뒤로 가는 바는 실패로 읽힌다 (§03-3)", () => {
    expect(monotonic(0.6, 0.3)).toBe(0.6);
    expect(monotonic(0.6, 0.9)).toBe(0.9);
  });

  it("NaN이 들어와도 직전 값을 유지한다", () => {
    expect(monotonic(0.5, NaN)).toBe(0.5);
  });

  it("1을 넘지 않는다", () => {
    expect(monotonic(0.9, 4)).toBe(1);
  });
});

describe("progressText", () => {
  it("퍼센트는 정수다 (§03-2)", () => {
    expect(progressText("chars", 0.4567)).toContain("46%");
    expect(progressText("chars", 0.4567)).not.toContain(".");
  });

  it("단계가 없어도 문구가 비지 않는다", () => {
    expect(progressText(null, 0).length).toBeGreaterThan(0);
  });

  it("범위를 벗어난 진행률을 0~100%로 접는다", () => {
    expect(progressText(null, -1)).toContain("0%");
    expect(progressText(null, 2)).toContain("100%");
  });
});

describe("pickTip", () => {
  it("첫 진입에는 쿨다운 팁을 고정한다 — 유일한 온보딩이다 (§03-3)", () => {
    expect(pickTip(12_345, true)).toBe(BOOT_TIPS[0]);
    expect(pickTip(0, true)).toBe(BOOT_TIPS[0]);
  });

  it("재진입은 시드로 로테이션한다 (결정론)", () => {
    expect(pickTip(7, false)).toBe(pickTip(7, false));
    expect(pickTip(1, false)).not.toBe(pickTip(2, false));
  });

  it("어떤 시드에도 팁이 나온다", () => {
    for (const seed of [-5, 0, 1, 999_999, NaN]) {
      expect(pickTip(seed, false).length).toBeGreaterThan(0);
    }
  });

  it("지연 문구는 팁보다 늦게, 타임아웃은 그보다 늦게 온다", () => {
    expect(TIP_AFTER_MS).toBeLessThan(SLOW_AFTER_MS);
    expect(SLOW_AFTER_MS).toBeLessThan(BOOT_TIMEOUT_MS);
  });
});

describe("classifyBootError", () => {
  it("WebGL 실패를 GPU로 분류한다", () => {
    expect(classifyBootError(new Error("WebGL unsupported"))).toBe("gpu");
    expect(classifyBootError(new Error("WebGPU init failed"))).toBe("gpu");
  });

  it("네트워크 실패를 구분한다", () => {
    expect(classifyBootError(new Error("Failed to load bg.json"))).toBe("network");
    expect(classifyBootError(new Error("fetch 404"))).toBe("network");
  });

  it("에셋 데이터 오류를 GPU보다 먼저 본다 — 메시지에 두 단어가 같이 나온다", () => {
    const err = new Error("Unable to render skeleton on WebGL context");
    expect(classifyBootError(err)).toBe("asset");
    // 브라우저를 바꿔도 해결되지 않는 종류임을 개발자가 봐야 한다
    expect(expandsDetail(classifyBootError(err))).toBe(true);
    expect(classifyBootError(new Error("[pvp] chars.json 형식이 아니다"))).toBe(
      "asset",
    );
  });

  it("Error가 아닌 값도 문자열로 본다", () => {
    expect(classifyBootError("webgl gone")).toBe("gpu");
    expect(classifyBootError(null)).toBe("unknown");
  });

  it("원인마다 다른 문구를 준다 — '알 수 없는 오류'는 정보가 없다", () => {
    const texts = (["gpu", "network", "asset", "unknown"] as const).map(
      bootErrorText,
    );
    expect(new Set(texts).size).toBe(4);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
  });

  it("에셋 오류 외에는 상세를 접어 둔다", () => {
    expect(expandsDetail("gpu")).toBe(false);
    expect(expandsDetail("network")).toBe(false);
    expect(expandsDetail("unknown")).toBe(false);
  });
});
