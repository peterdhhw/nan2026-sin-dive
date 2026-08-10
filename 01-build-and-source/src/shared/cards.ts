import { Assets, Sprite, Texture } from "pixi.js";
import { loadPixelTexture } from "./pixelTexture";
import {
  CARD_MANIFEST_URL,
  type CardManifest,
  type CardRegion,
} from "./cardManifest";

/**
 * 수집 카드 로더 — `cards.json` + PNG 105장.
 *
 * `portraits.ts`와 같은 원칙:
 * - **없어도 게임은 굴러간다.** 카드가 안 오면 카드함이 빈 격자로 뜨고 획득
 *   문구만 나온다(획득 자체는 `localStorage`에 남으므로 잃지 않는다).
 * - 크기는 매니페스트가 정한다. TS에 px를 복사하지 않는다.
 *
 * 다른 점: **한 카드가 세 파일이다**(`full`/`thumb`/`sil`). 어느 것을 받을지는
 * 호출자가 카드마다 정한다 — 그게 이 파일의 존재 이유다. 아래 `loadCardArt`의
 * 주석을 보라: 미획득 카드에 `thumb`을 받으면 안 딴 그림이 클라이언트에 온다.
 */

/** 카드 한 장의 세 그림 중 무엇을 받을 것인가 */
export type CardArtKind = "full" | "thumb" | "sil";

/** 받아 놓은 카드 그림 하나 */
export interface CardArt {
  tex: Texture;
  /** 표시 크기(디자인 px). 매니페스트가 정한다 */
  w: number;
  h: number;
}

/**
 * 매니페스트만 받는다 (7KB).
 *
 * 그림과 분리한 이유: 카드함 버튼은 **그림 없이도** `카드함 12/35`를 적어야
 * 한다. 그 수를 세려면 어떤 카드가 있는지만 알면 되고, 그림 105장(0.5MB)은
 * 오버레이를 열 때 받으면 된다. 실제로 대부분의 판에서 카드함은 안 열린다.
 */
export async function loadCardManifest(): Promise<CardManifest | null> {
  try {
    return await Assets.load<CardManifest>(CARD_MANIFEST_URL);
  } catch (err) {
    // 조용히 넘기지 않는다 — 카드함이 비어 보이는 이유가 로그에 남아야 한다
    console.warn("[pvp] cards.json을 못 읽었다 — 카드함이 비어 보인다", err);
    return null;
  }
}

/** 매니페스트에서 id로 찾는다. 없으면 null */
export function findCard(
  manifest: CardManifest | null,
  id: string,
): CardRegion | null {
  if (!manifest) return null;
  for (const rows of Object.values(manifest)) {
    const hit = rows.find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

/** 카드의 `kind`별 경로·크기. 매니페스트 값을 그대로 쓴다 */
function artOf(
  row: CardRegion,
  kind: CardArtKind,
): {
  url: string;
  w: number;
  h: number;
} {
  if (kind === "full") {
    return { url: row.full, w: row.fullW, h: row.fullH };
  }
  return {
    url: kind === "thumb" ? row.thumb : row.sil,
    w: row.thumbW,
    h: row.thumbH,
  };
}

/**
 * 카드마다 **다른 종류**를 받는다.
 *
 * 한 호출에 `kind`를 하나만 받는 형태(`loadCardArt(rows, "thumb")`)로 만들다가
 * 바꿨다. 카드함은 딴 카드는 `thumb`, 안 딴 카드는 `sil`을 받아야 하는데,
 * 종류당 한 번씩 부르면 두 호출이 **따로 도착한다** — 먼저 온 쪽만 그려진
 * 격자가 한 프레임 이상 보이고, 그게 "몇 장 없어졌다"로 읽힌다.
 *
 * **미획득 카드에 `thumb`을 넘기면 안 된다.** 실루엣이 별도 파일인 이유가
 * 그것이다(`tools/gen_cards.py` docstring) — 안 딴 카드의 그림을 받아 놓고
 * 흰색으로 덮으면 네트워크 탭에 전부 보인다. 그 규칙은 여기서 지켜지지 않고
 * **호출자가** 지킨다. 그래서 카드함은 `owned` 집합으로 kind를 정한다.
 *
 * 실패는 그 칸만 빠진다 — 한 장이 없다고 카드함을 닫지 않는다.
 */
export async function loadCardArt(
  items: readonly { row: CardRegion; kind: CardArtKind }[],
): Promise<Map<string, CardArt>> {
  const out = new Map<string, CardArt>();
  await Promise.all(
    items.map(async ({ row, kind }) => {
      const a = artOf(row, kind);
      try {
        const tex = await loadPixelTexture(a.url);
        out.set(row.id, { tex, w: a.w, h: a.h });
      } catch (err) {
        console.warn(`[pvp] 카드 ${row.id}/${kind} 로드 실패`, err);
      }
    }),
  );
  return out;
}

/**
 * 표시 크기까지 맞춘 스프라이트.
 *
 * `anchor`는 세우지 않는다 — 자리마다 기준이 다르다(격자는 좌상단, 승리
 * 오버레이는 중앙 하단). `portraits.PortraitSet.sprite`와 같은 규칙이다.
 *
 * `maxW`/`maxH`를 주면 **종횡비를 지켜** 그 안에 넣는다. 카드함 칸은 3:4로
 * 잡혀 있지만(`cardRules.BOX_CELL_W/H`) 칸 폭이 화면에서 유도되므로
 * 썸네일(110×147)과 정확히 같지 않다 — 늘리지 않고 맞춘다.
 */
export function cardSprite(
  art: CardArt,
  fit?: { maxW: number; maxH: number },
): Sprite {
  const sp = new Sprite(art.tex);
  let { w, h } = art;
  if (fit && w > 0 && h > 0) {
    const k = Math.min(fit.maxW / w, fit.maxH / h);
    w *= k;
    h *= k;
  }
  sp.width = w;
  sp.height = h;
  return sp;
}
