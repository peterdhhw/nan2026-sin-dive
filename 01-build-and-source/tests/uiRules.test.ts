import { describe, expect, it } from "vitest";
import {
  DISABLED_COST,
  DISABLED_LABEL,
  buttonSkin,
  hasDiagonalHighlight,
  type ButtonState,
} from "../src/shared/ui/buttonRules";
import {
  COUNTUP_MS,
  ICON_OVERHANG,
  PILL_H,
  PULSE_MS,
  PULSE_SCALE,
  countUpValue,
  iconDiameter,
  pillTextWidth,
  pulseScale,
} from "../src/shared/ui/pillRules";
import {
  AUTO_PULSE_MS,
  BURST_COOLDOWN_MS,
  COMBO_COOLDOWN_MS,
  READY_PULSE_MS,
  READY_PULSE_SCALE,
  ULT_COOLDOWN_MS,
  autoPulseAlpha,
  cooldownLabel,
  iconRegionFor,
  readyFlashAlpha,
  readyPulse,
  slotState,
} from "../src/shared/ui/skillSlotRules";
import { SKILL_ICON_REGIONS } from "../src/shared/fxManifest";
import { HERO_SLUGS } from "../src/shared/charManifest";
import { PRESET_SKILLS, presetSkillsFor } from "../src/loadout/preset";
import type { SkillDef } from "../src/core/types";

const ALL_STATES: ButtonState[] = [
  "ready",
  "disabled",
  "confirm",
  "ad",
  "neutral",
];

describe("buttonSkin", () => {
  it("모든 상태에 스킨이 있다", () => {
    for (const s of ALL_STATES) {
      expect(buttonSkin(s).base).toBeTypeOf("number");
    }
  });

  it("disabled만 입력을 막는다", () => {
    for (const s of ALL_STATES) {
      expect(buttonSkin(s).interactive).toBe(s !== "disabled");
    }
  });

  it("disabled는 라벨을 흐리게, 비용만 빨갛게 (§C2)", () => {
    const skin = buttonSkin("disabled");
    expect(skin.label).toBe(DISABLED_LABEL);
    expect(skin.sub).toBe(DISABLED_COST);
  });

  it("광고 버튼만 ▶ 글리프를 갖는다", () => {
    for (const s of ALL_STATES) {
      expect(buttonSkin(s).glyph).toBe(s === "ad" ? "▶" : null);
    }
  });

  it("상태별 바탕색이 서로 다르다 — 같으면 상태를 구분할 수 없다", () => {
    const bases = new Set(ALL_STATES.map((s) => buttonSkin(s).base));
    expect(bases.size).toBe(ALL_STATES.length);
  });
});

describe("hasDiagonalHighlight", () => {
  it("초록(ready)에만 얹는다 (§3-3)", () => {
    for (const s of ALL_STATES) {
      expect(hasDiagonalHighlight(s)).toBe(s === "ready");
    }
  });
});

describe("iconDiameter", () => {
  it("필 높이보다 8px 작다 (§C3)", () => {
    expect(iconDiameter(PILL_H)).toBe(PILL_H - 8);
  });

  it("아주 낮은 필에서도 음수가 되지 않는다", () => {
    expect(iconDiameter(4)).toBe(0);
    expect(iconDiameter(-20)).toBe(0);
  });

  it("아이콘이 왼쪽으로 튀어나온다 (§C3)", () => {
    expect(ICON_OVERHANG).toBeGreaterThan(0);
  });
});

describe("pillTextWidth", () => {
  it("시작 위치와 오른쪽 여백만 뺀다 — 글자가 테두리를 넘으면 옆 위젯 위로 흐른다", () => {
    // VS 씬 캡처에서 `물의 여사제 (나)`가 폭 168 알약을 넘쳐 옆 이름과 겹쳤다
    expect(pillTextWidth(184, 22, 22)).toBe(184 - 44);
  });

  it("아이콘이 있으면 그만큼 좁다", () => {
    // 아이콘이 있을 때 textX는 아이콘 오른쪽 끝 + 10이다 (pill.ts)
    expect(pillTextWidth(200, 54, 22)).toBeLessThan(pillTextWidth(200, 22, 22));
  });

  it("오른쪽 여백은 왼쪽과 독립이다 — 같이 빼면 글자 자리가 두 글자로 준다", () => {
    // 이 계약이 없던 첫 판(오른쪽에도 textX를 뺐다)에서 `(나)`가 잘렸다.
    // 아이콘 필의 글자 자리가 왼쪽 여백만큼 좁아지고 그 이상은 아니어야 한다
    expect(pillTextWidth(168, 54, 22)).toBe(168 - 54 - 22);
  });

  it("여백이 폭을 잡아먹어도 0이나 음수가 되지 않는다", () => {
    // 0을 주면 fitText가 글자를 한 자까지 깎는다 — 아무것도 안 읽히는 게 최악이다
    expect(pillTextWidth(40, 60, 22)).toBeGreaterThan(0);
    expect(pillTextWidth(0, 0, 0)).toBeGreaterThan(0);
  });
});

describe("countUpValue", () => {
  it("음수 elapsed는 목표값 — 진행 중이 아니다", () => {
    expect(countUpValue(0, 1240, -1)).toBe(1240);
  });

  it("0에서 시작값, 끝에서 목표값", () => {
    expect(countUpValue(100, 500, 0)).toBe(100);
    expect(countUpValue(100, 500, COUNTUP_MS)).toBe(500);
  });

  it("정수만 준다 — 소수는 읽을 수 없다", () => {
    for (let t = 0; t <= COUNTUP_MS; t += 7) {
      expect(Number.isInteger(countUpValue(0, 137, t))).toBe(true);
    }
  });

  it("단조 증가한다", () => {
    let prev = -Infinity;
    for (let t = 0; t <= COUNTUP_MS; t += 5) {
      const v = countUpValue(0, 1000, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("감소하는 값도 처리한다", () => {
    expect(countUpValue(500, 100, COUNTUP_MS)).toBe(100);
    expect(countUpValue(500, 100, COUNTUP_MS / 2)).toBeLessThan(500);
  });
});

describe("pulseScale", () => {
  it("구간 밖에서는 1 — 0이면 요소가 사라진다", () => {
    expect(pulseScale(-1)).toBe(1);
    expect(pulseScale(PULSE_MS)).toBe(1);
    expect(pulseScale(99999)).toBe(1);
  });

  it("중간에서 최대 배율에 닿는다", () => {
    expect(pulseScale(PULSE_MS / 2)).toBeCloseTo(PULSE_SCALE, 5);
  });

  it("항상 1 이상이다 — 줄어들면 눌림 모션과 섞인다", () => {
    for (let t = 0; t < PULSE_MS; t += 5) {
      expect(pulseScale(t)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("iconRegionFor", () => {
  const mk = (over: Partial<SkillDef>): SkillDef => ({
    id: "x",
    name: "x",
    kind: "attack",
    cooldownMs: 1000,
    power: 1,
    ...over,
  });

  it("kind별로 갈린다", () => {
    expect(iconRegionFor(mk({ kind: "interference" }))).toBe(
      "skill_interference",
    );
    expect(iconRegionFor(mk({ kind: "buff" }))).toBe("skill_buff");
  });

  it("공격 4종을 쿨다운으로 갈라 놓는다 — 같은 아이콘이면 슬롯이 구분되지 않는다", () => {
    expect(iconRegionFor(mk({ cooldownMs: COMBO_COOLDOWN_MS - 1 }))).toBe(
      "skill_attack",
    );
    expect(iconRegionFor(mk({ cooldownMs: COMBO_COOLDOWN_MS }))).toBe(
      "skill_combo",
    );
    expect(iconRegionFor(mk({ cooldownMs: BURST_COOLDOWN_MS - 1 }))).toBe(
      "skill_combo",
    );
    expect(iconRegionFor(mk({ cooldownMs: BURST_COOLDOWN_MS }))).toBe(
      "skill_burst",
    );
    expect(iconRegionFor(mk({ cooldownMs: ULT_COOLDOWN_MS - 1 }))).toBe(
      "skill_burst",
    );
    expect(iconRegionFor(mk({ cooldownMs: ULT_COOLDOWN_MS }))).toBe("skill_ult");
  });

  /**
   * 문턱이 순서를 지켜야 한다. 거꾸로 놓으면 가운데 등급에 닿는 쿨다운 구간이
   * 비어서, 네 등급을 만들어 놓고 화면에는 셋만 나오는 것을 아무 검사도 못 잡는다.
   */
  it("세 문턱이 순서대로다 — 뒤집히면 가운데 등급이 사라진다", () => {
    expect(COMBO_COOLDOWN_MS).toBeLessThan(BURST_COOLDOWN_MS);
    expect(BURST_COOLDOWN_MS).toBeLessThan(ULT_COOLDOWN_MS);
  });

  /**
   * **문턱은 `ROLE_NUMBERS`에서 유도된 값이다.** 이 수가 그 유래를 지킨다:
   * 네 역할의 쿨을 실제로 넣었을 때 네 등급이 하나씩 나와야 한다.
   *
   * 왜 필요한가 — 옛 문턱(4000/7000)은 쿨이 2.5/5/9초일 때 유도된 것이고, 쿨이
   * 1.8/2.5/3.4/4.5초로 내려오자 **네 칸 중 셋을 한 아이콘으로 뭉쳤다.** 위
   * 경계 시험들은 문턱 상수를 기준으로 스스로를 검사하므로 그때도 전부
   * 통과했다(파생 상수엔 유래를 남겨야 한다는 그 형태다). 프리셋의 실제 쿨로
   * 물어야 그 침묵이 깨진다.
   */
  it("네 역할의 실제 쿨이 네 등급을 하나씩 받는다", () => {
    const attacks = presetSkillsFor(HERO_SLUGS[0]).filter(
      (s) => s.kind === "attack",
    );
    const regions = attacks.map(iconRegionFor);
    expect(regions).toEqual([
      "skill_attack",
      "skill_combo",
      "skill_burst",
      "skill_ult",
    ]);
  });

  /**
   * 방해 두 칸도 갈린다. 늦추는 것(수치)과 시야를 막는 것은 상대에게 다른 일이
   * 벌어지는 것이라, 같은 아이콘이면 눌러 보고 알아내야 한다.
   */
  it("시야를 막는 방해는 다른 아이콘이다", () => {
    expect(
      iconRegionFor(mk({ kind: "interference", interferenceKind: "blind" })),
    ).toBe("skill_blind");
    expect(
      iconRegionFor(mk({ kind: "interference", interferenceKind: "slow" })),
    ).toBe("skill_interference");
  });

  it("프리셋 6칸이 서로 다른 아이콘을 받는다", () => {
    const regions = PRESET_SKILLS.map(iconRegionFor);
    expect(new Set(regions).size).toBe(PRESET_SKILLS.length);
  });

  /**
   * 캐릭터를 바꿔도 여섯 칸이 서로 달라야 한다. 등급은 쿨다운에서 나오고
   * 쿨다운은 역할이 갖는 값이라(`ROLE_NUMBERS`) 일곱이 같아야 정상이지만,
   * 한 캐릭터만 세면 그게 정답인 줄 알게 된다.
   *
   * 예전에는 여기서 `skill_buff`가 나오는 것도 함께 물었다 — 그 칸을 지웠으므로
   * (`presetSkillsFor`) 지금 프리셋에는 없다. region 자체는 남아 있고
   * (`SKILL_ICON_REGIONS`의 결정 기록) 위 "kind별로 갈린다"가 그것을 지킨다.
   */
  it("일곱 캐릭터 다 여섯 칸이 서로 다른 아이콘이다", () => {
    for (const slug of HERO_SLUGS) {
      const regions = presetSkillsFor(slug).map(iconRegionFor);
      expect(new Set(regions).size, `${slug}: ${regions.join(",")}`).toBe(
        regions.length,
      );
    }
  });

  it("결과가 아틀라스에 실제로 있는 region이다", () => {
    for (const s of PRESET_SKILLS) {
      expect(SKILL_ICON_REGIONS).toContain(iconRegionFor(s));
    }
  });
});

describe("cooldownLabel", () => {
  it("준비 완료면 빈 문자열 — '0'은 상태인지 값인지 알 수 없다", () => {
    expect(cooldownLabel(0)).toBe("");
    expect(cooldownLabel(-100)).toBe("");
    expect(cooldownLabel(NaN)).toBe("");
  });

  it("올림한다 — 내림하면 0.4초 남았는데 '0'이 뜬다", () => {
    expect(cooldownLabel(1)).toBe("1");
    expect(cooldownLabel(400)).toBe("1");
    expect(cooldownLabel(1000)).toBe("1");
    expect(cooldownLabel(1001)).toBe("2");
    expect(cooldownLabel(12_000)).toBe("12");
  });
});

describe("slotState", () => {
  it("남은 쿨다운으로 갈린다", () => {
    expect(slotState(0)).toBe("ready");
    expect(slotState(1)).toBe("cooling");
  });

  it("locked가 우선한다", () => {
    expect(slotState(0, true)).toBe("locked");
    expect(slotState(5000, true)).toBe("locked");
  });
});

describe("쿨다운 완료 연출", () => {
  it("펄스는 구간 밖에서 1", () => {
    expect(readyPulse(-1)).toBe(1);
    expect(readyPulse(READY_PULSE_MS)).toBe(1);
  });

  it("중간에서 스펙 배율에 닿는다 (§4: 1.08)", () => {
    expect(readyPulse(READY_PULSE_MS / 2)).toBeCloseTo(READY_PULSE_SCALE, 5);
  });

  it("흰 플래시는 1에서 0으로 사라진다", () => {
    expect(readyFlashAlpha(0)).toBeCloseTo(1, 5);
    expect(readyFlashAlpha(READY_PULSE_MS)).toBe(0);
    expect(readyFlashAlpha(-5)).toBe(0);
  });

  it("AUTO 펄스가 수동 완료 펄스보다 약하고 짧다 — 내 조작과 구분돼야 한다", () => {
    expect(AUTO_PULSE_MS).toBeLessThan(READY_PULSE_MS);
    expect(autoPulseAlpha(0)).toBeLessThan(readyFlashAlpha(0));
    expect(autoPulseAlpha(AUTO_PULSE_MS)).toBe(0);
    expect(autoPulseAlpha(-1)).toBe(0);
  });
});
