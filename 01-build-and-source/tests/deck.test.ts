import { describe, expect, it } from "vitest";
import {
  ABYSS_PER_MINIBOSS,
  ABYSS_PER_NAMED_BOSS,
  CARDS_PER_BOSS_FLOOR,
  CARD_ATK_CAP,
  CARD_ATK_STEP,
  DRAW_COST,
  abyssForFloorClear,
  canDraw,
  cardAtkMul,
  cardsForFloorClear,
} from "../src/core/deck/deck";
import { TOTAL_CARDS } from "../src/shared/cardManifest";
import {
  MINIBOSS_EVERY,
  NAMED_BOSS_EVERY,
  floorKindOf,
} from "../src/core/phase/phaseWaves";

describe("cardAtkMul — 카드 수 → ATK 배율", () => {
  it("0장이면 정확히 1이다 — 카드가 없는 사람의 판은 3단계 전과 같아야 한다", () => {
    expect(cardAtkMul(0)).toBe(1);
  });

  it("한 장이 한 걸음이다", () => {
    expect(cardAtkMul(1)).toBeCloseTo(1 + CARD_ATK_STEP);
    expect(cardAtkMul(5)).toBeCloseTo(1 + 5 * CARD_ATK_STEP);
  });

  /**
   * **한 장도 손해가 되지 않는다.** 단조 증가가 깨지면 카드를 딴 판이 전보다
   * 느려지는 구간이 생기고, 그건 보상이 벌점으로 읽히는 것이다. 상한에
   * 닿은 뒤로도 줄지는 않아야 하므로 `>=`로 묻는다.
   */
  it("장수가 늘면 배율이 줄지 않는다", () => {
    let prev = cardAtkMul(0);
    for (let n = 1; n <= TOTAL_CARDS + 20; n++) {
      const cur = cardAtkMul(n);
      expect(cur, `${n}장`).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  /**
   * **상한은 만재보다 위에 있어야 한다** — 아니면 카드함 끝의 몇 장이 아무
   * 것도 하지 않는다. 이 검사가 상한 상수와 카드 총수를 묶어 둔다: 본선에서
   * 로스터가 늘어 총수가 커지면 여기가 먼저 깨진다.
   */
  it("35장 만재가 상한에 닿지 않는다", () => {
    expect(cardAtkMul(TOTAL_CARDS)).toBeCloseTo(1 + TOTAL_CARDS * CARD_ATK_STEP);
    expect(cardAtkMul(TOTAL_CARDS)).toBeLessThan(CARD_ATK_CAP);
  });

  it("상한을 넘지 않는다", () => {
    const overflow = Math.ceil((CARD_ATK_CAP - 1) / CARD_ATK_STEP) + 10;
    expect(cardAtkMul(overflow)).toBe(CARD_ATK_CAP);
    expect(cardAtkMul(1e9)).toBe(CARD_ATK_CAP);
  });

  /**
   * **깨진 값은 "효과 없음"으로 간다.** 배율이 NaN이 되면 팀 딜 전체가 NaN이
   * 되어 적 HP가 안 줄고 화면이 멈춘 것처럼 보인다 — 실패는 조용한 쪽이 아니라
   * 안전한 쪽으로 가야 한다.
   */
  it("비유한·음수·소수는 접는다", () => {
    expect(cardAtkMul(Number.NaN)).toBe(1);
    expect(cardAtkMul(Number.POSITIVE_INFINITY)).toBe(1);
    expect(cardAtkMul(-5)).toBe(1);
    expect(cardAtkMul(2.9)).toBe(cardAtkMul(2));
  });
});

describe("심연석 — 뽑기 재화", () => {
  it("일반 층은 0이다 — 층마다 주면 한 판에 세트가 끝난다", () => {
    expect(abyssForFloorClear("minions")).toBe(0);
    expect(abyssForFloorClear("miniboss")).toBe(ABYSS_PER_MINIBOSS);
    expect(abyssForFloorClear("boss")).toBe(ABYSS_PER_NAMED_BOSS);
  });

  /**
   * **획득 속도가 뽑기 비용에 맞물려 있어야 한다.** 100층까지 내려간 사람이
   * 카드를 한 장도 못 뽑으면 심연석은 화면의 장식이고, 반대로 수십 장이
   * 나오면 `cardAtkMul`의 곡선이 첫 판에 끝난다. 층 종류는 코어가 정본이므로
   * (`floorKindOf`) 여기서 실제로 세어 부등식을 고정한다.
   */
  it("100층까지 벌면 몇 장은 뽑고, 세트가 끝나지는 않는다", () => {
    let earned = 0;
    for (let f = 1; f <= 100; f += 1) earned += abyssForFloorClear(floorKindOf(f));
    // 미니보스 9개(10~90) + 네임드 1개(100)
    expect(earned).toBe(9 * ABYSS_PER_MINIBOSS + ABYSS_PER_NAMED_BOSS);
    const draws = Math.floor(earned / DRAW_COST);
    expect(draws).toBeGreaterThanOrEqual(2);
    expect(draws).toBeLessThan(TOTAL_CARDS);
  });

  it("네임드 층은 미니보스보다 훨씬 값지다 (100층 간격의 값)", () => {
    expect(ABYSS_PER_NAMED_BOSS).toBeGreaterThan(
      ABYSS_PER_MINIBOSS * (NAMED_BOSS_EVERY / MINIBOSS_EVERY / 2),
    );
  });

  /**
   * 보스 층 카드 지급 (유저 신고: "왜 내려가는데 카드가 안 생겨?").
   *
   * 심연석과 **다른 함수**라서 따로 묻는다 — 둘이 같은 층 종류를 보지만 한쪽만
   * 고치는 일이 실제로 있을 수 있고, 그때 "10층마다 1장"이 조용히 깨진다.
   */
  it("잡몹 층은 0장, 보스 층은 1장이다", () => {
    expect(cardsForFloorClear("minions")).toBe(0);
    expect(cardsForFloorClear("miniboss")).toBe(CARDS_PER_BOSS_FLOOR);
    // 네임드 층을 빼먹는 것이 이 함수의 유일한 실수 형태다 (`floorKindOf(100)`
    // 이 `"boss"`이므로 `=== "miniboss"`로 쓰면 딱 열 번째만 0장이 된다)
    expect(cardsForFloorClear("boss")).toBe(CARDS_PER_BOSS_FLOOR);
  });

  /**
   * **도달 가능한 층으로만 센다.** 종류 문자열 세 개를 직접 넣는 위 검사는
   * `floorKindOf`가 그 종류를 실제로 언제 돌려주는지 안 묻는다 — 100층에서
   * 카드가 끊기는 형태가 그 틈으로 지나간다(`only-reachable-cases-count`).
   */
  it("100층까지 내려가면 10장이 들어온다 — 열 번째도 빠지지 않는다", () => {
    let cards = 0;
    for (let f = 1; f <= 100; f += 1) cards += cardsForFloorClear(floorKindOf(f));
    expect(cards).toBe(10 * CARDS_PER_BOSS_FLOOR);
    // 심연석 뽑기(3장)와 합쳐도 35장 카드함이 한 판에 끝나지 않는다
    let earned = 0;
    for (let f = 1; f <= 100; f += 1) earned += abyssForFloorClear(floorKindOf(f));
    expect(cards + Math.floor(earned / DRAW_COST)).toBeLessThan(TOTAL_CARDS);
  });

  it("canDraw — 비용에 닿으면 뽑고, 잔고 실패(null)는 막는다", () => {
    expect(canDraw(DRAW_COST)).toBe(true);
    expect(canDraw(DRAW_COST + 1)).toBe(true);
    expect(canDraw(DRAW_COST - 1)).toBe(false);
    expect(canDraw(0)).toBe(false);
    // null은 "잔고를 모른다"다 — 모르는 잔고에서 빼면 실패가 손실로 굳는다(§4-3)
    expect(canDraw(null)).toBe(false);
    expect(canDraw(Number.NaN)).toBe(false);
    expect(canDraw(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
