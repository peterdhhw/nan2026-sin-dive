import { describe, expect, it } from "vitest";
import {
  ABYSS_PILL_W,
  ABYSS_PILL_X,
  ABYSS_PILL_Y,
  COMBO_TEXT_Y,
  CORRUPTION_TEXT_Y,
  FLOOR_TEXT_X,
  GOLD_PILL_W,
  GOLD_PILL_X,
  GOLD_PILL_Y,
  HUD_H,
  TITLE_BTN_X,
  TITLE_BTN_Y,
  abyssLabel,
  comboLabel,
  corruptionLabel,
  goldLabel,
  ABYSS_PILL_GAP,
  PHASE_TEXT_MAX_W,
} from "../src/single/diveHudRules";
import {
  ICON_OVERHANG,
  PILL_H,
  iconDiameter,
  pillTextWidth,
} from "../src/shared/ui/pillRules";
import { pillRadius } from "../src/shared/ui/shapeRules";
import { abyssForFloorClear } from "../src/core/deck/deck";
import { floorKindOf } from "../src/core/phase/phaseWaves";
import { FINAL_FLOOR, PHASES } from "../src/core/phase/floors";
import { DESIGN_W } from "../src/shared/viewport";
import { FIT_MIN_SCALE } from "../src/shared/ui/fitTextRules";
import { formatCompact } from "../src/shared/format";

/**
 * 도트 폰트(Galmuri11, 24px)에서 문자열이 차지하는 폭의 어림값.
 *
 * 글자마다 24를 곱하면 안 된다 — Galmuri는 고정폭이지만 **라틴은 반각**이라
 * `1,234,567`이 실제 폭의 두 배로 계산되고, 그러면 잘리지 않는 문구도 검사에서
 * 넘친다(처음 이 어림으로 필을 152→192로 잘못 넓혔다). 한글·기호는 전각(24),
 * ASCII는 반각(12)이다.
 */
function dotTextW(text: string, size = 24): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x80 ? size / 2 : size;
  return w;
}

describe("배치 — HUD 밴드(위 12%) 안에 든다", () => {
  it("우측 요소들이 밴드 안에서 겹치지 않는 순서다", () => {
    expect(TITLE_BTN_Y).toBeGreaterThanOrEqual(0);
    expect(GOLD_PILL_Y).toBeGreaterThan(TITLE_BTN_Y);
    expect(COMBO_TEXT_Y).toBeGreaterThan(GOLD_PILL_Y);
    expect(CORRUPTION_TEXT_Y).toBeLessThan(HUD_H);
    expect(TITLE_BTN_X + 132).toBeLessThanOrEqual(DESIGN_W - 24 + 132); // 우측 여백 기준
    expect(GOLD_PILL_X).toBeGreaterThan(DESIGN_W / 2);
  });

  /**
   * 심연석 필이 이웃과 안 겹친다 (3단계). 두 필은 같은 띠에 나란히 있으므로
   * 폭·간격이 어긋나면 숫자가 서로를 덮는다 — 화면은 안 죽으니 조용하다.
   */
  it("심연석 필이 골드 필과 왼쪽 열 사이에 든다", () => {
    expect(ABYSS_PILL_Y).toBe(GOLD_PILL_Y);
    expect(ABYSS_PILL_X).toBeGreaterThan(0);
    // 골드 필을 침범하지 않는다
    expect(ABYSS_PILL_X + ABYSS_PILL_W).toBeLessThanOrEqual(GOLD_PILL_X);
    // 왼쪽 열(x 24부터)의 가장 긴 줄과 안 닿는다. 세로로는 못 피한다 —
    // 필(66~118)과 타락도 줄(112~136)이 6px 겹치므로 가로가 유일한 여지다
    expect(ABYSS_PILL_X).toBeGreaterThanOrEqual(
      FLOOR_TEXT_X + dotTextW(corruptionLabel(100)),
    );
    // 필 두 개가 HUD 밴드 안에 든다
    expect(ABYSS_PILL_Y + PILL_H).toBeLessThanOrEqual(HUD_H);
  });
});

describe("corruptionLabel", () => {
  it("단계 이름이 core 정본과 같이 움직인다", () => {
    expect(corruptionLabel(0)).toBe("타락도 0% · 일반");
    expect(corruptionLabel(35)).toBe("타락도 35% · 각성");
    expect(corruptionLabel(100)).toBe("타락도 100% · 완전타락");
  });

  it("범위 밖 값은 접는다", () => {
    expect(corruptionLabel(-5)).toBe("타락도 0% · 일반");
    expect(corruptionLabel(999)).toBe("타락도 100% · 완전타락");
  });
});

describe("comboLabel / goldLabel", () => {
  it("콤보 0은 빈 문자열(숨김)이다", () => {
    expect(comboLabel(0)).toBe("");
    expect(comboLabel(-1)).toBe("");
  });

  it("콤보 배율을 사람이 읽게 쓴다", () => {
    expect(comboLabel(2)).toBe("콤보 x2 · 골드 1.5배");
    expect(comboLabel(8)).toBe("콤보 x8 · 골드 3배");
  });

  it("여섯 자리까지는 천 단위 구분, 읽기 실패는 실패라고 말한다", () => {
    expect(goldLabel(999999)).toBe("999,999 G");
    expect(goldLabel(0)).toBe("0 G");
    expect(goldLabel(null)).toBe("확인 불가");
  });

  /**
   * **골드 필이 실제로 잘렸다 (2026-08-07).** 캡처에 `3,299,03…`이 찍혔다.
   *
   * 이 검사가 없던 것이 통과시킨 이유다 — 바로 옆 `abyssLabel`은 "벌 수 있는
   * 최대 잔고가 잘리지 않는다"를 갖고 있었는데, **골드 쪽에는 문자열 비교만**
   * 있었다(`goldLabel(1234567)`이 `1,234,567 G`인지). 그 수가 필에 들어가는지는
   * 아무도 안 물었다. 같은 필, 같은 폭 산수, 검사는 한쪽만 있었다.
   *
   * 상한은 **실제로 벌 수 있는 값**으로 잡는다(심연석 검사와 같은 근거). 골드는
   * 심연석과 달리 상한이 없어서 페이싱 시뮬로 잰다 — 3분에 8자리, 10분에
   * 12자리, 40분에 15자리다. 여기서는 시뮬을 다시 돌리지 않고 **자리수를 늘려
   * 가며** 묻는다: 어느 자리수에서도 필에 들어가야 한다. 축약이 자리수를
   * 고정하므로 이것이 성립한다(그게 `formatCompact`의 존재 이유다).
   */
  it("몇 자리를 벌어도 골드 필에 들어간다 — 축약이 폭을 고정한다", () => {
    // 필이 글자에 내주는 폭 (pill.ts의 paint와 같은 산수)
    const iconTextX = -ICON_OVERHANG + iconDiameter(PILL_H) + 10;
    const textBudget = pillTextWidth(GOLD_PILL_W, iconTextX, pillRadius(PILL_H));

    // 1자리 ~ 18자리. 18은 40분 실측(15자리)에 세 자리를 더 얹은 것이다
    for (let digits = 1; digits <= 18; digits += 1) {
      // 그 자리수에서 가장 넓은 수 — 9가 가장 넓지 않을 수 있으니 둘 다 본다
      for (const v of [10 ** (digits - 1), 10 ** digits - 1]) {
        const label = goldLabel(v);
        expect(label, `${digits}자리 ${v}`).not.toContain("…");
        // 축소 하한 0.75까지는 온전히 보인다 (fitText) — 그 아래면 말줄임이다
        expect(dotTextW(label) * FIT_MIN_SCALE, `${digits}자리 ${v} = ${label}`)
          .toBeLessThanOrEqual(textBudget);
      }
    }
  });

  /**
   * **잔고와 비용이 같은 표기여야 뺄셈이 된다.** 강화 화면이 하는 일의 전부다.
   * 한쪽만 축약하면 `1.15M G` 버튼과 `1,154,837 G` 필이 나란히 서서 같은 수인지
   * 알 수 없다 — 잘린 것보다 나쁘다(잘린 것은 잘린 게 보인다).
   */
  it("골드 필과 강화 비용이 같은 수를 같은 말로 쓴다", () => {
    for (const v of [60, 999_999, 1_000_000, 3_299_036, 755_109_956_697]) {
      expect(goldLabel(v), String(v)).toBe(`${formatCompact(v)} G`);
    }
  });
});

describe("abyssLabel — 심연석 필 문구 (3단계)", () => {
  it("재화 이름을 적는다 — 숫자만 있으면 골드 필과 구별이 색뿐이다", () => {
    expect(abyssLabel(0)).toBe("심연석 0");
    expect(abyssLabel(1234)).toBe("심연석 1,234");
  });

  it("읽기 실패는 0으로 위장하지 않는다", () => {
    expect(abyssLabel(null)).toBe("확인 불가");
  });

  /**
   * **잔고가 말줄임되면 잔고를 못 읽는 것과 같다.**
   *
   * 필의 글자 자리는 폭이 아니다 — 아이콘과 코너를 뺀 나머지고(`pillTextWidth`),
   * 그걸 넘으면 `fitText`가 축소하다 하한(0.75)에서 `심연석 2,3…`으로 자른다.
   * 폭 152로 잡았던 첫 안이 정확히 그랬다(글자 자리 78px).
   *
   * 상한은 **실제로 벌 수 있는 최대**로 잡는다 — 임의의 큰 수(1,234,567)로 재면
   * 도달할 수 없는 자릿수 때문에 필을 쓸데없이 넓히게 된다.
   */
  it("벌 수 있는 최대 잔고가 잘리지 않는다", () => {
    let maxAbyss = 0;
    for (let f = 1; f <= FINAL_FLOOR; f += 1) maxAbyss += abyssForFloorClear(floorKindOf(f));
    // 9999층 = 미니보스 999 + 네임드 99 → 4자리
    expect(String(maxAbyss).length).toBe(4);

    // 필이 글자에 내주는 폭 (pill.ts의 paint와 같은 산수)
    const iconTextX = -ICON_OVERHANG + iconDiameter(PILL_H) + 10;
    const textBudget = pillTextWidth(ABYSS_PILL_W, iconTextX, pillRadius(PILL_H));
    for (const v of [null, 0, maxAbyss]) {
      // 축소 하한 0.75까지는 온전히 보인다 (fitText) — 그 아래면 말줄임이다
      expect(dotTextW(abyssLabel(v)) * 0.75, String(v)).toBeLessThanOrEqual(textBudget);
    }
  });
});

/**
 * 페이즈 이름이 심연석 필과 겹치지 않는다 (2026-08-07).
 *
 * 이름은 폭 예산 없는 맨 `Text`였고 필과 **같은 줄**을 쓴다(필 66~118, 이름 76).
 * 30층 캡처에서 `표층 지각 & 달콤한 환청 지대`의 "지대"가 필 아래로 들어가
 * 사라졌다. `ABYSS_PILL_W`의 두 부등식은 **타락도 줄만** 봤고 이 줄은 논증에
 * 없었다 — 그래서 아무 검사도 울리지 않았다.
 *
 * 여기서 묻는 것은 **10개 페이즈 전부**다. 한 층만 재면 짧은 이름이 통과시킨다.
 */
describe("페이즈 이름 폭 예산", () => {
  it("모든 페이즈 이름이 심연석 필 왼쪽에서 끝난다", () => {
    for (const p of PHASES) {
      // 축소 하한까지 줄이면 들어가야 한다 — 그 아래면 이름이 말줄임된다
      expect(
        dotTextW(p.name) * FIT_MIN_SCALE,
        p.name,
      ).toBeLessThanOrEqual(PHASE_TEXT_MAX_W);
    }
  });

  it("예산이 필 자리에서 유도된다 — 숫자를 손으로 적으면 필이 움직일 때 조용해진다", () => {
    expect(PHASE_TEXT_MAX_W).toBe(ABYSS_PILL_X - ABYSS_PILL_GAP - FLOOR_TEXT_X);
    // 이름의 오른쪽 끝이 필 왼쪽 끝을 넘지 않는다
    expect(FLOOR_TEXT_X + PHASE_TEXT_MAX_W).toBeLessThanOrEqual(ABYSS_PILL_X);
  });
});

/**
 * 두 필의 실패 문구가 자기 글자 자리에 들어간다.
 *
 * `잔고 확인 불가`(어림 168px)가 골드 필 예산 114px을 넘어 `잔고 확인 …`으로
 * 잘려 있었다 — null과 0을 구분하려고 일부러 만든 문구가 잘려서 로딩 중처럼
 * 보였고, SAVE-SCHEMA §4-3의 구분이 화면에서 사라졌다.
 */
describe("잔고 읽기 실패 문구가 잘리지 않는다", () => {
  const budgetOf = (pillW: number): number => {
    const iconTextX = -ICON_OVERHANG + iconDiameter(PILL_H) + 10;
    return pillTextWidth(pillW, iconTextX, pillRadius(PILL_H));
  };

  it("골드 필", () => {
    expect(dotTextW(goldLabel(null)) * FIT_MIN_SCALE).toBeLessThanOrEqual(
      budgetOf(GOLD_PILL_W),
    );
  });

  it("심연석 필", () => {
    expect(dotTextW(abyssLabel(null)) * FIT_MIN_SCALE).toBeLessThanOrEqual(
      budgetOf(ABYSS_PILL_W),
    );
  });
});
