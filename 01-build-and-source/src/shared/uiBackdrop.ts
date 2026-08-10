import { Assets, Container, Graphics, Sprite } from "pixi.js";
import { loadPixelTexture } from "./pixelTexture";
import { SCRIM_COLOR } from "./theme";
import { DESIGN_H, DESIGN_W } from "./viewport";
import {
  UI_BG_MANIFEST_URL,
  backdropCover,
  footerScrimBands,
  isUsableUiBg,
  type UiBgEntry,
  type UiBgKey,
  type UiBgManifest,
} from "./uiBackdropRules";

/**
 * 로딩(S0)·타이틀(S1)의 전면 배경 한 장.
 *
 * 왜 공용 필드 무대를 안 쓰는지, 왜 매니페스트가 `ui.json`인지는
 * `uiBackdropRules.ts` 머리에 있다.
 *
 * **없어도 화면은 굴러간다.** 배경이 안 오면 씬은 자기 딤/하늘 위에 위젯만
 * 얹는다 — 효과음·필드 배경과 같은 원칙이다(설계 03-3). 로딩 화면이 그림
 * 한 장 때문에 안 뜨는 것이 가장 나쁜 결과다.
 */

export interface UiBackdrop {
  view: Container;
  /**
   * 그림의 지평선 y(디자인 px). 타이틀의 캐릭터가 여기 발을 붙인다.
   *
   * **그림이 없으면 null이다** — 0을 돌려주면 캐릭터가 화면 맨 위에 서고,
   * 그건 "배경이 없다"보다 나쁜 화면이다. 호출자가 자기 기본값으로 간다.
   */
  readonly groundY: number | null;
  destroy(): void;
}

/** 받아 둔 매니페스트. 두 씬(S0·S1)이 같은 파일을 두 번 받지 않는다 */
let cached: UiBgManifest | null | undefined;

async function loadManifest(): Promise<UiBgManifest | null> {
  if (cached !== undefined) return cached;
  try {
    cached = await Assets.load<UiBgManifest>(UI_BG_MANIFEST_URL);
  } catch (err) {
    // 조용히 넘기지 않는다 — 화면이 옛 배경으로 보이는 이유가 로그에 남아야 한다
    console.warn("[bg] ui.json을 못 읽었다 — 전면 배경 없이 간다", err);
    cached = null;
  }
  return cached;
}

/**
 * 매니페스트를 되돌린다. **테스트·디버그 전용이다** — 런타임은 부르지 않는다
 * (한 세션에서 그림이 바뀌는 일이 없다).
 */
export function resetUiBackdropCache(): void {
  cached = undefined;
}

/**
 * 화면 하나의 배경. 실패하면 `groundY`가 null인 빈 컨테이너를 돌려준다.
 *
 * 크기를 인자로 받지 않는다 — 이 두 화면은 디자인 해상도 전체를 덮는다
 * (전투 씬처럼 필드가 쪼개지지 않는다). 실제 화면비 대응은 상위
 * `GameApp`의 스케일이 한다.
 */
export async function createUiBackdrop(key: UiBgKey): Promise<UiBackdrop> {
  const view = new Container();
  view.label = `ui-backdrop-${key}`;

  const manifest = await loadManifest();
  const entry: unknown = manifest?.[key];
  if (!isUsableUiBg(entry)) {
    if (manifest !== null) {
      console.warn(`[bg] ui.json에 쓸 만한 "${key}" 항목이 없다`);
    }
    return {
      view,
      groundY: null,
      destroy(): void {
        view.destroy({ children: true });
      },
    };
  }
  const e: UiBgEntry = entry;

  let groundY: number | null = null;
  try {
    const tex = await loadPixelTexture(e.url);
    const sp = new Sprite(tex);
    // 배율은 **매니페스트의 w/h**에서 나온다. 텍스처의 실측을 쓰지 않는 이유:
    // 로드 실패로 1×1 흰 텍스처가 오는 경우에 배율이 폭발한다
    const k = backdropCover(e.w, e.h, DESIGN_W, DESIGN_H);
    sp.anchor.set(0.5);
    sp.scale.set(k);
    sp.position.set(DESIGN_W / 2, DESIGN_H / 2);
    view.addChild(sp);
    /**
     * 바닥 스크림. **그림의 아래쪽이 가장 밝다** — 두 그림 다 거기가 협곡
     * 바닥이라 30~70% 띠의 두 배 명도인데, 로딩의 팁(84%)·느린 안내(89%)와
     * 타이틀의 요약(93%)이 하필 그 위에 앉는다(캡처에서 팁이 자갈에 먹혔다).
     *
     * 전체 딤을 올려서 해결하지 않는다 — 그러면 그림 전체가 지워져 배경을
     * 새로 뽑은 의미가 없어진다. 글자가 있는 바닥만, 위로 갈수록 옅어지는
     * 층으로 덮는다(경계가 선으로 남지 않게 — 근거는 `footerScrimBands`).
     */
    const scrim = new Graphics();
    for (const b of footerScrimBands(DESIGN_H)) {
      scrim.rect(0, b.y, DESIGN_W, b.h).fill({ color: SCRIM_COLOR, alpha: b.alpha });
    }
    view.addChild(scrim);
    // 지평선도 같은 배율·같은 중앙 정렬을 지나야 화면 좌표가 된다 —
    // `groundRatio * DESIGN_H`로 두면 잘려 나간 만큼이 빠져 캐릭터가 뜬다
    const drawnH = e.h * k;
    groundY = DESIGN_H / 2 - drawnH / 2 + drawnH * e.groundRatio;
  } catch (err) {
    console.warn(`[bg] ${e.url}을 못 읽었다 — 전면 배경 없이 간다`, err);
  }

  return {
    view,
    get groundY(): number | null {
      return groundY;
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
