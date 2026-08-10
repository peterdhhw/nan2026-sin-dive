import { describe, expect, it } from "vitest";
import { DEBUG_RESULTS } from "../src/shared/debugEntry";
import {
  PREVIEW_ELAPSED_MS,
  PREVIEW_GAUGE,
  PREVIEW_KILLS,
  debugMatch,
  debugSessionResult,
} from "../src/pvp/debugPreview";
import { resultText } from "../src/pvp/matchText";

describe("debugSessionResult", () => {
  it("네 종류 모두 유효한 결과를 준다 — 하나라도 비면 `?result=`가 죽는다", () => {
    for (const kind of DEBUG_RESULTS) {
      const r = debugSessionResult(kind);
      expect(r.elapsedMs).toBeGreaterThan(0);
      expect(r.myKills).toBeGreaterThanOrEqual(0);
      expect(r.gaugePos).toBeGreaterThanOrEqual(-1);
      expect(r.gaugePos).toBeLessThanOrEqual(1);
      // 씬이 읽는 문구가 다 나오는지까지 봐야 스크린샷이 빈 화면이 아니다
      expect(resultText(r).stamp.length).toBeGreaterThan(0);
    }
  });

  it("승/패/무를 실제로 다른 결과로 만든다", () => {
    expect(debugSessionResult("win").winner).toBe(0);
    expect(debugSessionResult("lose").winner).toBe(1);
    expect(debugSessionResult("draw").winner).toBeNull();
  });

  it("무승부는 시간 만료다 — 임계선에 닿았으면 승자가 있어야 한다", () => {
    expect(debugSessionResult("draw").reason).toBe("timeLimit");
    expect(debugSessionResult("draw").gaugePos).toBe(0);
  });

  it("몰수는 승리 쪽으로 띄운다 — 파티클 억제(§08-3)를 검증할 유일한 경로다", () => {
    const r = debugSessionResult("forfeit");
    expect(r.reason).toBe("forfeit");
    expect(r.winner).toBe(0);
    expect(resultText(r).celebrate).toBe(false);
  });

  it("값이 고정이다 — 스크린샷 diff가 흔들리면 회귀를 못 읽는다", () => {
    const a = debugSessionResult("win");
    expect(a).toEqual(debugSessionResult("win"));
    expect(a.myKills).toBe(PREVIEW_KILLS);
    expect(a.elapsedMs).toBe(PREVIEW_ELAPSED_MS);
    expect(a.gaugePos).toBe(PREVIEW_GAUGE);
  });
});

describe("debugMatch", () => {
  it("내 슬롯이 실제 슬롯 목록 안에 있다 — 없으면 씬이 나를 못 찾는다", () => {
    const m = debugMatch(11, 2);
    expect(m.slots).toHaveLength(4);
    expect(m.slots.some((s) => s.slotId === m.mySlotId)).toBe(true);
    expect(m.slots.find((s) => s.slotId === m.mySlotId)?.team).toBe(0);
  });

  it("상대 팀에 사람이 하나 있다 (§06-4 색 구분·§08-4 상대 표기)", () => {
    const theirs = debugMatch(11, 2).slots.filter((s) => s.team === 1);
    expect(theirs.filter((s) => s.kind === "human")).toHaveLength(1);
    expect(theirs.filter((s) => s.kind === "ai")).toHaveLength(1);
  });

  it("슬롯 아이디가 겹치지 않는다", () => {
    const m = debugMatch(11, 2);
    expect(new Set(m.slots.map((s) => s.slotId)).size).toBe(m.slots.length);
  });

  it("시드를 그대로 쓴다 — `?seed=`로 같은 웨이브를 재현할 수 있어야 한다", () => {
    expect(debugMatch(42, 2).seed).toBe(42);
    expect(debugMatch(42, 2)).toEqual(debugMatch(42, 2));
  });

  it("1:1도 만든다 — 팀 크기를 코드에 박아 두지 않았다", () => {
    const m = debugMatch(1, 1);
    expect(m.slots).toHaveLength(2);
    expect(m.slots.every((s) => s.kind === "human")).toBe(true);
  });
});
