import { Assets, Sprite, Texture } from "pixi.js";
import { loadPixelTexture } from "./pixelTexture";
import {
  PORTRAIT_MANIFEST_URL,
  portraitDisplaySize,
  type PortraitManifest,
  type PortraitRegion,
  type PortraitVariant,
} from "./portraitManifest";

/**
 * 캐릭터 삽화 로더 — `portraits.json` + PNG 35장.
 *
 * 배경 아틀라스(`background.ts loadAtlases`)와 같은 원칙:
 * - **없어도 게임은 굴러간다.** 삽화가 안 오면 도형 대체로 그린다(설계 문서 03-3).
 * - 크기는 매니페스트의 `ratio`가 정한다. TS에 px를 복사하지 않는다.
 *
 * 다른 점: 아틀라스가 아니라 **파일 35장**이다. 아틀라스로 묶지 않은 이유는
 * 용도가 서로 다른 씬에서 쓰이기 때문이다 — 카드는 대기 씬, 선택은 선택 격자,
 * 승리·패배·무승부는 결과 씬. 한 장으로 묶으면 대기 씬에서 카드 0.24MB를
 * 그리려고 **디코드 20MB**를 다 올린다.
 *
 * 결과 3종은 한 판에 **한 장만 쓰인다**(판정이 셋 중 하나다). 그래서 결과 씬을
 * 붙일 때도 셋을 다 받으면 안 된다 — 16.4MB 중 11MB가 끝까지 안 쓰인다.
 */

export interface PortraitSet {
  /** 없으면 null — 호출자가 도형 대체로 넘어간다 */
  get(slug: string, variant: PortraitVariant): PortraitRegion | null;
  /**
   * 표시 크기까지 맞춘 스프라이트. 없으면 null.
   *
   * `anchor`는 세우지 않는다 — 자리마다 기준이 달라서(카드는 중앙 상단,
   * 격자는 중앙) 호출자가 정한다.
   */
  sprite(slug: string, variant: PortraitVariant): Sprite | null;
}

/**
 * 여러 벌을 하나로 본다 — 앞쪽에서 찾히면 그것을 쓴다.
 *
 * **variant를 따로 받기 위한 함수다.** 카드 7장(112KB)과 전신 7장(692KB, 6배)을
 * 한 호출로 묶으면 692KB가 도착할 때까지 카드도 못 그린다 — 내 캐릭터 얼굴이
 * 대기 화면에 아예 안 나오는 것과 늦게 나오는 것은 다른 실패다. 따로 받고
 * 여기서 합친다.
 */
export function mergePortraits(...sets: readonly PortraitSet[]): PortraitSet {
  return {
    get(slug, variant) {
      for (const s of sets) {
        const r = s.get(slug, variant);
        if (r) return r;
      }
      return null;
    },
    sprite(slug, variant) {
      for (const s of sets) {
        const sp = s.sprite(slug, variant);
        if (sp) return sp;
      }
      return null;
    },
  };
}

/** 삽화가 하나도 없을 때. 모든 조회가 null이라 호출자가 대체 경로로 간다 */
export const EMPTY_PORTRAITS: PortraitSet = {
  get: () => null,
  sprite: () => null,
};

/**
 * 지정한 variant만 받는다.
 *
 * **씬이 필요한 것만 올린다.** 21장을 한 번에 받으면 대기 씬 진입에 텍스처
 * 10.7MB(=w·h·4B 합)를 쓰는데, 그 씬이 쓰는 것은 카드 7장(0.25MB)뿐이다.
 *
 * 실패는 조용하지 않다 — `console.warn`을 남기고 그 칸만 빠진다. 매니페스트가
 * 있는데 PNG가 없으면 그 캐릭터만 도형으로 그려지고, 로그가 이유를 말해 준다.
 */
export async function loadPortraits(
  variants: readonly PortraitVariant[],
  slugs: readonly string[],
): Promise<PortraitSet> {
  let manifest: PortraitManifest;
  try {
    manifest = await Assets.load<PortraitManifest>(PORTRAIT_MANIFEST_URL);
  } catch (err) {
    console.warn("[pvp] 삽화 매니페스트를 못 읽었다 — 도형으로 그린다", err);
    return EMPTY_PORTRAITS;
  }

  const regions = new Map<string, PortraitRegion>();
  const texes = new Map<string, Texture>();
  await Promise.all(
    slugs.flatMap((slug) =>
      variants.map(async (v) => {
        const r = manifest[slug]?.[v];
        if (!r) {
          console.warn(`[pvp] portraits.json에 ${slug}/${v}가 없다`);
          return;
        }
        try {
          const tex = await loadPixelTexture(r.url);
          const key = `${slug}/${v}`;
          regions.set(key, r);
          texes.set(key, tex);
        } catch (err) {
          console.warn(`[pvp] 삽화 ${slug}/${v} 로드 실패`, err);
        }
      }),
    ),
  );

  return {
    get(slug, variant) {
      return regions.get(`${slug}/${variant}`) ?? null;
    },
    sprite(slug, variant) {
      const key = `${slug}/${variant}`;
      const r = regions.get(key);
      const tex = texes.get(key);
      if (!r || !tex) return null;
      const sp = new Sprite(tex);
      // **높이를 정하고 폭을 유도한다** — 둘을 다 지시하면 캐릭터마다 폭이
      // 달라서(카드 54~134px) 누군가는 늘어난다
      const { w, h } = portraitDisplaySize(variant, r);
      sp.width = w;
      sp.height = h;
      return sp;
    },
  };
}
