import { describe, expect, it } from "vitest";
import {
  SCENE_FADE_IN_MS,
  SCENE_FADE_OUT_MS,
  SCENE_NAMES,
  parseSceneName,
  veilAlpha,
} from "../src/shared/sceneRules";

describe("parseSceneName", () => {
  it("정의된 씬 이름만 통과시킨다", () => {
    for (const n of SCENE_NAMES) expect(parseSceneName(n)).toBe(n);
    expect(parseSceneName("lobby")).toBeNull();
    expect(parseSceneName(null)).toBeNull();
    expect(parseSceneName("")).toBeNull();
  });

  it("대소문자·공백을 흘려 준다 — URL을 손으로 치는 검증 경로다", () => {
    expect(parseSceneName(" Result ")).toBe("result");
    expect(parseSceneName("BATTLE")).toBe("battle");
  });

  it("전투 직행이 가능해야 한다 (매칭 5초 + VS 1.6초 절약, §09-3)", () => {
    expect(parseSceneName("battle")).toBe("battle");
  });
});

describe("veilAlpha", () => {
  it("out은 0→1로 덮고 in은 1→0으로 걷는다", () => {
    expect(veilAlpha(0, 200, "out")).toBe(0);
    expect(veilAlpha(200, 200, "out")).toBe(1);
    expect(veilAlpha(0, 200, "in")).toBe(1);
    expect(veilAlpha(200, 200, "in")).toBe(0);
  });

  it("범위를 넘긴 시간에도 끝점에서 멈춘다 — 막이 어중간하게 남으면 안 된다", () => {
    expect(veilAlpha(9_999, 200, "out")).toBe(1);
    expect(veilAlpha(9_999, 200, "in")).toBe(0);
    expect(veilAlpha(-50, 200, "out")).toBe(0);
  });

  it("duration 0은 즉시 완료다 (첫 씬은 페이드아웃이 없다)", () => {
    expect(veilAlpha(0, 0, "out")).toBe(1);
    expect(veilAlpha(0, 0, "in")).toBe(0);
  });

  it("덮는 쪽이 걷는 쪽보다 짧다 — 다음 씬은 이미 준비돼 있다", () => {
    expect(SCENE_FADE_OUT_MS).toBeLessThan(SCENE_FADE_IN_MS);
  });
});
