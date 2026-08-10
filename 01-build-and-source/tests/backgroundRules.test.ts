import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  BG_GROUND_RATIO,
  CELESTIALS_PER_FIELD,
  COMPACT_FIELD_H,
  PROPS_PER_FIELD,
  SCENERY_LAYERS,
  SKY_STEPS,
  THEME_CELESTIALS,
  THEME_PROPS,
  advanceScroll,
  celestialPlacements,
  fieldDetailLevel,
  groundY,
  mixColor,
  propPlacements,
  sceneryAtlas,
  sceneryTileCount,
  sceneryTileW,
  skyBandColor,
  themeFade,
  visibleSceneryLayers,
  wrapScroll,
} from "../src/shared/backgroundRules";
import { GROUND_RATIO } from "../src/shared/battleFieldRules";
import { BG_ATLASES } from "../src/shared/fxManifest";
import { THEME_ABYSS, THEME_FADE_MS, THEME_SURFACE } from "../src/shared/theme";

// 배경이 지면을 그리고 캐릭터가 그 위에 선다 — 두 값이 갈라지면 캐릭터가
// 흙 속에 묻히거나 허공에 뜬다. 값 두 벌을 쓰는 것 자체가 버그의 원인이다
test("background ground ratio matches the field's", () => {
  expect(BG_GROUND_RATIO).toBe(GROUND_RATIO);
});

test("groundY is a fraction of the field height", () => {
  expect(groundY(1000)).toBeCloseTo(880, 6);
  expect(groundY(235)).toBeLessThan(235);
});

// ── 무한 스크롤 랩어라운드

// JS의 %는 음수를 유지한다. 왼쪽으로 흐를 때 오프셋이 음수로 남으면
// 두 번째 타일이 화면 오른쪽에 오지 못해 빈 틈이 생긴다 (스크린샷으로는
// "왜 배경이 없지?"로만 보인다)
test("wrapScroll folds negative offsets into the tile range", () => {
  expect(wrapScroll(-3, 100)).toBe(97);
  expect(wrapScroll(-103, 100)).toBe(97);
  expect(wrapScroll(250, 100)).toBe(50);
  expect(wrapScroll(0, 100)).toBe(0);
});

test("wrapScroll never returns the tile width itself", () => {
  for (const v of [100, 200, -100, -200, 1000]) {
    const r = wrapScroll(v, 100);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(100);
  }
});

test("wrapScroll survives a zero or bogus tile width", () => {
  expect(wrapScroll(37, 0)).toBe(0);
  expect(wrapScroll(Number.NaN, 100)).toBe(0);
});

test("advanceScroll moves proportionally to parallax and time", () => {
  const slow = advanceScroll(0, 100, 0.15, 1000, 900);
  const fast = advanceScroll(0, 100, 0.7, 1000, 900);
  expect(slow).toBeCloseTo(15, 6);
  expect(fast).toBeCloseTo(70, 6);
});

test("advanceScroll wraps instead of growing without bound", () => {
  let o = 0;
  for (let i = 0; i < 1000; i++) o = advanceScroll(o, 240, 1, 100, 900);
  expect(o).toBeGreaterThanOrEqual(0);
  expect(o).toBeLessThan(900);
});

test("advanceScroll with dtMs 0 only normalizes", () => {
  expect(advanceScroll(-5, 100, 1, 0, 900)).toBe(895);
});

// ── 레이어 사양

// 뒤에서 앞으로 갈수록 빠르고 진해야 한다. 순서가 뒤집히면 깊이가 반대로
// 읽혀 원경이 앞으로 튀어나온 것처럼 보인다
test("scenery layers strictly increase in parallax and alpha", () => {
  for (let i = 1; i < SCENERY_LAYERS.length; i++) {
    const a = SCENERY_LAYERS[i - 1]!;
    const b = SCENERY_LAYERS[i]!;
    expect(b.parallax).toBeGreaterThan(a.parallax);
    expect(b.alpha).toBeGreaterThan(a.alpha);
    expect(b.sink).toBeGreaterThanOrEqual(a.sink);
  }
});

test("there are exactly three scenery layers, far to near", () => {
  // 3겹 고정이다 (§2 저사양 예산)
  expect(SCENERY_LAYERS).toHaveLength(3);
  expect(SCENERY_LAYERS.map((l) => l.region)).toEqual(["far", "mid", "near"]);
});

// 원경이 불투명하면 대기 원근이 사라진다 — 그림의 명도로는 만들 수 없다.
// 지상 원경은 밝은 청록이고 심연 근경은 밝은 청회색이라(실측 lum 0.32 / 0.39)
// 명도 순서가 테마마다 반대다. 깊이는 하늘색이 배어 나오는 정도로만 만든다
test("only the nearest layer is fully opaque", () => {
  for (const l of SCENERY_LAYERS) {
    expect(l.alpha).toBeGreaterThan(0);
    expect(l.alpha).toBeLessThanOrEqual(1);
    expect(l.parallax).toBeLessThanOrEqual(1);
  }
  expect(SCENERY_LAYERS[0]!.alpha).toBeLessThan(1);
  expect(SCENERY_LAYERS.at(-1)!.alpha).toBe(1);
});

// ── 타일 폭 유도
//
// 폭을 상수로 잡으면(예전 `TILE_W = 900`) 그림이 늘어난다. 종횡비를 지키는
// 대신 폭이 필드보다 좁을 수 있어서, 몇 장 필요한지 세는 것이 규칙이 된다

test("tile width comes from the texture aspect, not a constant", () => {
  expect(sceneryTileW(101, 50, 126)).toBeCloseTo((126 * 101) / 50, 6);
  // 같은 높이라도 종횡비가 다르면 폭이 달라야 한다 — 같으면 늘어난 것이다
  expect(sceneryTileW(205, 94, 235)).not.toBeCloseTo(
    sceneryTileW(101, 50, 235),
    1,
  );
});

test("tile width degrades to zero instead of NaN", () => {
  // 0은 wrapScroll이 0으로 접어 주므로 조용히 멈춘다. NaN이면 스프라이트 x가
  // NaN이 되어 레이어가 통째로 사라진다 ("왜 배경이 없지?"로만 보인다)
  for (const [w, h, dh] of [
    [0, 50, 100],
    [101, 0, 100],
    [101, 50, 0],
  ] as const) {
    expect(sceneryTileW(w, h, dh)).toBe(0);
  }
});

// 타일 한 장으로 720을 못 덮는 레이어가 있다(원경 255px). 장수를 세지 않으면
// 오른쪽에 하늘만 남은 세로 띠가 화면을 지나간다
test("tile count covers the field with one tile to spare for scrolling", () => {
  for (const [fieldW, tileW] of [
    [720, 255],
    [720, 473],
    [720, 900],
    [360, 513],
  ] as const) {
    // 한 장이 왼쪽으로 거의 빠진 순간(offset → tileW)에도 덮여야 한다
    expect((sceneryTileCount(fieldW, tileW) - 1) * tileW).toBeGreaterThanOrEqual(
      fieldW,
    );
  }
});

test("tile count is zero for a bogus tile width", () => {
  expect(sceneryTileCount(720, 0)).toBe(0);
  expect(sceneryTileCount(0, 255)).toBe(0);
});

test("scenery atlas name follows the theme id", () => {
  // 이름 규칙이 `gen_bg_art.py`의 `build_atlas`와 갈라지면 배경이 사라진다
  expect(sceneryAtlas("surface")).toBe("scenery_surface");
  expect(sceneryAtlas("abyss")).toBe("scenery_abyss");
  for (const t of [THEME_SURFACE, THEME_ABYSS]) {
    expect(BG_ATLASES).toContain(sceneryAtlas(t.id));
  }
});

// ── 축소 표현 2단계

test("detail level switches exactly at the compact threshold", () => {
  expect(fieldDetailLevel(COMPACT_FIELD_H)).toBe("full");
  expect(fieldDetailLevel(COMPACT_FIELD_H - 1)).toBe("compact");
  expect(fieldDetailLevel(605)).toBe("full");
  expect(fieldDetailLevel(235)).toBe("compact");
});

test("compact drops the far layer only", () => {
  expect(visibleSceneryLayers(605)).toEqual([0, 1, 2]);
  expect(visibleSceneryLayers(235)).toEqual([1, 2]);
});

// 최소 필드에서도 근경은 남아야 한다 — 전부 지우면 지면만 남아 필드가
// 회색 띠로 보이고, 밀리는 쪽이 화면을 읽을 수 없다 (§1-1)
test("even the smallest field keeps the near scenery layer", () => {
  expect(visibleSceneryLayers(235)).toContain(2);
});

// ── 결정론 배치 (지면 장식·천체만. 삽화는 그림이 한 장이라 배치가 없다)

test("prop and celestial placements are deterministic and in range", () => {
  expect(propPlacements("surface", 5)).toEqual(propPlacements("surface", 5));
  expect(propPlacements("surface", 5)).toHaveLength(PROPS_PER_FIELD);
  for (const p of propPlacements("abyss", 5)) {
    expect(THEME_PROPS.abyss).toContain(p.region);
    expect(p.xr).toBeGreaterThanOrEqual(0);
    expect(p.xr).toBeLessThanOrEqual(1);
  }
  const cs = celestialPlacements("surface", 5);
  expect(cs).toHaveLength(CELESTIALS_PER_FIELD);
  for (const c of cs) {
    expect(THEME_CELESTIALS.surface).toContain(c.region);
    // 하늘 상단 구간에만 뜬다 — 아래로 내려오면 캐릭터 머리와 겹친다
    expect(c.yr).toBeGreaterThanOrEqual(0.08);
    expect(c.yr).toBeLessThanOrEqual(0.52);
    expect(c.alpha).toBeGreaterThan(0);
    expect(c.alpha).toBeLessThanOrEqual(1);
  }
});

test("asking for zero placements yields none", () => {
  expect(propPlacements("surface", 7, 0)).toEqual([]);
  expect(celestialPlacements("surface", 7, 0)).toEqual([]);
});

// 아틀라스에 없는 region을 지정하면 그 조각만 조용히 안 그려진다 —
// 배경 일부가 빠진 건 스크린샷으로 알아채기 어렵다
test("every region named by a theme exists in the generated atlas", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/bg/bg.json", "utf-8"),
  ) as Record<string, { regions: Record<string, unknown> }>;
  const keys = new Set(
    BG_ATLASES.flatMap((n) => Object.keys(manifest[n]?.regions ?? {})),
  );
  for (const table of [THEME_PROPS, THEME_CELESTIALS]) {
    for (const list of Object.values(table)) {
      for (const region of list) expect(keys).toContain(region);
    }
  }
});

// 삽화 3겹은 **테마마다** 다 있어야 한다. 한 겹이 없으면 그 테마에서만 배경
// 한 층이 사라지는데, 지상만 보고 넘어가면 심연에서 처음 드러난다
test("both themes provide all three scenery layers with a ratio", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/bg/bg.json", "utf-8"),
  ) as Record<
    string,
    { regions: Record<string, { w: number; h: number; ratio?: number }> }
  >;
  for (const t of [THEME_SURFACE, THEME_ABYSS]) {
    const regions = manifest[sceneryAtlas(t.id)]?.regions;
    expect(regions, t.id).toBeDefined();
    for (const spec of SCENERY_LAYERS) {
      const r = regions![spec.region];
      expect(r, `${t.id}/${spec.region}`).toBeDefined();
      // 표시 높이 비율은 **아틀라스가** 들고 있다 (생성기의 h_ratio).
      // TS에 복사해 두면 생성기를 고쳐도 화면이 안 바뀐다
      expect(r!.ratio, `${t.id}/${spec.region} ratio`).toBeGreaterThan(0);
      expect(r!.ratio).toBeLessThanOrEqual(1);
      // 패럴랙스 띠는 넓고 낮다. 세로가 더 길면 잘못 잘린 것이다
      expect(r!.w).toBeGreaterThan(r!.h);
    }
  }
});

// 원경 → 근경으로 갈수록 크게 보여야 깊이가 읽힌다. 비율이 뒤집히면
// 원경이 근경을 덮어 화면이 뒤에서 앞으로 읽힌다
test("scenery ratios grow from far to near in every theme", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/bg/bg.json", "utf-8"),
  ) as Record<string, { regions: Record<string, { ratio?: number }> }>;
  for (const t of [THEME_SURFACE, THEME_ABYSS]) {
    const regions = manifest[sceneryAtlas(t.id)]!.regions;
    const ratios = SCENERY_LAYERS.map((l) => regions[l.region]!.ratio!);
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `${t.id} ${SCENERY_LAYERS[i]!.region}`).toBeGreaterThan(
        ratios[i - 1]!,
      );
    }
    // 근경도 지면선(0.88)을 넘으면 안 된다 — 넘으면 필드 위로 삐져나온다
    expect(ratios.at(-1)!).toBeLessThan(BG_GROUND_RATIO);
  }
});

test("bg.json declares exactly the atlases the code expects", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/bg/bg.json", "utf-8"),
  ) as Record<string, { url: string; w: number; h: number }>;
  expect(Object.keys(manifest).sort()).toEqual([...BG_ATLASES].sort());
  for (const name of BG_ATLASES) {
    const a = manifest[name]!;
    expect(a.url).toBe(`assets/bg/${name}.png`);
    expect(a.w).toBeGreaterThan(0);
    expect(a.h).toBeGreaterThan(0);
  }
});

// 테마마다 아틀라스가 따로다 — 같은 그림을 tint만 바꿔 쓰면 전환이
// "같은 숲의 색만 바뀐 것"으로 보인다 (실루엣 시절 실제로 그랬다)
test("the two themes never share a scenery atlas", () => {
  expect(sceneryAtlas("surface")).not.toBe(sceneryAtlas("abyss"));
});

// ── 색 보간

test("mixColor returns the endpoints exactly", () => {
  expect(mixColor(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
  expect(mixColor(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
});

test("mixColor interpolates each channel independently", () => {
  expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  expect(mixColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
});

test("mixColor clamps out-of-range t instead of producing garbage", () => {
  expect(mixColor(0x102030, 0xa0b0c0, -5)).toBe(0x102030);
  expect(mixColor(0x102030, 0xa0b0c0, 9)).toBe(0xa0b0c0);
  expect(mixColor(0x102030, 0xa0b0c0, Number.NaN)).toBe(0x102030);
});

test("sky bands run from the top colour to the bottom colour", () => {
  expect(skyBandColor(THEME_SURFACE, 0)).toBe(THEME_SURFACE.skyTop);
  expect(skyBandColor(THEME_SURFACE, SKY_STEPS - 1)).toBe(
    THEME_SURFACE.skyBottom,
  );
});

test("sky band index is clamped to the band count", () => {
  expect(skyBandColor(THEME_ABYSS, -3)).toBe(THEME_ABYSS.skyTop);
  expect(skyBandColor(THEME_ABYSS, 999)).toBe(THEME_ABYSS.skyBottom);
});

test("a single sky band degenerates to the top colour", () => {
  expect(skyBandColor(THEME_SURFACE, 0, 1)).toBe(THEME_SURFACE.skyTop);
});

// ── 테마 크로스페이드

test("theme fade runs 0 to 1 over the shared duration", () => {
  expect(themeFade(0, THEME_FADE_MS)).toBe(0);
  expect(themeFade(THEME_FADE_MS / 2, THEME_FADE_MS)).toBeCloseTo(0.5, 6);
  expect(themeFade(THEME_FADE_MS, THEME_FADE_MS)).toBe(1);
  expect(themeFade(THEME_FADE_MS * 3, THEME_FADE_MS)).toBe(1);
});

// -1은 "전환 중이 아님" 센티넬이다. 0을 돌려주면 배경이 투명해진다
test("the not-fading sentinel reads as fully faded in", () => {
  expect(themeFade(-1, THEME_FADE_MS)).toBe(1);
  expect(themeFade(10, 0)).toBe(1);
});

/**
 * 심연 하늘의 균열이 **하드 픽셀**이다 (2026-08-07).
 *
 * 생성기 첫 판은 `GaussianBlur(1.6)`로 끝났고, 산출물의 보이는 픽셀 중 59%가
 * 알파 128 아래였다(평균 103). 균열은 `blendMode = "add"`로 얹히므로 흐린
 * 알파는 면적이 곧 밝기가 되어 형태가 사라진다 — 하늘에 번진 보라 얼룩이었다.
 * 이건 코드를 읽어서는 안 잡힌다: **산출물 픽셀을 직접 봐야 한다.**
 * (`meleeFx.test.ts`의 "생성된 이펙트 시트가 하드 픽셀이다"와 같은 이유다.)
 */
describe("균열 에셋이 하드 픽셀이다", () => {
  /**
   * PNG의 알파 채널만 읽는다 — 디코더를 붙이지 않는다. 아틀라스는 8bit RGBA,
   * 비인터레이스다(생성기가 PIL로 그렇게 쓴다). 그 전제가 깨지면 여기서 던진다.
   */
  const alphaOf = (path: string, box: { x: number; y: number; w: number; h: number }): number[] => {
    const buf = readFileSync(path);
    let off = 8;
    let w = 0;
    const idat: Buffer[] = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString("ascii", off + 4, off + 8);
      if (type === "IHDR") {
        w = buf.readUInt32BE(off + 8);
        expect(buf[off + 16], "bit depth").toBe(8);
        expect(buf[off + 17], "colour type (6 = RGBA)").toBe(6);
        expect(buf[off + 20], "interlace").toBe(0);
      }
      if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    // PNG 행 필터를 되돌린다 (§9.2). **필터 0을 가정하면 안 된다** — PIL은
    // 행마다 다른 필터를 고르고, 그러면 알파값이 이웃과의 차분으로 읽힌다
    // (처음 그렇게 읽어서 단계가 251가지로 나왔다)
    const bpp = 4;
    const stride = w * bpp;
    const px = Buffer.alloc(stride * (raw.length / (stride + 1)));
    for (let y = 0; y * (stride + 1) < raw.length; y += 1) {
      const ft = raw[y * (stride + 1)]!;
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let i = 0; i < stride; i += 1) {
        const a = i >= bpp ? px[dst + i - bpp]! : 0; // 왼쪽
        const b = y > 0 ? px[dst - stride + i]! : 0; // 위
        const c = y > 0 && i >= bpp ? px[dst - stride + i - bpp]! : 0; // 왼쪽 위
        let add = 0;
        if (ft === 1) add = a;
        else if (ft === 2) add = b;
        else if (ft === 3) add = (a + b) >> 1;
        else if (ft === 4) {
          // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        } else if (ft !== 0) {
          throw new Error(`알 수 없는 PNG 행 필터: ${ft}`);
        }
        px[dst + i] = (raw[src + i]! + add) & 0xff;
      }
    }
    const out: number[] = [];
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) {
        out.push(px[y * stride + x * bpp + 3]!);
      }
    }
    return out;
  };

  const crackAlpha = (): number[] => {
    const manifest = JSON.parse(
      readFileSync("public/assets/bg/bg.json", "utf-8"),
    ) as Record<string, { regions: Record<string, { x: number; y: number; w: number; h: number }> }>;
    const r = manifest["props"]?.regions["crack"];
    expect(r, "props/crack region").toBeDefined();
    return alphaOf("public/assets/bg/props.png", r!);
  };

  it("알파가 단계값뿐이다 — 연속 감쇠는 확대하면 그라디언트로 되살아난다", () => {
    const visible = crackAlpha().filter((a) => a > 0);
    expect(visible.length).toBeGreaterThan(0);
    const steps = [...new Set(visible)].sort((a, b) => a - b);
    // 세 단계(가지·몸통·심). 251가지였던 것이 블러의 흔적이다
    expect(steps.length, steps.join(",")).toBeLessThanOrEqual(4);
    expect(steps.at(-1)).toBe(255);
  });

  /**
   * 가산 합성에서 반투명 픽셀은 **형태가 아니라 번짐**이다. 절반이 넘으면
   * 균열이 아니라 얼룩으로 읽힌다 — 그게 원래 결함이었다(59%).
   */
  it("반투명 픽셀이 과반이 아니다", () => {
    const visible = crackAlpha().filter((a) => a > 0);
    const faint = visible.filter((a) => a < 128).length;
    expect(faint / visible.length).toBeLessThan(0.45);
  });

  it("생성기가 균열에 블러를 쓰지 않는다", () => {
    const src = readFileSync("tools/gen_bg.py", "utf-8");
    // 주석에는 "블러 금지"라고 적혀 있으므로 실제 호출만 본다
    expect(src).not.toMatch(/ImageFilter/);
    expect(src).not.toMatch(/\.filter\(/);
    // 확대는 NEAREST여야 한다 — 보간이면 단계 알파가 다시 이어진다
    expect(src).not.toMatch(/draw_crack[\s\S]*?Image\.(BICUBIC|BILINEAR|LANCZOS)/);
  });
});
