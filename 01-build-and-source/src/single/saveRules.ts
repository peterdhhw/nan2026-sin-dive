/**
 * 싱글 저장 스키마 — `sin.single.*` 키의 파싱·직렬화.
 *
 * 설계 문서: docs/SAVE-SCHEMA.md §3(규칙 4개), §4-3(잔고는 조용히 버리면 안 된다)
 *
 * 규칙 준수:
 * 1. 접두사 `sin.single.` — 기존 `abyss.*`(카드함)는 건드리지 않고 그대로
 *    공유한다.
 * 2. 키 상수와 파싱·직렬화가 이 Rules 파일에 함께 있다 — 씬이 키 문자열을
 *    직접 들지 않는다.
 * 3. 래퍼는 `appStore()`를 재사용한다 (사파리 프라이빗 모드 방어를 두 번
 *    만들지 않는다).
 * 4. 파싱은 모르는 값을 버리되 **잔고(골드)만은 다르다**: 형식이 깨진 잔고는
 *    0이 아니라 `null`(읽기 실패)로 구분한다. 실패 상태에서는 소비가 막히고
 *    (economyRules.canBuy), 화면이 실패를 말해야 한다. "저장값이 아예 없음"
 *    (첫 방문)은 실패가 아니라 0에서 시작한다.
 *
 * 직렬화는 전부 콤마 구분이다 — JSON은 한 글자만 깨져도 전부 잃지만 콤마
 * 구분은 깨진 조각만 잃는다 (cardRules.ts:50과 같은 근거).
 */

import { appStore } from "../shared/store";
import { HERO_SLUGS, type HeroSlug } from "../shared/charManifest";
import {
  UPGRADE_IDS,
  clampLevels,
  emptyLevels,
  type UpgradeId,
  type UpgradeLevels,
} from "./economyRules";
import { clampFloor } from "../core/phase/floors";

export const SINGLE_FLOOR_KEY = "sin.single.floor";
export const SINGLE_CHOICES_KEY = "sin.single.choices";
export const SINGLE_CURRENCY_KEY = "sin.single.currency";
export const SINGLE_UPGRADES_KEY = "sin.single.upgrades";
export const SINGLE_LAST_TICK_KEY = "sin.single.lastTickMs";
export const SINGLE_STORY_KEY = "sin.single.story";
/**
 * 싱글에서 **키운** 캐릭터 슬러그 집합.
 *
 * PvP 선택지가 이것으로 제한된다(요구사항 3): 싱글에서 1명만 키웠으면 대전에서도
 * 그 1명만 고를 수 있다. "얼마나" 키웠는지는 `sin.single.upgrades`가 이미 들고
 * 있으므로 여기는 **키웠는가**만 담는다.
 */
export const SINGLE_GROWN_KEY = "sin.single.grown";

/** saveRules가 쓰는 저장소 형태 — appStore()의 반환과 같다 */
export type SingleStore = Pick<Storage, "getItem" | "setItem"> | null;

/** 씬에서 `appStore()`를 직접 부르지 말고 이걸 지나라 — import 경로가 한 곳이 된다 */
export function singleStore(): SingleStore {
  return appStore();
}

export interface SingleSave {
  /** 도달 최고 층 (1..9999). 하강 시작 층이자 타락도 깊이 성분의 재료 */
  floor: number;
  /** '심연의 선택' 수용 횟수 — 타락도는 (floor, choices)에서 유도한다 */
  choices: number;
  /** 골드 잔고. **null = 읽기 실패** (0과 다르다 — 실패 시 소비 금지) */
  gold: number | null;
  /** 심연석 잔고 (카드 뽑기 재화). null = 읽기 실패, 골드와 같은 계약 */
  abyss: number | null;
  /**
   * 우리가 모르는 재화 조각 원문 — 쓸 때 되돌려 붙인다
   * (`unknownCurrencyParts`). 화면은 이걸 보지 않는다.
   */
  currencyUnknown: string[];
  upgrades: UpgradeLevels;
  /** 마지막으로 게임을 본 시각(epoch ms). null = 기록 없음 → 방치 보상 없음 */
  lastTickMs: number | null;
  /** 본 스토리 연출 id 집합 */
  storySeen: Set<string>;
  /**
   * 싱글에서 키운 캐릭터. **PvP 선택지가 이것으로 제한된다**(요구사항 3).
   * 빈 집합 = 아직 아무도 안 키웠다(첫 방문).
   */
  grown: Set<HeroSlug>;
}

// ── 파싱 (순수 — 저장소를 모른다) ──────────────────────────────────────

/** 층: 숫자가 아니면 1층부터 (진행도를 0으로 되돌리는 것보다 clamp가 낫다) */
export function parseFloor(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? clampFloor(n) : 1;
}

export function parseChoices(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * 잔고: `gold:123` 콤마 구분. 반환 `null`은 **읽기 실패**다 — 값이 있는데
 * gold 항목을 읽을 수 없는 경우. 저장값이 아예 없으면(첫 방문) 0이다.
 * 모르는 재화 항목(`gem:4` 등)은 무시한다 — 재화가 늘어도 옛 클라이언트가
 * 안 죽는다.
 */
export function parseCurrencyGold(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return 0;
  for (const part of raw.split(",")) {
    const [key, value] = part.split(":");
    if (key?.trim() !== "gold") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return null; // gold 항목이 있는데 숫자가 아니다 — 실패로 구분
  }
  return null; // 값은 있는데 gold 항목이 없다 — 실패로 구분
}

/**
 * 심연석 잔고 (`abyss:`). 골드와 **같은 계약**이다 — `null`은 읽기 실패고,
 * 저장값이 아예 없으면 0이다.
 *
 * 골드와 다른 점은 `abyss` 항목만 없는 경우다: 3단계 전에 저장된 값
 * (`gold:1200`)에는 이 항목이 없는데 그건 깨진 것이 아니라 **아직 안 생긴
 * 재화**다. 그래서 여기서만 0을 준다 — 실패로 보면 그 사람은 심연석을 영구히
 * 못 쓴다(소비가 `canBuy`류에서 막힌다). 반대로 `abyss:xyz`처럼 항목이 있는데
 * 못 읽는 경우는 골드와 같이 실패다.
 */
export function parseCurrencyAbyss(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return 0;
  for (const part of raw.split(",")) {
    const [key, value] = part.split(":");
    if (key?.trim() !== "abyss") continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return null; // 항목이 있는데 숫자가 아니다 — 실패로 구분
  }
  return 0; // 옛 저장값에는 이 항목이 없다 (골드와 갈리는 지점)
}

/** 우리가 아는 재화 키 — 나머지는 모르는 재화로 보존한다 */
const KNOWN_CURRENCY_KEYS = new Set(["gold", "abyss"]);

/**
 * 우리가 모르는 재화 조각들을 **원문 그대로** 돌려준다 (`gem:4` 등).
 *
 * **왜 보존하는가**: 재화는 한 키(`sin.single.currency`) 안에 콤마로 산다.
 * 골드만 쓰던 `writeGold`가 문자열을 통째로 갈아치웠으므로, 심연석을 같은 키에
 * 넣는 순간 "골드를 저장하면 심연석이 사라진다"가 된다. 그리고 그 버그는
 * 3단계에서 우리가 두 재화를 다 알기 때문에 안 보이고, **젬이 붙는 본선에서**
 * 나타난다 — 옛 버전 탭이 저장을 한 번 하면 새 재화가 지워지는 꼴이다.
 * 그래서 쓰기가 모르는 조각을 통과시킨다(읽기가 모르는 값을 버리는 것과 반대
 * 방향이지만 근거는 같다: 잔고는 조용히 잃으면 안 된다 — §4-3).
 */
export function unknownCurrencyParts(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.split(":")[0]?.trim();
    if (!key || KNOWN_CURRENCY_KEYS.has(key)) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * 재화 줄 직렬화. 아는 재화를 먼저, 모르는 조각을 뒤에 붙인다 (순서 고정 =
 * 같은 잔고면 같은 문자열).
 */
export function serializeCurrency(
  gold: number,
  abyss = 0,
  unknown: readonly string[] = [],
): string {
  const g = Math.max(0, Math.floor(Number.isFinite(gold) ? gold : 0));
  const a = Math.max(0, Math.floor(Number.isFinite(abyss) ? abyss : 0));
  return [`gold:${g}`, `abyss:${a}`, ...unknown].join(",");
}

/** 강화: `atk:12,spd:3` 콤마 구분. 모르는 id·깨진 조각은 버리고 나머지는 산다 */
export function parseUpgrades(raw: string | null | undefined): UpgradeLevels {
  const out = emptyLevels();
  if (raw === null || raw === undefined) return out;
  const known = new Set<string>(UPGRADE_IDS);
  for (const part of raw.split(",")) {
    const [key, value] = part.split(":");
    const id = key?.trim();
    if (!id || !known.has(id)) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[id as UpgradeId] = n;
  }
  return clampLevels(out);
}

export function serializeUpgrades(levels: UpgradeLevels): string {
  const clamped = clampLevels(levels);
  return UPGRADE_IDS.map((id) => `${id}:${clamped[id]}`).join(",");
}

export function parseLastTickMs(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** 스토리 id는 [a-z0-9_-]만 통과 — 깨진 조각은 조용히 버려도 되는 성격(한 번 보면 끝) */
export function parseStorySeen(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (raw === null || raw === undefined) return out;
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id.length > 0 && /^[a-z0-9_-]+$/.test(id)) out.add(id);
  }
  return out;
}

/**
 * 키운 캐릭터: `water_priestess,leaf_ranger` 콤마 구분.
 *
 * **로스터에 없는 슬러그는 버린다.** 자체 생성 4종에서 chierit 7종으로 갈아탄
 * 이력이 있어서(`HERO_SLUGS` 주석), 옛 저장값의 슬러그를 그대로 믿으면 프리셋에
 * 없는 캐릭터가 선택지로 올라오고 스킬이 빈다 — `parseStoredPick`과 같은 방어다.
 */
export function parseGrown(raw: string | null | undefined): Set<HeroSlug> {
  const out = new Set<HeroSlug>();
  if (raw === null || raw === undefined) return out;
  const known = new Set<string>(HERO_SLUGS);
  for (const part of raw.split(",")) {
    const slug = part.trim();
    if (known.has(slug)) out.add(slug as HeroSlug);
  }
  return out;
}

/** 정렬해서 쓴다 — 같은 집합이면 같은 문자열 (serializeOwned와 같은 근거) */
export function serializeStorySeen(seen: ReadonlySet<string>): string {
  return [...seen].sort().join(",");
}

/**
 * 키운 캐릭터 줄 직렬화. **`HERO_SLUGS` 순서로 쓴다** — `Set` 삽입 순서로 쓰면
 * 같은 집합이 저장마다 다른 문자열이 되어 저장값 비교로 회귀를 못 잡는다
 * (`serializeUpgrades`가 `UPGRADE_IDS` 순서를 쓰는 것과 같은 근거).
 */
export function serializeGrown(grown: ReadonlySet<HeroSlug>): string {
  return HERO_SLUGS.filter((s) => grown.has(s)).join(",");
}

// ── 읽기/쓰기 (저장소 경유 — 실패는 삼킨다, cardRules.ts:88과 같은 근거) ──

export function readSingleSave(store: SingleStore): SingleSave {
  // "키가 없음"(첫 방문)과 "읽기 자체가 안 됨"(프라이빗 모드·getItem throw)을
  // 구분한다 — 잔고만은 후자를 0으로 뭉개면 안 되기 때문 (§4-3).
  let readable = store !== null;
  const get = (key: string): string | null => {
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch {
      readable = false;
      return null;
    }
  };
  const rawCurrency = get(SINGLE_CURRENCY_KEY);
  // 두 잔고가 같은 키에 살므로 읽기 가능 여부도 한 번에 갈린다
  const currencyReadable = readable;
  return {
    floor: parseFloor(get(SINGLE_FLOOR_KEY)),
    choices: parseChoices(get(SINGLE_CHOICES_KEY)),
    gold: currencyReadable ? parseCurrencyGold(rawCurrency) : null,
    abyss: currencyReadable ? parseCurrencyAbyss(rawCurrency) : null,
    currencyUnknown: currencyReadable ? unknownCurrencyParts(rawCurrency) : [],
    upgrades: parseUpgrades(get(SINGLE_UPGRADES_KEY)),
    lastTickMs: parseLastTickMs(get(SINGLE_LAST_TICK_KEY)),
    storySeen: parseStorySeen(get(SINGLE_STORY_KEY)),
    grown: parseGrown(get(SINGLE_GROWN_KEY)),
  };
}

function writeSwallow(store: SingleStore, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // 저장 실패의 대가는 "이번 진행을 잃는다"이고, 그게 크래시보다 낫다
  }
}

export function writeFloor(store: SingleStore, floor: number): void {
  writeSwallow(store, SINGLE_FLOOR_KEY, String(clampFloor(floor)));
}

export function writeChoices(store: SingleStore, choices: number): void {
  writeSwallow(store, SINGLE_CHOICES_KEY, String(Math.max(0, Math.floor(choices))));
}

/**
 * 재화 줄 쓰기 — **두 잔고를 함께 쓴다.**
 *
 * 골드만 받는 `writeGold`를 남기지 않은 이유: 한 키에 두 잔고가 살므로 골드만
 * 쓰는 경로가 있으면 그 경로가 심연석을 지운다. 두 함수로 갈라 두면 호출부가
 * 어느 쪽을 불렀는지에 따라 잔고가 사라지고, 그건 저장을 다시 읽을 때까지
 * 조용하다. 모르는 조각(`unknown`)까지 받는 것이 같은 근거의 세 번째 층이다.
 *
 * **null(읽기 실패)은 넘기지 마라** — 호출부가 실패 상태에서 쓰기를 건너뛰는
 * 것이 규칙이다(§4-3). 여기서 0으로 접으면 "잔고 확인 불가"가 "잔고 0"으로
 * 굳어 버린다.
 */
export function writeCurrency(
  store: SingleStore,
  gold: number,
  abyss = 0,
  unknown: readonly string[] = [],
): void {
  writeSwallow(store, SINGLE_CURRENCY_KEY, serializeCurrency(gold, abyss, unknown));
}

export function writeUpgrades(store: SingleStore, levels: UpgradeLevels): void {
  writeSwallow(store, SINGLE_UPGRADES_KEY, serializeUpgrades(levels));
}

export function writeLastTickMs(store: SingleStore, ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  writeSwallow(store, SINGLE_LAST_TICK_KEY, String(Math.floor(ms)));
}

export function writeStorySeen(store: SingleStore, seen: ReadonlySet<string>): void {
  writeSwallow(store, SINGLE_STORY_KEY, serializeStorySeen(seen));
}

export function writeGrown(
  store: SingleStore,
  grown: ReadonlySet<HeroSlug>,
): void {
  writeSwallow(store, SINGLE_GROWN_KEY, serializeGrown(grown));
}
