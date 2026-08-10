import { expect, test } from "vitest";
import {
  MAX_DEBUG_WAVE,
  NO_DEBUG,
  parseDebugEntry,
} from "../src/shared/debugEntry";

// 프로덕션에서 URL로 게이지를 옮길 수 있으면 그건 디버그가 아니라 치트다
test("every parameter is ignored when debug entry is disabled", () => {
  const r = parseDebugEntry("?gauge=-0.72&wave=3&debug=1&nowait", false);
  expect(r).toEqual(NO_DEBUG);
});

test("no parameters means every default", () => {
  expect(parseDebugEntry("", true)).toEqual(NO_DEBUG);
  expect(parseDebugEntry("?seed=7", true)).toEqual(NO_DEBUG);
});

test("gauge is read and clamped to the legal range", () => {
  expect(parseDebugEntry("?gauge=-0.72", true).gauge).toBe(-0.72);
  expect(parseDebugEntry("?gauge=0.72", true).gauge).toBe(0.72);
  expect(parseDebugEntry("?gauge=5", true).gauge).toBe(1);
  expect(parseDebugEntry("?gauge=-5", true).gauge).toBe(-1);
});

test("a garbage gauge falls back to the default instead of NaN", () => {
  expect(parseDebugEntry("?gauge=abc", true).gauge).toBeNull();
  expect(parseDebugEntry("?gauge=", true).gauge).toBeNull();
});

// 0을 그대로 넘기면 세션이 인덱스 -1을 계산한다
test("wave is 1-based and never drops below one", () => {
  expect(parseDebugEntry("?wave=3", true).wave).toBe(3);
  expect(parseDebugEntry("?wave=0", true).wave).toBe(1);
  expect(parseDebugEntry("?wave=-4", true).wave).toBe(1);
  expect(parseDebugEntry("?wave=2.7", true).wave).toBe(2);
  expect(parseDebugEntry("?wave=9999", true).wave).toBe(MAX_DEBUG_WAVE);
  expect(parseDebugEntry("?wave=x", true).wave).toBeNull();
});

// 전투 상태를 지정한 건 전투를 보러 온 것이다 — 매칭 대기 화면은 방해다
test("asking for a battle state skips the matching wait", () => {
  expect(parseDebugEntry("?gauge=0.5", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?wave=3", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?nowait", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?seed=7", true).skipMatch).toBe(false);
});

test("the debug hud flag needs an explicit 1", () => {
  expect(parseDebugEntry("?debug=1", true).debugHud).toBe(true);
  expect(parseDebugEntry("?debug=0", true).debugHud).toBe(false);
  expect(parseDebugEntry("?debug", true).debugHud).toBe(false);
});

// 게이지 0을 명시하는 것과 지정하지 않는 것은 구분되어야 한다 —
// null 병합(??)으로 처리하면 0이 "미지정"으로 삼켜진다
test("an explicit zero gauge is distinguishable from unset", () => {
  expect(parseDebugEntry("?gauge=0", true).gauge).toBe(0);
  expect(parseDebugEntry("", true).gauge).toBeNull();
});

// ── `?scene=` / `?result=` (설계 문서 09-3 스크린샷 표)

test("scene entry accepts only known scene names", () => {
  expect(parseDebugEntry("?scene=result", true).scene).toBe("result");
  expect(parseDebugEntry("?scene=BATTLE", true).scene).toBe("battle");
  expect(parseDebugEntry("?scene=lobby", true).scene).toBeNull();
  expect(parseDebugEntry("", true).scene).toBeNull();
});

test("result entry accepts only known result kinds", () => {
  expect(parseDebugEntry("?result=lose", true).result).toBe("lose");
  expect(parseDebugEntry("?result=Forfeit", true).result).toBe("forfeit");
  expect(parseDebugEntry("?result=cheese", true).result).toBeNull();
});

// `?result=`만 준 것도 결과 화면을 보러 온 것이다 — 씬을 따로 적게 하지 않는다
test("a result kind alone implies the result scene", () => {
  expect(parseDebugEntry("?result=win", true).scene).toBe("result");
});

// 매칭 이후 씬으로 직행한다는 것은 매칭 대기를 볼 이유가 없다는 뜻이다.
// 매칭 씬 자체는 예외 — 그 화면을 보러 온 것이므로 대기가 돌아야 한다
test("jumping past matchmaking skips the wait, but the match scene does not", () => {
  expect(parseDebugEntry("?scene=battle", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?scene=result", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?scene=title", true).skipMatch).toBe(true);
  expect(parseDebugEntry("?scene=match", true).skipMatch).toBe(false);
});

test("scene and result are ignored in production", () => {
  const d = parseDebugEntry("?scene=result&result=lose", false);
  expect(d.scene).toBeNull();
  expect(d.result).toBeNull();
});
