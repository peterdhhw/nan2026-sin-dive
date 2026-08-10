import { describe, expect, test } from "vitest";
import { NO_GROWTH, scaleLoadout } from "../src/loadout/scale";
// `appRuntime`이 아니라 `preset`을 직접 쓴다 — appRuntime은 Pixi를 끌어와서
// node 환경에서 로드 자체가 실패한다(`battleField.ts`의 `navigator`)
import { PresetLoadoutProvider } from "../src/loadout/preset";
import {
  atkMulOf,
  attackIntervalMulOf,
  emptyLevels,
  skillMulOf,
} from "../src/single/economyRules";
import { HERO_SLUGS } from "../src/shared/charManifest";
import type { AttackClip } from "../src/shared/meleeRules";
import { autoAttackDamage } from "../src/core/team";

/**
 * 싱글에서 키운 팀이 대전으로 넘어가는 배율 적용(2단계).
 *
 * **여기서 잡으려는 실패는 전부 조용하다** — 화면에는 숫자가 하나 뜨고
 * 그게 맞는지는 눈으로 알 수 없다:
 *
 * 1. **원본 오염.** 프리셋 객체를 제자리에서 고치면 다음 판이 곱해진 값에 또
 *    곱한다. 두 판을 돌려야 나타나므로 한 판만 보면 정상이다.
 * 2. **간격 0.** `autoAttackDamage`는 `interval > 0`이 아니면 dps를 0으로 둔다 —
 *    그래서 증상이 "판이 터진다"가 아니라 **"아군이 칼은 휘두르는데 상대 게이지가
 *    안 움직인다"**다. 실력 문제로 보이므로 버그로 신고되지 않는다.
 * 3. **방해 스킬까지 곱하기.** 감속률 0.4에 배율을 먹이면 100%를 넘어 상대가
 *    아예 멈춘다. 그건 버그가 아니라 "강한 강화"로 보인다.
 */

/** 실제 대전 팀 크기(`appRuntime.TEAM_SIZE`). 그쪽은 Pixi를 끌고 오므로 여기 적는다 */
const TEAM_SIZE = 2;

function base() {
  return new PresetLoadoutProvider(HERO_SLUGS[0]).load(TEAM_SIZE);
}

describe("성장 없는 배율", () => {
  test("NO_GROWTH는 스탯을 그대로 둔다 — 저장값을 못 읽어도 게임이 굴러간다", () => {
    const b = base();
    const s = scaleLoadout(b, NO_GROWTH);
    expect(s.characters.map((c) => c.stats)).toEqual(
      b.characters.map((c) => c.stats),
    );
    expect(s.skills.map((k) => k.power)).toEqual(b.skills.map((k) => k.power));
  });

  test("강화 레벨 0의 배율이 곧 NO_GROWTH다 — 첫 방문이 손해를 보지 않는다", () => {
    const lv = emptyLevels();
    expect(atkMulOf(lv)).toBe(1);
    expect(attackIntervalMulOf(lv)).toBe(1);
    expect(skillMulOf(lv)).toBe(1);
  });
});

describe("배율이 먹는다", () => {
  test("공격력은 곱해지고 간격은 줄어든다", () => {
    const b = base();
    const s = scaleLoadout(b, { atkMul: 2, intervalMul: 0.5, skillMul: 3 });
    for (let i = 0; i < b.characters.length; i += 1) {
      expect(s.characters[i]!.stats.attack).toBeCloseTo(
        b.characters[i]!.stats.attack * 2,
        6,
      );
      expect(s.characters[i]!.stats.attackIntervalMs).toBeCloseTo(
        b.characters[i]!.stats.attackIntervalMs * 0.5,
        6,
      );
    }
  });

  test("팀 전원이 같이 자란다 — 1번만 세지면 팀원이 구경꾼이 된다", () => {
    const b = base();
    const s = scaleLoadout(b, { atkMul: 4, intervalMul: 1, skillMul: 1 });
    expect(s.characters).toHaveLength(TEAM_SIZE);
    for (let i = 0; i < s.characters.length; i += 1) {
      expect(s.characters[i]!.stats.attack).toBeGreaterThan(
        b.characters[i]!.stats.attack,
      );
    }
  });

  test("공격 스킬 위력만 곱한다 — 방해 스킬의 power는 딜이 아니다", () => {
    const b = base();
    const s = scaleLoadout(b, { atkMul: 1, intervalMul: 1, skillMul: 10 });
    // 방해 스킬이 실제로 로드아웃에 있어야 이 검사가 의미를 갖는다
    // (없으면 "곱하지 않았다"가 공짜로 통과한다)
    const interference = b.skills.filter((k) => k.kind === "interference");
    expect(interference.length).toBeGreaterThan(0);
    for (let i = 0; i < b.skills.length; i += 1) {
      const want =
        b.skills[i]!.kind === "attack"
          ? b.skills[i]!.power * 10
          : b.skills[i]!.power;
      expect(s.skills[i]!.power, `${b.skills[i]!.id}`).toBeCloseTo(want, 6);
    }
  });

  test("감속률이 100%를 넘지 않는다 — 넘으면 상대가 영구 정지한다", () => {
    const s = scaleLoadout(base(), { atkMul: 1, intervalMul: 1, skillMul: 50 });
    for (const k of s.skills) {
      if (k.kind !== "interference") continue;
      expect(k.power, `${k.id}`).toBeLessThanOrEqual(1);
    }
  });

  test("배율은 종류별로 따로 먹는다 — 한 배율이 다른 칸을 건드리지 않는다", () => {
    const b = base();
    const onlySkill = scaleLoadout(b, {
      atkMul: 1,
      intervalMul: 1,
      skillMul: 5,
    });
    expect(onlySkill.characters.map((c) => c.stats.attack)).toEqual(
      b.characters.map((c) => c.stats.attack),
    );
    const onlyAtk = scaleLoadout(b, { atkMul: 5, intervalMul: 1, skillMul: 1 });
    expect(onlyAtk.skills.map((k) => k.power)).toEqual(
      b.skills.map((k) => k.power),
    );
  });
});

describe("원본을 건드리지 않는다", () => {
  test("두 번 곱해도 복리가 되지 않는다 — 프리셋이 오염되면 판마다 세진다", () => {
    const b = base();
    const first = b.characters[0]!.stats.attack;
    const a = scaleLoadout(b, { atkMul: 2, intervalMul: 1, skillMul: 1 });
    const c = scaleLoadout(b, { atkMul: 2, intervalMul: 1, skillMul: 1 });
    expect(b.characters[0]!.stats.attack).toBe(first);
    expect(a.characters[0]!.stats.attack).toBe(c.characters[0]!.stats.attack);
  });

  test("결과를 고쳐도 원본이 안 바뀐다 (stats·skills가 새 객체다)", () => {
    const b = base();
    const s = scaleLoadout(b, NO_GROWTH);
    for (let i = 0; i < b.characters.length; i += 1) {
      expect(s.characters[i]!.stats, `m${i}`).not.toBe(b.characters[i]!.stats);
    }
    /**
     * **스킬은 전부** 새 객체여야 한다 — 0번만 물으면 부족하다. 배율을 안 먹는
     * 방해 스킬을 `{ ...s }` 없이 그대로 넘기는 실수가 조용히 통과한다(0번은
     * 공격 스킬이라 어차피 새 객체다). 쿨다운 추적기가 이 객체를 들고 있어서
     * 공유하면 한 판의 쿨다운이 다음 판으로 넘어간다
     */
    for (let i = 0; i < b.skills.length; i += 1) {
      expect(s.skills[i], `${b.skills[i]!.id}`).not.toBe(b.skills[i]);
    }
    s.characters[0]!.stats.attack = 99999;
    for (const k of s.skills) k.power = 99999;
    expect(b.characters[0]!.stats.attack).not.toBe(99999);
    for (const k of b.skills) expect(k.power, k.id).not.toBe(99999);
  });

  test("melee.clips 배열을 공유하지 않는다 — 세션이 밀어 넣은 클립이 프리셋에 남는다", () => {
    const b = base();
    const s = scaleLoadout(b, NO_GROWTH);
    expect(s.characters[0]!.melee.clips).not.toBe(b.characters[0]!.melee.clips);
    expect(s.characters[0]!.melee.clips).toEqual(b.characters[0]!.melee.clips);
    // 타입은 `readonly`지만 **런타임 배열은 그냥 배열이다** — 세션이 캐스팅해서
    // 밀어 넣으면 공유된 배열이 프리셋에 남는다. 그래서 캐스팅해서 물어본다:
    // 같은 배열을 가리키고 있는지 여부는 타입이 막아 주지 않는다
    const before = b.characters[0]!.melee.clips.length;
    (s.characters[0]!.melee.clips as AttackClip[]).push(
      s.characters[0]!.melee.clips[0]!,
    );
    expect(b.characters[0]!.melee.clips).toHaveLength(before);
  });
});

describe("깨진 저장값", () => {
  // 배율의 출처는 localStorage다 — 손으로 고친 값·다른 버전이 남긴 값이 들어온다
  const broken = [NaN, 0, -1, Infinity, -Infinity];

  test.each(broken)("배율 %p은 1로 접힌다", (bad) => {
    const b = base();
    const s = scaleLoadout(b, {
      atkMul: bad as number,
      intervalMul: bad as number,
      skillMul: bad as number,
    });
    expect(s.characters[0]!.stats.attack).toBe(b.characters[0]!.stats.attack);
    expect(s.characters[0]!.stats.attackIntervalMs).toBe(
      b.characters[0]!.stats.attackIntervalMs,
    );
    expect(s.skills[0]!.power).toBe(b.skills[0]!.power);
  });

  test("한 칸이 깨져도 나머지 배율은 살아 있다", () => {
    const b = base();
    const s = scaleLoadout(b, { atkMul: NaN, intervalMul: 0.5, skillMul: 2 });
    expect(s.characters[0]!.stats.attack).toBe(b.characters[0]!.stats.attack);
    expect(s.characters[0]!.stats.attackIntervalMs).toBeCloseTo(
      b.characters[0]!.stats.attackIntervalMs * 0.5,
      6,
    );
  });

  test("아무리 곱해도 간격이 0이 되지 않는다 — 0이면 팀이 딜을 못 넣는다", () => {
    // 강화 상한(SPD_MAX_LEVEL 60)을 한참 넘긴 배율. 저장값이 깨져도 여기서 막힌다
    const s = scaleLoadout(base(), {
      atkMul: 1,
      intervalMul: 1e-12,
      skillMul: 1,
    });
    for (const c of s.characters) {
      expect(c.stats.attackIntervalMs).toBeGreaterThanOrEqual(1);
    }
    // 코어에 실제로 물려서 확인한다 — 간격만 재면 "dps가 0이 아니다"를 안 묻는다.
    // `autoAttackDamage`는 interval <= 0에서 조용히 0을 돌려주므로 여기가 게이트다
    for (const d of autoAttackDamage(s.characters, 1000)) {
      expect(d.rawDamage, d.memberId).toBeGreaterThan(0);
      expect(Number.isFinite(d.rawDamage), d.memberId).toBe(true);
    }
  });
});
