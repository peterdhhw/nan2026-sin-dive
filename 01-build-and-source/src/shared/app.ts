import { Application, Container } from "pixi.js";
import { DESIGN_H, DESIGN_W } from "./viewport";

export interface GameLayers {
  hud: Container;
  top: Container;
  gauge: Container;
  bottom: Container;
  skillBar: Container;
  /** 이펙트 — 항상 최상단 */
  fx: Container;
}

export interface GameApp {
  app: Application;
  /** 디자인 좌표계(720x1280) 루트. 캔버스 크기에 맞춰 스케일된다. */
  root: Container;
  /**
   * 전투 레이어 6개를 한 덩어리로 묶은 컨테이너.
   *
   * 결과 화면(§08-1)이 뒤 전장의 **채도를 40%로 깎아야** 하는데, 레이어마다
   * 필터를 걸면 필터 패스가 6번 돈다. 루트에 걸면 결과 UI까지 같이 흐려진다 —
   * 그래서 전장만 감싸는 층을 하나 둔다. `layers`의 객체는 그대로다.
   */
  battleRoot: Container;
  layers: GameLayers;
  /** 캔버스 리사이즈 시 호출 — root 스케일을 다시 맞춘다 */
  resize(): void;
  destroy(): void;
}

const LAYER_ORDER: (keyof GameLayers)[] = [
  "top",
  "bottom",
  "gauge",
  "hud",
  "skillBar",
  "fx",
];

export async function createGameApp(mount: HTMLElement): Promise<GameApp> {
  const app = new Application();

  // v8: 생성자가 아니라 init()에서 렌더러가 만들어진다.
  try {
    await app.init({
      width: DESIGN_W,
      height: DESIGN_H,
      backgroundAlpha: 0,
      /**
       * **안티에일리어싱을 끈다.** 도트 룩의 전제다 — 켜 두면 우리가 계단으로
       * 깎아 놓은 모서리마다 반투명 중간색 픽셀이 한 줄 깔려서, 계단이 다시
       * 매끈한 곡선처럼 뭉개진다. 캐릭터는 4배로 띄운 128px 도트이므로
       * UI만 매끄러우면 "UI 해상도가 너무 높다"로 보인다.
       *
       * 대각선은 이제 톱니가 보이는데, 그게 도트 그림의 정상이다.
       */
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
  } catch (err) {
    // v8에 canvas 렌더러는 없다 — webgpu가 마지막 기회다.
    console.warn("[pvp] WebGL init failed, retrying with WebGPU", err);
    await app.init({
      width: DESIGN_W,
      height: DESIGN_H,
      backgroundAlpha: 0,
      resolution: 1,
      preference: "webgpu",
    });
  }

  mount.appendChild(app.canvas);

  const root = new Container();
  app.stage.addChild(root);

  // 전장 레이어를 하나로 묶는다 — 결과 화면이 여기에만 채도 필터를 건다 (§08-1)
  const battleRoot = new Container();
  battleRoot.label = "battle-root";
  root.addChild(battleRoot);

  const layers = {} as GameLayers;
  for (const key of LAYER_ORDER) {
    const c = new Container();
    c.label = key;
    layers[key] = c;
    battleRoot.addChild(c);
  }

  const resize = (): void => {
    const rect = mount.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    app.renderer.resize(w, h);
    // 세로 고정: 항상 폭·높이 중 작은 배율로 맞춰 잘리지 않게 한다
    const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
    root.scale.set(scale);
    root.position.set((w - DESIGN_W * scale) / 2, (h - DESIGN_H * scale) / 2);
  };

  resize();
  window.addEventListener("resize", resize);

  return {
    app,
    root,
    battleRoot,
    layers,
    resize,
    destroy(): void {
      window.removeEventListener("resize", resize);
      app.destroy(true, { children: true });
    },
  };
}
