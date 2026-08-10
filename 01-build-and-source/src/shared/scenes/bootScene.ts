import { Assets, Container, Graphics } from "pixi.js";
import type { Scene, SceneCtx } from "../sceneManager";
import { DESIGN_H, DESIGN_W } from "../viewport";
import {
  ACCENT_GOLD,
  TEAM_OURS,
  T_CAPTION,
  UI_OUTLINE,
  UI_TEXT_DIM,
} from "../theme";
import { createUiBackdrop, type UiBackdrop } from "../uiBackdrop";
import { approach, floatOffset } from "../tween";
import { caption, createLogo, sceneText } from "./common";
import {
  BAR_LERP_HALF_LIFE_MS,
  BOOT_STEPS,
  SLOW_AFTER_MS,
  SLOW_NOTICE,
  TIP_AFTER_MS,
  bootProgress,
  monotonic,
  pickTip,
  progressText,
  type BootStepId,
} from "./bootRules";
import { BG_MANIFEST_URL, FX_SHEETS } from "../fxManifest";
import { loadCharManifest, loadCharSheets } from "../spriteChar";
import { loadSfx } from "../audio";
import { HINT_SEEN_KEY } from "../ui/hintRules";
import { ensureFontsReady } from "../fontReady";

import {
  fillPixelCircle,
  fillPixelRect,
  strokePixelRect,
} from "../ui/pixelShape";
// 순수 규칙은 bootRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  BOOT_STEPS,
  BOOT_TIPS,
  bootProgress,
  classifyBootError,
  monotonic,
  pickTip,
  progressText,
} from "./bootRules";

/**
 * S0. 부팅 / 로딩.
 *
 * 설계 문서: specs/2026-07-27-ux/03-scene-boot.md
 *
 * **에셋 로드 실패는 이 씬을 막지 않는다.** 배경·효과음·아이콘이 없어도 대전은
 * 굴러가야 한다(§03-3). 던지는 것은 Pixi 초기화 실패뿐이고, 그건 `main.ts`의
 * 오류 화면(§03-5)이 받는다.
 */

/** 로딩 바 (§03-2: 폭 62%, 높이 22) */
const BAR_W = DESIGN_W * 0.62;
const BAR_H = 22;

export interface BootSceneOpts {
  ctx: SceneCtx;
  /** 로드가 끝나면 부를 다음 단계. 기본 흐름은 S2 매칭이다 (§03-3) */
  onDone(): void;
}

export function createBootScene(opts: BootSceneOpts): Scene {
  const { ctx } = opts;
  const view = new Container();
  view.label = "boot";

  /**
   * ## 공용 필드 무대를 끈다 (2026-08-09)
   *
   * 여태 이 씬은 `setTheme(THEME_ABYSS)`만 하고 공용 배경을 **켜 둔 채**였다
   * (`showBackground`를 아예 부르지 않아 앞 화면의 값이 남았다). 그 무대는
   * 전투용 무한 스크롤 띠라서 정지 화면에 깔면 흐르는 삽화의 타일 이음새,
   * 공중에 뜬 가산합성 균열, 지면의 풀포기가 같이 보인다 — 유저 지시의
   * "로딩화면에 불필요한 이미지 오브젝트들"이 그것이다.
   *
   * 대신 한 장짜리 키 아트를 깐다(`uiBackdrop`). 테마도 세우지 않는다 —
   * 배경이 테마를 안 쓰므로 여기서 만지면 다음 씬이 물려받는 값만 흐트러진다.
   */
  ctx.manager.showBackground(false);

  /**
   * 전면 배경. **기다리지 않는다** — 로딩 화면이 그림 한 장 때문에 늦게 뜨면
   * 그게 가장 나쁜 결과다(이 씬의 존재 이유가 "지금 받고 있다"를 즉시 보여
   * 주는 것이다). 도착하면 맨 뒤에 끼운다.
   */
  let destroyed = false;
  void createUiBackdrop("boot").then((b: UiBackdrop) => {
    if (destroyed) {
      b.destroy();
      return;
    }
    // 인덱스 0 = 위젯 전부 뒤. 붙은 뒤로는 `view`가 소유하므로 따로 안 들고 있는다
    view.addChildAt(b.view, 0);
  });

  const logo = createLogo(0.9);
  logo.position.set(DESIGN_W / 2, DESIGN_H * 0.38);
  view.addChild(logo);

  const barBg = new Graphics();
  const barFill = new Graphics();
  const barGlow = new Graphics();
  const barY = DESIGN_H * 0.62;
  strokePixelRect(
    fillPixelRect(barBg, -BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, BAR_H / 2, {
      color: 0x1a1428,
    }),
    -BAR_W / 2,
    -BAR_H / 2,
    BAR_W,
    BAR_H,
    BAR_H / 2,
    { color: UI_OUTLINE, width: 3, alignment: 1 },
  );
  const bar = new Container();
  bar.addChild(barBg, barFill, barGlow);
  bar.position.set(DESIGN_W / 2, barY);
  view.addChild(bar);

  const status = caption(progressText(null, 0));
  status.position.set(DESIGN_W / 2, DESIGN_H * 0.66);
  view.addChild(status);

  const tip = sceneText("", T_CAPTION, UI_TEXT_DIM, DESIGN_W * 0.8);
  tip.position.set(DESIGN_W / 2, DESIGN_H * 0.84);
  tip.visible = false;
  view.addChild(tip);

  const slow = caption(SLOW_NOTICE);
  slow.position.set(DESIGN_W / 2, DESIGN_H * 0.89);
  slow.visible = false;
  view.addChild(slow);

  /** 첫 방문이면 팁 0번을 고정한다 (§03-3) */
  const firstVisit = ((): boolean => {
    try {
      return localStorage.getItem(HINT_SEEN_KEY) === null;
    } catch {
      // 사파리 프라이빗 모드는 접근 자체가 throw다 — 첫 방문으로 본다
      return true;
    }
  })();

  let elapsedMs = 0;
  let target = 0;
  let shown = 0;
  let lastStep: BootStepId | null = null;
  let finished = false;

  const doneSteps: BootStepId[] = [];
  const mark = (id: BootStepId): void => {
    doneSteps.push(id);
    lastStep = id;
    target = monotonic(target, bootProgress(doneSteps));
  };

  const paintBar = (): void => {
    const w = Math.max(0, BAR_W * shown);
    barFill.clear();
    if (w > 2) {
      fillPixelRect(barFill, -BAR_W / 2, -BAR_H / 2, w, BAR_H, BAR_H / 2, {
        color: TEAM_OURS,
      });
    }
    barGlow.clear();
    // 채움 오른쪽 끝에 금색 발광 — "지금 여기까지 왔다"를 눈으로 잡아준다
    if (w > 6) {
      fillPixelCircle(barGlow, -BAR_W / 2 + w, 0, BAR_H * 0.62, {
        color: ACCENT_GOLD,
        alpha: 0.35,
      });
      fillPixelRect(
        barGlow,
        -BAR_W / 2 + w - 4,
        -BAR_H / 2 + 2,
        4,
        BAR_H - 4,
        2,
        { color: ACCENT_GOLD },
      );
    }
  };
  paintBar();

  /**
   * 로드 단계를 순차로 돈다.
   *
   * 병렬로 던지면 진행률이 계단 하나로 튀고(모든 요청이 거의 동시에 끝난다),
   * 모바일에서 동시 연결 수를 넘겨 오히려 느려진다. 캐릭터 시트는 22장이라
   * 특히 순차여야 한다 — 한꺼번에 던지면 첫 진입이 요청 대기로 채워진다.
   */
  const run = async (): Promise<void> => {
    const tryStep = async (
      id: BootStepId,
      fn: () => Promise<unknown>,
    ): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        // 실패해도 진행한다 — 배경·효과음 없이도 대전은 성립한다 (§03-3)
        console.warn(`[boot] "${id}" 단계 실패, 계속 진행한다`, err);
      }
      mark(id);
    };

    /**
     * 폰트는 `main.ts`가 이 씬을 만들기 **전에** 이미 받았다 — 여기서 받으면
     * 이 씬의 로고·안내 텍스트가 벌써 폴백 폰트로 측정되어 버린다(`fontReady.ts`).
     * 그래도 단계를 남기는 이유는 로딩 바의 진행 단위가 스펙이기 때문이다(§03-2).
     * 이미 끝난 약속을 다시 기다리므로 즉시 통과한다.
     */
    await tryStep("font", ensureFontsReady);
    await tryStep("bg", () => Assets.load(BG_MANIFEST_URL));
    await tryStep("fx", () => Assets.load(FX_SHEETS.impact.url));
    await tryStep("chars", async () => {
      const m = await loadCharManifest();
      // 매니페스트에 있는 것을 다 받는다 — 어느 종족이 몇 층에 나올지는
      // 코어 시드가 정하므로 여기서 고를 수 없다. 22장 합쳐 630KB다
      await loadCharSheets(Object.keys(m.chars));
    });
    await tryStep("warmup", async () => {
      // 첫 프레임 텍스처 업로드 스파이크를 여기서 치른다 (§03-4).
      // 화면 밖에서 한 프레임 렌더하고 버린다
      ctx.app.app.render();
    });
    await tryStep("sfx", () => loadSfx());

    // 바가 100%에 닿는 것을 보여준 뒤 넘어간다 — 99%에서 씬이 바뀌면
    // "다 안 받았는데 시작했다"로 읽힌다
    finished = true;
  };

  return {
    view,
    enter(): void {
      void run();
    },
    exit(): void {},
    update(dtMs: number): void {
      elapsedMs += dtMs;
      logo.y = DESIGN_H * 0.38 + floatOffset(elapsedMs, 4, 3200);
      shown = approach(shown, target, dtMs, BAR_LERP_HALF_LIFE_MS);
      paintBar();
      status.text = progressText(lastStep, shown);
      if (!tip.visible && elapsedMs >= TIP_AFTER_MS) {
        tip.text = pickTip(elapsedMs, firstVisit);
        tip.visible = true;
      }
      if (!slow.visible && elapsedMs >= SLOW_AFTER_MS && !finished) {
        slow.visible = true;
      }
      if (finished && shown > 0.995) {
        finished = false;
        opts.onDone();
      }
    },
    destroy(): void {
      // 붙은 배경은 `view`가 자식으로 들고 있으므로 여기서 따로 지우지 않는다
      // (두 번 지우면 Pixi가 경고를 낸다). 아직 안 붙은 경우는 위 then이
      // 이 깃발을 보고 스스로 지운다 — 안 그러면 씬이 죽은 뒤에 그림이
      // 붙어서 파괴된 컨테이너를 만진다
      destroyed = true;
      view.destroy({ children: true });
    },
  };
}

/** 단계 수·가중을 화면에서도 확인할 수 있게 남긴다 (테스트가 합을 강제한다) */
export const BOOT_STEP_COUNT = BOOT_STEPS.length;
