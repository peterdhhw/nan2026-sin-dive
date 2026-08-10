import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 폰트 문(gate)의 계약.
 *
 * 회귀 대상은 **순서**다 — 웹폰트가 도착하기 전에 `Text`를 만들면 Pixi가 폴백
 * 폰트의 어센트를 Galmuri 키로 캐시해서 모든 글자의 첫 픽셀 행이 잘렸다
 * (`우리 팀` → `누리 팀`). 실측 수치는 `src/shared/fontReady.ts` 주석에 있다.
 *
 * 여기서 못박는 것은 화면이 아니라 그 문의 성질이다: 굵기 두 개를 다 받는가,
 * 여러 번 불러도 한 번만 받는가, 실패해도 던지지 않는가, 그리고 낡은 메트릭
 * 캐시를 비우는가. 잘림 자체는 헤드리스 캡처로 확인한다(맨 캔버스 대조 포함).
 */

const clearMetrics = vi.fn();
vi.mock("pixi.js", () => ({
  CanvasTextMetrics: {
    get clearMetrics() {
      return clearMetrics;
    },
  },
}));

/** 매 테스트마다 모듈을 새로 읽는다 — `ensureFontsReady`가 약속을 기억한다 */
async function freshModule(): Promise<{
  ensureFontsReady: () => Promise<void>;
}> {
  vi.resetModules();
  return import("../src/shared/fontReady");
}

interface FakeFontSet {
  load: ReturnType<typeof vi.fn>;
  ready: Promise<void>;
}

function stubFonts(fonts: FakeFontSet | undefined): void {
  vi.stubGlobal("document", { fonts });
}

const okFonts = (): FakeFontSet => ({
  load: vi.fn().mockResolvedValue([]),
  ready: Promise.resolve(),
});

describe("ensureFontsReady", () => {
  beforeEach(() => {
    clearMetrics.mockClear();
    vi.unstubAllGlobals();
  });

  it("400과 700을 다 받는다 — Bold가 별도 파일이다", async () => {
    // 400만 받으면 700을 쓰는 텍스트(라벨·버튼 대부분)가 폴백으로 측정된다
    const fonts = okFonts();
    stubFonts(fonts);
    const { ensureFontsReady } = await freshModule();
    await ensureFontsReady();

    const specs = fonts.load.mock.calls.map((args) => String(args[0]));
    expect(specs.map((s) => s.split(" ")[0])).toEqual(["400", "700"]);
    for (const spec of specs) expect(spec).toContain('"Galmuri11"');
  });

  it("낡은 메트릭 캐시를 비운다", async () => {
    stubFonts(okFonts());
    const { ensureFontsReady } = await freshModule();
    await ensureFontsReady();
    expect(clearMetrics).toHaveBeenCalledTimes(1);
  });

  it("여러 번 불러도 한 번만 받는다 — 부팅 씬이 같은 문을 다시 기다린다", async () => {
    const fonts = okFonts();
    stubFonts(fonts);
    const { ensureFontsReady } = await freshModule();
    await Promise.all([
      ensureFontsReady(),
      ensureFontsReady(),
      ensureFontsReady(),
    ]);
    await ensureFontsReady();
    expect(fonts.load).toHaveBeenCalledTimes(2); // 굵기 2개, 재요청 없음
  });

  it("로드가 실패해도 던지지 않는다 — 폰트 없이도 대전은 성립한다 (§03-3)", async () => {
    const fonts: FakeFontSet = {
      load: vi.fn().mockRejectedValue(new Error("offline")),
      ready: Promise.resolve(),
    };
    stubFonts(fonts);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ensureFontsReady } = await freshModule();
    await expect(ensureFontsReady()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("document.fonts가 없는 환경도 통과한다", async () => {
    // 구형 웹뷰에는 FontFaceSet이 없다. 여기서 던지면 부팅 전체가 죽는다
    stubFonts(undefined);
    const { ensureFontsReady } = await freshModule();
    await expect(ensureFontsReady()).resolves.toBeUndefined();
  });
});
