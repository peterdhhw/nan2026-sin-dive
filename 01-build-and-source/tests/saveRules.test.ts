import { describe, expect, it } from "vitest";
import {
  SINGLE_CHOICES_KEY,
  SINGLE_CURRENCY_KEY,
  SINGLE_FLOOR_KEY,
  SINGLE_GROWN_KEY,
  SINGLE_LAST_TICK_KEY,
  SINGLE_STORY_KEY,
  SINGLE_UPGRADES_KEY,
  parseChoices,
  parseCurrencyAbyss,
  parseCurrencyGold,
  parseFloor,
  parseGrown,
  parseLastTickMs,
  parseStorySeen,
  parseUpgrades,
  readSingleSave,
  serializeCurrency,
  serializeGrown,
  serializeStorySeen,
  serializeUpgrades,
  unknownCurrencyParts,
  writeCurrency,
  writeFloor,
  writeGrown,
  writeLastTickMs,
  writeStorySeen,
  writeUpgrades,
} from "../src/single/saveRules";
import { emptyLevels } from "../src/single/economyRules";

/** 테스트용 인메모리 저장소 — pickStore()와 같은 형태 */
function memStore(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

describe("키 규칙 — 접두사 sin.single.", () => {
  it("모든 키가 sin.single. 접두사를 쓴다 (abyss.*는 건드리지 않는다)", () => {
    for (const key of [
      SINGLE_FLOOR_KEY,
      SINGLE_CHOICES_KEY,
      SINGLE_CURRENCY_KEY,
      SINGLE_UPGRADES_KEY,
      SINGLE_LAST_TICK_KEY,
      SINGLE_STORY_KEY,
      SINGLE_GROWN_KEY,
    ]) {
      expect(key.startsWith("sin.single.")).toBe(true);
    }
  });
});

describe("parseFloor — 진행도는 버리지 않고 접는다", () => {
  it("없으면 1층, 범위 밖은 clamp, 쓰레기는 1층", () => {
    expect(parseFloor(null)).toBe(1);
    expect(parseFloor("372")).toBe(372);
    expect(parseFloor("0")).toBe(1);
    expect(parseFloor("99999")).toBe(9999);
    expect(parseFloor("abc")).toBe(1);
  });
});

describe("parseChoices — 수용 횟수", () => {
  it("음수·쓰레기는 0, 정상 값은 내림 정수다", () => {
    expect(parseChoices(null)).toBe(0);
    expect(parseChoices("3")).toBe(3);
    expect(parseChoices("2.9")).toBe(2);
    expect(parseChoices("-2")).toBe(0);
    expect(parseChoices("abc")).toBe(0);
  });
});

describe("parseCurrencyGold — 0과 읽기 실패는 다른 값이다 (SAVE-SCHEMA §4-3)", () => {
  it("없으면(첫 방문) 0이다", () => {
    expect(parseCurrencyGold(null)).toBe(0);
  });

  it("정상 형식은 gold 값을 읽는다, 모르는 재화는 무시한다", () => {
    expect(parseCurrencyGold("gold:123")).toBe(123);
    expect(parseCurrencyGold("gold:123,gem:4,abyss:0")).toBe(123);
    expect(parseCurrencyGold("gem:4,gold:7")).toBe(7);
  });

  it("값이 있는데 gold를 못 읽으면 null(실패)이다 — 0이 아니다", () => {
    expect(parseCurrencyGold("gold:abc")).toBeNull();
    expect(parseCurrencyGold("gold:-5")).toBeNull();
    expect(parseCurrencyGold("gem:4")).toBeNull();
    expect(parseCurrencyGold("완전깨진값")).toBeNull();
  });

  it("직렬화 왕복이 성립한다", () => {
    expect(parseCurrencyGold(serializeCurrency(987))).toBe(987);
    // 3단계부터 한 줄에 두 잔고가 산다 — 골드만 적으면 심연석이 지워진다
    expect(serializeCurrency(12.9)).toBe("gold:12,abyss:0");
    expect(serializeCurrency(-3)).toBe("gold:0,abyss:0");
  });
});

describe("parseCurrencyAbyss — 옛 저장값에는 이 항목이 없다", () => {
  it("항목이 없으면 0이다 (골드와 갈리는 지점)", () => {
    // 골드는 "gem:4"만 있으면 null(실패)이지만 심연석은 0이다. 3단계 이전
    // 저장값에는 이 항목이 아예 없으므로, 그걸 실패로 보면 그 사람은 뽑기가
    // 영구히 잠긴다 — 잔고 실패는 소비를 막기 때문이다(§4-3)
    expect(parseCurrencyAbyss(null)).toBe(0);
    expect(parseCurrencyAbyss("gold:120")).toBe(0);
    expect(parseCurrencyAbyss("gem:4")).toBe(0);
  });

  it("항목이 있으면 읽고, 깨졌으면 null(실패)이다", () => {
    expect(parseCurrencyAbyss("gold:1,abyss:30")).toBe(30);
    expect(parseCurrencyAbyss("abyss:2.9")).toBe(2);
    expect(parseCurrencyAbyss("abyss:xyz")).toBeNull();
    expect(parseCurrencyAbyss("abyss:-5")).toBeNull();
  });

  it("왕복", () => {
    expect(parseCurrencyAbyss(serializeCurrency(10, 47))).toBe(47);
  });
});

describe("모르는 재화 조각은 살아 남는다 (본선의 젬을 미리 지우지 않는다)", () => {
  it("아는 키만 골라내고 나머지는 그대로 돌려준다", () => {
    expect(unknownCurrencyParts("gold:1,abyss:2")).toEqual([]);
    expect(unknownCurrencyParts("gold:1,gem:4,ticket:2")).toEqual(["gem:4", "ticket:2"]);
    expect(unknownCurrencyParts(null)).toEqual([]);
  });

  it("읽기 → 쓰기 왕복에서 모르는 조각이 보존된다", () => {
    const store = memStore({ [SINGLE_CURRENCY_KEY]: "gold:500,gem:4,abyss:30" });
    const save = readSingleSave(store);
    expect(save.gold).toBe(500);
    expect(save.abyss).toBe(30);
    expect(save.currencyUnknown).toEqual(["gem:4"]);
    // 세션이 하는 그대로 되돌려 쓴다 — 이 왕복이 깨지면 새 빌드가 남의 재화를 지운다
    writeCurrency(store, save.gold as number, save.abyss as number, save.currencyUnknown);
    expect(parseCurrencyGold(store.dump()[SINGLE_CURRENCY_KEY])).toBe(500);
    expect(store.dump()[SINGLE_CURRENCY_KEY]).toContain("gem:4");
  });
});

describe("parseUpgrades — 모르는 id는 버리고 아는 것만 산다", () => {
  it("정상 왕복", () => {
    const levels = { atk: 12, spd: 3, gold: 0, skill: 5 };
    expect(parseUpgrades(serializeUpgrades(levels))).toEqual(levels);
  });

  it("깨진 조각·모르는 id가 있어도 나머지는 산다 (콤마 구분의 근거)", () => {
    expect(parseUpgrades("atk:4,zzz:9,spd:깨짐,gold:2")).toEqual({
      ...emptyLevels(),
      atk: 4,
      gold: 2,
    });
  });

  it("없으면 전부 0이다", () => {
    expect(parseUpgrades(null)).toEqual(emptyLevels());
  });
});

describe("parseLastTickMs / parseStorySeen", () => {
  it("lastTick: 양수 epoch ms만 통과, 아니면 null(방치 보상 없음)", () => {
    expect(parseLastTickMs("1754200000000")).toBe(1754200000000);
    expect(parseLastTickMs("0")).toBeNull();
    expect(parseLastTickMs("-1")).toBeNull();
    expect(parseLastTickMs("abc")).toBeNull();
    expect(parseLastTickMs(null)).toBeNull();
  });

  it("story: 형식에 맞는 id만 통과하고 정렬 직렬화된다", () => {
    const seen = parseStorySeen("prologue,boss-100,깨진 값,boss_200");
    expect(seen).toEqual(new Set(["prologue", "boss-100", "boss_200"]));
    expect(serializeStorySeen(new Set(["b", "a"]))).toBe("a,b");
  });
});

describe("readSingleSave — 저장소 경유", () => {
  it("빈 저장소(첫 방문)는 1층·0골드·강화 0에서 시작한다", () => {
    const save = readSingleSave(memStore());
    expect(save.floor).toBe(1);
    expect(save.choices).toBe(0);
    expect(save.gold).toBe(0);
    expect(save.abyss).toBe(0);
    expect(save.upgrades).toEqual(emptyLevels());
    expect(save.lastTickMs).toBeNull();
    expect(save.storySeen.size).toBe(0);
  });

  it("store가 null(프라이빗 모드)이면 잔고는 실패(null)다 — 소비가 막힌다", () => {
    const save = readSingleSave(null);
    expect(save.gold).toBeNull();
    expect(save.floor).toBe(1);
  });

  it("쓰기 → 읽기 왕복", () => {
    const store = memStore();
    writeFloor(store, 372);
    writeCurrency(store, 4567, 30);
    writeUpgrades(store, { atk: 2, spd: 1, gold: 0, skill: 3 });
    writeLastTickMs(store, 1754200000000);
    writeStorySeen(store, new Set(["prologue"]));
    const save = readSingleSave(store);
    expect(save.floor).toBe(372);
    expect(save.gold).toBe(4567);
    expect(save.abyss).toBe(30);
    expect(save.upgrades).toEqual({ atk: 2, spd: 1, gold: 0, skill: 3 });
    expect(save.lastTickMs).toBe(1754200000000);
    expect(save.storySeen.has("prologue")).toBe(true);
  });

  it("getItem이 throw해도 죽지 않는다 (사파리 프라이빗 모드 방어)", () => {
    const store = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const save = readSingleSave(store);
    expect(save.floor).toBe(1);
    // getItem 실패는 "값을 알 수 없음"이므로 잔고도 실패로 남는다.
    // 두 잔고가 같은 키에 사니 실패도 같이 온다 — 심연석만 0으로 남으면
    // "번 적 없음"으로 위장되어 뽑기가 열린다
    expect(save.gold).toBeNull();
    expect(save.abyss).toBeNull();
    expect(() => writeCurrency(store, 10, 3)).not.toThrow();
  });
});

describe("parseGrown — 싱글에서 키운 캐릭터", () => {
  it("콤마 구분 슬러그를 읽는다", () => {
    expect(parseGrown("water_priestess,leaf_ranger")).toEqual(
      new Set(["water_priestess", "leaf_ranger"]),
    );
  });

  it("값이 없으면 빈 집합 — 첫 방문은 아무도 안 키웠다", () => {
    expect(parseGrown(null)).toEqual(new Set());
    expect(parseGrown(undefined)).toEqual(new Set());
    expect(parseGrown("")).toEqual(new Set());
  });

  /**
   * 로스터가 바뀌면 저장값이 유효하지 않다 — 자체 생성 4종에서 chierit 7종으로
   * 갈아탄 이력이 있고, 그때 남은 `rize`를 그대로 믿으면 프리셋에 없는 슬러그가
   * PvP 선택지로 올라온다. `parseStoredPick`과 같은 방어다.
   */
  it("로스터에 없는 슬러그는 버린다 — 깨진 조각만 잃는다", () => {
    expect(parseGrown("water_priestess,rize,leaf_ranger")).toEqual(
      new Set(["water_priestess", "leaf_ranger"]),
    );
  });

  it("공백·빈 조각을 견딘다", () => {
    expect(parseGrown(" water_priestess , , leaf_ranger ")).toEqual(
      new Set(["water_priestess", "leaf_ranger"]),
    );
  });

  it("중복은 집합이 흡수한다", () => {
    expect(parseGrown("leaf_ranger,leaf_ranger")).toEqual(
      new Set(["leaf_ranger"]),
    );
  });
});

describe("serializeGrown / writeGrown", () => {
  /**
   * **순서를 고정한다** — `HERO_SLUGS` 순서로 쓴다. `Set` 삽입 순서로 쓰면 같은
   * 집합이 저장할 때마다 다른 문자열이 되어, 저장값 비교로 회귀를 잡을 수 없다
   * (`serializeUpgrades`가 `UPGRADE_IDS` 순서를 쓰는 것과 같은 근거).
   */
  it("HERO_SLUGS 순서로 쓴다 — 같은 집합이면 같은 문자열", () => {
    const a = serializeGrown(new Set(["leaf_ranger", "water_priestess"]));
    const b = serializeGrown(new Set(["water_priestess", "leaf_ranger"]));
    expect(a).toBe(b);
    expect(a).toBe("water_priestess,leaf_ranger");
  });

  it("빈 집합은 빈 문자열", () => {
    expect(serializeGrown(new Set())).toBe("");
  });

  it("왕복한다", () => {
    const grown = new Set(["water_priestess", "fire_knight"] as const);
    expect(parseGrown(serializeGrown(grown))).toEqual(grown);
  });

  it("writeGrown이 키에 쓰고 readSingleSave가 읽는다", () => {
    const store = memStore();
    writeGrown(store, new Set(["leaf_ranger"]));
    expect(store.getItem(SINGLE_GROWN_KEY)).toBe("leaf_ranger");
    expect(readSingleSave(store).grown).toEqual(new Set(["leaf_ranger"]));
  });

  it("저장값이 없으면 빈 집합이다 — 첫 방문", () => {
    expect(readSingleSave(memStore()).grown).toEqual(new Set());
  });

  /** 저장 실패는 삼킨다 — 크래시보다 이번 진행을 잃는 것이 낫다 */
  it("저장소가 null이어도 던지지 않는다", () => {
    expect(() => writeGrown(null, new Set(["leaf_ranger"]))).not.toThrow();
  });

  /**
   * 세션의 `persist()`가 하는 그 동작이다 — 읽은 집합에 지금 캐릭터를 더해서
   * 쓴다. 세션은 Pixi를 쓰므로 node 테스트가 못 불러오지만, 규칙은 여기서
   * 박아 둘 수 있다: **덮어쓰기면 앞의 성장이 사라진다.**
   */
  it("기존 목록에 더한다 — 다른 캐릭터로 하강해도 앞의 성장이 남는다", () => {
    const store = memStore();
    writeGrown(store, new Set(["water_priestess"]));
    const grown = readSingleSave(store).grown;
    grown.add("leaf_ranger");
    writeGrown(store, grown);
    expect(readSingleSave(store).grown).toEqual(
      new Set(["water_priestess", "leaf_ranger"]),
    );
  });
});
