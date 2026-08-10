import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import {
  BG_ATLASES,
  BG_MANIFEST_URL,
  type BgAtlas,
  type BgAtlasName,
} from "./fxManifest";
import { loadPixelTexture } from "./pixelTexture";
import {
  CELESTIALS_PER_FIELD,
  CELESTIAL_PARALLAX,
  SCENERY_LAYERS,
  SCROLL_IDLE_PX_S,
  SKY_STEPS,
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
} from "./backgroundRules";
import { THEME_FADE_MS, THEME_SURFACE, type WaveTheme } from "./theme";
import type { SplitRect } from "./viewport";

// 순수 규칙은 backgroundRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  BG_GROUND_RATIO,
  fieldDetailLevel,
  groundY,
  visibleSceneryLayers,
} from "./backgroundRules";

/**
 * 필드 배경 — 하늘·천체·삽화 3겹·지면·장식.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §2
 *
 * 상/하 필드가 각각 하나씩 가진다. **필드 높이가 매 프레임 바뀌므로**
 * (게이지가 화면비를 움직인다) 배치는 `setRect()`에서 전부 다시 계산한다.
 */
export interface BackgroundStage {
  view: Container;
  setRect(rect: SplitRect): void;
  /**
   * 테마 교체. 기본은 600ms 크로스페이드다.
   * @param immediate 첫 배치·디버그 진입처럼 "처음부터 그 테마였다"로 만들 때
   */
  setTheme(theme: WaveTheme, opts?: { immediate?: boolean }): void;
  /** 배치 시드 — 웨이브마다 그림이 바뀐다 */
  setSeed(seed: number): void;
  /** 스크롤 속도(px/s, 패럴랙스 1.0 기준). 웨이브 전진 연출이 올린다 */
  setScrollSpeed(pxPerSec: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

/**
 * 아틀라스 하나 = 텍스처 1장 + region별 잘린 텍스처.
 *
 * `ratio`는 삽화 region만 갖는다(표시 높이 ÷ 필드 높이). 생성기가 `bg.json`에
 * 써 둔 값을 그대로 들고 다닌다 — TS에 복사하면 두 벌이 갈라진다.
 */
interface Region {
  readonly tex: Texture;
  readonly ratio?: number;
}
type RegionMap = Map<string, Region>;

/**
 * 프롭·천체 타일 폭 (디자인 좌표). 필드 폭(720)보다 넓게 잡아 두 장으로
 * 이어 붙인다 — 같으면 스크롤 이음새가 화면 정중앙에 자주 걸린다.
 *
 * **삽화는 이 값을 쓰지 않는다.** 종횡비를 지켜야 그림이 안 늘어나므로
 * 폭을 `sceneryTileW()`로 유도한다 (레이어마다 다르다).
 */
const TILE_W = 900;

async function loadAtlases(): Promise<Map<BgAtlasName, RegionMap>> {
  const out = new Map<BgAtlasName, RegionMap>();
  let manifest: Record<string, BgAtlas>;
  try {
    manifest = await Assets.load<Record<string, BgAtlas>>(BG_MANIFEST_URL);
  } catch (err) {
    // 배경이 없어도 대전은 굴러가야 한다 (효과음과 같은 원칙, 설계 문서 03-3)
    console.warn("[pvp] 배경 아틀라스 매니페스트를 못 읽었다", err);
    return out;
  }
  for (const name of BG_ATLASES) {
    const atlas = manifest[name];
    if (!atlas) {
      console.warn(`[pvp] bg.json에 "${name}" 아틀라스가 없다`);
      continue;
    }
    try {
      const base = await loadPixelTexture(atlas.url);
      const regions: RegionMap = new Map();
      for (const [key, r] of Object.entries(atlas.regions)) {
        regions.set(key, {
          tex: new Texture({
            source: base.source,
            frame: new Rectangle(r.x, r.y, r.w, r.h),
          }),
          ratio: r.ratio,
        });
      }
      out.set(name, regions);
    } catch (err) {
      console.warn(`[pvp] 배경 아틀라스 "${name}" 로드 실패`, err);
    }
  }
  return out;
}

/**
 * 프롭·천체 region을 아틀라스 구분 없이 찾는다 — 이름이 전역에서 유일하다
 * (`tuft_a`, `crack` …). 삽화는 **쓸 수 없다**: `far`/`mid`/`near`가 테마마다
 * 있어서 먼저 걸린 아틀라스가 이긴다(지상 하늘에 심연 절벽이 뜬다).
 * 삽화는 `sceneryRegion()`으로 아틀라스를 지정해 찾는다.
 */
function findRegion(
  atlases: Map<BgAtlasName, RegionMap>,
  key: string,
): Texture | null {
  for (const [name, regions] of atlases) {
    if (name.startsWith("scenery_")) continue;
    const r = regions.get(key);
    if (r) return r.tex;
  }
  return null;
}

/** 테마 삽화의 한 겹. 아틀라스를 명시하므로 테마가 섞이지 않는다 */
function sceneryRegion(
  atlases: Map<BgAtlasName, RegionMap>,
  themeId: WaveTheme["id"],
  key: string,
): Region | null {
  return atlases.get(sceneryAtlas(themeId))?.get(key) ?? null;
}

export async function createBackgroundStage(opts: {
  rect: SplitRect;
  /**
   * 좌우를 뒤집어 그린다 (상대 팀 필드). `battleField`의 `mirrorX`와 같은 의미다.
   *
   * **지면은 양 필드 모두 아래에 있다** — 예전에는 여기서 상하를 뒤집어
   * 상대 팀의 하늘을 화면 아래로 보냈는데, 그러면 캐릭터가 거울에 비친 것처럼
   * 매달려 보인다. 지금은 좌우만 뒤집어 상대 팀이 오른쪽에서 왼쪽으로
   * 나아가게 한다 — 삽화가 흐르는 방향도 같이 뒤집혀야 전진으로 읽힌다.
   */
  mirrorX?: boolean;
  theme?: WaveTheme;
  seed?: number;
}): Promise<BackgroundStage> {
  const view = new Container();
  const mirrorX = opts.mirrorX === true;
  let rect = opts.rect;
  let seed = opts.seed ?? 1;
  let theme = opts.theme ?? THEME_SURFACE;
  /** 크로스페이드 중인 이전 테마. null이면 전환 중이 아니다 */
  let prevTheme: WaveTheme | null = null;
  let fadeMs = -1;
  let scrollSpeed = SCROLL_IDLE_PX_S;

  const atlases = await loadAtlases();

  // 반전은 이 컨테이너 하나가 담당한다 — 안쪽 배치 코드는 상/하 필드가 같다.
  // scale.x = -1 + position.x = rect.w 이므로 로컬 x가 rect.w - x로 뒤집힌다.
  const world = new Container();
  view.addChild(world);

  const sky = new Graphics();
  world.addChild(sky);
  const celestialLayer = new Container();
  world.addChild(celestialLayer);
  /** 삽화 3겹 — 각 레이어가 같은 그림을 이어 붙인 띠를 들고 좌우로 흐른다 */
  const sceneryLayers = SCENERY_LAYERS.map(() => new Container());
  for (const c of sceneryLayers) world.addChild(c);
  const ground = new Graphics();
  world.addChild(ground);
  const propLayer = new Container();
  world.addChild(propLayer);

  /** 레이어별 스크롤 오프셋 (타일 폭 안으로 접힌 값) */
  const offsets = SCENERY_LAYERS.map(() => 0);
  /**
   * 레이어별 타일 폭. 랩어라운드 주기이므로 `buildScenery`가 정한 값을
   * `update`가 그대로 써야 한다 — 두 곳에서 따로 계산하면 필드 높이가 바뀌는
   * 순간 접는 주기와 실제 타일 폭이 어긋나 띠가 튄다.
   */
  const tileWs = SCENERY_LAYERS.map(() => 0);
  let celestialOffset = 0;

  /** 하늘·지면 색은 크로스페이드 중에는 보간값을 쓴다 */
  const blend = (pick: (t: WaveTheme) => number): number => {
    if (prevTheme === null) return pick(theme);
    return mixColor(
      pick(prevTheme),
      pick(theme),
      themeFade(fadeMs, THEME_FADE_MS),
    );
  };

  const paintSky = (): void => {
    sky.clear();
    const bandH = rect.h / SKY_STEPS;
    const from = blend((t) => t.skyTop);
    const to = blend((t) => t.skyBottom);
    for (let i = 0; i < SKY_STEPS; i++) {
      // 띠를 0.5px 겹쳐 그린다 — 딱 맞추면 반올림 때문에 실선 틈이 보인다
      sky
        .rect(0, i * bandH, rect.w, bandH + 0.5)
        .fill({ color: skyBandColor({ skyTop: from, skyBottom: to }, i) });
    }
  };

  const paintGround = (): void => {
    const gy = groundY(rect.h);
    ground.clear();
    ground
      .rect(0, gy, rect.w, rect.h - gy)
      .fill({ color: blend((t) => t.soil) });
    // 지면 밴드는 흙 위에 얹힌 얇은 층 — 아래로 갈수록 흙이 드러난다
    ground
      .rect(0, gy, rect.w, Math.max(6, (rect.h - gy) * 0.45))
      .fill({ color: blend((t) => t.ground) });
    // 상단 립 2px — 지면의 "윗면"을 만든다. 없으면 흙이 벽처럼 보인다
    ground.rect(0, gy, rect.w, 2).fill({ color: blend((t) => t.groundLip) });
  };

  /** 스프라이트 하나를 만들어 컨테이너에 넣는다 */
  const put = (parent: Container, key: string, tint: number): Sprite | null => {
    const tex = findRegion(atlases, key);
    if (!tex) return null;
    const s = new Sprite(tex);
    s.tint = tint;
    parent.addChild(s);
    return s;
  };

  /**
   * 삽화 3겹을 다시 깐다. 필드 높이·테마가 바뀔 때만 부른다.
   *
   * 한 겹 = 같은 그림을 좌우로 이어 붙인 띠다. 생성기가 좌우 이음새를
   * 섞어(`_wrap_seam`) 놓았으므로 경계가 안 보인다.
   *
   * 시드를 쓰지 않는다 — 그림이 한 장뿐이니 배치에 무작위성이 없다. 웨이브마다
   * 배경이 달라지는 것은 이제 테마가 담당한다.
   */
  const buildScenery = (): void => {
    const gy = groundY(rect.h);
    const visible = new Set(visibleSceneryLayers(rect.h));
    sceneryLayers.forEach((layer, li) => {
      layer.removeChildren().forEach((c) => c.destroy());
      const spec = SCENERY_LAYERS[li]!;
      layer.visible = visible.has(li);
      tileWs[li] = 0;
      if (!layer.visible) return;
      layer.alpha = spec.alpha;
      const region = sceneryRegion(atlases, theme.id, spec.region);
      if (!region) return;
      const tex = region.tex;
      // 표시 높이는 아틀라스가 들고 있는 비율에서 온다. 필드가 235px로 줄면
      // 삽화도 같이 줄어 지면 위 전투 공간을 침범하지 않는다.
      const h = rect.h * (region.ratio ?? 0.42);
      const tileW = sceneryTileW(tex.width, tex.height, h);
      if (!(tileW > 0)) return;
      tileWs[li] = tileW;
      // 필드 폭을 덮을 만큼 깐다 — 타일이 종횡비에서 나오므로 720보다 좁을 수 있다
      const count = sceneryTileCount(rect.w, tileW);
      for (let tile = 0; tile < count; tile++) {
        const s = new Sprite(tex);
        layer.addChild(s);
        const k = h / tex.height;
        s.scale.set(k);
        s.anchor.set(0, 1);
        s.x = tile * tileW;
        s.y = gy + rect.h * spec.sink;
      }
    });
  };

  const buildCelestials = (): void => {
    celestialLayer.removeChildren().forEach((c) => c.destroy());
    // 크로스페이드가 낮춰 둔 알파를 되돌린다 (setTheme이 build 뒤에 다시 0으로 내린다)
    celestialLayer.alpha = 1;
    const gy = groundY(rect.h);
    for (let tile = 0; tile < 2; tile++) {
      for (const p of celestialPlacements(
        theme.id,
        seed,
        CELESTIALS_PER_FIELD,
      )) {
        const s = put(celestialLayer, p.region, theme.prop);
        if (!s) continue;
        const h = rect.h * 0.2 * p.scale;
        const k = h / s.texture.height;
        s.scale.set(k);
        s.anchor.set(0.5);
        s.alpha = p.alpha;
        // 심연의 균열은 빛이다 — 가산 합성이어야 발광으로 읽힌다.
        // (Pixi v8에서 blendMode는 컨테이너가 아니라 leaf에 걸어야 전달된다)
        if (p.region === "crack") s.blendMode = "add";
        s.x = tile * TILE_W + p.xr * TILE_W;
        s.y = gy * p.yr;
      }
    }
  };

  const buildProps = (): void => {
    propLayer.removeChildren().forEach((c) => c.destroy());
    propLayer.alpha = 1;
    const gy = groundY(rect.h);
    for (const p of propPlacements(theme.id, seed)) {
      const s = put(propLayer, p.region, theme.prop);
      if (!s) continue;
      const h = rect.h * 0.055 * p.scale;
      const k = h / s.texture.height;
      s.scale.set(p.flip ? -k : k, k);
      s.anchor.set(0.5, 1);
      s.x = p.xr * rect.w;
      // 지면 립 바로 위에 발을 붙인다 (+2 = 립 두께)
      s.y = gy + 2;
    }
  };

  /** 스크롤 오프셋을 스프라이트 위치에 반영한다 */
  const applyScroll = (): void => {
    sceneryLayers.forEach((layer, li) => {
      // 왼쪽으로 흐른다 — 캐릭터가 오른쪽을 향하므로 전진처럼 읽힌다
      layer.x = -offsets[li]!;
    });
    celestialLayer.x = -celestialOffset;
  };

  const layout = (): void => {
    view.position.set(rect.x, rect.y);
    world.position.set(mirrorX ? rect.w : 0, 0);
    world.scale.set(mirrorX ? -1 : 1, 1);
    paintSky();
    paintGround();
    buildScenery();
    buildCelestials();
    buildProps();
    applyScroll();
  };

  layout();

  /** 필드 높이가 이 값 이상 바뀌면 실루엣을 다시 만든다 */
  const REBUILD_EPS = 1;
  let builtH = rect.h;
  let builtLevel = fieldDetailLevel(rect.h);

  return {
    view,
    setRect(next: SplitRect): void {
      rect = next;
      view.position.set(rect.x, rect.y);
      // 폭이 바뀌면 반전 축도 옮겨야 한다 (반전 컨테이너는 x = rect.w를 축으로 접힌다)
      world.position.set(mirrorX ? rect.w : 0, 0);
      paintSky();
      paintGround();
      // 실루엣·프롭은 스프라이트를 파괴/재생성하므로 매 프레임 못 한다.
      // 게이지가 움직이는 동안 높이는 매 프레임 조금씩 바뀌는데(lerp) 그때마다
      // 10~20개를 지웠다 만들면 GC가 프레임을 먹는다. 1px 임계로 묶는다.
      const level = fieldDetailLevel(rect.h);
      if (Math.abs(rect.h - builtH) >= REBUILD_EPS || level !== builtLevel) {
        builtH = rect.h;
        builtLevel = level;
        buildScenery();
        buildCelestials();
        buildProps();
        applyScroll();
      }
    },
    setTheme(next: WaveTheme, o?: { immediate?: boolean }): void {
      /**
       * **삽화가 같으면 색만 갈아 끼운다.** 하강이 연속이 되면서(§01-1-3)
       * `id`는 같고 하늘·지면 색만 조금 다른 호출이 계속 온다 — 예전처럼
       * `id`가 같다고 되돌아가면 배경이 두 장으로 고정된다.
       *
       * 크로스페이드를 걸지 않는 이유: 이미 매 프레임 조금씩 움직이는 값이라
       * 여기에 600ms 보간을 얹으면 목표가 계속 달아나 색이 항상 뒤처진다.
       */
      if (next.id === theme.id) {
        theme = next;
        // 전환 중이면 그쪽이 알파를 쥐고 있다 — 하늘색만 지금 값으로 맞춘다
        paintSky();
        paintGround();
        return;
      }
      if (o?.immediate === true) {
        theme = next;
        prevTheme = null;
        fadeMs = -1;
        layout();
        return;
      }
      // 크로스페이드: 하늘·지면은 색 보간(저렴), 실루엣은 즉시 교체 후
      // 레이어 알파를 0→목표로 올린다. 두 테마의 실루엣을 동시에 들면
      // 드로우콜이 두 배가 되는데, 600ms 동안 그 값을 쓸 이유가 없다
      prevTheme = theme;
      theme = next;
      fadeMs = 0;
      buildScenery();
      buildCelestials();
      buildProps();
      applyScroll();
      // 실루엣**만** 페이드하면 안 된다: 천체·프롭은 즉시 바뀌므로 민트 하늘 위에
      // 심연의 보라색 균열이 떠 있는 프레임이 나온다 (스크린샷으로 확인).
      // 전경 세 층을 같이 0에서 올린다
      for (const l of sceneryLayers) l.alpha = 0;
      celestialLayer.alpha = 0;
      propLayer.alpha = 0;
    },
    setSeed(next: number): void {
      if (next === seed) return;
      seed = next;
      buildScenery();
      buildCelestials();
      buildProps();
      applyScroll();
    },
    setScrollSpeed(pxPerSec: number): void {
      scrollSpeed = Number.isFinite(pxPerSec) ? pxPerSec : SCROLL_IDLE_PX_S;
    },
    update(dtMs: number): void {
      SCENERY_LAYERS.forEach((spec, li) => {
        // 접는 주기는 그 레이어의 실제 타일 폭이다 (레이어마다 다르다).
        // `buildScenery`가 아직 못 깐 레이어는 0이라 스크롤도 무의미하다
        offsets[li] = advanceScroll(
          offsets[li]!,
          scrollSpeed,
          spec.parallax,
          dtMs,
          tileWs[li]!,
        );
      });
      celestialOffset = advanceScroll(
        celestialOffset,
        scrollSpeed,
        CELESTIAL_PARALLAX,
        dtMs,
        TILE_W,
      );
      applyScroll();

      if (fadeMs >= 0) {
        fadeMs += dtMs;
        const k = themeFade(fadeMs, THEME_FADE_MS);
        sceneryLayers.forEach((l, li) => {
          l.alpha = SCENERY_LAYERS[li]!.alpha * k;
        });
        celestialLayer.alpha = k;
        propLayer.alpha = k;
        paintSky();
        paintGround();
        if (k >= 1) {
          fadeMs = -1;
          prevTheme = null;
        }
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
