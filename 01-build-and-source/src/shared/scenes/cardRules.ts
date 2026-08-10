/**
 * 카드 수집의 순수 규칙 — 획득 판정, 저장/복원, 카드함 격자 배치.
 *
 * 설계 문서: specs/2026-07-27-ux/10-cards.md
 *
 * Pixi를 import하지 않는다 (`cardBoxOverlay.ts`·`resultScene.ts`가 쓴다).
 *
 * ## 왜 이기면 **한 장**인가 (결정 기록)
 *
 * 유저 지시는 "카드화해서 모을 수 있도록"이다. 판당 장 수를 정해야 했다.
 *
 * - 판마다 전부 주면 첫 승에 5장이 다 들어와 수집이 한 판에 끝난다.
 * - 확률로 주면(예: 40%) 이겼는데 아무것도 안 나오는 판이 생긴다 — 이긴 보상이
 *   "없음"일 수 있으면 그건 보상이 아니다.
 *
 * 그래서 **이기면 반드시 한 장, 미획득 중에서만** 준다. 다 모은 캐릭터로 이기면
 * 아무 일도 안 일어나는데(`grantCard`가 null), 그건 "안 나왔다"가 아니라
 * "다 모았다"라서 화면이 그렇게 말할 수 있다.
 *
 * ## 왜 캐릭터를 갈아타면 진행이 나뉘는가
 *
 * 카드는 **내가 고른 캐릭터의 것만** 나온다(`grantCard(slug, …)`). 전체 풀에서
 * 랜덤으로 주는 안을 접었다 — 그러면 한 번도 안 쓴 캐릭터의 카드가 쌓여서
 * "이 캐릭터를 골라서 얻었다"는 연결이 끊긴다. 캐릭터를 바꿀 이유가 하나 생기는
 * 편이 수집의 동기로도 낫다.
 */

import { createRng } from "../../core/rng";
import { DESIGN_H, DESIGN_W } from "../viewport";
import { HERO_SLUGS } from "../charManifest";
import {
  CARDS_PER_HERO,
  TOTAL_CARDS,
  allCardIds,
  cardIdsOf,
  isCardId,
} from "../cardManifest";

/** 획득한 카드 id 목록. 접두사 `abyss.`는 바꾸지 마라 (SAVE-SCHEMA §3) */
export const CARD_STORAGE_KEY = "abyss.cards.owned";

/**
 * 저장 문자열 → 획득 집합.
 *
 * **모르는 id는 버린다.** 카드 장면 목록(`gen_cards.SCENES`)이 늘어나면 번호가
 * 늘고, 줄어들면(그럴 일은 없어야 하지만) 저장값에 없는 카드가 남는다 —
 * 그걸 그대로 세면 카드함이 `37/35`를 표시한다. `cardManifest.isCardId`가
 * 목록으로 검증하는 것이 이 방어다.
 *
 * 형식은 콤마 구분이다. JSON 배열로 두면 파싱 실패가 "전부 잃음"이 되는데,
 * 콤마 구분은 한 조각이 깨져도 나머지가 살아남는다.
 */
export function parseOwned(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== "string") return out;
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (isCardId(id)) out.add(id);
  }
  return out;
}

/** 획득 집합 → 저장 문자열. 순서를 고정한다 (같은 집합이면 같은 문자열) */
export function serializeOwned(owned: ReadonlySet<string>): string {
  return [...owned].sort().join(",");
}

/**
 * `localStorage` 접근을 감싼다 — 사파리 프라이빗 모드는 접근 자체가 던진다.
 * 여기서 따로 만드는 대신 공용 래퍼(`shared/store.ts`)를 쓴다.
 */
export { appStore as cardStore } from "../store";

export function readOwned(store: Pick<Storage, "getItem"> | null): Set<string> {
  if (!store) return new Set();
  try {
    return parseOwned(store.getItem(CARD_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function writeOwned(
  store: Pick<Storage, "setItem"> | null,
  owned: ReadonlySet<string>,
): void {
  if (!store) return;
  try {
    store.setItem(CARD_STORAGE_KEY, serializeOwned(owned));
  } catch {
    // 저장 실패는 이번 판의 획득만 잃는다 — 화면은 이미 딴 것으로 그려졌고,
    // 다음 진입에 카드함이 그 카드를 미획득으로 되돌린다. 여기서 예외를
    // 올리면 결과 화면이 죽는다(이긴 판이 크래시로 끝난다)
  }
}

/* ── 등급 (3단계)
 *
 * ## 왜 등급이 "어느 카드가 나오는가"인가 — "나오는가 안 나오는가"가 아니라
 *
 * 이 파일 머리의 보장(**이기면 반드시 한 장**)을 등급이 깨면 안 된다. 등급을
 * 확률로 두면(예: 전설 10%면 90%는 빈손) 우리가 위에서 접은 확률 지급 안이
 * 이름만 바꿔 돌아온다. 그래서 등급은 **뽑기의 결과가 아니라 카드의 성질**이다:
 * 한 장은 항상 나오고, 등급은 그 한 장이 무엇인지를 가른다.
 *
 * ## 등급을 번호로 정한 이유 — 해시가 아니라
 *
 * id 해시로 흩뿌리면 "왜 이 카드가 전설인가"에 답이 없고, 테스트도 해시를
 * 다시 계산하는 것 말고 할 게 없다(구현을 구현으로 검증하는 꼴). 번호로 가르면
 * **캐릭터마다 등급 분포가 같다** — 누구를 골라도 전설 한 장·희귀 두 장이라,
 * 캐릭터를 갈아탄 사람이 등급에서 손해 보지 않는다(위 "진행이 나뉜다"의 짝).
 */

/** 등급 — 흔한 것부터. 순서가 곧 폴백 순서다(아래 `drawFrom`) */
export const CARD_GRADES = ["common", "rare", "legend"] as const;
export type CardGrade = (typeof CARD_GRADES)[number];

/** 화면 표기 — 등급을 색이 아니라 글자로도 말한다 (§01-6) */
export const GRADE_NAMES: Record<CardGrade, string> = {
  common: "일반",
  rare: "희귀",
  legend: "전설",
};

/**
 * 뽑기 가중치. 합이 10이라 "전설 10%"가 읽는 대로 나온다.
 *
 * 전설이 한 캐릭터에 한 장(번호 5)뿐이므로 10%는 **그 한 장을 언제 만나는가**의
 * 값이다: 다섯 장을 다 모으는 동안 평균 한 번 정도 마지막에 남는다.
 */
export const GRADE_WEIGHTS: Record<CardGrade, number> = {
  common: 6,
  rare: 3,
  legend: 1,
};

/**
 * 카드의 등급. 번호 1~2 일반 · 3~4 희귀 · 5 전설.
 *
 * 모르는 id는 `common` — 등급은 화면 문구에만 쓰이므로 여기서 던지면 카드
 * 하나가 결과 화면을 죽인다.
 */
export function gradeOf(id: string): CardGrade {
  const cut = id.lastIndexOf("_");
  const no = cut > 0 ? Number(id.slice(cut + 1)) : Number.NaN;
  if (!Number.isFinite(no)) return "common";
  if (no >= CARDS_PER_HERO) return "legend";
  return no >= 3 ? "rare" : "common";
}

/**
 * 후보 중 한 장을 등급 가중으로 뽑는다. 후보가 비면 `null`.
 *
 * **폴백이 흔한 등급부터인 이유**: 뽑힌 등급에 남은 카드가 없을 때(전설을
 * 이미 땄다) 아무거나 주면 그게 전설이 될 수 있다 — 그러면 "전설을 다 따면
 * 전설이 더 잘 나온다"가 된다. 흔한 쪽부터 훑으면 보장(한 장은 나온다)은
 * 지키면서 귀한 것이 위로가 되지 않는다.
 *
 * 후보를 정렬해 뽑는 것이 중요하다: `Set`의 순회 순서는 삽입 순서라, 정렬하지
 * 않으면 같은 시드·같은 보유 상태에서도 카드를 딴 **순서**에 따라 다른 카드가
 * 나온다 — 그러면 시드를 받는 의미가 없다.
 */
function drawFrom(candidates: readonly string[], seed: number): string | null {
  const pool = [...candidates].sort();
  if (pool.length === 0) return null;
  const rng = createRng(Number.isFinite(seed) ? Math.floor(seed) : 0);

  // 1) 등급을 가중 추첨한다 (rng를 먼저 한 번 쓴다 — 순서를 고정해야 결정론)
  const total = CARD_GRADES.reduce((a, g) => a + GRADE_WEIGHTS[g], 0);
  let roll = rng.int(total);
  let picked: CardGrade = CARD_GRADES[0] as CardGrade;
  for (const g of CARD_GRADES) {
    if (roll < GRADE_WEIGHTS[g]) {
      picked = g;
      break;
    }
    roll -= GRADE_WEIGHTS[g];
  }

  // 2) 그 등급에 남은 카드가 없으면 흔한 등급부터 훑는다
  const order: CardGrade[] = [picked, ...CARD_GRADES.filter((g) => g !== picked)];
  for (const g of order) {
    const byGrade = pool.filter((id) => gradeOf(id) === g);
    if (byGrade.length > 0) return byGrade[rng.int(byGrade.length)] ?? null;
  }
  return null;
}

/**
 * 이 캐릭터의 미획득 카드 하나. 다 모았으면 `null`.
 *
 * **시드를 받는다.** `Math.random()`은 `src/shared/`에서 금지다(§C6) — 재접속·
 * 리플레이가 같은 그림이어야 하는 규칙이 이 파일에도 그대로 걸린다. 결과 씬은
 * `runtime.nextSeed()`가 준 판 시드를 넘긴다.
 */
export function grantCard(
  slug: string,
  owned: ReadonlySet<string>,
  seed: number,
): string | null {
  return drawFrom(
    cardIdsOf(slug).filter((id) => !owned.has(id)),
    seed,
  );
}

/**
 * 이긴 판의 보상. **두 가지뿐이다** — 카드 한 장이거나 "다 모았다"다.
 *
 * `null`을 돌려주는 대신 종류를 붙인 이유: 화면이 두 경우를 **다르게** 말해야
 * 한다. 다 모은 캐릭터로 이겼을 때 아무것도 안 뜨면 "이번엔 안 나왔다"로
 * 읽히는데, 그건 우리가 없앤 경우다(`grantCard` 주석의 확률 지급 안).
 */
export type CardReward =
  | { kind: "card"; id: string; grade: CardGrade }
  | { kind: "complete" };

/**
 * 이번 판의 보상을 정한다. 저장은 **호출자가** 한다 — 이 함수는 순수하다.
 *
 * 순수하게 둔 이유: 보상 판정은 시드 하나로 재현돼야 하고(§C6), 저장까지
 * 여기서 하면 테스트가 `localStorage`를 흉내내야 한다. 그러면 "저장을 안 해도
 * 판정은 같다"는 성질을 테스트가 확인할 수 없다.
 */
export function rewardFor(
  slug: string,
  owned: ReadonlySet<string>,
  seed: number,
): CardReward {
  const id = grantCard(slug, owned, seed);
  // 등급을 여기서 붙인다 — 화면이 id에서 다시 유도하면 뽑기와 표기가 갈릴 수 있다
  return id === null ? { kind: "complete" } : { kind: "card", id, grade: gradeOf(id) };
}

/** 획득 문구: "전설 카드 획득!" — 등급이 없으면 등급 없는 문구가 된다 */
export function rewardCaption(reward: CardReward): string {
  return reward.kind === "card"
    ? `${GRADE_NAMES[reward.grade]} 카드 획득!`
    : "수집 완료";
}

/**
 * 심연석 뽑기 — **로스터 전체**의 미획득 중에서 한 장 (3단계).
 *
 * 대전 보상(`rewardFor`)이 내 캐릭터의 카드만 주는 것과 **일부러 다르다.**
 * 하강은 캐릭터를 고르는 화면이 없고(2단계에서 없앴다) 리드 하나로 수천 층을
 * 내려가므로, 여기서도 리드의 카드만 주면 나머지 여섯 명의 30장이 대전을
 * 열지 못한 사람에게 영구히 잠긴다. 두 입구가 서로 다른 풀을 보는 것이
 * "대전을 하는 이유"(내가 고른 캐릭터를 먼저 채운다)도 남긴다.
 *
 * 등급 가중과 보장은 그대로다 — 심연석을 냈으면 반드시 한 장 나온다.
 * 다 모았으면 `complete`이고, **그때는 호출자가 심연석을 차감하지 않는다.**
 */
export function drawReward(owned: ReadonlySet<string>, seed: number): CardReward {
  const id = drawFrom(
    allCardIds().filter((cid) => !owned.has(cid)),
    seed,
  );
  return id === null ? { kind: "complete" } : { kind: "card", id, grade: gradeOf(id) };
}

/** 카드함 버튼·진행 표기 (`카드함 12/35`) */
export function cardBoxLabel(owned: ReadonlySet<string>): string {
  return `카드함 ${ownedCount(owned)}/${TOTAL_CARDS}`;
}

/** 로스터에 있는 카드만 센다 — 저장값 검증을 통과한 것만 들어오지만 두 번 막는다 */
export function ownedCount(owned: ReadonlySet<string>): number {
  let n = 0;
  for (const id of owned) if (isCardId(id)) n += 1;
  return n;
}

/** 한 캐릭터의 진행 (`3/5`) — 카드함 줄 머리에 붙는다 */
export function heroProgress(
  slug: string,
  owned: ReadonlySet<string>,
): { got: number; total: number } {
  const got = cardIdsOf(slug).filter((id) => owned.has(id)).length;
  return { got, total: CARDS_PER_HERO };
}

/** 다 모았는가 — 획득 문구를 "다 모았다"로 바꾸는 데 쓴다 */
export function heroComplete(
  slug: string,
  owned: ReadonlySet<string>,
): boolean {
  return heroProgress(slug, owned).got >= CARDS_PER_HERO;
}

/* ── 카드함 격자 (§10-3)
 *
 * 캐릭터 한 명이 **한 줄**이다. 7행 × 5열.
 *
 * 3열로 흘리는 안(지금은 사라진 캐릭터 선택 격자와 같은 모양)을 접었다: 35칸을 3열로 놓으면
 * 12행이 되어 스크롤이 필요하고, 무엇보다 **누구의 카드인지가 안 읽힌다** —
 * 5장씩 한 줄이면 줄 왼쪽에 이름 하나만 적어도 다섯 칸이 다 설명된다.
 * 캐릭터당 장 수(`CARDS_PER_HERO`)가 곧 열 수인 것도 이 배치의 성질이다. */

/** 열 수 = 캐릭터당 카드 수. 한 줄이 한 캐릭터다 */
export const BOX_COLS = CARDS_PER_HERO;
export const BOX_GAP = 8;
/** 줄 머리의 이름 칸 폭 */
export const BOX_NAME_W = 116;
/** 격자 좌우 여백 */
export const BOX_MARGIN_X = 12;
/** 제목·진행 표기가 차지하는 위쪽 띠 */
export const BOX_TOP = 132;
/** 그 띠 안에서 제목("카드함")과 진행 표기("12/35")의 기준선 */
export const BOX_TITLE_Y = 52;
export const BOX_PROGRESS_Y = 92;

/**
 * 카드함 배경막의 불투명도 — **1이다. 아래 화면을 아예 가린다.**
 *
 * 0.92였고, 타이틀에서 열어 찍어 보니(1:1 캡처) 밑에 있는 화면의 위젯이
 * 배경막을 뚫고 올라와 카드함 **자기 글자와 같은 띠에서 겹쳤다**:
 * `대전 서버 연결됨 · 1명` 필이 진행 표기(`BOX_PROGRESS_Y`)를 가로지르고
 * 하단 조작 힌트가 `닫기` 버튼 위로 올라왔다. 화면에서는 오타나 깨진 글리프로
 * 읽힌다 — 반투명이 만든 것이지 텍스트 결함이 아니다.
 *
 * **왜 위젯을 옮기는 쪽이 아닌가:** 카드함은 화면을 꽉 채우는 격자다. 아래가
 * 보여서 얻는 정보가 없고(대기 화면이든 타이틀이든 뒤에 있는 것은 맥락일
 * 뿐이다), 반투명을 유지하면 카드함을 여는 **모든** 호출자가 자기 위젯을
 * 카드함 띠 밖으로 빼야 한다 — 지금 둘(타이틀·대기)이고 늘어난다.
 *
 * 다른 오버레이(`pickScene` 0.88, `victoryOverlay` 0.78)는 그대로다. 그쪽은
 * 뒤에 있는 것(전장·상대)이 연출의 일부라 일부러 비친다.
 */
export const BOX_DIM_ALPHA = 1;
/** 닫기 버튼 높이·하단 여백 */
export const BOX_BUTTON_H = 68;
export const BOX_BUTTON_MARGIN = 24;

/**
 * 칸 하나의 크기. **가로·세로 예산 중 작은 쪽이 정한다.**
 *
 * 썸네일이 110×147(3:4)로 구워져 있으므로(`gen_cards.THUMB_W/H`) 칸도 3:4여야
 * 그림이 안 눌린다. 여기에 px를 적으면 열 수를 바꿨을 때 그림만 늘어난다.
 *
 * 처음엔 폭만 보고 유도했는데(108×144) 7행이 1204px이 되어 닫기 버튼(1188)을
 * 덮었다 — `boxLayout(...).fits`가 false였다. **35칸은 폭이 아니라 세로가
 * 빡빡하다**: 열이 5개인데 행이 7개다. 그래서 두 예산을 다 재고 작은 쪽을 쓴다.
 */
/** 격자가 쓸 수 있는 세로 — 제목 띠 아래, 닫기 버튼 위(여유 16px) */
const BOX_GRID_MAX_H =
  DESIGN_H - BOX_BUTTON_H - BOX_BUTTON_MARGIN - 16 - BOX_TOP;
/** 폭 예산이 허용하는 칸 폭 */
const BOX_CELL_W_BY_W =
  (DESIGN_W - BOX_MARGIN_X * 2 - BOX_NAME_W - BOX_GAP * BOX_COLS) / BOX_COLS;
/** 세로 예산이 허용하는 칸 폭 (3:4를 지킨 채 7행이 들어가는 높이에서 되돌린다) */
const BOX_CELL_W_BY_H =
  (((BOX_GRID_MAX_H - BOX_GAP * (HERO_SLUGS.length - 1)) / HERO_SLUGS.length) *
    3) /
  4;
export const BOX_CELL_W = Math.min(BOX_CELL_W_BY_W, BOX_CELL_W_BY_H);
export const BOX_CELL_H = (BOX_CELL_W * 4) / 3;

/* ── 카드함 입구 버튼 (대기 화면 S2)
 *
 * 오른쪽 위 구석이다. 대기 화면의 세로는 이미 다 차 있다 — 로고 0.07 · 제목
 * 0.15 · 링 0.28 · 토스트 0.355 · 카드 2×2 0.42/0.64 · 스트립 0.8 · 힌트
 * 0.875 · 건너뛰기 0.925(실측). 빈 띠가 없으므로 **가운데 열이 비는 위쪽
 * 구석**을 쓴다: 로고는 화면 폭의 45%(약 136px)라 오른쪽 280px이 남는다.
 *
 * 하단에 두는 안을 접었다 — `건너뛰기`(0.925)와 같은 띠에 놓이면 대기를 끊는
 * 버튼 옆에 수집함이 붙어서, 급할 때 누르는 자리에 안 급한 것이 섞인다. */

/** 입구 버튼 크기 — `카드함 35/35`(가장 긴 라벨)가 들어가야 한다 */
export const BOX_ENTRY_W = 216;
export const BOX_ENTRY_H = 56;
/** 화면 오른쪽·위 여백 */
export const BOX_ENTRY_MARGIN = 12;

/**
 * 입구 버튼의 좌상단. 로고 띠와 **가로로** 어긋나 있는지는 테스트가 본다 —
 * 여기서 눈대중으로 정하면 로고가 커졌을 때 글자가 겹친 것을 아무도 못 잡는다.
 */
export function boxEntryPos(): { x: number; y: number } {
  return {
    x: DESIGN_W - BOX_ENTRY_W - BOX_ENTRY_MARGIN,
    y: BOX_ENTRY_MARGIN,
  };
}

/**
 * 줄 머리의 이름·수 두 라벨의 y (격자 원점 기준, 세로 중앙 기준선).
 *
 * **이름이 몇 줄로 접혔는지를 받아야 한다.** 처음엔 이름을 -12, 수를 +14로
 * 고정했는데 그때의 로스터 이름은 대부분 `수정의 파쇄자`꼴이라 `BOX_NAME_W`
 * (116px)에서 두 줄로 접히고 두 번째 줄이 수와 겹쳐 찍혔다. 고정 오프셋은
 * 이름이 한 줄이라는 가정이었고, 그 가정은 로스터 이름 길이에 달려 있다.
 *
 * **지금은 일곱 다 두세 글자라 한 줄이다** — 그래도 이 인자를 없애지 않는다.
 * 이름은 기획이 바꾸는 값이고(실제로 이번에 셋을 바꿨다) 길어지는 쪽으로
 * 바뀌는 순간 겹침이 조용히 돌아온다. 한 줄이면 -12/+14와 같은 자리로
 * 돌아오므로 지금 화면은 그대로다.
 *
 * 그래서 이름 블록(`lines`줄)과 수(1줄)를 **함께 세로 중앙에 쌓는다**: 전체
 * 높이는 `(lines + 1) * lineH`이고, 각 라벨은 자기 블록의 중앙에 앉는다.
 * 한 줄이면 -12/+14와 같은 자리로 돌아온다(lineH 26).
 */
export function boxRowLabelY(
  lines: number,
  lineH = 26,
): { nameY: number; countY: number } {
  const n = Number.isFinite(lines) ? Math.max(1, Math.floor(lines)) : 1;
  const h = Number.isFinite(lineH) && lineH > 0 ? lineH : 26;
  const mid = BOX_CELL_H / 2;
  // 이름 n줄 + 수 1줄을 쌓은 블록의 위쪽 끝
  const top = mid - ((n + 1) * h) / 2;
  return {
    nameY: top + (n * h) / 2,
    countY: top + n * h + h / 2,
  };
}

/** 칸 좌상단 (격자 원점 기준) */
export function boxCellPos(row: number, col: number): { x: number; y: number } {
  const r = Number.isFinite(row) ? Math.max(0, Math.floor(row)) : 0;
  const c = Number.isFinite(col) ? Math.max(0, Math.floor(col)) : 0;
  return {
    x: BOX_NAME_W + c * (BOX_CELL_W + BOX_GAP),
    y: r * (BOX_CELL_H + BOX_GAP),
  };
}

/**
 * 격자 전체 크기 — 화면에 들어가는지 확인하는 데 쓴다.
 *
 * `rows`를 인자로 받는다: 로스터가 7종이라 지금은 7행이지만, 그 값을 여기
 * 상수로 박으면 캐릭터를 늘렸을 때 격자가 닫기 버튼을 덮는 것을 테스트가
 * 못 잡는다.
 */
export function boxGridSize(rows: number): { w: number; h: number } {
  const r = Math.max(0, Math.floor(rows));
  return {
    w: BOX_NAME_W + BOX_COLS * BOX_CELL_W + (BOX_COLS - 1) * BOX_GAP,
    h: r * BOX_CELL_H + Math.max(0, r - 1) * BOX_GAP,
  };
}

/**
 * 카드함 세로 배치. **배치를 한 곳에 모으는 이유** — 씬에 흩어 놓으면 격자가
 * 버튼을 덮는 것을 node 테스트가 못 잡는다. 그건 "고를 수는 있는데 확정을 못
 * 한다"로 나타나므로 캡처를 열기 전까지 조용하다. (지워진 캐릭터 선택
 * 오버레이의 `pickLayout`이 같은 근거로 서 있었다 — UX 스펙 05 §8-3.)
 *
 * `fits`가 false면 배치가 성립하지 않는다. 지금은 7행이 들어가지만, 상수
 * 하나만 키워도(칸 폭·여백) 넘칠 수 있으므로 씬이 아니라 테스트가 이걸 본다.
 */
export function boxLayout(rows: number): {
  gridX: number;
  gridY: number;
  buttonY: number;
  fits: boolean;
} {
  const grid = boxGridSize(rows);
  const buttonY = DESIGN_H - BOX_BUTTON_H - BOX_BUTTON_MARGIN;
  return {
    gridX: BOX_MARGIN_X,
    gridY: BOX_TOP,
    buttonY,
    // 격자 아래로 16px은 남아야 한다 — 버튼에 닿으면 한 덩어리로 읽힌다
    fits: BOX_TOP + grid.h + 16 <= buttonY,
  };
}
