import { expect, test } from "vitest";
import {
  COMPACT_MIN,
  COMPACT_UNITS,
  formatClock,
  formatCompact,
  formatGauge,
  formatGold,
  formatInt,
} from "../src/shared/format";

test("clock formats m:ss with zero-padded seconds", () => {
  expect(formatClock(0)).toBe("0:00");
  expect(formatClock(1_000)).toBe("0:01");
  expect(formatClock(59_000)).toBe("0:59");
  expect(formatClock(60_000)).toBe("1:00");
  expect(formatClock(120_000)).toBe("2:00");
});

// ceil이 아니면 제한시간 120초가 시작부터 1:59로 보인다
test("clock rounds up so a full match starts at 2:00", () => {
  expect(formatClock(119_999)).toBe("2:00");
  expect(formatClock(59_001)).toBe("1:00");
  expect(formatClock(1)).toBe("0:01");
});

// 타이머가 NaN:NaN을 띄우는 사고를 막는다
test("clock folds negative and non-finite input to zero", () => {
  expect(formatClock(-1)).toBe("0:00");
  expect(formatClock(-99_000)).toBe("0:00");
  expect(formatClock(Number.NaN)).toBe("0:00");
  expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
});

test("gauge always carries a sign and two decimals", () => {
  expect(formatGauge(0)).toBe("+0.00");
  expect(formatGauge(0.8)).toBe("+0.80");
  expect(formatGauge(-0.8)).toBe("-0.80");
  expect(formatGauge(0.426)).toBe("+0.43");
});

// 0.425는 float에서 0.42499…이라 "+0.42"가 된다. toFixed의 정상 동작이고
// 게이지 표기에서 0.01의 차이는 의미가 없으므로 그대로 둔다
test("gauge rounding follows float representation, not decimal intuition", () => {
  expect(formatGauge(0.425)).toBe("+0.42");
});

// -0.004가 "-0.00"으로 나오면 지고 있는 것처럼 읽힌다
test("gauge never renders a signed zero", () => {
  expect(formatGauge(-0.004)).toBe("+0.00");
  expect(formatGauge(-0)).toBe("+0.00");
});

test("gauge clamps to the -1..1 range and survives garbage", () => {
  expect(formatGauge(5)).toBe("+1.00");
  expect(formatGauge(-5)).toBe("-1.00");
  expect(formatGauge(Number.NaN)).toBe("+0.00");
});

// 자리수가 흔들리면 데미지 숫자의 폭이 프레임마다 변한다
test("int rounds and never goes negative", () => {
  expect(formatInt(0)).toBe("0");
  expect(formatInt(42.4)).toBe("42");
  expect(formatInt(42.5)).toBe("43");
  expect(formatInt(-10)).toBe("0");
  expect(formatInt(Number.NaN)).toBe("0");
});

// 전투 수치(데미지·HP)는 여전히 축약하지 않는다 — 네 자리를 안 넘는다.
// 축약은 `formatCompact`(골드 전용)이고, `formatInt`는 그대로다
test("four-digit values are not abbreviated", () => {
  expect(formatInt(650)).toBe("650");
  expect(formatInt(9_999)).toBe("9999");
});

/* ── formatCompact — 골드 자리수 (2026-08-07)
 *
 * 캡처에서 골드 필이 `3,299,03…`으로 잘렸다. 임계값·유효자리는 필의 글자
 * 자리(114px)에서 유도됐고 근거는 `shared/format.formatCompact` 주석에 있다.
 *
 * **자리수를 세는 검사가 이 파일의 본론이다.** 문자열을 하나하나 비교하면
 * `1.23M`이 맞는지는 확인되지만 "필에 들어가는가"는 안 물어진다 — 그게 결함이
 * 통과한 방식이다(`diveHudRules.test.ts`의 폭 예산 검사가 짝이다).
 */

// 임계값 아래는 콤마다 — 강화 비용과 잔고의 뺄셈이 초반에 정확해야 한다
test("compact keeps exact commas below the threshold", () => {
  expect(formatCompact(0)).toBe("0");
  expect(formatCompact(60)).toBe("60");
  expect(formatCompact(999_999)).toBe("999,999");
  expect(COMPACT_MIN).toBe(1_000_000);
});

// 임계값에서 축약으로 넘어간다. 경계 양쪽을 다 본다 — 한쪽만 보면 부등호
// 방향(< vs <=)이 바뀌어도 조용하다
test("compact switches to units exactly at the threshold", () => {
  expect(formatCompact(999_999)).toBe("999,999");
  expect(formatCompact(1_000_000)).toBe("1M");
  expect(formatCompact(1_000_001)).toBe("1M");
});

test("compact scales through the unit ladder", () => {
  expect(formatCompact(1_234_567)).toBe("1.23M");
  expect(formatCompact(12_345_678)).toBe("12.3M");
  expect(formatCompact(123_456_789)).toBe("123M");
  expect(formatCompact(1_234_567_890)).toBe("1.23B");
  expect(formatCompact(755_109_956_697)).toBe("755B");
  expect(formatCompact(851_438_094_950_251)).toBe("851T");
});

/**
 * **이 검사가 결함을 막는 것이다.** 어떤 값이 와도 표기가 짧아야 한다 —
 * 페이싱 실측이 3분 8자리 / 10분 12자리 / 40분 15자리이므로 "도달 못 하는
 * 자리수"라는 변명이 안 통한다.
 *
 * 상한을 글자 수로 묻는 이유: 폭(px)은 `diveHudRules.test.ts`가 필 기하로
 * 재고 있다. 여기서는 함수 자체의 계약 — **자리수가 늘어도 표기 길이는 안
 * 늘어난다** — 만 묻는다.
 */
test("compact output length stays bounded as the value grows", () => {
  for (let digits = 1; digits <= 18; digits += 1) {
    for (const v of [10 ** (digits - 1), 10 ** digits - 1]) {
      const s = formatCompact(v);
      // `999,999`(7글자)가 가장 긴 콤마 표기이고, 축약은 `123.45M`을 안 만든다
      expect(s.length, `${digits}자리 ${v} = ${s}`).toBeLessThanOrEqual(7);
    }
  }
});

/** 유효자리 3 — 폭이 고정되고 "지금 뭘 살 수 있나"가 남는다 */
test("compact keeps three significant digits, no trailing zeros", () => {
  expect(formatCompact(1_000_000)).toBe("1M");
  expect(formatCompact(1_100_000)).toBe("1.1M");
  expect(formatCompact(1_110_000)).toBe("1.11M");
  // 넷째 자리는 버린다 — 소수 자리수가 흔들리면 필의 글자 폭이 프레임마다 변한다
  expect(formatCompact(1_111_100)).toBe("1.11M");
  expect(formatCompact(111_100_000)).toBe("111M");
});

// 단위 사다리에 빈 칸이 있으면 특정 자리수만 조용히 원래 크기로 찍힌다
test("unit ladder starts at the ones place and has no gaps", () => {
  expect(COMPACT_UNITS[0]).toBe("");
  expect(new Set(COMPACT_UNITS).size).toBe(COMPACT_UNITS.length);
  expect([...COMPACT_UNITS]).toEqual(["", "K", "M", "B", "T", "Q"]);
});

// 마지막 단위를 넘는 값은 그 단위에 눌러 둔다 — NaN이나 `undefined` 단위를
// 찍는 것보다 큰 수가 낫다
test("compact clamps beyond the last unit instead of breaking", () => {
  const huge = formatCompact(1e21);
  expect(huge).toContain("Q");
  expect(huge).not.toContain("undefined");
  expect(huge).not.toContain("NaN");
});

test("compact folds garbage and negatives", () => {
  expect(formatCompact(Number.NaN)).toBe("0");
  expect(formatCompact(-5)).toBe("0");
  expect(formatCompact(Number.POSITIVE_INFINITY)).toBe("0");
});

// 골드 표기는 수와 단위를 한 곳에서 붙인다 — 세 호출부가 `G`를 각자 붙이면
// 하나가 빠져도 조용하다
test("gold label appends the unit to the compact number", () => {
  expect(formatGold(0)).toBe("0 G");
  expect(formatGold(999_999)).toBe("999,999 G");
  // 캡처에서 `3,299,03…`으로 잘렸던 그 값이다. 3.30 → 꼬리 0을 지워 `3.3M`
  expect(formatGold(3_299_036)).toBe("3.3M G");
});
