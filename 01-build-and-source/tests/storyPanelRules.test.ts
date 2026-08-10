import { describe, expect, it } from "vitest";
import {
  STORY_BUTTON_GAP_X,
  STORY_BUTTON_H,
  STORY_BUTTON_PAD_B,
  STORY_CENTER_Y,
  STORY_CONTENT_GAP,
  STORY_MARGIN_Y,
  STORY_PAGEMARK_GAP,
  STORY_PAGEMARK_H,
  STORY_PANEL_MAX_H,
  STORY_PANEL_MIN_H,
  STORY_PANEL_W,
  STORY_PANEL_X,
  STORY_TEXT_GAP,
  storyBottomH,
  storyButtonSlots,
  storyButtonY,
  storyPageMarkY,
  storyPanelH,
  storyPanelY,
  storyStackY,
} from "../src/single/storyPanelRules";
import { PAD_PANEL } from "../src/shared/ui/shapeRules";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";

/* ── 스토리 모달 높이 (2026-08-07)
 *
 * 고치기 전은 `PANEL_H = 520` 고정이었고, 프롤로그 1:1 캡처에서 본문이 y470에
 * 끝나고 다음 요소가 y685에 있었다 — **패널 안 200px이 비어 있었다.** 세 모달
 * (프롤로그 2줄 / 선택 2줄+힌트 / 엔딩 5줄)이 가장 긴 엔딩에 맞춘 한 값을
 * 나눠 쓴 결과다.
 *
 * **그래서 이 파일은 높이 숫자를 비교하지 않는다.** 어떤 값을 기대값으로 적어도
 * "내용에서 나왔는가"는 안 물어진다. 묻는 것은 **내용이 늘면 높이가 늘고, 남는
 * 빈 구간은 간격 상수만큼이다**라는 관계다. 고정 높이가 절대로 가질 수 없는
 * 성질이다.
 */

/** 캡처에서 재던 세 모달의 실제 내용 높이(패널 내부 좌표의 아래 끝) */
const CONTENT = {
  /** 프롤로그 — 캡션 한 줄 + 본문 2줄 */
  prologue: 24 + STORY_TEXT_GAP + 60,
  /** 심연의 선택 — 제목 + 본문 2줄 + 힌트 1줄 */
  choice: 36 + STORY_TEXT_GAP + 60 + STORY_TEXT_GAP + 24,
  /** 엔딩 — 제목 + 본문 5줄(빈 줄 포함) */
  ending: 36 + STORY_TEXT_GAP + 180,
} as const;

describe("높이는 내용에서 나온다", () => {
  /**
   * **이게 본론이다.** 내용이 길어지면 패널이 커진다 — 고정 높이는 이 검사를
   * 통과할 수 없다.
   */
  it("내용이 길면 패널이 커진다", () => {
    const bottom = storyBottomH(false);
    const short = storyPanelH(CONTENT.prologue, bottom);
    const mid = storyPanelH(CONTENT.choice, bottom);
    const tall = storyPanelH(CONTENT.ending, bottom);
    expect(mid).toBeGreaterThan(short);
    expect(tall).toBeGreaterThan(mid);
  });

  /**
   * **빈 구간이 간격 하나로 제한된다.** 결함이 걸리는 검사다: 고치기 전
   * 프롤로그는 이 값이 200px이었다.
   *
   * 상한을 `STORY_CONTENT_GAP`으로 두는 이유 — 그 간격이 본문과 버튼을 다른
   * 블록으로 읽히게 하는 **의도된** 여백이고, 그보다 큰 빈 곳은 전부 남은
   * 공간이 흘러들어온 것이다.
   */
  it("본문과 아래 블록 사이 빈 곳이 간격 하나를 넘지 않는다", () => {
    for (const [name, content, pageMark] of [
      ["프롤로그", CONTENT.prologue, true],
      ["선택", CONTENT.choice, false],
      ["엔딩", CONTENT.ending, false],
    ] as const) {
      const bottom = storyBottomH(pageMark);
      const h = storyPanelH(content, bottom);
      const innerH = h - PAD_PANEL * 2;
      // 아래 블록이 시작하는 y — 페이지 표시가 있으면 그쪽이 먼저다
      const blockTop = pageMark ? storyPageMarkY(innerH) : storyButtonY(innerH);
      const gap = blockTop - content;
      expect(gap, `${name} 빈 구간`).toBeGreaterThanOrEqual(0);
      expect(gap, `${name} 빈 구간`).toBeLessThanOrEqual(STORY_CONTENT_GAP);
    }
  });

  /**
   * 고정 높이를 **대조군으로** 넣는다. 고치기 전 520이 위 검사를 어떻게
   * 어기는지가 남아 있어야, 다음에 누가 "간단하게 상수로 두자"고 할 때 그
   * 대가가 보인다.
   */
  it("대조군 — 고정 520은 프롤로그에서 빈 구간이 간격의 다섯 배를 넘었다", () => {
    const FIXED_H = 520;
    const innerH = FIXED_H - PAD_PANEL * 2;
    const gap = storyPageMarkY(innerH) - CONTENT.prologue;
    expect(gap).toBeGreaterThan(STORY_CONTENT_GAP * 5);
  });

  it("아래 블록이 패널 안에 들어간다 — 버튼이 밖으로 나가면 못 닫는다", () => {
    for (const [content, pageMark] of [
      [CONTENT.prologue, true],
      [CONTENT.choice, false],
      [CONTENT.ending, false],
      // 내용이 상한을 넘겨도 버튼은 남아야 한다
      [9999, false],
    ] as const) {
      const bottom = storyBottomH(pageMark);
      const innerH = storyPanelH(content, bottom) - PAD_PANEL * 2;
      const btnY = storyButtonY(innerH);
      expect(btnY).toBeGreaterThanOrEqual(0);
      expect(btnY + STORY_BUTTON_H).toBeLessThanOrEqual(innerH);
      if (pageMark) {
        expect(storyPageMarkY(innerH)).toBeGreaterThanOrEqual(0);
        expect(storyPageMarkY(innerH) + STORY_PAGEMARK_H).toBeLessThanOrEqual(btnY);
      }
    }
  });

  /**
   * 페이지 표시가 있으면 아래 블록이 더 높다 — 세 모달에 같은 값을 쓰면
   * 나머지 둘에 다시 빈 줄이 생긴다(원래 결함이 작게 되풀이된다).
   */
  it("아래 블록 높이가 모달마다 다르다", () => {
    expect(storyBottomH(true)).toBeGreaterThan(storyBottomH(false));
    expect(storyBottomH(true) - storyBottomH(false)).toBe(
      STORY_PAGEMARK_H + STORY_PAGEMARK_GAP,
    );
  });
});

describe("화면 안에 들어간다", () => {
  it("어떤 내용이 와도 패널이 화면 밖으로 안 나간다", () => {
    for (const content of [0, 100, 400, 1000, 100_000, Number.MAX_SAFE_INTEGER]) {
      const h = storyPanelH(content, storyBottomH(true));
      const y = storyPanelY(h);
      expect(y, `내용 ${content}`).toBeGreaterThanOrEqual(STORY_MARGIN_Y);
      expect(y + h, `내용 ${content}`).toBeLessThanOrEqual(DESIGN_H - STORY_MARGIN_Y);
    }
  });

  /**
   * 높이가 바뀌어도 **중심이 같다.** 고치기 전에는 위 y가 상수라 높이를 바꾸면
   * 모달이 위아래로 튀었다(그래서 `openModal`이 `(PANEL_H - panelH)/2`로
   * 보정하고 있었다 — 그 보정이 필요했다는 게 중심이 진짜 기준이라는 증거다).
   */
  it("높이가 달라도 세로 중심이 유지된다", () => {
    for (const content of [0, 200, 600]) {
      const h = storyPanelH(content, storyBottomH(false));
      expect(storyPanelY(h) + h / 2).toBeCloseTo(STORY_CENTER_Y, 6);
    }
  });

  it("중심이 화면 중앙보다 위다 — 아래는 엄지가 가린다", () => {
    expect(STORY_CENTER_Y).toBeLessThan(DESIGN_H / 2);
  });

  it("가로는 화면 안에서 좌우 대칭이다", () => {
    expect(STORY_PANEL_X).toBeGreaterThan(0);
    expect(STORY_PANEL_X + STORY_PANEL_W).toBe(DESIGN_W - STORY_PANEL_X);
  });

  it("하한이 상한보다 작다 — 접힘 순서가 뒤집히면 늘 상한이 이긴다", () => {
    expect(STORY_PANEL_MIN_H).toBeLessThan(STORY_PANEL_MAX_H);
    // 하한은 아래 블록만으로도 필요한 높이다
    expect(STORY_PANEL_MIN_H).toBeGreaterThanOrEqual(
      PAD_PANEL * 2 + STORY_BUTTON_H + STORY_BUTTON_PAD_B,
    );
  });

  it("이상한 입력은 하한으로 접는다 — NaN 높이의 패널을 만들지 않는다", () => {
    for (const bad of [Number.NaN, -100, Number.POSITIVE_INFINITY]) {
      const h = storyPanelH(bad, storyBottomH(false));
      expect(Number.isFinite(h), String(bad)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(STORY_PANEL_MIN_H);
      expect(h).toBeLessThanOrEqual(STORY_PANEL_MAX_H);
    }
    expect(Number.isFinite(storyPanelY(Number.NaN))).toBe(true);
  });
});

describe("글 쌓기", () => {
  /**
   * 첫 블록은 0이고 그 뒤는 **앞 블록의 아래 끝**에서 쌓인다.
   *
   * 고치기 전에는 y가 상수였다 — 선택 모달의 힌트가 `y=200`이라 본문이 2줄
   * 안에 들어간다는 가정이 박혀 있었다. 본문이 3줄이 되는 날 힌트가 본문을
   * 덮는데, 그건 캡처를 다시 찍어야 보인다.
   */
  it("앞 블록이 길어지면 뒤 블록이 밀린다", () => {
    expect(storyStackY(0)).toBe(0);
    const short = storyStackY(60);
    const long = storyStackY(120);
    expect(long - short).toBe(60);
    expect(short).toBe(60 + STORY_TEXT_GAP);
  });

  it("쌓기가 겹치지 않는다 — 간격이 0보다 크다", () => {
    expect(STORY_TEXT_GAP).toBeGreaterThan(0);
  });

  it("이상한 입력은 0으로 접는다", () => {
    expect(storyStackY(Number.NaN)).toBe(0);
    expect(storyStackY(-50)).toBe(0);
  });
});

describe("버튼 자리", () => {
  const INNER_W = STORY_PANEL_W - PAD_PANEL * 2;

  it("한 개는 가운데다", () => {
    const [slot] = storyButtonSlots(INNER_W, 1, 240);
    expect(slot).toBeDefined();
    if (!slot) return;
    expect(slot.w).toBe(240);
    expect(slot.x + slot.w / 2).toBeCloseTo(INNER_W / 2, 6);
  });

  /**
   * 두 개는 폭을 나눈다 — **선호 폭을 무시한다.** 지정하면 두 버튼의 합이
   * 내부 폭을 넘는 순간 한쪽이 패널 밖으로 나가고, 그건 "선택지가 하나만
   * 보인다"다(수용/거부에서 거부가 사라진다).
   */
  it("두 개는 내부 폭 안에서 간격을 두고 나눈다", () => {
    const slots = storyButtonSlots(INNER_W, 2, 999);
    expect(slots).toHaveLength(2);
    const [a, b] = slots;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) return;
    expect(a.x).toBe(0);
    expect(a.w).toBe(b.w);
    expect(b.x - (a.x + a.w)).toBe(STORY_BUTTON_GAP_X);
    expect(b.x + b.w).toBeLessThanOrEqual(INNER_W);
  });

  it("선호 폭이 내부 폭보다 크면 내부 폭으로 접는다", () => {
    const [slot] = storyButtonSlots(INNER_W, 1, 9999);
    expect(slot?.w).toBe(INNER_W);
    expect(slot?.x).toBe(0);
  });

  it("개수가 이상하면 최소 한 칸을 준다 — 버튼 0개는 못 닫는 모달이다", () => {
    expect(storyButtonSlots(INNER_W, 0)).toHaveLength(1);
    expect(storyButtonSlots(INNER_W, -3)).toHaveLength(1);
  });
});
