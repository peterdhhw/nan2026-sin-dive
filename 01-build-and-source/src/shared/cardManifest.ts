/**
 * 수집 카드 매니페스트 타입 + id 규칙.
 *
 * 원본은 `tools/gen_cards.py`가 굽는다 (갤러리 아카이브 → `public/assets/cards/`).
 * 주인공 7종 × 5장 = 35장.
 *
 * **Pixi를 import하지 않는다** — node 테스트가 이 규칙으로 `cards.json`을 검증한다
 * (`portraitManifest.ts`와 같은 취급).
 *
 * ## id를 매니페스트에서 읽지 않고 여기서 유도하는 이유
 *
 * 획득한 카드는 `localStorage`에 **id 문자열로** 남는다. 그러니 id는 매니페스트가
 * 도착하기 전에도 유효/무효를 판정할 수 있어야 한다 — 안 그러면 저장값을 검증할
 * 유일한 시점이 "그림이 다 도착한 뒤"가 되고, 그 사이 카드함이 몇 장인지 모른다.
 * 저장값을 목록으로 검증하는 것이 이 방어다(`isCardId`).
 */

import { HERO_SLUGS, type HeroSlug } from "./charManifest";

/** `cards.json`의 경로. PNG는 같은 폴더에 있다 */
export const CARD_MANIFEST_URL = "assets/cards/cards.json";

/**
 * 캐릭터당 카드 수. `tools/gen_cards.py`의 `SCENES` 길이와 같아야 한다(테스트로 대조).
 *
 * 20장 중 5장만 고른 근거는 생성기 쪽 주석에 있다 — 7/7 전원 성공 · 9:16 원본 ·
 * 계절이 서로 다름.
 */
export const CARDS_PER_HERO = 5;

/** 카드함이 "n/35"로 세는 그 35 */
export const TOTAL_CARDS = HERO_SLUGS.length * CARDS_PER_HERO;

/**
 * 카드 id — `<slug>_<NN>`. **번호는 1부터**다.
 *
 * 0-based로 두면 저장된 문자열(`water_priestess_00`)과 파일 이름(`_01`)이
 * 어긋나는데, 둘 다 사람이 눈으로 보는 값이라 그 어긋남이 오래 안 잡힌다.
 */
export function cardIdOf(slug: string, no: number): string {
  const n = Number.isFinite(no) ? Math.floor(no) : 0;
  return `${slug}_${String(n).padStart(2, "0")}`;
}

/** 한 캐릭터의 카드 id 5개 (번호 순) */
export function cardIdsOf(slug: string): string[] {
  return Array.from({ length: CARDS_PER_HERO }, (_, i) =>
    cardIdOf(slug, i + 1),
  );
}

/** 전체 35장의 id. 순서 = 캐릭터 목록 순서 × 번호 순 */
export function allCardIds(): string[] {
  return HERO_SLUGS.flatMap((s) => cardIdsOf(s));
}

/**
 * id가 로스터에 있는 카드인가. 저장값 검증에 쓴다.
 *
 * **`cardIdOf`로 되돌려 같은지 본다.** 숫자만 검사하면(`Number(...)` 범위)
 * `..._1`·`..._001`·`..._1.0`이 전부 통과하는데, 그 문자열은 매니페스트의
 * 어떤 행과도 같지 않으므로 카드함에는 안 보이면서 **수만 올린다**(`36/35`).
 * 이 함수가 막으려는 것이 바로 그 실패다(`cardRules.parseOwned` 주석).
 */
export function isCardId(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const cut = raw.lastIndexOf("_");
  if (cut <= 0) return false;
  const slug = raw.slice(0, cut);
  const no = Number(raw.slice(cut + 1));
  if (!(HERO_SLUGS as readonly string[]).includes(slug)) return false;
  if (!Number.isInteger(no) || no < 1 || no > CARDS_PER_HERO) return false;
  return cardIdOf(slug, no) === raw;
}

/** id의 캐릭터. 모르는 id면 null */
export function cardSlugOf(id: string): HeroSlug | null {
  const cut = id.lastIndexOf("_");
  if (cut <= 0) return null;
  const slug = id.slice(0, cut);
  return (HERO_SLUGS as readonly string[]).includes(slug)
    ? (slug as HeroSlug)
    : null;
}

export interface CardRegion {
  /** `<slug>_<NN>` */
  id: string;
  /** 1..CARDS_PER_HERO */
  no: number;
  /** 생성기의 장면 이름 (`04_festival`) — 그림을 되찾을 때 쓴다 */
  scene: string;
  /** 카드 이름 (`여름 축제`) */
  title: string;
  /** public/ 기준 상대 경로 */
  full: string;
  thumb: string;
  sil: string;
  fullW: number;
  fullH: number;
  thumbW: number;
  thumbH: number;
  /**
   * 실루엣의 불투명 비율.
   *
   * **0이면 미획득 칸이 빈 사각형이다** — 카드가 있다는 것도 안 읽힌다.
   * 런타임은 안 쓰고 테스트가 쓴다 (`PortraitRegion.alphaRatio`와 같은 취급).
   */
  silRatio: number;
}

/** 슬러그 → 카드 5장 (번호 순) */
export type CardManifest = Record<string, CardRegion[]>;
