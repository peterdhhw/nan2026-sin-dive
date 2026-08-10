import { describe, expect, it } from "vitest";
import {
  PICK_CELL_H,
  PICK_CELL_W,
  PICK_COLS,
  PICK_GRID_GAP,
  PICK_ROWS,
  PICK_STORAGE_KEY,
  defaultPick,
  parseStoredPick,
  pickCell,
  pickGridSize,
  pickLayout,
  pickPreviewY,
  pickAnySelectable,
  pickEmptyNotice,
  pickLockNotice,
  pickSelectable,
  readPick,
  writePick,
} from "../src/shared/scenes/pickRules";
import { HERO_SLUGS, PICK_SLUGS } from "../src/shared/charManifest";
import { DESIGN_W } from "../src/shared/viewport";

function memStore(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("복원된 선택 규칙", () => {
  it("로스터에 없는 슬러그는 null — 옛 저장값 방어", () => {
    expect(parseStoredPick("rize")).toBeNull();
    expect(parseStoredPick("water_priestess")).toBe("water_priestess");
  });

  it("기본 선택은 항상 하나 있다 — 아무 칸도 안 켜진 화면을 막는다", () => {
    expect(defaultPick(null)).toBe(PICK_SLUGS[0]);
  });

  it("왕복 저장", () => {
    const store = memStore();
    writePick(store, "metal_bladekeeper");
    expect(store.getItem(PICK_STORAGE_KEY)).toBe("metal_bladekeeper");
    expect(readPick(store)).toBe("metal_bladekeeper");
  });

  it("배치가 성립한다 — 미리보기 높이가 남는다", () => {
    expect(pickLayout().previewH).toBeGreaterThan(0);
  });

  it("격자 크기는 빈 칸도 자리를 먹는다", () => {
    const g = pickGridSize({ cellW: 100, cellH: 100, gap: 10 });
    expect(g.w).toBe(210);
    expect(g.h).toBe(PICK_ROWS * 100 + (PICK_ROWS - 1) * 10);
  });
});

describe("pickSelectable — 모드마다 다른 잠금", () => {
  /**
   * 싱글은 전부 고를 수 있다. 요구사항 1은 "고를 수 있고"이지 "잠근다"가 아니다 —
   * 여기서 잠그면 첫 방문자가 아무 캐릭터도 못 골라 게임에 못 들어간다.
   */
  it("싱글에서는 전부 고를 수 있다 — 키운 목록이 비어 있어도", () => {
    for (const s of HERO_SLUGS) {
      expect(pickSelectable(s, { mode: "single", grown: new Set() })).toBe(true);
    }
  });

  /** PvP는 키운 캐릭터만 (요구사항 3) */
  it("PvP는 키운 캐릭터만 고를 수 있다", () => {
    const grown = new Set(["leaf_ranger"]);
    expect(pickSelectable("leaf_ranger", { mode: "pvp", grown })).toBe(true);
    expect(pickSelectable("fire_knight", { mode: "pvp", grown })).toBe(false);
  });

  it("잠금 안내가 왜 못 고르는지 말한다", () => {
    expect(pickLockNotice("pvp")).toContain("싱글");
  });
});

describe("PvP 선택지가 0개인 경우 — 요구사항 3의 실패 모드", () => {
  /**
   * 대전은 100층으로 잠겨 있으므로(`PVP_UNLOCK_FLOOR`) 100층을 찍은 사람은
   * 반드시 누군가를 키웠다 — `persist()`가 하강 중에 기록한다. 그래서 정상
   * 경로로는 0개가 나오지 않는다. **그래도 판정을 둔다**: 심사자 해제
   * 링크(`?unlock=pvp`)가 층수를 조작하지 않고 입구만 열기 때문에, 그 경로로는
   * 0개가 실제로 도달 가능하다 — 도달 못 하는 경우를 막는 코드가 아니다.
   */
  it("키운 캐릭터가 없으면 고를 수 있는 칸이 0개다", () => {
    const open = HERO_SLUGS.filter((s) =>
      pickSelectable(s, { mode: "pvp", grown: new Set() }),
    );
    expect(open).toHaveLength(0);
  });

  it("1명만 키웠으면 1칸만 열린다 — 사용자 지시 그대로", () => {
    const open = HERO_SLUGS.filter((s) =>
      pickSelectable(s, { mode: "pvp", grown: new Set(["leaf_ranger"]) }),
    );
    expect(open).toEqual(["leaf_ranger"]);
  });

  it("pickAnySelectable이 0개를 말한다", () => {
    expect(pickAnySelectable({ mode: "pvp", grown: new Set() })).toBe(false);
    expect(pickAnySelectable({ mode: "single", grown: new Set() })).toBe(true);
  });

  /** **격자 안**의 캐릭터를 키웠으면 — 격자 밖은 아래 별도 검사가 본다 */
  it("키운 캐릭터가 하나라도 있으면 막다른 길이 아니다", () => {
    expect(
      pickAnySelectable({ mode: "pvp", grown: new Set(["metal_bladekeeper"]) }),
    ).toBe(true);
  });

  /**
   * 로스터에 없는 슬러그만 저장돼 있으면 **0개와 같다.** 저장이 comma 문자열이라
   * (`serializeGrown`) 로스터가 바뀐 뒤의 옛 값이 그대로 남아 있을 수 있다 —
   * `parseGrown`이 걸러 내지만, 여기까지 통과했더라도 격자에는 켤 칸이 없다.
   */
  it("모르는 슬러그만 있으면 0개다 — 로스터가 바뀐 뒤의 옛 저장", () => {
    expect(pickAnySelectable({ mode: "pvp", grown: new Set(["rize"]) })).toBe(
      false,
    );
  });

  /**
   * 빈 화면 안내와 잠긴 칸 안내가 **같은 문장이면 안 된다.** 저쪽은 "다른 칸을
   * 골라라"로 읽히는데 여기서는 고를 칸 자체가 없다 — 같으면 사람이 다른 칸을
   * 눌러 보며 시간을 버린다.
   */
  it("빈 화면 안내는 잠긴 칸 안내와 다르고, 나갈 길을 말한다", () => {
    expect(pickEmptyNotice("pvp")).not.toBe(pickLockNotice("pvp"));
    expect(pickEmptyNotice("pvp")).toContain("심연");
  });
});

describe("PICK_SLUGS — 격자는 기획서 4인, 내부 로스터는 7종", () => {
  /**
   * **부분집합임을 묻는다.** 별개 목록으로 두면 오타 하나가 빈 격자로만
   * 드러나고, 그건 화면이 안 죽는다 — 칸이 하나 비어 있을 뿐이다
   * (`no-absolute-thresholds-on-weights`: "고른 것이 0개"를 조용히 통과시키면
   * 안 된다). 그래서 길이도 같이 묻는다.
   */
  it("PICK_SLUGS는 HERO_SLUGS의 부분집합이고 4개다", () => {
    expect(PICK_SLUGS).toHaveLength(4);
    for (const s of PICK_SLUGS) expect(HERO_SLUGS).toContain(s);
    expect(new Set(PICK_SLUGS).size).toBe(4);
  });

  /**
   * 순서가 기획서 순서(A 리제 → B 노라 → C 실비아 → D 클로에)다.
   * `HERO_SLUGS` 순서와 **어긋난다** — 그것이 `PICK_SLUGS`가 자기 순서를 갖는
   * 이유다. 순서를 안 물으면 격자와 기획서를 대조할 수 없다.
   */
  it("순서가 기획서 순서다 — HERO_SLUGS 순서와 다르다", () => {
    expect([...PICK_SLUGS]).toEqual([
      "metal_bladekeeper",
      "leaf_ranger",
      "water_priestess",
      "wind_hashashin",
    ]);
    expect([...PICK_SLUGS]).not.toEqual(
      HERO_SLUGS.filter((s) => (PICK_SLUGS as readonly string[]).includes(s)),
    );
  });

  /** 격자 밖 슬러그를 저장해 뒀으면 무효다 — 첫 칸(리제)으로 떨어진다 (§1-5) */
  it("격자 밖 저장값은 무효다 — 배포본에서 고른 값이 남아 있다", () => {
    expect(parseStoredPick("ground_monk")).toBeNull();
    // `fire_knight`는 **예전 격자**의 첫 칸이었다 — 그 배포본에서 고른 값이
    // 남아 있으면 지금은 무효여야 한다(배정이 겉모습 우선으로 옮겨 갔다)
    expect(parseStoredPick("fire_knight")).toBeNull();
    expect(parseStoredPick("metal_bladekeeper")).toBe("metal_bladekeeper");
    expect(defaultPick("ground_monk")).toBe(PICK_SLUGS[0]);
    expect(defaultPick("fire_knight")).toBe(PICK_SLUGS[0]);
  });

  /**
   * 격자가 2×2다 (§1-3). 3열이면 3+1이 되어 마지막 칸이 혼자 남고, 지금 주석이 그
   * 모양을 "특별한 캐릭터로 읽힌다"고 기각했다.
   *
   * **`PICK_ROWS`를 상수 2로 박지 않는다** — 목록을 늘린 날 행이 안 늘어난다
   * (`derived-constants-need-their-derivation`). 분모가 `PICK_SLUGS.length`임을
   * 여기서 묻는다.
   */
  it("격자는 2×2다 — 계산식이 목록 길이에서 나온다", () => {
    expect(PICK_COLS).toBe(2);
    expect(PICK_ROWS).toBe(Math.ceil(PICK_SLUGS.length / PICK_COLS));
    expect(PICK_ROWS).toBe(2);
    expect(pickCell(3)).toEqual({ row: 1, col: 1 });
  });

  /**
   * **칸이 커지는 것을 검사가 알아야 한다.** 열이 3 → 2가 되면 칸 폭이 1.5배로
   * 커지고, 격자 높이는 3행 → 2행으로 줄어든다. 그 변화가 확정 버튼·미리보기를
   * 파고들면 안 된다(`panels-that-grow-upward`: 상수를 손으로 키우면 이웃을
   * 파고든다).
   */
  it("칸이 커져도 배치가 성립한다 — 미리보기 높이가 남는다", () => {
    const l = pickLayout();
    expect(l.previewH).toBeGreaterThan(0);
    expect(l.gridY).toBeGreaterThan(l.previewTop);
    expect(l.nameY).toBeGreaterThan(l.previewTop);
    // 격자가 화면 폭을 넘지 않는다 — 2열이면 칸이 넓어진다
    const g = pickGridSize({
      cellW: PICK_CELL_W,
      cellH: PICK_CELL_H,
      gap: PICK_GRID_GAP,
    });
    expect(g.w).toBeLessThanOrEqual(DESIGN_W);
  });

  /**
   * PvP에서 격자 밖 캐릭터를 키웠으면 그 칸은 없다 — §1-5의 대가다.
   * `pickAnySelectable`이 그것을 먼저 말해야 막다른 화면이 안 나온다.
   */
  it("격자 밖 캐릭터만 키웠으면 고를 칸이 0개다", () => {
    expect(
      pickAnySelectable({ mode: "pvp", grown: new Set(["ground_monk"]) }),
    ).toBe(false);
    expect(
      pickAnySelectable({ mode: "pvp", grown: new Set(["fire_knight"]) }),
    ).toBe(false);
    expect(
      pickAnySelectable({ mode: "pvp", grown: new Set(["metal_bladekeeper"]) }),
    ).toBe(true);
  });
});

describe("미리보기 세로 위치 — 삽화가 띠 가운데에 선다 (신고: 위에 붙어 있음)", () => {
  it("512px 삽화가 실제 띠에서 위쪽에 붙지 않는다", () => {
    const L = pickLayout();
    // 높이를 손으로 적지 않는다 — 매니페스트의 실제 `select` 높이를 쓴다
    const artH = 512;
    const y = pickPreviewY(artH, L.previewH);
    // 신고 당시 값은 0이었다. 남는 자리의 절반이 내려와야 한다
    expect(y).toBeCloseTo((L.previewH - artH) / 2, 6);
    expect(y).toBeGreaterThan(20);
  });

  it("삽화 아래 여백과 위 여백이 같다 — 한쪽으로 몰리지 않는다", () => {
    const L = pickLayout();
    const artH = 512;
    const y = pickPreviewY(artH, L.previewH);
    const above = y;
    const below = L.previewH - (y + artH);
    expect(below).toBeCloseTo(above, 6);
  });

  it("띠가 삽화보다 좁아지면 0으로 수렴한다 — 제목을 덮지 않는다", () => {
    // 상수 오프셋으로 내렸다면 여기서 음수가 나온다(제목 침범)
    expect(pickPreviewY(512, 512)).toBe(0);
    expect(pickPreviewY(512, 300)).toBe(0);
    expect(pickPreviewY(512, 0)).toBe(0);
  });

  it("NaN·음수 입력에도 유한한 값을 낸다", () => {
    expect(pickPreviewY(Number.NaN, 680)).toBe(340);
    expect(pickPreviewY(512, Number.NaN)).toBe(0);
    expect(pickPreviewY(-10, -10)).toBe(0);
  });
});
