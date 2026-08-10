import { Assets, Rectangle, Texture } from "pixi.js";
import { ICON_ATLAS, ICON_MANIFEST_URL, type BgAtlas } from "../fxManifest";
import { loadPixelTexture } from "../pixelTexture";

/**
 * 스킬 아이콘 아틀라스 로더.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C4
 *
 * **한 번만 읽고 캐시한다.** 슬롯 4개가 각자 `Assets.load`를 부르면 같은 JSON을
 * 네 번 파싱한다(Pixi가 텍스처는 캐시하지만 우리 region 슬라이싱은 안 한다).
 *
 * 실패해도 던지지 않는다 — 아이콘이 없으면 색 원만 남고 라벨로 읽을 수 있다.
 * 아이콘 하나 때문에 대전이 시작되지 않는 쪽이 훨씬 나쁘다 (배경과 같은 원칙).
 */

export type IconRegions = Map<string, Texture>;

let cached: Promise<IconRegions> | null = null;

async function load(): Promise<IconRegions> {
  const out: IconRegions = new Map();
  try {
    const manifest =
      await Assets.load<Record<string, BgAtlas>>(ICON_MANIFEST_URL);
    const atlas = manifest[ICON_ATLAS];
    if (!atlas) {
      console.warn(`[pvp] icons.json에 "${ICON_ATLAS}" 아틀라스가 없다`);
      return out;
    }
    const base = await loadPixelTexture(atlas.url);
    for (const [key, r] of Object.entries(atlas.regions)) {
      out.set(
        key,
        new Texture({
          source: base.source,
          frame: new Rectangle(r.x, r.y, r.w, r.h),
        }),
      );
    }
  } catch (err) {
    console.warn("[pvp] 스킬 아이콘 아틀라스 로드 실패", err);
  }
  return out;
}

export function loadIconAtlas(): Promise<IconRegions> {
  cached ??= load();
  return cached;
}

/** 테스트·씬 재생성용 — 캐시를 버린다 */
export function resetIconAtlas(): void {
  cached = null;
}
