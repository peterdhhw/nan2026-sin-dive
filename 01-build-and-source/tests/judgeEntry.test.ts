import { expect, test } from "vitest";
import {
  JUDGE_UNLOCK_KEY,
  JUDGE_UNLOCK_PVP,
  NO_JUDGE,
  parseJudgeEntry,
} from "../src/shared/judgeEntry";

// 이 파서의 존재 이유 자체다 — `debugEntry`처럼 DEV 게이트를 달면 소개서에
// 적은 해제 링크가 배포본에서 조용히 죽는다. 인자가 하나뿐인 것이 의도다
test("해제는 DEV 플래그를 요구하지 않는다 — 배포본에서 동작해야 한다", () => {
  expect(parseJudgeEntry.length).toBe(1);
  expect(parseJudgeEntry("?unlock=pvp").pvp).toBe(true);
});

test("파라미터가 없으면 잠긴 쪽이 기본이다", () => {
  expect(parseJudgeEntry("")).toEqual(NO_JUDGE);
  expect(parseJudgeEntry("?seed=7")).toEqual(NO_JUDGE);
  expect(NO_JUDGE.pvp).toBe(false);
});

// 문서에서 링크를 복사해 올 때 붙는 공백·대문자로 해제가 조용히 안 되면
// 심사자는 잠긴 버튼을 보고 "버그"라고 적는다
test("값 비교는 공백과 대소문자를 접는다", () => {
  expect(parseJudgeEntry("?unlock=PVP").pvp).toBe(true);
  expect(parseJudgeEntry("?unlock=%20pvp%20").pvp).toBe(true);
  expect(parseJudgeEntry("?unlock=PvP").pvp).toBe(true);
});

test("다른 값은 열지 않는다 — 아무 값이나 통하면 잠금이 없는 것과 같다", () => {
  expect(parseJudgeEntry("?unlock=1").pvp).toBe(false);
  expect(parseJudgeEntry("?unlock=all").pvp).toBe(false);
  expect(parseJudgeEntry("?unlock=").pvp).toBe(false);
  expect(parseJudgeEntry("?unlock").pvp).toBe(false);
});

// 주는 것이 진행도가 아니라 입구라는 것이 이것이 치트가 아닌 근거다.
// 게이지·웨이브·저장값 필드가 하나라도 생기면 그 근거가 무너진다
test("입구 말고는 아무것도 주지 않는다 — 필드가 pvp 하나뿐이다", () => {
  expect(Object.keys(parseJudgeEntry("?unlock=pvp&gauge=0.9&wave=99"))).toEqual([
    "pvp",
  ]);
});

test("링크에 쓰는 키·값이 상수와 같다 — 문서와 코드가 갈리지 않게", () => {
  expect(parseJudgeEntry(`?${JUDGE_UNLOCK_KEY}=${JUDGE_UNLOCK_PVP}`).pvp).toBe(
    true,
  );
});
