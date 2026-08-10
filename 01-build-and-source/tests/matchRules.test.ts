import { describe, expect, it } from "vitest";
import {
  AI_FILL_STAGGER_MS,
  CONFIRM_HOLD_MS,
  CONFIRM_TOTAL_MS,
  DOTS_PERIOD_MS,
  FLOURISH_MS,
  aiFillAtMs,
  cardBorder,
  confirmFlashAlpha,
  dotPhase,
  flourishFlash,
  flourishScale,
  isEmptyCard,
  ringColor,
  ringSweep,
  ringUrgent,
  stampScale,
  waitingFillOrder,
} from "../src/pvp/matchRules";
import { ACCENT_GOLD, TEAM_OURS, TEAM_THEIRS } from "../src/shared/theme";
import {
  MATCH_OFFLINE_WAIT_MS,
  matchConfirmHeadline,
  matchCountdownSec,
  matchSlotLabel,
} from "../src/pvp/matchText";
import { serverStatusText } from "../src/shared/screenText";
import { MATCH_WAIT_MS } from "../src/net/matchmaking";

describe("ringColor", () => {
  it("남은 비율에 따라 우리색 → 금색 → 상대색으로 갈린다 (§05-4)", () => {
    expect(ringColor(1)).toBe(TEAM_OURS);
    expect(ringColor(0.4)).toBe(TEAM_OURS);
    expect(ringColor(0.39)).toBe(ACCENT_GOLD);
    expect(ringColor(0.15)).toBe(ACCENT_GOLD);
    expect(ringColor(0.14)).toBe(TEAM_THEIRS);
    expect(ringColor(0)).toBe(TEAM_THEIRS);
  });

  it("범위를 벗어난 값도 색을 준다", () => {
    expect(ringColor(2)).toBe(TEAM_OURS);
    expect(ringColor(-1)).toBe(TEAM_THEIRS);
    expect(ringColor(NaN)).toBe(TEAM_THEIRS);
  });
});

describe("ringUrgent", () => {
  it("15% 미만에서만 뛴다 — 항상 뛰면 5초 내내 시선을 잡아먹는다", () => {
    expect(ringUrgent(0.2)).toBe(false);
    expect(ringUrgent(0.15)).toBe(false);
    expect(ringUrgent(0.14)).toBe(true);
  });
});

describe("ringSweep", () => {
  it("가득 찼을 때 한 바퀴, 비었을 때 0이다", () => {
    expect(ringSweep(1)).toBeCloseTo(Math.PI * 2, 6);
    expect(ringSweep(0)).toBe(0);
    expect(ringSweep(0.5)).toBeCloseTo(Math.PI, 6);
  });
});

describe("flourishScale", () => {
  it("0.85에서 시작해 1.06을 지나 1.0에 정착한다 (§05-3)", () => {
    expect(flourishScale(0)).toBeCloseTo(0.85, 5);
    expect(flourishScale(FLOURISH_MS * 0.6)).toBeCloseTo(1.06, 5);
    expect(flourishScale(FLOURISH_MS)).toBe(1);
    expect(flourishScale(FLOURISH_MS + 500)).toBe(1);
  });

  it("정점을 넘어선 뒤에는 1보다 작아지지 않는다", () => {
    for (let t = FLOURISH_MS * 0.6; t <= FLOURISH_MS; t += 8) {
      expect(flourishScale(t)).toBeGreaterThanOrEqual(1);
    }
  });

  it("모션이 없는 상태(음수·NaN)에서는 1이다", () => {
    expect(flourishScale(-1)).toBe(1);
    expect(flourishScale(NaN)).toBe(1);
  });

  it("플래시는 채워지는 순간이 가장 밝고 끝에서 0이다", () => {
    expect(flourishFlash(0)).toBe(1);
    expect(flourishFlash(FLOURISH_MS)).toBe(0);
    expect(flourishFlash(-1)).toBe(0);
  });
});

describe("dotPhase", () => {
  it("한 주기에 세 점을 순서대로 밝힌다 (§05-3)", () => {
    expect(dotPhase(0)).toBe(0);
    expect(dotPhase(DOTS_PERIOD_MS / 3)).toBe(1);
    expect(dotPhase((DOTS_PERIOD_MS / 3) * 2)).toBe(2);
    expect(dotPhase(DOTS_PERIOD_MS)).toBe(0);
  });

  it("항상 0..2 범위다", () => {
    for (const t of [-100, 0, 777, 12_345, NaN]) {
      const p = dotPhase(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(2);
    }
  });
});

describe("확정 연출", () => {
  it("0.9초 유지 뒤 120ms 플래시다 (§05-5)", () => {
    expect(CONFIRM_TOTAL_MS).toBe(CONFIRM_HOLD_MS + 120);
    expect(confirmFlashAlpha(0)).toBe(0);
    expect(confirmFlashAlpha(CONFIRM_HOLD_MS - 1)).toBe(0);
    expect(confirmFlashAlpha(CONFIRM_HOLD_MS)).toBe(0);
    expect(confirmFlashAlpha(CONFIRM_TOTAL_MS)).toBe(1);
    expect(confirmFlashAlpha(CONFIRM_TOTAL_MS + 500)).toBe(1);
  });

  it("스탬프는 1.4에서 1.0으로 줄어든다", () => {
    expect(stampScale(0)).toBeCloseTo(1.4, 5);
    expect(stampScale(260)).toBe(1);
    expect(stampScale(9_999)).toBe(1);
  });

  it("AI 슬롯은 120ms 간격으로 채워진다 — 동시면 과정이 안 보인다", () => {
    expect(aiFillAtMs(0)).toBe(0);
    expect(aiFillAtMs(1)).toBe(AI_FILL_STAGGER_MS);
    expect(aiFillAtMs(2)).toBe(AI_FILL_STAGGER_MS * 2);
    // 최악의 경우(3칸 AI)에도 유지 시간 안에 다 채워져야 한다
    expect(aiFillAtMs(3)).toBeLessThan(CONFIRM_HOLD_MS);
  });

  it("음수 순서는 0으로 접는다", () => {
    expect(aiFillAtMs(-3)).toBe(0);
    expect(aiFillAtMs(NaN)).toBe(0);
  });
});

describe("cardBorder", () => {
  it("내 카드만 금색이다 — 네 칸 중 어디가 나인지 찾을 수 있어야 한다 (§05-3)", () => {
    expect(cardBorder("me", 0)).toBe(ACCENT_GOLD);
    expect(cardBorder("human", 0)).toBe(TEAM_OURS);
    expect(cardBorder("human", 1)).toBe(TEAM_THEIRS);
  });

  it("빈 칸과 AI는 서로 다른 회색이다", () => {
    expect(cardBorder("empty", 0)).not.toBe(cardBorder("ai", 0));
  });

  it("빈 칸만 점선으로 그린다 — 색만으로 구분하지 않는다 (§01-6)", () => {
    expect(isEmptyCard("empty")).toBe(true);
    for (const k of ["me", "human", "ai"] as const) {
      expect(isEmptyCard(k)).toBe(false);
    }
  });
});

describe("matchCountdownSec", () => {
  it("링과 캡션이 같은 소스를 쓴다 (§05-4)", () => {
    expect(matchCountdownSec(0)).toBe(MATCH_WAIT_MS / 1000);
    expect(matchCountdownSec(MATCH_WAIT_MS)).toBe(0);
  });

  it("음수 카운트다운을 보여주지 않는다", () => {
    expect(matchCountdownSec(MATCH_WAIT_MS + 9_000)).toBe(0);
  });

  it("오프라인 단축 대기에도 같은 함수를 쓴다 (§05-6)", () => {
    expect(MATCH_OFFLINE_WAIT_MS).toBeLessThan(MATCH_WAIT_MS);
    expect(matchCountdownSec(0, MATCH_OFFLINE_WAIT_MS)).toBe(2);
    expect(matchCountdownSec(MATCH_OFFLINE_WAIT_MS, MATCH_OFFLINE_WAIT_MS)).toBe(0);
  });

  it("상한이 0이어도(디버그 직행) 음수가 안 나온다", () => {
    expect(matchCountdownSec(0, 0)).toBe(0);
  });
});

describe("matchConfirmHeadline", () => {
  it("사람 수에 따라 문구가 갈린다 (§05-5)", () => {
    expect(matchConfirmHeadline(4)).toContain("사람");
    expect(matchConfirmHeadline(2)).toContain("AI");
    expect(matchConfirmHeadline(1)).toBe("AI 대전");
  });

  it("이상한 값에도 문구가 있다", () => {
    expect(matchConfirmHeadline(NaN).length).toBeGreaterThan(0);
    expect(matchConfirmHeadline(-2).length).toBeGreaterThan(0);
  });
});

describe("matchSlotLabel", () => {
  it("내 슬롯은 (나)로 표시한다", () => {
    expect(
      matchSlotLabel({ kind: "human", displayName: "리아" }, true),
    ).toContain("(나)");
  });

  // 로컬 매칭·AppSync 자기 슬롯의 표시 이름이 이미 "나"다
  it('이름이 이미 "나"면 "나 (나)"로 겹쳐 쓰지 않는다', () => {
    expect(matchSlotLabel({ kind: "human", displayName: "나" }, true)).toBe("나");
  });

  it("AI는 캐릭터 이름이 아니라 AI로 표시한다 — 같은 이름이 네 번 나오지 않게", () => {
    expect(matchSlotLabel({ kind: "ai", displayName: "리아" }, false)).toBe("AI");
  });
});

describe("serverStatusText", () => {
  it("연결 여부를 숨기지 않는다 — 키 만료(2026-08-25) 대비 (§05-2)", () => {
    expect(serverStatusText(false, 3)).toContain("오프라인");
    expect(serverStatusText(true, 3)).toContain("3");
  });

  it("음수·NaN 인원을 0으로 접는다", () => {
    expect(serverStatusText(true, -1)).toContain("0");
    expect(serverStatusText(true, NaN)).toContain("0");
  });
});

describe("waitingFillOrder", () => {
  // 2명 대전에서 두 번째 사람은 항상 상대 팀이다 (localizeMatch의 홀짝 배정)
  it("나 다음은 우리 팀 옆자리가 아니라 상대 0번이다 (§05-3)", () => {
    expect(waitingFillOrder(2)).toEqual([0, 2, 1, 3]);
  });

  it("모든 카드를 정확히 한 번씩 덮는다 — 빠진 칸은 영원히 비어 보인다", () => {
    for (const size of [1, 2, 3]) {
      const order = waitingFillOrder(size);
      expect(order).toHaveLength(size * 2);
      expect(new Set(order).size).toBe(size * 2);
      expect([...order].sort((a, b) => a - b)).toEqual(
        Array.from({ length: size * 2 }, (_, i) => i),
      );
    }
  });

  it("1:1도, 이상한 팀 크기도 빈 배열을 주지 않는다", () => {
    expect(waitingFillOrder(1)).toEqual([0, 1]);
    expect(waitingFillOrder(0)).toEqual([0, 1]);
    expect(waitingFillOrder(NaN)).toEqual([0, 1]);
  });
});
