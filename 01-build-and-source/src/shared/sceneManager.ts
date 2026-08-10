import { Container, Graphics, Ticker } from "pixi.js";
import type { GameApp } from "./app";
import { createBackgroundStage, type BackgroundStage } from "./background";
import { DESIGN_H, DESIGN_W } from "./viewport";
import {
  SCENE_FADE_IN_MS,
  SCENE_FADE_OUT_MS,
  veilAlpha,
  type SceneName,
} from "./sceneRules";
import { THEME_SURFACE, type WaveTheme } from "./theme";
import type { DebugEntry } from "./debugEntry";

// 순수 규칙은 sceneRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  SCENE_FADE_IN_MS,
  SCENE_FADE_OUT_MS,
  SCENE_NAMES,
  parseSceneName,
  veilAlpha,
  type SceneName,
} from "./sceneRules";

/**
 * 씬과 씬 관리자.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C11
 *
 * **`location.reload()`를 없애기 위한 구조다.** 리로드로 다음 판을 시작하면
 * Spine·아틀라스를 다시 받고 흰 화면이 번쩍인다(§08-5). 씬을 갈아치우면
 * 재대전이 매칭 5초 + VS 1.6초 안에 시작된다.
 */

export interface Scene {
  readonly view: Container;
  /** 진입 애니메이션 시작. await하면 관리자가 그만큼 기다린다 */
  enter(): Promise<void> | void;
  /** 퇴장 애니메이션 완료까지 대기 */
  exit(): Promise<void> | void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 씬을 만드는 함수. 관리자가 이전 씬을 치운 **뒤**에 부른다 */
export type SceneFactory = () => Scene | Promise<Scene>;

export interface SceneManager {
  /** 이전 씬 exit → destroy → 다음 enter. 전환 중 입력은 막힌다 */
  goto(next: SceneFactory): Promise<void>;
  update(dtMs: number): void;
  /** 씬보다 오래 사는 공용 배경 (§C11) */
  readonly background: BackgroundStage;
  /** 배경 테마 — 씬 사이에 유지된다 (§08-6) */
  setTheme(theme: WaveTheme, opts?: { immediate?: boolean }): void;
  readonly theme: WaveTheme;
  /**
   * 공용 배경을 끈다. 전투 씬은 상/하 필드가 각자 배경을 그리므로
   * 이 전면 배경이 완전히 가려진다 — 켜 두면 드로우콜만 버린다 (§07-10 예산).
   */
  showBackground(visible: boolean): void;
  /** 지금 화면에 있는 씬 이름 (로그·디버그용) */
  readonly current: SceneName | null;
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface SceneManagerOpts {
  app: GameApp;
  debug: DebugEntry;
}

/**
 * 씬 컨텍스트 — 씬이 관리자·앱에 닿는 유일한 통로.
 *
 * 씬이 `SceneManager`를 직접 들고 있으면 순환 참조(관리자가 씬을 만들고 씬이
 * 관리자를 부른다)가 타입에서도 생긴다. 필요한 것만 좁혀서 넘긴다.
 */
export interface SceneCtx {
  app: GameApp;
  debug: DebugEntry;
  manager: SceneManager;
}

export async function createSceneManager(
  opts: SceneManagerOpts,
): Promise<SceneManager> {
  const { app } = opts;

  /**
   * 공용 배경. 씬 컨테이너보다 **뒤**에 깔린다.
   *
   * 전투 씬(S4)은 상/하 필드가 각자 배경을 갖는다(반전·높이가 다르다) —
   * 그 배경들이 이 전면 배경을 덮는다. 그래도 여기 하나를 두는 이유는
   * 전환 사이에 배경이 사라지지 않게 하는 것이다(§C11).
   */
  const bgRoot = new Container();
  const background = await createBackgroundStage({
    rect: { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H },
    theme: THEME_SURFACE,
    seed: 1,
  });
  bgRoot.addChild(background.view);
  // 인덱스 0 = 모든 레이어 뒤
  app.root.addChildAt(bgRoot, 0);

  /** 씬 뷰가 들어가는 컨테이너 — 전투 레이어들 위에 얹힌다 */
  const sceneRoot = new Container();
  app.root.addChild(sceneRoot);

  /** 전환 막. 항상 최상단 */
  const veil = new Container();
  const veilG = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x000000 });
  veil.addChild(veilG);
  veil.alpha = 0;
  veil.visible = false;
  // 전환 중에는 탭을 삼킨다 — 씬이 바뀌는 도중의 오조작은 되돌릴 수 없다 (§C11)
  veil.eventMode = "static";
  veil.hitArea = {
    contains: (x, y) => x >= 0 && y >= 0 && x <= DESIGN_W && y <= DESIGN_H,
  };
  app.root.addChild(veil);

  let scene: Scene | null = null;
  let currentName: SceneName | null = null;
  let theme: WaveTheme = THEME_SURFACE;
  /** 전환 중 goto가 또 불리면 앞의 것이 끝난 뒤에 돈다 */
  let chain: Promise<void> = Promise.resolve();
  let running = false;

  const onTick = (ticker: Ticker): void => {
    manager.update(ticker.deltaMS);
  };

  /** 막을 durationMs 동안 페이드. 완료까지 await한다 */
  const fade = (dir: "out" | "in", durationMs: number): Promise<void> =>
    new Promise<void>((resolve) => {
      let elapsed = 0;
      veil.visible = true;
      veil.alpha = veilAlpha(0, durationMs, dir);
      const step = (ticker: Ticker): void => {
        elapsed += ticker.deltaMS;
        veil.alpha = veilAlpha(elapsed, durationMs, dir);
        if (elapsed < durationMs) return;
        Ticker.shared.remove(step);
        if (dir === "in") veil.visible = false;
        resolve();
      };
      Ticker.shared.add(step);
    });

  const manager: SceneManager = {
    background,
    get theme(): WaveTheme {
      return theme;
    },
    get current(): SceneName | null {
      return currentName;
    },
    setTheme(next: WaveTheme, o?: { immediate?: boolean }): void {
      theme = next;
      background.setTheme(next, o);
    },
    showBackground(visible: boolean): void {
      bgRoot.visible = visible;
    },
    goto(next: SceneFactory): Promise<void> {
      // 직렬화한다 — 두 전환이 겹치면 씬 두 개가 동시에 살아 있게 된다
      chain = chain.then(async () => {
        await fade("out", scene === null ? 0 : SCENE_FADE_OUT_MS);
        if (scene !== null) {
          await scene.exit();
          scene.view.parent?.removeChild(scene.view);
          scene.destroy();
          scene = null;
        }
        const built = await next();
        scene = built;
        currentName = built.view.label as SceneName | null;
        sceneRoot.addChild(built.view);
        // enter는 막이 걷히는 것과 **같이** 시작한다. 기다린 뒤에 걷으면
        // 검은 화면에서 진입 애니메이션이 이미 끝나 있다
        const entered = built.enter();
        await fade("in", SCENE_FADE_IN_MS);
        await entered;
      });
      return chain;
    },
    update(dtMs: number): void {
      background.update(dtMs);
      scene?.update(dtMs);
    },
    start(): void {
      if (running) return;
      running = true;
      Ticker.shared.add(onTick);
    },
    stop(): void {
      if (!running) return;
      running = false;
      Ticker.shared.remove(onTick);
    },
    destroy(): void {
      manager.stop();
      scene?.destroy();
      scene = null;
      background.destroy();
      bgRoot.destroy({ children: true });
      sceneRoot.destroy({ children: true });
      veil.destroy({ children: true });
    },
  };

  return manager;
}
