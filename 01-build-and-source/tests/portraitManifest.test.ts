import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { HERO_SLUGS } from "../src/shared/charManifest";
import { CARD_W_RATIO } from "../src/pvp/matchRules";
import { CARD_H } from "../src/shared/viewport";
import { DESIGN_W } from "../src/shared/viewport";
import {
  PORTRAIT_BASE_H,
  PORTRAIT_MANIFEST_URL,
  PORTRAIT_VARIANTS,
  portraitDisplayHeight,
  portraitDisplaySize,
  type PortraitManifest,
} from "../src/shared/portraitManifest";

/** 생성기(`tools/gen_portraits.py`) 산출물. 목록과 파일이 어긋나면 카드가 빈다 */
const manifest = JSON.parse(
  readFileSync(`public/${PORTRAIT_MANIFEST_URL}`, "utf-8"),
) as PortraitManifest;

const PY = readFileSync("tools/gen_portraits.py", "utf-8");

/** `이름 = {` 로 시작하는 파이썬 dict의 본문. 닫는 `}`까지 */
function pyDict(open: string): string {
  const start = PY.indexOf(open);
  expect(start, open).toBeGreaterThan(0);
  return PY.slice(start + open.length).split("\n}")[0]!;
}

/** 파이썬 쪽 dict 최상위 키 목록. 두 벌을 손으로 맞추므로 대조가 필요하다 */
function pyKeys(name: string): string[] {
  const start = PY.indexOf(`${name}: dict[str, `);
  expect(start, `${name} 선언`).toBeGreaterThan(0);
  const body = PY.slice(start).split("\n}")[0]!;
  return [...body.matchAll(/^ {4}"([a-z0-9_/]+)":/gm)].map((m) => m[1]!);
}

describe("portraits.json (생성기 산출물)", () => {
  test("주인공 7종 × 5장이 다 있다 — 하나만 없어도 그 캐릭터 카드가 빈다", () => {
    expect(Object.keys(manifest).sort()).toEqual([...HERO_SLUGS].sort());
    for (const s of HERO_SLUGS) {
      expect(Object.keys(manifest[s]!).sort(), s).toEqual(
        [...PORTRAIT_VARIANTS].sort(),
      );
    }
  });

  test("파일이 실제로 존재하고 매니페스트가 가리키는 경로와 같다", () => {
    for (const s of HERO_SLUGS) {
      for (const v of PORTRAIT_VARIANTS) {
        const r = manifest[s]![v]!;
        expect(r.url, `${s}/${v}`).toBe(`assets/portraits/${s}_${v}.png`);
        expect(() => readFileSync(`public/${r.url}`), r.url).not.toThrow();
      }
    }
  });

  /**
   * **투명이 0%면 배경 제거가 실패한 것이다** — 인물이 아니라 불투명 사각형이
   * 카드에 박힌다.
   *
   * 실제로 그렇게 나왔다: 처음엔 배경 생성기와 같은 마젠타 키잉을 썼는데
   * SD3.5가 그 지시를 무시하고 **흰 배경**을 그려서 지울 색이 없었다. 세 장 다
   * 투명 0%로 조용히 통과했고, 카드에 흰 사각형이 뜨는 것을 보고서야 알았다.
   *
   * 하한 5%의 유래: 실측 최소가 15.8%(`crystal_mauler/card` — 얼굴만 남긴
   * 크롭이라 여백이 가장 적다)다. 상한 90%는 반대 실패다(인물까지 지워진 것).
   */
  test("배경이 실제로 오려져 있다 — 0%면 불투명 사각형이다", () => {
    for (const s of HERO_SLUGS) {
      for (const v of PORTRAIT_VARIANTS) {
        const r = manifest[s]![v]!;
        expect(r.alphaRatio, `${s}/${v}`).toBeGreaterThan(0.05);
        expect(r.alphaRatio, `${s}/${v}`).toBeLessThan(0.9);
      }
    }
  });

  /**
   * **텍스처가 표시 크기보다 작으면 확대되어 뭉갠다.**
   *
   * 생성기는 `PX_PER_TEXEL = 1.0`으로 굽는다 — 1.6으로 잡았다가 카드 93px에서
   * 눈이 2px이 되는 것을 4배 확대 캡처로 확인하고 내린 값이다. 밀도가 조용히
   * 되돌아가는 것을 여기서 막는다. 반올림 여유 2px만 준다(win은 435.2 → 435).
   */
  test("텍스처 높이가 표시 높이 이상이다 — 모자라면 확대되어 얼굴이 뭉갠다", () => {
    for (const s of HERO_SLUGS) {
      for (const v of PORTRAIT_VARIANTS) {
        const r = manifest[s]![v]!;
        const disp = portraitDisplayHeight(v, r.ratio);
        expect(
          r.h,
          `${s}/${v} 표시 ${disp.toFixed(0)}px`,
        ).toBeGreaterThanOrEqual(disp - 2);
      }
    }
  });

  /**
   * `ratio`의 분모가 TS와 파이썬 두 벌로 있다(`PORTRAIT_BASE_H` ↔ `REF_BASE`).
   * 어긋나면 **아무것도 안 깨지면서** 밀도만 달라진다 — 생성기는 A로 굽고
   * 런타임은 B로 표시하니 위 "텍스처가 표시보다 크다"까지 통과한다.
   */
  test("표시 기준 높이가 생성기와 같다 — 어긋나면 밀도만 조용히 달라진다", () => {
    const num = (name: string): number => {
      const m = PY.match(new RegExp(`^${name} = ([0-9.]+)`, "m"));
      expect(m, `${name}`).not.toBeNull();
      return Number(m![1]);
    };
    const consts: Record<string, number> = {
      REF_CARD_H: num("REF_CARD_H"),
      REF_SCREEN_H: num("REF_SCREEN_H"),
    };
    // **variant를 손으로 나열하지 않는다.** 예전엔 세 줄을 적어 뒀는데
    // `lose`·`draw`가 늘었을 때 그 둘이 조용히 빠졌다 — 이 테스트가 지키려는
    // 실패("어긋나면 아무것도 안 깨지면서 밀도만 달라진다")가 새 variant에서만
    // 그대로 살아 있었다. 파이썬 `REF_BASE` 표 전체를 읽어 양쪽 키까지 대조한다.
    const body = pyDict("REF_BASE = {");
    const py = new Map<string, number>();
    for (const m of body.matchAll(/"([a-z_]+)":\s*([A-Z_]+|[0-9.]+)/g)) {
      const raw = m[2]!;
      py.set(m[1]!, raw in consts ? consts[raw]! : Number(raw));
    }
    expect([...py.keys()].sort()).toEqual([...PORTRAIT_VARIANTS].sort());
    for (const v of PORTRAIT_VARIANTS) {
      expect(PORTRAIT_BASE_H[v], `REF_BASE[${v}]`).toBe(py.get(v));
    }
  });

  /**
   * 카드 삽화는 **카드 안에** 들어야 한다. 표시 높이를 비율로 정하고 폭을
   * 유도하므로(`portraitDisplaySize`) 폭은 캐릭터마다 다르다 — 실측 54~134px.
   * 넘치면 옆 카드나 테두리를 뚫는다.
   */
  test("카드 삽화가 카드 폭 안에 든다 — 넘치면 테두리를 뚫는다", () => {
    const cardW = DESIGN_W * CARD_W_RATIO;
    for (const s of HERO_SLUGS) {
      const r = manifest[s]!.card!;
      const { w, h } = portraitDisplaySize("card", r);
      // 테두리·여백 8px씩
      expect(w, `${s}/card 폭 ${w.toFixed(0)} vs 카드 ${cardW.toFixed(0)}`)
        .toBeLessThanOrEqual(cardW - 16);
      // 라벨 자리(하단 24px)를 남긴다
      expect(h, `${s}/card 높이 ${h.toFixed(0)}`).toBeLessThanOrEqual(
        CARD_H - 24,
      );
    }
  });

  test("선택 삽화는 전신이다 — 세로가 가로보다 길다", () => {
    for (const s of HERO_SLUGS) {
      const r = manifest[s]!.select!;
      expect(r.h / r.w, `${s}/select ${r.w}×${r.h}`).toBeGreaterThan(1.2);
    }
  });

  /**
   * 카드가 **더 바짝 잘려 있어야** 한다 — 카드에 전신이 들어오면 93px 안에서
   * 얼굴이 20px가 되어 일곱 명이 서로 구별되지 않는다.
   *
   * 이것을 카드 쪽 가로세로비 상한으로 재려다 틀렸다: `ground_monk/card`는
   * 1.72로 `fire_knight/select`(1.75)와 거의 같다 — 어깨가 좁은 캐릭터의 얼굴
   * 크롭이 어깨가 넓은 캐릭터의 전신과 같은 비율로 나온다. **절대 비율은
   * 캐릭터 체형에 오염된다.** 같은 사람의 두 크롭을 견주면 그 오염이 사라진다
   * (실측 여유 0.36~2.20).
   */
  test("카드가 선택본보다 바짝 잘려 있다 — 전신이 들어오면 얼굴이 20px가 된다", () => {
    for (const s of HERO_SLUGS) {
      const card = manifest[s]!.card!;
      const sel = manifest[s]!.select!;
      expect(
        sel.h / sel.w - card.h / card.w,
        `${s} card ${(card.h / card.w).toFixed(2)} vs select ${(sel.h / sel.w).toFixed(2)}`,
      ).toBeGreaterThan(0.3);
    }
  });

  /**
   * 명도는 **기록만** 강제한다.
   *
   * 스프라이트 쪽에는 "주인공이 배경보다 밝다"가 있지만(`charManifest.test.ts`)
   * 삽화에는 그 형태로 못 쓴다. 견줄 대상이 다르다: 스프라이트는 필드 삽화
   * 위에 서고, 삽화는 UI 패널(`UI_PANEL` 휘도 0.262) 위에 놓인다. 배경 삽화의
   * 가장 밝은 층(0.328)과 견주면 `fire_knight/card`(0.159)가 걸리는데, 그 그림은
   * 배경 위에 놓이지 않으므로 그 실패는 의미가 없다.
   *
   * 패널과의 대비로 재는 것도 지금은 근거가 없다 — `leaf_ranger/card`(0.221)는
   * 패널과 0.04 차이지만 아직 카드에 얹어 본 적이 없어서 "녹는지"를 모른다.
   * 메모리 `[[judge-by-capture-not-metrics]]`대로 그 판정은 카드를 실제로
   * 그리는 단계(캐릭터 선택 씬)에서 캡처로 한다. 여기서는 숫자가 사라지는 것만
   * 막는다 — 없으면 그때 대조할 기준조차 없다.
   */
  test("모든 삽화가 명도를 기록한다 — 없으면 나중에 대조할 기준이 없다", () => {
    for (const s of HERO_SLUGS) {
      for (const v of PORTRAIT_VARIANTS) {
        const r = manifest[s]![v]!;
        expect(r.medLum, `${s}/${v}`).toBeGreaterThan(0);
        expect(r.medLum, `${s}/${v}`).toBeLessThan(1);
      }
    }
  });

  /**
   * 생성기의 캐릭터 목록이 게임 목록과 같아야 한다. 히어로를 늘리고 `LOOKS`를
   * 안 채우면 그 캐릭터만 삽화 없이 남는다 — 생성기도 `main()`에서 멈추지만
   * 그건 사람이 생성기를 다시 돌릴 때만 드러난다.
   */
  test("생성기가 아는 캐릭터가 게임 목록과 같다", () => {
    expect(pyKeys("LOOKS").sort()).toEqual([...HERO_SLUGS].sort());
    expect(pyKeys("SEEDS").sort()).toEqual([...HERO_SLUGS].sort());
  });

  /**
   * **캐릭터당 시드가 하나여야** 세 장이 같은 사람에 가까워진다. 시드가 겹치면
   * 두 캐릭터가 닮는다. 이건 지표로 못 잡는다 — 세 장의 대표 색조 편차를 재
   * 봤더니 멀쩡한 캐릭터 둘을 Δ106°·Δ93°로 신고했다(카드는 머리색이, 전신은
   * 망토가 지배한다). 그래서 그림 대신 **구조**를 지킨다.
   */
  test("시드가 캐릭터마다 서로 다르다 — 겹치면 두 캐릭터가 닮는다", () => {
    const body = PY.slice(PY.indexOf("SEEDS: dict[str, int]")).split("\n}")[0]!;
    const seeds = [...body.matchAll(/:\s*(\d+),/g)].map((m) => Number(m[1]));
    expect(seeds).toHaveLength(HERO_SLUGS.length);
    expect(new Set(seeds).size).toBe(HERO_SLUGS.length);
  });

  /**
   * 자르기 예외(`CROP_OVERRIDE`)의 키가 실제 슬러그·variant를 가리켜야 한다.
   * 오타는 **조용하다** — `.get()`이 기본값으로 떨어져서 예외가 없던 것이 되고,
   * 그 캐릭터만 턱이 잘린 채 통과한다.
   */
  test("자르기 예외 키가 실제 캐릭터·용도를 가리킨다 — 오타는 조용히 무시된다", () => {
    for (const key of pyKeys("CROP_OVERRIDE")) {
      const [slug, variant] = key.split("/");
      expect(HERO_SLUGS as readonly string[], key).toContain(slug);
      expect(PORTRAIT_VARIANTS as readonly string[], key).toContain(variant);
    }
  });

  /**
   * 텍스처 예산 — 삽화는 씬마다 나눠 올린다(카드=대기, 선택=선택, 승리=결과).
   * 그래도 한 씬이 7종을 동시에 띄우므로 variant별로 잰다.
   *
   * 캐릭터 시트 쪽과 같은 규칙으로 **압축 안 된 `w×h×4`**를 센다 — 디스크 KB로
   * 재면 100배 낮게 읽힌다. 실측: 카드 0.2MB · 선택 3.3MB · 승리 6.7MB.
   */
  test("한 씬이 7종을 동시에 올려도 GPU 예산 안이다", () => {
    for (const v of PORTRAIT_VARIANTS) {
      const mb =
        HERO_SLUGS.reduce(
          (n, s) => n + manifest[s]![v]!.w * manifest[s]![v]!.h * 4,
          0,
        ) /
        1024 /
        1024;
      expect(mb, `${v} 합계 ${mb.toFixed(1)}MB`).toBeLessThanOrEqual(16);
    }
  });
});
