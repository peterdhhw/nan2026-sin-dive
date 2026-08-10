import { describe, expect, it } from "vitest";
import {
  CHOICE_ACCEPT_LABEL,
  ENDING_B_CORRUPTION,
  PROLOGUE_LINES,
  STORY_ENDING_ID,
  STORY_PROLOGUE_ID,
  bossIntroLine,
  bossNameOf,
  endingBody,
  endingOf,
  endingTitle,
  idleRewardToast,
  minibossIntroLine,
} from "../src/single/storyRules";
import { corruptionOf } from "../src/core/corruption/corruption";

describe("bossNameOf — 기획서 고정 4수문장 + 페이즈 파생", () => {
  it("기획서 §5.4의 네임드 보스 이름을 그대로 쓴다", () => {
    expect(bossNameOf(100)).toBe("녹슨 파수꾼 코어");
    expect(bossNameOf(1000)).toBe("표층 수문장 가르간튜아");
    expect(bossNameOf(5000)).toBe("몽마의 군주 아스모데우스");
    expect(bossNameOf(9900)).toBe("제로 수호사도 메타트론");
  });

  it("나머지 100층 보스는 페이즈 환경 이름에서 파생한다", () => {
    expect(bossNameOf(200)).toBe("표층 지각 & 달콤한 환청 지대의 수문장");
    expect(bossNameOf(1100)).toBe("붉은 증기의 온천 & 고열 구역의 수문장");
  });

  it("배너 문구에 층수가 붙는다", () => {
    expect(bossIntroLine(100)).toBe("100F — 녹슨 파수꾼 코어");
    expect(minibossIntroLine(30)).toBe("30F — 심연의 파수병");
  });
});

describe("endingOf — 타락도 70% 분기", () => {
  it("70 미만 A(성녀), 이상 B(여신)", () => {
    expect(endingOf(0)).toBe("A");
    expect(endingOf(ENDING_B_CORRUPTION - 1)).toBe("A");
    expect(endingOf(ENDING_B_CORRUPTION)).toBe("B");
    expect(endingOf(100)).toBe("B");
  });

  /** 깊이만으로는 60이 상한 — B 엔딩은 반드시 '수용' 선택이 쌓여야 나온다 */
  it("깊이만 판 유저는 A, 수용을 쌓은 유저만 B다", () => {
    expect(endingOf(corruptionOf(9999, 0))).toBe("A");
    expect(endingOf(corruptionOf(9999, 1))).toBe("B"); // 60 + 10
  });

  it("엔딩 문구가 비어 있지 않다", () => {
    for (const e of ["A", "B"] as const) {
      expect(endingTitle(e).length).toBeGreaterThan(0);
      expect(endingBody(e).length).toBeGreaterThan(0);
    }
  });
});

describe("고정 문구·id", () => {
  it("스토리 id는 저장 형식([a-z0-9_-])에 맞는다", () => {
    for (const id of [STORY_PROLOGUE_ID, STORY_ENDING_ID]) {
      expect(/^[a-z0-9_-]+$/.test(id)).toBe(true);
    }
  });

  it("프롤로그는 3줄이다 (기획서 §5.1 3씬)", () => {
    expect(PROLOGUE_LINES.length).toBe(3);
    expect(CHOICE_ACCEPT_LABEL).toContain("+10");
  });

  it("방치 보상 토스트", () => {
    expect(idleRewardToast(10, 47, 12400)).toBe("자리 비운 사이 — 37층 하강 · 12,400 G");
    expect(idleRewardToast(99, 99, 500)).toBe("자리 비운 사이 — 500 G 획득");
  });
});
