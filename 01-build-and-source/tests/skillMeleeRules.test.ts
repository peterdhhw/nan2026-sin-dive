import { describe, expect, it } from "vitest";
import { FX_SHEETS } from "../src/shared/fxManifest";
import { meleeFx } from "../src/shared/meleeFx";
import {
  SKILL_FX_MAX_RATIO,
  SKILL_MIN_APPROACH_MS,
  skillCastFx,
  skillHitFx,
  skillHitSpanMs,
  skillFxMaxPx,
  skillMelee,
  skillStyle,
} from "../src/shared/skillMeleeRules";
import {
  ALLY_H_RATIO,
  FX_COVER_RATIO,
  REF_FIELD_H,
  allyDisplayPx,
} from "../src/shared/battleFieldRules";
import { SINGLE_FIELD_H } from "../src/single/upgradePanelRules";
import {
  ATTACK_ROLES,
  PRESET_SKILLS,
  PresetLoadoutProvider,
  attackSkillId,
} from "../src/loadout/preset";
import { HERO_SLUGS } from "../src/shared/charManifest";
import type { ApproachKind } from "../src/shared/meleeRules";

/**
 * 접근 셋 다 본다. `walk`는 취향이 아니라 에셋 사실이다 — 7종 중
 * water_priestess만 달리기 시트가 없다. 둘만 돌면 그 캐릭터의 스킬 연출이
 * 검사 밖에 남는다.
 */
const APPROACHES: readonly ApproachKind[] = ["run", "roll", "walk"];

/**
 * 돌진 연출을 갖는 스킬 id 전부 — 7종 × 공격 3역할 = 21개.
 *
 * **표에서 만든다.** 손으로 적으면 캐릭터를 늘렸을 때 여기를 안 고쳐도 통과하고,
 * 새 캐릭터의 스킬이 `skillMelee() === null`로 떨어져 자동 공격 순환으로
 * 되돌아가는 것을 아무 검사도 못 잡는다.
 */
const ATTACK_IDS: readonly string[] = HERO_SLUGS.flatMap((slug) =>
  ATTACK_ROLES.map((role) => attackSkillId(slug, role)),
);

/** 대표 캐릭터의 네 역할 — 역할끼리 비교할 때 쓴다 */
const LEAD = HERO_SLUGS[0];
const QUICK = attackSkillId(LEAD, "quick");
const COMBO = attackSkillId(LEAD, "combo");
const BURST = attackSkillId(LEAD, "burst");
const ULT = attackSkillId(LEAD, "ult");
/** 궤적(`slash`)이 나오는 캐릭터 — 회전 검사는 이쪽만 의미가 있다 */
const BLADED = "fire_knight";

describe("skillMelee", () => {
  it("28개 공격 스킬이 다 자기 연출을 갖는다", () => {
    expect(ATTACK_IDS).toHaveLength(HERO_SLUGS.length * ATTACK_ROLES.length);
    for (const id of ATTACK_IDS) expect(skillMelee(id), id).not.toBeNull();
  });

  it("프리셋 여섯 칸 중 공격만 돌진한다", () => {
    for (const s of PRESET_SKILLS) {
      const m = skillMelee(s.id);
      if (s.kind === "attack") expect(m, s.id).not.toBeNull();
      // 방해는 돌진하지 않는다 — 여기 값이 생기면 자동 공격 클립을 덮어써서
      // 사슬을 걸었는데 칼을 휘두른다
      else expect(m, s.id).toBeNull();
    }
  });

  /**
   * `id`가 표의 키와 어긋나면 로그(`why=impact:m0:attack1:<id>`)가 다른 스킬을
   * 가리켜서, 헤드리스 검증이 통과하는데 화면은 틀린 상태가 된다.
   */
  it("연출의 id가 스킬 id와 같다", () => {
    for (const id of ATTACK_IDS) expect(skillMelee(id)!.id).toBe(id);
  });

  it("모르는 스킬 id는 null — 호출자가 자동 공격 순환으로 되돌아간다", () => {
    expect(skillMelee("nope")).toBeNull();
    expect(skillMelee("")).toBeNull();
    // 캐릭터는 있고 역할 이름이 틀린 경우도 걸러야 한다
    expect(skillMelee(`${LEAD}_ultimate`)).toBeNull();
  });

  /**
   * 이 모듈의 존재 이유다. 쿨다운 2.5초와 9초짜리가 같은 동작을 하면
   * 스킬을 고른 것이 화면에 남지 않는다 — 게이지만 다른 버튼 세 개다.
   *
   * **일곱을 다 본다.** 대표 하나만 세면 어느 한 캐릭터의 표가 어긋나도 통과한다.
   */
  it("일곱 다 네 공격이 서로 다른 클립을 쓴다", () => {
    for (const slug of HERO_SLUGS) {
      const clips = ATTACK_ROLES.map(
        (r) => skillMelee(attackSkillId(slug, r))!.clip,
      );
      expect(new Set(clips).size, `${slug}: ${clips.join(",")}`).toBe(
        ATTACK_ROLES.length,
      );
    }
  });

  /**
   * 역할의 박자가 갈려야 한다. 연타는 캐릭터보다 빠르게, 마무리기는 느리게
   * 붙고, **연격은 캐릭터의 원래 속도 그대로**다 — 넷 다 배율을 걸면 캐릭터의
   * 접근 시간이 화면에 한 번도 그대로 나오지 않아 일곱을 갈라 놓은 축이 덮인다.
   */
  it("접근 박자가 갈린다 — 파고들기 / 그대로 / 무겁게", () => {
    expect(skillMelee(QUICK)!.approachScale).toBeLessThan(1);
    expect(skillMelee(COMBO)!.approachScale).toBe(1);
    expect(skillMelee(BURST)!.approachScale).toBeGreaterThan(1);
  });

  /**
   * **네 번째 칸은 burst의 복제가 아니다.** 그 칸은 캐릭터마다 남은 한 클립을
   * 받는데 셋은 `special`(2.1~2.7초)이라, burst의 접근 배율 1.45를 쓰면 한
   * 사이클이 자기 쿨을 거의 다 먹는다 — 유저가 고치라고 한 "수동이 느리다"가
   * 그 칸에서 되돌아온다(`ROLE_MOTIONS.ult`의 결정 기록).
   *
   * 그래서 시간 축에서는 quick과 같은 자리에 서고 **층·번짐·복귀로** 무게를
   * 만든다. 이 셋을 다 묻는다 — 하나만 보면 나머지가 burst 값으로 되돌아가도
   * 통과하고, 그러면 두 칸이 화면에서 겹친다.
   */
  it("ult이 burst의 복제가 아니다 — 빠르게 파고들어 가장 많이 터뜨린다", () => {
    const u = skillMelee(ULT)!;
    const b = skillMelee(BURST)!;
    // 시간 축: quick과 같은 자리 (burst와 같아지면 두 칸이 겹친다)
    expect(u.approachScale).toBe(skillMelee(QUICK)!.approachScale);
    expect(u.approachScale).toBeLessThan(b.approachScale);
    // 층 축: burst를 넘는다
    expect(u.hit.length).toBeGreaterThan(b.hit.length);
    expect(skillHitSpanMs(u)).toBeGreaterThan(skillHitSpanMs(b));
    // 복귀는 로스터에서 가장 무겁다 — 층 여섯이 복귀 안에 들어가야 하기 때문이다
    expect(u.returnScale).toBeGreaterThan(b.returnScale);
  });

  /** 캐릭터가 바꾸는 것은 클립이고, 박자는 역할이 갖는다 */
  it("같은 역할이면 일곱이 같은 박자다 — 밸런스는 역할이 갖는다", () => {
    for (const role of ATTACK_ROLES) {
      const scales = new Set(
        HERO_SLUGS.map((s) => skillMelee(attackSkillId(s, role))!.approachScale),
      );
      expect(scales.size, role).toBe(1);
    }
  });

  it("네 역할의 임팩트 시트 조합이 서로 다르다", () => {
    const key = (id: string): string =>
      skillHitFx(skillMelee(id), "run", REF_FIELD_H)
        .map((f) => f.sheet)
        .join("+");
    const keys = ATTACK_ROLES.map((r) => key(attackSkillId(LEAD, r)));
    expect(new Set(keys).size, keys.join(" / ")).toBe(ATTACK_ROLES.length);
  });

  it("층수가 연타 < 연격 < 마무리기 < ult다 — 무게는 크기가 아니라 개수·시각차다", () => {
    const n = (id: string): number => skillMelee(id)!.hit.length;
    expect(n(QUICK)).toBeLessThan(n(COMBO));
    expect(n(COMBO)).toBeLessThan(n(BURST));
    expect(n(BURST)).toBeLessThan(n(ULT));
  });

  it("시전 순간 이펙트도 네 역할이 갈린다", () => {
    const key = (id: string): string =>
      skillCastFx(skillMelee(id), "run", REF_FIELD_H)
        .map((f) => f.sheet)
        .join("+");
    const keys = ATTACK_ROLES.map((r) => key(attackSkillId(LEAD, r)));
    expect(new Set(keys).size, keys.join(" / ")).toBe(ATTACK_ROLES.length);
  });

  /**
   * **광선을 지운 자리를 시전 이펙트가 메운다.** 공격 스킬은 슬롯 → 적 광선을
   * 쓰지 않으므로(`castBeamShown`), 눌렀다는 증거가 전부 캐릭터 몸에서 나와야
   * 한다 — 한 장이면 예전 자동 공격 미사일과 구별이 안 된다.
   */
  it("시전 이펙트가 한 장이 아니다 — 광선을 뺀 자리를 이것이 메운다", () => {
    for (const id of ATTACK_IDS) {
      expect(skillCastFx(skillMelee(id), "run", REF_FIELD_H).length, id).toBeGreaterThan(1);
    }
  });

  it("스킬이 없으면 시전 이펙트는 자동 공격의 한 장이다", () => {
    const none = skillCastFx(null, "run", REF_FIELD_H);
    expect(none).toHaveLength(1);
    expect(none[0]!.sheet).toBe("missile");
    expect(none[0]!.delayMs).toBe(0);
  });
});

/**
 * 이 describe가 "이펙트를 더 많이"의 판정 기준이다. **개수만 세면 안 된다** —
 * 세 장을 같은 프레임·같은 높이에 깔면 화면에는 큰 얼룩 하나만 남는다.
 * 개수 · 시각차 · 높이차 셋을 따로 본다.
 */
describe("이펙트의 층이 시간과 높이로 번진다", () => {
  it("한 프레임에 다 깔리지 않는다 — 뭉치면 세 장이 한 장으로 읽힌다", () => {
    for (const id of ATTACK_IDS) {
      const delays = skillHitFx(skillMelee(id), "run", REF_FIELD_H).map((l) => l.delayMs);
      expect(new Set(delays).size, id).toBe(delays.length);
      // 첫 층은 임팩트 프레임과 같아야 한다 — 늦으면 칼이 허공을 가른다
      expect(Math.min(...delays), id).toBe(0);
    }
  });

  it("층들이 같은 높이에 몰려 있지 않다 — 가로줄 하나로 뭉친다", () => {
    for (const id of ATTACK_IDS) {
      const lifts = skillHitFx(skillMelee(id), "run", REF_FIELD_H).map((l) => l.liftRatio);
      expect(Math.max(...lifts) - Math.min(...lifts), id).toBeGreaterThan(0.15);
    }
  });

  /**
   * 마무리기의 무게는 **한 장의 크기가 아니라 화면에 남는 시간**이다
   * (`SKILL_FX_MAX_RATIO`가 크기를 막고 있으므로 크기로는 못 만든다).
   */
  it("번지는 시간이 연타 < 연격 < 마무리기 < ult다", () => {
    const q = skillHitSpanMs(skillMelee(QUICK));
    const c = skillHitSpanMs(skillMelee(COMBO));
    const b = skillHitSpanMs(skillMelee(BURST));
    expect(q).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(q);
    expect(b).toBeGreaterThan(q * 2);
    expect(skillHitSpanMs(skillMelee(ULT))).toBeGreaterThan(b);
  });

  /**
   * 임팩트가 클립보다 오래 끌면 아군은 이미 대기 자리로 돌아왔는데 적 앞에서
   * 이펙트가 계속 터진다 — 누가 때린 것인지 화면에서 끊긴다. 일곱 중 가장 짧은
   * 복귀(wind_hashashin 280ms)보다 짧아야 한다.
   */
  it("번지는 시간이 복귀 모션 안에서 끝난다", () => {
    const chars = new PresetLoadoutProvider().load(HERO_SLUGS.length).characters;
    for (const id of ATTACK_IDS) {
      const m = skillMelee(id)!;
      const shortestReturn = Math.min(
        ...chars.map((c) => skillStyle(c.melee, m).returnMs),
      );
      expect(skillHitSpanMs(m), id).toBeLessThan(shortestReturn);
    }
  });

  it("스킬이 없으면 번지는 시간이 0이다", () => {
    expect(skillHitSpanMs(null)).toBe(0);
  });
});

/**
 * 필드 높이 둘 — PvP 기준(512)과 싱글(800). `meleeFx.test.ts`와 같은 이유다.
 */
const FIELD_HS: readonly (readonly [string, number])[] = [
  ["PvP 기준", REF_FIELD_H],
  ["싱글", SINGLE_FIELD_H],
];

describe("skillHitFx", () => {
  it("존재하는 시트만 가리킨다 — 없는 키는 조용히 생략된다", () => {
    for (const id of ATTACK_IDS) {
      for (const ap of APPROACHES) {
        const layers = skillHitFx(skillMelee(id), ap, REF_FIELD_H);
        expect(layers.length, id).toBeGreaterThan(0);
        for (const l of layers)
          expect(FX_SHEETS[l.sheet], `${id}/${l.sheet}`).toBeDefined();
      }
    }
  });

  /**
   * **크기는 캐릭터 키 대비로만 판정한다.** 예전에는 "24px보다 크고 72px보다
   * 작다"였는데, 그 두 숫자는 아군이 231px일 때 정한 것이라 캐릭터를 줄이자
   * (`ALLY_H_RATIO` 0.55 → 0.40) 통과하면서 화면에서는 이펙트가 캐릭터를
   * 삼켰다 — 상수는 기준이 바뀌면 조용히 의미가 달라진다.
   *
   * **배율이 아니라 px로 재고 키로 나눈다**: 시트가 96과 64로 달라서 같은
   * 배율이 같은 크기가 아니다.
   */
  it("어느 층도 캐릭터를 덮지 않고, 안 보일 만큼 작지도 않다 — 두 필드 다", () => {
    /**
     * **필드 높이 둘 다 본다** (2026-08-07). 이펙트 크기는 `allyDisplayPx(fieldH)`
     * 에서 나오고 필드 높이는 모드가 정한다 — PvP는 기준 512, 싱글은 800이다.
     * 예전에는 인자 없이 불러 어느 모드에서나 512로 계산했고, 그래서 싱글에서만
     * 이펙트가 키의 27%였다. 한 값만 재면 그 차이가 검사에 없다.
     */
    for (const [where, fieldH] of FIELD_HS) {
      const charPx = allyDisplayPx(fieldH);
      for (const id of ATTACK_IDS) {
        for (const l of skillHitFx(skillMelee(id), "run", fieldH)) {
          const rel = (FX_SHEETS[l.sheet].frameW * l.scale) / charPx;
          const at = `${where}/${id}/${l.sheet}`;
          // 키의 1/4 아래면 도트 캐릭터 위에서 점으로 보인다
          expect(rel, at).toBeGreaterThan(0.25);
          expect(rel, at).toBeLessThanOrEqual(FX_COVER_RATIO);
          expect(Math.abs(l.offsetRatio), at).toBeLessThan(0.15);
        }
      }
    }
  });

  /**
   * 시전 층도 같이 본다 — 타격만 재면 시전 층이 검사 밖에 남는다. 실제 결함은
   * `toScale` 한 곳이라 둘 다 같이 틀렸다.
   */
  it("시전 층도 필드 높이를 따라간다", () => {
    for (const id of ATTACK_IDS) {
      const ref = skillCastFx(skillMelee(id), "run", REF_FIELD_H);
      const single = skillCastFx(skillMelee(id), "run", SINGLE_FIELD_H);
      expect(single.length, id).toBe(ref.length);
      for (const [i, l] of ref.entries()) {
        expect(single[i]!.scale / l.scale, `${id}/${l.sheet}`).toBeCloseTo(
          SINGLE_FIELD_H / REF_FIELD_H,
          6,
        );
      }
    }
  });

  /**
   * 상한이 두 모듈에 다른 단위로 있으면 한쪽만 고친다 — 실제로 그렇게 됐다
   * (px 상수 72가 캐릭터 크기 변경을 못 따라왔다). 같은 값에 묶어 둔다.
   */
  it("상한이 필드 규칙의 덮임 한계와 같은 값이다", () => {
    expect(SKILL_FX_MAX_RATIO).toBe(FX_COVER_RATIO);
    // px 상한도 필드 높이에서 나온다 — 상수로 두면 싱글에서 상한이 아니게 된다
    for (const [where, fieldH] of FIELD_HS) {
      expect(skillFxMaxPx(fieldH), where).toBeCloseTo(
        fieldH * ALLY_H_RATIO * FX_COVER_RATIO,
        6,
      );
    }
    expect(skillFxMaxPx(SINGLE_FIELD_H)).toBeGreaterThan(
      skillFxMaxPx(REF_FIELD_H),
    );
  });

  it("점에서 터지는 시트는 회전을 쓰지 않는다 — 프레임마다 흔들려 보인다", () => {
    for (const id of ATTACK_IDS) {
      for (const ap of APPROACHES) {
        for (const l of skillHitFx(skillMelee(id), ap, REF_FIELD_H)) {
          if (l.sheet !== "slash")
            expect(l.rotation, `${id}/${l.sheet}`).toBe(0);
        }
      }
    }
  });

  it("궤적은 굴러 들어온 쪽이 반대로 눕는다 — 아래에서 위로 올려 벤다", () => {
    const run = skillHitFx(skillMelee(QUICK), "run", REF_FIELD_H)[0]!;
    const roll = skillHitFx(skillMelee(QUICK), "roll", REF_FIELD_H)[0]!;
    expect(run.sheet).toBe("slash");
    expect(Math.sign(run.rotation)).toBe(-Math.sign(roll.rotation));
  });

  /**
   * 걷는 캐릭터에게 `run` 값이 그대로 가면 접근 클립만 다르고 타격은 똑같아서,
   * 걷는 것이 화면에 남지 않는다. 접근 셋이 다 달라야 한다.
   */
  it("궤적 기울기가 접근 셋에서 서로 다르다", () => {
    const tilts = APPROACHES.map(
      (ap) => skillHitFx(skillMelee(QUICK), ap, REF_FIELD_H)[0]!.rotation,
    );
    expect(new Set(tilts).size).toBe(APPROACHES.length);
  });

  /**
   * 스킬 궤적이 자동 공격 궤적과 같으면, 눌렀을 때 나오는 것이 그냥
   * 자동 공격이다 — 클립을 갈라 놓은 것이 이펙트에서 지워진다.
   */
  it("자동 공격의 궤적보다 크게 그어진다", () => {
    const auto = meleeFx(BLADED, "attack1", "run", REF_FIELD_H);
    expect(auto.sheet).toBe("slash");
    for (const id of [QUICK, COMBO]) {
      const skill = skillHitFx(skillMelee(id), "run", REF_FIELD_H)[0]!;
      expect(skill.sheet, id).toBe(auto.sheet);
      expect(Math.abs(skill.rotation), id).toBeGreaterThan(
        Math.abs(auto.rotation),
      );
    }
  });

  it("스킬이 없으면 빈 배열 — 호출자가 캐릭터별 연출로 되돌아가는 신호다", () => {
    expect(skillHitFx(null, "run", REF_FIELD_H)).toEqual([]);
  });
});

describe("skillStyle", () => {
  it("스킬이 없으면 스타일을 그대로 준다", () => {
    const style = new PresetLoadoutProvider().load(1).characters[0]!.melee;
    expect(skillStyle(style, null)).toBe(style);
  });

  /**
   * **캐릭터 일곱의 차이를 지우지 않는다.** 스킬이 접근 시간을 상수로 박으면
   * metal_bladekeeper(200ms)와 water_priestess(340ms)가 스킬을 쓸 때 같은
   * 속도로 붙는다 — 일곱을 갈라 놓은 축이 스킬 한 번에 사라진다. 배율이라
   * 순서가 유지된다.
   */
  it("배율이라 캐릭터별 빠르기 순서가 유지된다", () => {
    const chars = new PresetLoadoutProvider().load(HERO_SLUGS.length).characters;
    const rank = (xs: number[]): number[] =>
      xs.map((v) => xs.filter((w) => w < v).length);
    for (const role of ATTACK_ROLES) {
      const before = chars.map((c) => c.melee.approachMs);
      const after = chars.map(
        (c) =>
          skillStyle(c.melee, skillMelee(attackSkillId(c.charSlug, role)))
            .approachMs,
      );
      // 순위가 그대로다 — 가장 빨랐던 캐릭터가 스킬을 써도 가장 빠르다
      expect(rank(after), role).toEqual(rank(before));
    }
  });

  it("접근 시간에 하한이 있다 — 더 짧으면 먼지만 남고 순간이동으로 보인다", () => {
    const tiny = {
      approach: "run" as const,
      approachMs: 10,
      returnMs: 10,
      reach: 0.2,
      clips: ["attack1" as const],
    };
    const s = skillStyle(tiny, skillMelee(QUICK));
    expect(s.approachMs).toBeGreaterThanOrEqual(SKILL_MIN_APPROACH_MS);
    // 복귀는 0이 되면 자세가 튄다 — 최소 1프레임은 남는다
    expect(s.returnMs).toBeGreaterThan(0);
  });

  it("정체성(접근 동작·사거리·클립)은 건드리지 않는다", () => {
    // 걷는 캐릭터로 본다 — 스킬이 접근 동작을 덮으면 없는 `run` 시트를 가리켜
    // `spriteChar`의 대체 사슬이 조용히 `walk`를 재생한다
    const style = new PresetLoadoutProvider("water_priestess").load(1)
      .characters[0]!.melee;
    expect(style.approach).toBe("walk");
    const s = skillStyle(style, skillMelee(attackSkillId("water_priestess", "burst")));
    expect(s.approach).toBe(style.approach);
    expect(s.reach).toBe(style.reach);
    expect(s.clips).toEqual(style.clips);
  });

  it("원본 스타일을 제자리에서 고치지 않는다 — 스킬 한 번이 영구히 남는다", () => {
    const style = new PresetLoadoutProvider().load(1).characters[0]!.melee;
    const before = style.approachMs;
    skillStyle(style, skillMelee(QUICK));
    expect(style.approachMs).toBe(before);
  });
});
