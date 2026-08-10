import { describe, expect, test } from "vitest";
import { HERO_SLUGS } from "../src/shared/charManifest";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";
import {
  CARDS_PER_HERO,
  TOTAL_CARDS,
  allCardIds,
  cardIdOf,
  cardIdsOf,
} from "../src/shared/cardManifest";
import {
  BOX_CELL_H,
  BOX_CELL_W,
  BOX_COLS,
  BOX_DIM_ALPHA,
  BOX_ENTRY_H,
  BOX_ENTRY_W,
  BOX_GAP,
  BOX_MARGIN_X,
  BOX_NAME_W,
  BOX_PROGRESS_Y,
  BOX_TITLE_Y,
  BOX_TOP,
  CARD_GRADES,
  CARD_STORAGE_KEY,
  GRADE_WEIGHTS,
  boxCellPos,
  boxEntryPos,
  boxGridSize,
  boxLayout,
  boxRowLabelY,
  cardBoxLabel,
  drawReward,
  gradeOf,
  grantCard,
  heroComplete,
  heroProgress,
  ownedCount,
  parseOwned,
  readOwned,
  rewardCaption,
  rewardFor,
  serializeOwned,
  writeOwned,
} from "../src/shared/scenes/cardRules";
import { MATCH_LOGO_SCALE } from "../src/pvp/matchRules";
import {
  STATUS_PILL_Y_RATIO,
  logoWidth,
} from "../src/shared/scenes/titleRules";
import { PILL_H } from "../src/shared/ui/pillRules";
import { T_LABEL } from "../src/shared/theme";

/**
 * 카드 수집(§10)의 규칙 검사.
 *
 * **여기서 잡으려는 실패**는 세 종류다:
 *
 * 1. **저장값이 카드 수를 오염시킨다.** 카드함이 `36/35`를 적으면 수집이 끝나지
 *    않는다 — 다 모아도 완료가 안 된다.
 * 2. **같은 시드가 다른 카드를 준다.** `Set` 순회는 삽입 순서라, 후보를
 *    정렬하지 않으면 딴 **순서**에 따라 결과가 갈린다(`grantCard` 주석).
 *    그러면 시드를 받는 의미가 없고 §C6(결정성)이 조용히 깨진다.
 * 3. **격자가 화면을 넘는다.** 7행 × 5열을 1280px에 쌓으므로 칸을 조금 키우면
 *    아래 닫기 버튼을 덮는다 — 캡처를 열기 전까지 조용하다.
 */

/** `localStorage` 대역. 던지는 구현까지 흉내내야 사파리 경로가 검사된다 */
function fakeStore(initial?: string): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  readonly data: Map<string, string>;
} {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(CARD_STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const HERO = HERO_SLUGS[0]!;

describe("획득 목록 저장", () => {
  test("모르는 id는 버린다 — 안 버리면 카드함이 36/35를 센다", () => {
    const owned = parseOwned(
      [
        cardIdOf(HERO, 1),
        // 예전 로스터의 이름. 실제로 저장돼 있을 수 있다
        "rize_01",
        // 번호 밖
        `${HERO}_00`,
        `${HERO}_09`,
        // 형태만 비슷한 것 — 매니페스트의 어떤 행과도 안 맞는다
        `${HERO}_1`,
        "",
        "쓰레기",
      ].join(","),
    );
    expect([...owned]).toEqual([cardIdOf(HERO, 1)]);
    expect(ownedCount(owned)).toBe(1);
  });

  test("빈 값·null도 빈 집합이다 — 첫 진입이 0/35다", () => {
    for (const raw of [null, undefined, "", ",,,"]) {
      expect(parseOwned(raw).size, String(raw)).toBe(0);
    }
    expect(cardBoxLabel(new Set())).toBe(`카드함 0/${TOTAL_CARDS}`);
  });

  /**
   * **한 조각이 깨져도 나머지가 산다.** JSON 배열이면 파싱 실패가 "전부 잃음"이
   * 되는데, 그건 유저에게 수집을 처음부터 다시 하라는 말이다.
   */
  test("깨진 조각 하나가 나머지를 못 지운다", () => {
    const owned = parseOwned(
      `${cardIdOf(HERO, 2)},<<깨짐>>,${cardIdOf(HERO, 4)}`,
    );
    expect([...owned].sort()).toEqual([cardIdOf(HERO, 2), cardIdOf(HERO, 4)]);
  });

  test("같은 집합이면 같은 문자열이다 — 삽입 순서가 저장값을 바꾸지 않는다", () => {
    const a = new Set([cardIdOf(HERO, 3), cardIdOf(HERO, 1)]);
    const b = new Set([cardIdOf(HERO, 1), cardIdOf(HERO, 3)]);
    expect(serializeOwned(a)).toBe(serializeOwned(b));
    expect(parseOwned(serializeOwned(a))).toEqual(a);
  });

  test("쓴 값을 그대로 읽는다", () => {
    const store = fakeStore();
    const owned = new Set([cardIdOf(HERO, 5), cardIdOf(HERO, 1)]);
    writeOwned(store, owned);
    expect(readOwned(store)).toEqual(owned);
  });

  test("저장소가 없거나 던져도 굴러간다 (사파리 프라이빗)", () => {
    expect(readOwned(null).size).toBe(0);
    const throwing = {
      getItem: (): string => {
        throw new Error("quota");
      },
      setItem: (): void => {
        throw new Error("quota");
      },
    };
    expect(readOwned(throwing).size).toBe(0);
    // 이긴 판이 크래시로 끝나면 안 된다 — 이번 판의 획득만 잃는다
    expect(() =>
      writeOwned(throwing, new Set([cardIdOf(HERO, 1)])),
    ).not.toThrow();
    expect(() => writeOwned(null, new Set())).not.toThrow();
  });
});

describe("획득 판정", () => {
  test("이기면 반드시 한 장 — 미획득 중에서만 나온다", () => {
    let owned = new Set<string>();
    const got: string[] = [];
    for (let i = 0; i < CARDS_PER_HERO; i += 1) {
      const r = rewardFor(HERO, owned, 1234 + i);
      expect(r.kind, `${i}회차`).toBe("card");
      const id = (r as { kind: "card"; id: string }).id;
      expect(owned.has(id), `${id}가 이미 있는데 또 나왔다`).toBe(false);
      got.push(id);
      owned = new Set([...owned, id]);
    }
    expect(got.sort()).toEqual(cardIdsOf(HERO).sort());
    // 다 모으면 "안 나왔다"가 아니라 "다 모았다"다
    expect(rewardFor(HERO, owned, 7).kind).toBe("complete");
    expect(grantCard(HERO, owned, 7)).toBeNull();
    expect(heroComplete(HERO, owned)).toBe(true);
  });

  test("내가 고른 캐릭터의 카드만 나온다", () => {
    const other = HERO_SLUGS[3]!;
    for (let seed = 0; seed < 40; seed += 1) {
      const id = grantCard(other, new Set(), seed);
      expect(cardIdsOf(other), `seed ${seed}`).toContain(id);
    }
  });

  test("같은 시드·같은 보유면 같은 카드다 (§C6 결정성)", () => {
    const owned = new Set([cardIdOf(HERO, 2)]);
    for (const seed of [0, 1, 99, 123456]) {
      expect(grantCard(HERO, owned, seed)).toBe(grantCard(HERO, owned, seed));
    }
  });

  /**
   * **딴 순서가 결과를 바꾸면 안 된다.** `Set` 순회는 삽입 순서이므로 후보를
   * 정렬하지 않으면 같은 보유 상태·같은 시드가 다른 카드를 준다 — 이 테스트가
   * 그 정렬을 지킨다(`grantCard`가 `.sort()`를 잃으면 여기서 걸린다).
   */
  test("딴 순서가 다음 카드를 바꾸지 않는다", () => {
    const forward = new Set([cardIdOf(HERO, 1), cardIdOf(HERO, 4)]);
    const backward = new Set([cardIdOf(HERO, 4), cardIdOf(HERO, 1)]);
    for (const seed of [0, 5, 777]) {
      expect(grantCard(HERO, forward, seed), `seed ${seed}`).toBe(
        grantCard(HERO, backward, seed),
      );
    }
  });

  test("이상한 시드에도 카드가 나온다 — 이긴 판이 빈손이 되지 않는다", () => {
    for (const seed of [NaN, Infinity, -1, 0.5, -0]) {
      const id = grantCard(HERO, new Set(), seed);
      expect(cardIdsOf(HERO), String(seed)).toContain(id);
    }
  });

  test("진행 표기가 실제 보유와 맞는다", () => {
    const owned = new Set([cardIdOf(HERO, 1), cardIdOf(HERO, 5)]);
    expect(heroProgress(HERO, owned)).toEqual({
      got: 2,
      total: CARDS_PER_HERO,
    });
    expect(heroComplete(HERO, owned)).toBe(false);
    expect(cardBoxLabel(owned)).toBe(`카드함 2/${TOTAL_CARDS}`);
    // 다 모은 상태의 표기 — 35/35여야 수집이 끝난다
    expect(cardBoxLabel(new Set(allCardIds()))).toBe(
      `카드함 ${TOTAL_CARDS}/${TOTAL_CARDS}`,
    );
  });
});

describe("등급 (3단계)", () => {
  test("번호로 갈린다 — 1~2 일반, 3~4 희귀, 5 전설", () => {
    expect(gradeOf(cardIdOf(HERO, 1))).toBe("common");
    expect(gradeOf(cardIdOf(HERO, 2))).toBe("common");
    expect(gradeOf(cardIdOf(HERO, 3))).toBe("rare");
    expect(gradeOf(cardIdOf(HERO, 4))).toBe("rare");
    expect(gradeOf(cardIdOf(HERO, CARDS_PER_HERO))).toBe("legend");
  });

  test("캐릭터마다 등급 분포가 같다 — 누구를 골라도 전설 한 장", () => {
    for (const slug of HERO_SLUGS) {
      const grades = cardIdsOf(slug).map(gradeOf);
      expect(grades.filter((g) => g === "legend").length, slug).toBe(1);
      expect(grades.filter((g) => g === "rare").length, slug).toBe(2);
      expect(grades.filter((g) => g === "common").length, slug).toBe(2);
    }
  });

  test("모르는 id는 일반이다 — 등급이 화면을 죽이지 않는다", () => {
    expect(gradeOf("깨진값")).toBe("common");
    expect(gradeOf("")).toBe("common");
    expect(gradeOf("hero_abc")).toBe("common");
  });

  test("가중치 합이 10이라 '전설 10%'가 읽는 대로다", () => {
    const total = CARD_GRADES.reduce((a, g) => a + GRADE_WEIGHTS[g], 0);
    expect(total).toBe(10);
    expect(GRADE_WEIGHTS.legend).toBe(1);
  });

  /**
   * **등급이 보장을 깨지 않는다** — 이 파일 머리의 "이기면 반드시 한 장"이
   * 등급 도입으로 확률 지급이 되면 안 된다. 남은 카드가 전설 한 장뿐인
   * 상태에서도 반드시 그 한 장이 나와야 한다(전설 가중치는 10%다).
   */
  test("남은 게 전설뿐이어도 반드시 나온다 (폴백)", () => {
    const owned = new Set(
      cardIdsOf(HERO).filter((id) => gradeOf(id) !== "legend"),
    );
    for (let seed = 0; seed < 40; seed += 1) {
      const r = rewardFor(HERO, owned, seed);
      expect(r.kind, `seed ${seed}`).toBe("card");
      expect((r as { grade: string }).grade).toBe("legend");
    }
  });

  /**
   * 반대 방향 — 전설을 이미 땄으면 전설로 굴러도 **흔한 쪽**으로 내려온다.
   * 이게 없으면 "전설을 다 따면 전설이 더 잘 나온다"가 된다(drawFrom 주석).
   */
  test("귀한 등급이 소진되면 흔한 쪽으로 폴백한다", () => {
    const owned = new Set(
      cardIdsOf(HERO).filter((id) => gradeOf(id) !== "common"),
    );
    for (let seed = 0; seed < 40; seed += 1) {
      const r = rewardFor(HERO, owned, seed);
      expect((r as { grade: string }).grade, `seed ${seed}`).toBe("common");
    }
  });

  test("보상의 등급은 카드 id에서 유도한 것과 같다 — 표기가 갈리지 않는다", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const r = rewardFor(HERO, new Set(), seed);
      if (r.kind !== "card") continue;
      expect(r.grade).toBe(gradeOf(r.id));
    }
  });

  test("문구는 등급을 말한다", () => {
    expect(rewardCaption({ kind: "card", id: cardIdOf(HERO, 5), grade: "legend" })).toBe(
      "전설 카드 획득!",
    );
    expect(rewardCaption({ kind: "card", id: cardIdOf(HERO, 1), grade: "common" })).toBe(
      "일반 카드 획득!",
    );
    expect(rewardCaption({ kind: "complete" })).toBe("수집 완료");
  });

  /** 등급이 실제로 다양하게 나온다 — 전부 한 등급이면 가중 추첨이 죽은 것이다 */
  test("여러 시드에서 등급이 갈린다 (가중 추첨이 산다)", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const r = rewardFor(HERO, new Set(), seed);
      if (r.kind === "card") seen.add(r.grade);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("심연석 뽑기 — 로스터 전체 (3단계)", () => {
  test("리드가 아닌 캐릭터의 카드도 나온다", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const r = drawReward(new Set(), seed);
      if (r.kind === "card") seen.add(r.id.slice(0, r.id.lastIndexOf("_")));
    }
    // 대전 보상(`rewardFor`)은 한 캐릭터에 갇혀 있다 — 이쪽이 그러면
    // 대전을 못 연 사람에게 나머지 여섯 명의 30장이 영구히 잠긴다
    expect(seen.size).toBeGreaterThan(1);
  });

  test("미획득 중에서만 나오고, 35장을 다 채우면 complete다", () => {
    let owned = new Set<string>();
    for (let i = 0; i < TOTAL_CARDS; i += 1) {
      const r = drawReward(owned, 500 + i);
      expect(r.kind, `${i}회차`).toBe("card");
      const id = (r as { id: string }).id;
      expect(owned.has(id), `${id}가 또 나왔다`).toBe(false);
      expect(allCardIds()).toContain(id);
      owned = new Set([...owned, id]);
    }
    expect(owned.size).toBe(TOTAL_CARDS);
    // 다 모았으면 "안 나왔다"가 아니라 "다 모았다"다 — 호출자가 심연석을
    // 차감하지 않는 분기가 이 종류를 본다(session.drawOneCard)
    expect(drawReward(owned, 7).kind).toBe("complete");
  });

  test("같은 시드·같은 보유면 같은 카드다 (§C6)", () => {
    const owned = new Set([cardIdOf(HERO, 1)]);
    for (const seed of [0, 3, 99, 123456]) {
      const a = drawReward(owned, seed);
      const b = drawReward(owned, seed);
      expect(a).toEqual(b);
    }
  });

  test("이상한 시드에도 카드가 나온다 — 낸 심연석이 빈손이 되지 않는다", () => {
    for (const seed of [NaN, Infinity, -1, 0.5, -0]) {
      const r = drawReward(new Set(), seed);
      expect(r.kind, String(seed)).toBe("card");
      expect(allCardIds()).toContain((r as { id: string }).id);
    }
  });
});

describe("카드함 격자", () => {
  test("한 줄이 한 캐릭터다 — 열 수가 장 수와 같아야 이름 하나로 설명된다", () => {
    expect(BOX_COLS).toBe(CARDS_PER_HERO);
  });

  test("칸마다 다른 자리 — 겹치면 카드 하나가 다른 하나를 덮는다", () => {
    const seen = new Set<string>();
    for (let r = 0; r < HERO_SLUGS.length; r += 1) {
      for (let c = 0; c < BOX_COLS; c += 1) {
        const p = boxCellPos(r, c);
        expect(
          seen.has(`${p.x},${p.y}`),
          `${r}행 ${c}열이 앞 칸과 같은 자리`,
        ).toBe(false);
        seen.add(`${p.x},${p.y}`);
      }
    }
    expect(seen.size).toBe(HERO_SLUGS.length * BOX_COLS);
  });

  test("이름 칸을 침범하지 않는다 — 첫 열이 이름 위에 놓이면 둘 다 못 읽는다", () => {
    expect(boxCellPos(0, 0).x).toBeGreaterThanOrEqual(BOX_NAME_W);
  });

  test("격자가 화면 폭 안에 든다", () => {
    const grid = boxGridSize(HERO_SLUGS.length);
    expect(grid.w).toBeLessThanOrEqual(DESIGN_W - BOX_MARGIN_X * 2);
    // 마지막 열의 오른쪽 끝까지 본다 — `boxGridSize`만 보면 간격 계산 실수를 놓친다
    const last = boxCellPos(0, BOX_COLS - 1);
    expect(BOX_MARGIN_X + last.x + BOX_CELL_W).toBeLessThanOrEqual(DESIGN_W);
  });

  test("7행이 닫기 버튼을 덮지 않는다 — 덮으면 카드함을 못 닫는다", () => {
    const layout = boxLayout(HERO_SLUGS.length);
    expect(layout.fits).toBe(true);
    expect(layout.gridY).toBe(BOX_TOP);
    const grid = boxGridSize(HERO_SLUGS.length);
    expect(layout.gridY + grid.h).toBeLessThan(layout.buttonY);
    expect(layout.buttonY).toBeLessThan(DESIGN_H);
  });

  /**
   * 캐릭터가 늘면 격자가 버튼을 덮는다. **`fits`가 그걸 말해야 한다** — 항상
   * true를 돌려주면 이 배치 검사 전체가 아무것도 안 지킨다.
   */
  test("행이 너무 많으면 fits가 false다 — 늘 true면 검사가 무의미하다", () => {
    expect(boxLayout(40).fits).toBe(false);
  });

  test("칸이 썸네일과 같은 3:4다 — 어긋나면 그림이 눌린다", () => {
    expect(BOX_CELL_H / BOX_CELL_W).toBeCloseTo(4 / 3, 5);
    // 110×147 썸네일을 확대하지 않는 편이 좋다(도트가 뭉갠다)
    expect(BOX_CELL_W).toBeLessThanOrEqual(110);
  });

  test("칸 사이에 틈이 있다 — 붙으면 다섯 장이 한 장으로 읽힌다", () => {
    expect(BOX_GAP).toBeGreaterThan(0);
    expect(boxCellPos(0, 1).x - (boxCellPos(0, 0).x + BOX_CELL_W)).toBe(
      BOX_GAP,
    );
    expect(boxCellPos(1, 0).y - (boxCellPos(0, 0).y + BOX_CELL_H)).toBe(
      BOX_GAP,
    );
  });

  test("이상한 행·열도 격자 안에 떨어진다", () => {
    for (const bad of [NaN, -1, Infinity, 0.4]) {
      const p = boxCellPos(bad, bad);
      expect(Number.isFinite(p.x), String(bad)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(BOX_NAME_W);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * 캡처에서 잡은 실제 결함이다: 이름 두 줄짜리 캐릭터(로스터 7종 중 6종)에서
   * 두 번째 줄이 `0/5` 위에 겹쳐 찍혔다. 고정 오프셋이 "이름은 한 줄"이라는
   * 가정을 숨기고 있었다.
   */
  test("이름이 두 줄이어도 수 라벨과 겹치지 않는다", () => {
    const h = 26;
    for (const lines of [1, 2, 3]) {
      const { nameY, countY } = boxRowLabelY(lines, h);
      // 이름 블록의 아래 끝 < 수 라벨의 위 끝
      const nameBottom = nameY + (lines * h) / 2;
      const countTop = countY - h / 2;
      expect(countTop, `lines=${lines}`).toBeGreaterThanOrEqual(nameBottom);
    }
  });

  test("두 라벨은 칸 세로 중앙에 쌓인다 — 줄 수가 늘어도 한쪽으로 쏠리지 않는다", () => {
    const h = 26;
    for (const lines of [1, 2, 3]) {
      const { nameY, countY } = boxRowLabelY(lines, h);
      const top = nameY - (lines * h) / 2;
      const bottom = countY + h / 2;
      expect((top + bottom) / 2, `lines=${lines}`).toBeCloseTo(
        BOX_CELL_H / 2,
        5,
      );
    }
  });

  test("두 라벨 모두 칸 높이 안에 있다", () => {
    for (const lines of [1, 2]) {
      const { nameY, countY } = boxRowLabelY(lines, 26);
      expect(nameY - 13, `lines=${lines}`).toBeGreaterThanOrEqual(0);
      expect(countY + 13, `lines=${lines}`).toBeLessThanOrEqual(BOX_CELL_H);
    }
  });

  test("이상한 줄 수·줄 높이도 유한한 자리를 돌려준다", () => {
    for (const bad of [NaN, 0, -3, Infinity, 1.6]) {
      const a = boxRowLabelY(bad, 26);
      const b = boxRowLabelY(2, bad);
      expect(Number.isFinite(a.nameY), `lines=${bad}`).toBe(true);
      expect(Number.isFinite(a.countY), `lines=${bad}`).toBe(true);
      expect(Number.isFinite(b.nameY), `lineH=${bad}`).toBe(true);
      expect(Number.isFinite(b.countY), `lineH=${bad}`).toBe(true);
    }
  });

  /** 한 줄일 때는 손으로 맞춰 뒀던 -12/+14와 같은 자리여야 한다 (회귀 방지) */
  test("한 줄이면 기존 자리(-12/+14)와 같다", () => {
    const { nameY, countY } = boxRowLabelY(1, 26);
    expect(nameY).toBeCloseTo(BOX_CELL_H / 2 - 13, 5);
    expect(countY).toBeCloseTo(BOX_CELL_H / 2 + 13, 5);
  });
});

describe("카드함 입구 버튼 (대기 화면)", () => {
  test("화면 안에 있다", () => {
    const p = boxEntryPos();
    expect(p.x).toBeGreaterThan(0);
    expect(p.x + BOX_ENTRY_W).toBeLessThanOrEqual(DESIGN_W);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y + BOX_ENTRY_H).toBeLessThan(DESIGN_H);
  });

  /**
   * 대기 화면은 세로가 다 차 있다 — 로고 0.07 · 제목 0.15 · 링 0.28 ·
   * 토스트 0.355 · 카드 0.42/0.64 · 스트립 0.8 · 힌트 0.875 · 건너뛰기 0.925.
   * 버튼은 로고 띠의 **오른쪽 빈 자리**에 놓인다.
   *
   * 폭을 손으로 곱하지 않는다(`DESIGN_W * 0.45 * 0.42`) — 로고는 폰트 크기를
   * 도트 격자로 접고 장식이 **접힌 비**를 따르므로 실제 배율이 0.42가 아니라
   * 0.5다. 처음에 그렇게 계산했다가 로고를 20% 좁게 봤다. `logoWidth`가
   * 그리는 쪽과 같은 규칙으로 답한다.
   */
  test("로고와 가로로 겹치지 않는다", () => {
    const logoRight = DESIGN_W / 2 + logoWidth(DESIGN_W, MATCH_LOGO_SCALE) / 2;
    expect(boxEntryPos().x).toBeGreaterThanOrEqual(logoRight);
  });

  test("가장 긴 라벨이 버튼 폭에 든다 — `카드함 35/35`가 잘리면 수를 못 읽는다", () => {
    const label = cardBoxLabel(new Set(allCardIds()));
    // 도트 폰트는 한글 1em·숫자 0.5em 정도다(T_BODY 24px 기준). 잘림은 캡처로
    // 판정하지만(메모리 [[judge-by-capture-not-metrics]]) 폭이 라벨보다 좁아지는
    // 것은 여기서 막는다 — 상수 하나만 줄여도 조용히 잘린다
    expect(BOX_ENTRY_W).toBeGreaterThanOrEqual(label.length * 12);
  });
});

/**
 * 카드함 배경막 — **밑 화면이 카드함 글자와 겹치지 않는가.**
 *
 * 캡처에서 잡은 결함이다(1:1 720×1280, 타이틀에서 열었다): 배경막이 0.92라
 * 타이틀의 연결 상태 필이 진행 표기(`카드함 0/35`)를 가로질러 찍히고 하단 조작
 * 힌트가 `닫기` 버튼 위로 올라왔다. 화면에서는 **글자가 깨진 것**으로 읽힌다 —
 * 그래서 텍스트 쪽을 의심하게 되고, 원인인 불투명도는 조용하다.
 *
 * 겹침 자체를 좌표로 물을 수는 없다(밑 화면의 위젯은 카드함이 모른다). 물을 수
 * 있는 것은 **가리는가**다. 불투명하면 밑에 무엇이 있든 안 보이므로, 호출자가
 * 늘어도(지금 타이틀·대기 둘) 이 결함이 다시 안 생긴다.
 */
describe("카드함 배경막 — 밑 화면을 가린다", () => {
  test("불투명하다 — 반투명이면 밑 화면 위젯이 카드함 글자와 겹친다", () => {
    expect(BOX_DIM_ALPHA).toBe(1);
  });

  /**
   * 타이틀의 두 위젯이 실제로 카드함 글자 띠를 지난다는 대조군이다. 이게 없으면
   * 위 검사가 "불투명이 좋다"는 취향으로 읽힌다 — 겹치는 위젯이 정말 있는지를
   * 두 화면의 **실제 좌표**로 확인한다(메모리 [[controls-must-hit-target-branch]]).
   */
  test("겹치는 위젯이 실제로 있다 — 필이 진행 표기 띠를 지난다", () => {
    const pillTop = DESIGN_H * STATUS_PILL_Y_RATIO;
    const pillBottom = pillTop + PILL_H;
    // 진행 표기는 `BOX_PROGRESS_Y`가 세로 중심이다(anchor 0.5)
    expect(pillTop).toBeLessThan(BOX_PROGRESS_Y + T_LABEL.size / 2);
    expect(pillBottom).toBeGreaterThan(BOX_PROGRESS_Y - T_LABEL.size / 2);
    // 제목보다는 아래다 — 겹치는 것은 진행 표기 쪽이라는 사실까지 고정한다
    expect(pillTop).toBeGreaterThan(BOX_TITLE_Y);
  });

  test("제목이 진행 표기 위에 있다 — 둘이 겹치면 배경막과 무관하게 못 읽는다", () => {
    expect(BOX_TITLE_Y).toBeLessThan(BOX_PROGRESS_Y);
    expect(BOX_PROGRESS_Y - BOX_TITLE_Y).toBeGreaterThanOrEqual(T_LABEL.size);
    // 둘 다 격자 위쪽 띠 안이다 — 넘치면 첫 행 카드를 덮는다
    expect(BOX_PROGRESS_Y + T_LABEL.size / 2).toBeLessThan(BOX_TOP);
  });
});
