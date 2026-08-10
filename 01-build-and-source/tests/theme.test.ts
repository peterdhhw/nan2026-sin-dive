import { expect, test } from "vitest";
import {
  DESCENT_FULL_MS,
  DESCENT_SWAP_AT,
  THEME_ABYSS,
  THEME_SURFACE,
  UI_PANEL,
  UI_PANEL_LIT,
  WAVE_THEMES,
  debugDepthFloor,
  descentDepth,
  sameTheme,
  themeAtDepth,
} from "../src/shared/theme";

/**
 * 하강은 **시간**이 정한다 (설계 문서 01-1-3 결정 기록).
 *
 * 예전에는 `themeForWave(n)`이 웨이브 3부터 심연으로 클램프했다. 실측하면
 * 웨이브 1~5가 0.3초 안에 다 녹아서(시드 3·7·42) 배경이 0.2초에 심연으로
 * 바뀌고 남은 80초가 고정이었다 — 이 테스트들이 그 회귀를 막는다.
 */
test("깊이는 0에서 시작해 시간에 따라 오른다", () => {
  expect(descentDepth(0)).toBe(0);
  expect(descentDepth(DESCENT_FULL_MS / 2)).toBeCloseTo(0.5, 10);
  expect(descentDepth(DESCENT_FULL_MS)).toBe(1);
  // 상한을 넘겨도 1을 넘지 않는다 (제한시간 120초 > 하강 90초)
  expect(descentDepth(DESCENT_FULL_MS * 3)).toBe(1);
});

test("깊이는 단조 증가한다 — 되돌아가면 올라가는 것으로 보인다", () => {
  let prev = -1;
  for (let ms = 0; ms <= DESCENT_FULL_MS; ms += 1000) {
    const d = descentDepth(ms);
    expect(d).toBeGreaterThanOrEqual(prev);
    prev = d;
  }
});

// 판이 끝나는 시각(실측 81~84초)에 아직 내려가는 중이어야 한다.
// 여기가 1에 닿아 있으면 마지막 구간이 다시 "고정"이 된다
test("판이 끝날 때까지 계속 내려간다", () => {
  const at81 = descentDepth(81_000);
  const at84 = descentDepth(84_000);
  expect(at81).toBeLessThan(1);
  expect(at84).toBeGreaterThan(at81);
  // 그래도 대부분 내려와 있어야 한다 — 심연을 못 보고 판이 끝나면 안 된다
  expect(at81).toBeGreaterThan(0.8);
});

// 초반 몇 초가 곧 첫인상이다 (§01-0: "첫인상은 확실히 밝다").
// 예전 버그가 여기 있었다 — 0.2초에 이미 심연이었다
test("첫 몇 초는 지상 그림이다", () => {
  for (const ms of [0, 200, 1000, 5000]) {
    expect(themeAtDepth(descentDepth(ms)).id, `${ms}ms`).toBe("surface");
  }
});

test("망가진 시각은 0으로 접는다", () => {
  expect(descentDepth(Number.NaN)).toBe(0);
  expect(descentDepth(-5000)).toBe(0);
  // Infinity는 유한하지 않으므로 0 — 시각이 망가졌으면 안전한 쪽(지상)이다
  expect(descentDepth(Number.POSITIVE_INFINITY)).toBe(0);
});

test("깊이 끝값은 실측 팔레트를 그대로 준다", () => {
  expect(themeAtDepth(0)).toBe(THEME_SURFACE);
  expect(themeAtDepth(1)).toBe(THEME_ABYSS);
  // 망가진 값은 지상으로
  expect(themeAtDepth(Number.NaN)).toBe(THEME_SURFACE);
  expect(themeAtDepth(-1)).toBe(THEME_SURFACE);
  expect(themeAtDepth(9)).toBe(THEME_ABYSS);
});

// 색은 연속, 그림은 단계다 — 삽화가 테마별로 두 벌뿐이기 때문이다
test("삽화는 절반에서 한 번만 갈린다", () => {
  expect(themeAtDepth(DESCENT_SWAP_AT - 0.01).id).toBe("surface");
  expect(themeAtDepth(DESCENT_SWAP_AT).id).toBe("abyss");
  // 아틀라스는 두 개뿐이므로 id도 둘뿐이어야 한다
  const ids = new Set<string>();
  for (let d = 0; d <= 1.0001; d += 0.02) ids.add(themeAtDepth(d).id);
  expect([...ids].sort()).toEqual(["abyss", "surface"]);
});

test("중간 깊이의 하늘색은 두 테마 사이에 있다", () => {
  const mid = themeAtDepth(0.5);
  expect(luminance(mid.skyTop)).toBeLessThan(luminance(THEME_SURFACE.skyTop));
  expect(luminance(mid.skyTop)).toBeGreaterThan(luminance(THEME_ABYSS.skyTop));
});

// 하늘을 매 프레임 다시 칠하면 Graphics를 초당 60번 재빌드한다 —
// 호출자가 같은 색인지 물어볼 수 있어야 한다
test("sameTheme이 같은 깊이를 같다고 말한다", () => {
  expect(sameTheme(themeAtDepth(0.3), themeAtDepth(0.3))).toBe(true);
  expect(sameTheme(themeAtDepth(0.3), themeAtDepth(0.31))).toBe(false);
  // 경계에서는 그림이 갈리므로 반드시 다르다
  expect(
    sameTheme(themeAtDepth(DESCENT_SWAP_AT - 0.001), themeAtDepth(DESCENT_SWAP_AT)),
  ).toBe(false);
});

/**
 * `?wave=3` 디버그 진입은 심연 스크린샷 검증 경로다 (설계 문서 09-3).
 * 하강이 시간축으로 옮겨간 뒤에도 그 파라미터가 살아 있어야 한다.
 */
test("?wave=3 이상은 심연 깊이에서 시작한다", () => {
  expect(themeAtDepth(debugDepthFloor(3)).id).toBe("abyss");
  expect(themeAtDepth(debugDepthFloor(10)).id).toBe("abyss");
  expect(debugDepthFloor(1)).toBe(0);
  expect(debugDepthFloor(2)).toBe(0);
  expect(debugDepthFloor(null)).toBe(0);
  expect(debugDepthFloor(Number.NaN)).toBe(0);
});

// 바닥값에서 시작해도 계속 내려가야 한다 — 디버그 진입이 하강을 멈추면
// 그 진입점으로 본 화면이 실제 플레이와 다르다
test("디버그 바닥값에서 시작해도 하강은 계속된다", () => {
  const floor = debugDepthFloor(3);
  expect(descentDepth(0, floor)).toBe(floor);
  expect(descentDepth(DESCENT_FULL_MS * 0.8, floor)).toBeGreaterThan(floor);
  expect(descentDepth(DESCENT_FULL_MS, floor)).toBe(1);
});

test("only two themes ship (extension is data-only)", () => {
  expect(WAVE_THEMES).toHaveLength(2);
  expect(WAVE_THEMES.map((t) => t.id)).toEqual(["surface", "abyss"]);
});

/**
 * 명도 반전 규칙 (설계 문서 01-1-4): 필드가 어두워지면 UI 패널을 밝힌다.
 * 이게 없으면 후반에 패널과 배경의 명도가 같아져 화면이 진흙탕이 된다.
 */
function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("dark themes use a lighter panel than bright themes", () => {
  expect(THEME_SURFACE.uiPanel).toBe(UI_PANEL);
  expect(THEME_ABYSS.uiPanel).toBe(UI_PANEL_LIT);
  expect(luminance(THEME_ABYSS.uiPanel)).toBeGreaterThan(
    luminance(THEME_SURFACE.uiPanel),
  );
});

test("each theme's panel is separable from its own sky", () => {
  for (const t of WAVE_THEMES) {
    const gap = Math.abs(luminance(t.uiPanel) - luminance(t.skyBottom));
    expect(gap, t.id).toBeGreaterThan(0.08);
  }
});

// 어두운 테마는 아웃라인만으로 형태가 안 잡히므로 안쪽 밝은 림이 필요하다
test("only the dark theme asks for an inner rim", () => {
  expect(THEME_SURFACE.uiInnerRim).toBe(false);
  expect(THEME_ABYSS.uiInnerRim).toBe(true);
});

test("abyss is darker than surface on sky and ground", () => {
  expect(luminance(THEME_ABYSS.skyTop)).toBeLessThan(luminance(THEME_SURFACE.skyTop));
  expect(luminance(THEME_ABYSS.ground)).toBeLessThan(luminance(THEME_SURFACE.ground));
});

// 환경광은 캐릭터가 어두운 배경에 묻히지 않게 하려고 있다 (§1-3). `tint`는
// 곱셈이라 **밝힐 수 없으므로** 환경광 명도가 곧 감광률이다 — 어두운 환경광은
// 자기 목적의 반대로 작동한다.
//
// `luminance > 0.5`로 재고 있었다. 0.69(= 감광 31%)가 그 게이트를 통과했고,
// 배경이 삽화로 밝아지자 캐릭터가 배경보다 어두워졌다(실측 0.16 vs 0.25).
// 상한이 아니라 **하한**이 필요한 자리였다.
test("ambient tints characters without darkening them", () => {
  expect(THEME_SURFACE.ambient).toBe(0xffffff);
  for (const t of WAVE_THEMES) {
    // 감광 8% 이내. 여기를 낮추고 싶으면 그건 환경광이 아니라 연출이다
    expect(luminance(t.ambient), `${t.id} ambient 감광`).toBeGreaterThan(0.9);
  }
  // 그래도 색조는 있어야 한다 — 없으면 두 테마의 캐릭터가 똑같이 보인다
  expect(THEME_ABYSS.ambient).not.toBe(0xffffff);
});

// 실루엣 색 3겹(far/mid/near)을 명도 순으로 검사하던 자리다. 삽화로 갈면서
// 색이 그림 안으로 들어갔고, **그림의 명도 순서는 테마마다 반대다**
// (실측: 지상 원경 0.32 > 근경 0.18 / 심연 원경 0.04 < 근경 0.39).
// 그래서 깊이를 명도로 검사할 수 없다 — `SCENERY_LAYERS[i].alpha`가 하늘색을
// 배어 나오게 해서 만들고, 그 단조성은 backgroundRules.test.ts가 지킨다.
//
// 테마마다 배경 아틀라스가 있는지는 backgroundRules.test.ts에서 본다
// (`bg.json`을 읽어야 하므로 그쪽이 맞다).

test("ground lip is brighter than ground and soil is darker", () => {
  for (const t of WAVE_THEMES) {
    expect(luminance(t.groundLip), t.id).toBeGreaterThan(luminance(t.ground));
    expect(luminance(t.soil), t.id).toBeLessThan(luminance(t.ground));
  }
});
