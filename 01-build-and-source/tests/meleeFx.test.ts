import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import { FX_SHEETS } from "../src/shared/fxManifest";
import { dashDustFx, meleeFx } from "../src/shared/meleeFx";
import {
  ALLY_H_RATIO,
  FX_COVER_RATIO,
  REF_FIELD_H,
  allyDisplayPx,
} from "../src/shared/battleFieldRules";
import { SINGLE_FIELD_H } from "../src/single/upgradePanelRules";
import { PresetLoadoutProvider } from "../src/loadout/preset";
import type { ApproachKind, AttackClip } from "../src/shared/meleeRules";
import { HERO_SLUGS } from "../src/shared/charManifest";

/** 네 벌 다 본다 — `attack3`이 빠지면 새 공격 슬롯이 검사 밖에 남는다 */
const CLIPS: readonly AttackClip[] = ["attack1", "attack2", "attack3", "special"];
/**
 * 접근 셋 다 본다. `walk`는 취향이 아니라 에셋 사실이다 — water_priestess만
 * 달리기 시트가 없다. 여기에 빠지면 그 캐릭터의 이펙트가 검사 밖에 남는다.
 */
const APPROACHES: readonly ApproachKind[] = ["run", "roll", "walk"];

/**
 * **필드 높이 둘 다 본다** — 한 값만 재면 나머지 모드가 검사 밖에 남는다.
 *
 * 이펙트 크기는 `allyDisplayPx(fieldH)`에서 나오고 필드 높이는 모드가 정한다:
 * PvP는 게이지에 따라 420~604.8이고(기준 512), 싱글은 800으로 고정이다
 * (HUD 아래 ~ 강화 줄 위). 예전에는 `allyDisplayPx()`를 인자 없이 불러서
 * **어느 모드에서나 512로 계산했고**, PvP 필드가 512에 가까워 거기서는 맞았다 —
 * 싱글에서만 키의 27%로 작아졌는데 두 모드가 다른 값이라는 사실이 검사에
 * 없어서 조용했다.
 */
const FIELD_HS: readonly (readonly [string, number])[] = [
  ["PvP 기준", REF_FIELD_H],
  ["싱글", SINGLE_FIELD_H],
];

describe("meleeFx", () => {
  it("존재하는 시트만 가리킨다 — 없는 키를 주면 이펙트가 조용히 생략된다", () => {
    for (const c of new PresetLoadoutProvider().load(HERO_SLUGS.length)
      .characters) {
      for (const clip of CLIPS) {
        const spec = meleeFx(c.charSlug, clip, c.melee.approach, REF_FIELD_H);
        expect(FX_SHEETS[spec.sheet], `${c.charSlug}/${clip}`).toBeDefined();
      }
    }
  });

  /**
   * 이 함수의 존재 이유다. 일곱이 같은 시트를 쓰면 접근 곡선과 클립을 갈라 놓은
   * 것이 화면에서 지워진다 — "색만 다른 같은 사람"으로 돌아간다.
   */
  it("일곱 캐릭터가 한 시트로 몰리지 않는다", () => {
    const sheets = new Set(
      new PresetLoadoutProvider()
        .load(HERO_SLUGS.length)
        .characters.map(
          (c) => meleeFx(c.charSlug, "attack1", c.melee.approach, REF_FIELD_H).sheet,
        ),
    );
    expect(sheets.size).toBeGreaterThan(1);
  });

  /**
   * 갈래는 **캡처로 정했다**(무기 이름이 아니라 공격 프레임의 그림).
   * crystal_mauler는 망치인데 시트에 파란 호가 그려져 있어 궤적 쪽이고,
   * leaf_ranger는 활이라 팔을 휘두르지 않아 점 폭발 쪽이다.
   *
   * **일곱을 다 적는다.** 몇 개만 표본으로 적으면 새 캐릭터가 조용히 한쪽으로
   * 떨어져도 통과한다 — 그때는 "왜 이 캐릭터만 타격이 밋밋하지"를 화면에서 찾게 된다.
   */
  it("호를 그리는 넷은 궤적, 나머지 셋은 스파크다", () => {
    const want: Record<string, "slash" | "spark"> = {
      water_priestess: "spark",
      leaf_ranger: "spark",
      metal_bladekeeper: "slash",
      wind_hashashin: "slash",
      fire_knight: "slash",
      crystal_mauler: "slash",
      ground_monk: "spark",
    };
    // 표에 일곱이 다 있어야 한다 — 캐릭터를 늘리고 여기를 안 고치면 검사가 준다
    expect(Object.keys(want).sort()).toEqual([...HERO_SLUGS].sort());
    for (const slug of HERO_SLUGS) {
      expect(meleeFx(slug, "attack1", "run", REF_FIELD_H).sheet, slug).toBe(want[slug]);
    }
  });

  it("마무리 기술이 일반타보다 크다 — 같으면 클립을 순환시킨 의미가 없다", () => {
    for (const slug of HERO_SLUGS) {
      const normal = meleeFx(slug, "attack1", "run", REF_FIELD_H).scale;
      const special = meleeFx(slug, "special", "run", REF_FIELD_H).scale;
      expect(special, slug).toBeGreaterThan(normal);
    }
  });

  it("모르는 슬러그도 유효한 값을 준다 — 갤러리·디버그가 아무 슬러그로나 부른다", () => {
    const spec = meleeFx("goblin", "attack1", "run", REF_FIELD_H);
    expect(FX_SHEETS[spec.sheet]).toBeDefined();
    expect(Number.isFinite(spec.scale)).toBe(true);
    expect(Number.isFinite(spec.rotation)).toBe(true);
  });

  /**
   * **배율이 아니라 실제 px로 재고 캐릭터 키로 나눈다.** 시트 크기가 달라서
   * (96 vs 64) 같은 배율이 같은 크기가 아니다 — 배율에 상한을 걸면 64px 시트만
   * 부당하게 조인다.
   *
   * 예전에는 "24px보다 크고 72px보다 작다"였다. 그 두 숫자는 아군이 231px일 때
   * 정한 것이라, 캐릭터를 줄이자(`ALLY_H_RATIO` 0.55 → 0.40) 상한만 그대로
   * 남아 화면에서는 이펙트가 캐릭터를 삼켰다 — **상수는 기준이 바뀌면 조용히
   * 의미가 달라진다.** 처음 판의 소프트 글로우가 아군으로 오인된 실패가 곧
   * 이 덮임이었으므로, 판정은 키 대비여야 한다.
   */
  it("타격 이펙트가 캐릭터를 덮지도, 안 보이지도 않는 크기다 — 두 필드 다", () => {
    for (const [where, fieldH] of FIELD_HS) {
      const charPx = allyDisplayPx(fieldH);
      for (const slug of HERO_SLUGS) {
        for (const clip of CLIPS) {
          const s = meleeFx(slug, clip, "run", fieldH);
          const rel = (FX_SHEETS[s.sheet].frameW * s.scale) / charPx;
          const at = `${where}/${slug}/${clip}`;
          expect(rel, at).toBeGreaterThan(0.25);
          expect(rel, at).toBeLessThanOrEqual(FX_COVER_RATIO);
          expect(Math.abs(s.offsetRatio), at).toBeLessThan(0.15);
        }
      }
    }
  });

  /**
   * **필드가 커지면 이펙트도 같이 커진다.** 이것이 원래 결함이다 — 싱글 필드는
   * PvP 기준보다 1.56배 높은데 이펙트는 같은 px이었다. 화면에서는 캐릭터 대비
   * 42%가 아니라 27%로 보였고, 비율이 아니라 **곱하는 키**가 틀린 것이라
   * "비율로 적었다"는 근거가 오히려 문제를 가렸다.
   */
  it("필드 높이가 이펙트 px을 정한다 — 안 넘기면 두 모드가 같아진다", () => {
    const px = (fieldH: number): number => {
      const s = meleeFx(HERO_SLUGS[0], "attack1", "run", fieldH);
      return FX_SHEETS[s.sheet].frameW * s.scale;
    };
    expect(SINGLE_FIELD_H).toBeGreaterThan(REF_FIELD_H);
    expect(px(SINGLE_FIELD_H)).toBeGreaterThan(px(REF_FIELD_H));
    // 키에 정비례한다 — 화면에서 차지하는 비중이 모드와 무관하게 같다
    expect(px(SINGLE_FIELD_H) / px(REF_FIELD_H)).toBeCloseTo(
      SINGLE_FIELD_H / REF_FIELD_H,
      6,
    );
  });

  /**
   * 캐릭터를 다시 키우거나 줄이면 이펙트가 **같은 비율로** 따라가야 한다.
   * px 상수로 돌아가면 이 테스트가 먼저 깨진다 — 그때가 화면을 열어 보기 전에
   * 알 수 있는 유일한 시점이다.
   */
  it("이펙트 크기가 캐릭터 키에서 유도된다 — 상수로 박으면 안 된다", () => {
    for (const [where, fieldH] of FIELD_HS) {
      const charPx = fieldH * ALLY_H_RATIO;
      const s = meleeFx(HERO_SLUGS[0], "attack1", "run", fieldH);
      const px = FX_SHEETS[s.sheet].frameW * s.scale;
      // 0.42는 `HIT_RATIO.normal`이다. 값이 바뀌면 여기도 같이 바뀌어야 한다
      expect(px, where).toBeCloseTo(charPx * 0.42, 6);
    }
  });

  it("점에서 터지는 타격은 회전을 쓰지 않는다 — 프레임마다 흔들려 보인다", () => {
    // 접근 세 종류 다 본다 — 한 종류에서만 0이면 나머지가 검사 밖에 남는다
    for (const approach of APPROACHES) {
      expect(meleeFx("ground_monk", "attack1", approach, REF_FIELD_H).rotation, approach).toBe(
        0,
      );
      expect(
        meleeFx("water_priestess", "special", approach, REF_FIELD_H).rotation,
        approach,
      ).toBe(0);
    }
  });

  /**
   * 접근 셋이 **서로 다** 달라야 한다. `walk`가 `run` 값으로 떨어지면 걷는
   * 캐릭터는 접근 클립만 다르고 타격은 똑같아서, 걷는 것이 화면에 안 남는다.
   */
  it("궤적 기울기가 접근 방식 셋에서 서로 다르다", () => {
    const tilts = APPROACHES.map(
      (a) => meleeFx("fire_knight", "attack1", a, REF_FIELD_H).rotation,
    );
    expect(new Set(tilts).size).toBe(APPROACHES.length);
    // 굴러 들어오면 아래에서 위로 올려 벤다 — 뛰어드는 쪽과 부호가 반대다
    const [run, roll] = tilts as [number, number, number];
    expect(Math.sign(roll)).toBe(-Math.sign(run));
  });
});

describe("dashDustFx", () => {
  it("먼지 시트를 가리킨다", () => {
    for (const a of APPROACHES) {
      expect(dashDustFx(a, REF_FIELD_H).sheet, a).toBe("dust");
      expect(FX_SHEETS[dashDustFx(a, REF_FIELD_H).sheet], a).toBeDefined();
    }
  });

  /**
   * 굴르기 > 달리기 > 걷기. 먼지는 접근이 **순간이동으로 보이는 것을 막는**
   * 장치이므로 접근이 느린 쪽일수록 작아야 한다 — 천천히 걸어가면서 발밑이
   * 폭발하면 접근 동작을 갈라 놓은 것이 오히려 어긋난다.
   */
  it("굴르기 > 달리기 > 걷기 순으로 인다 — 몸이 지면에 닿는 양이다", () => {
    // 순서는 필드 높이와 무관하다 — 한 필드에서만 재면 스케일 인자가 순서를
    // 뒤집는 실수를 못 잡는다
    for (const [where, fieldH] of FIELD_HS) {
      expect(dashDustFx("roll", fieldH).scale, where).toBeGreaterThan(
        dashDustFx("run", fieldH).scale,
      );
      expect(dashDustFx("run", fieldH).scale, where).toBeGreaterThan(
        dashDustFx("walk", fieldH).scale,
      );
      for (const a of APPROACHES)
        expect(dashDustFx(a, fieldH).scale, `${where}/${a}`).toBeGreaterThan(0);
    }
  });

  it("먼지도 필드 높이를 따라간다 — 발밑 먼지만 작으면 발이 떠 보인다", () => {
    const px = (fieldH: number): number =>
      FX_SHEETS.dust.frameW * dashDustFx("run", fieldH).scale;
    expect(px(SINGLE_FIELD_H) / px(REF_FIELD_H)).toBeCloseTo(
      SINGLE_FIELD_H / REF_FIELD_H,
      6,
    );
  });
});

/**
 * 생성된 PNG가 **하드 픽셀**인지 본다.
 *
 * 처음 판은 `GaussianBlur` + 연속 알파 감쇠였고, 화면에서 캐릭터를 덮는 흐릿한
 * 흰 덩어리로 보였다(스크린샷에서 확인). 그 회귀는 코드를 읽어서는 안 잡힌다 —
 * 산출물 픽셀을 직접 봐야 한다.
 */
describe("생성된 이펙트 시트가 하드 픽셀이다", () => {
  /** PNG 헤더에서 크기만 읽는다 — 디코더를 붙이지 않는다 */
  const pngSize = (path: string): { w: number; h: number } => {
    const buf = readFileSync(path);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  };

  test("시트 파일 크기가 매니페스트와 맞다", () => {
    for (const s of Object.values(FX_SHEETS)) {
      const { w, h } = pngSize(`public/${s.url}`);
      expect(h, s.key).toBe(s.frameH);
      expect(w, s.key).toBe(s.frameW * s.frames);
    }
  });

  test("생성기가 블러를 쓰지 않는다", () => {
    const src = readFileSync("tools/gen_effects.py", "utf-8");
    // 주석에는 "블러 금지"라고 적혀 있으므로 실제 호출만 본다
    expect(src).not.toMatch(/ImageFilter\.GaussianBlur/);
    expect(src).not.toMatch(/\.filter\(/);
    // 확대는 NEAREST여야 한다 — BICUBIC이면 아웃라인이 번진다
    expect(src).not.toMatch(/Image\.BICUBIC|Image\.BILINEAR|Image\.LANCZOS/);
  });

  test("근접 시트 3종이 생성기 SPECS에 있다", () => {
    const src = readFileSync("tools/gen_effects.py", "utf-8");
    for (const key of ["slash", "spark", "dust"]) {
      expect(src).toMatch(new RegExp(`"${key}", make_${key}`));
    }
  });
});
