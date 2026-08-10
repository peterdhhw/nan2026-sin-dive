import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { HERO_SLUGS } from "../src/shared/charManifest";
import {
  CARDS_PER_HERO,
  CARD_MANIFEST_URL,
  TOTAL_CARDS,
  allCardIds,
  cardIdOf,
  cardIdsOf,
  cardSlugOf,
  isCardId,
  type CardManifest,
} from "../src/shared/cardManifest";

/** 생성기(`tools/gen_cards.py`) 산출물. 목록과 파일이 어긋나면 카드함이 빈다 */
const manifest = JSON.parse(
  readFileSync(`public/${CARD_MANIFEST_URL}`, "utf-8"),
) as CardManifest;

const PY = readFileSync("tools/gen_cards.py", "utf-8");

describe("cards.json (생성기 산출물)", () => {
  test("주인공 7종 × 5장이 다 있다 — 한 장만 없어도 그 칸이 물음표로 남는다", () => {
    expect(Object.keys(manifest).sort()).toEqual([...HERO_SLUGS].sort());
    for (const s of HERO_SLUGS) {
      const rows = manifest[s]!;
      expect(rows.length, s).toBe(CARDS_PER_HERO);
      // 번호는 1..5가 빠짐없이 있어야 한다 — `no`로 칸을 찾으므로(`cardBoxOverlay`)
      // 3이 없으면 세 번째 칸만 조용히 빈다
      expect(rows.map((r) => r.no).sort(), s).toEqual([1, 2, 3, 4, 5]);
    }
  });

  test("id가 TS 쪽 유도값과 같다 — 저장은 id 문자열로 남는다", () => {
    for (const s of HERO_SLUGS) {
      for (const r of manifest[s]!) {
        expect(r.id, `${s}/${r.no}`).toBe(cardIdOf(s, r.no));
        expect(isCardId(r.id), r.id).toBe(true);
        expect(cardSlugOf(r.id), r.id).toBe(s);
      }
      expect(manifest[s]!.map((r) => r.id).sort()).toEqual(cardIdsOf(s).sort());
    }
    expect(allCardIds().length).toBe(TOTAL_CARDS);
  });

  test("파일 세 벌(원본·썸네일·실루엣)이 실제로 있다", () => {
    for (const s of HERO_SLUGS) {
      for (const r of manifest[s]!) {
        for (const url of [r.full, r.thumb, r.sil]) {
          expect(() => readFileSync(`public/${url}`), url).not.toThrow();
        }
      }
    }
  });

  /**
   * **실루엣이 따로 구워져 있어야 미획득 카드의 그림이 클라이언트에 안 온다.**
   * 경로가 썸네일과 같으면(생성기 실수) 카드함이 안 딴 카드에 진짜 그림을
   * 받아 놓고 틴트로 덮는 셈이 된다 — 네트워크 탭에 전부 보인다.
   */
  test("실루엣이 썸네일과 다른 파일이다 — 같으면 안 딴 그림이 도착한다", () => {
    for (const s of HERO_SLUGS) {
      for (const r of manifest[s]!) {
        expect(r.sil, r.id).not.toBe(r.thumb);
        expect(r.sil, r.id).not.toBe(r.full);
        expect(r.sil.endsWith("_s.png"), r.sil).toBe(true);
      }
    }
  });

  /**
   * `silRatio` = 실루엣의 불투명 비율.
   *
   * 0이면 알파 문턱(`SIL_ALPHA`)이 그림을 다 지운 것이고 — 안 딴 칸이 빈
   * 사각형이 되어 "무엇이 남았는지"가 안 읽힌다(그 근거는 `cardBoxOverlay`의
   * "미획득 = 실루엣"). 1이면 반대로 배경까지 다 채워져 사람 모양이 안 나온다.
   * 실측 0.19~0.72 — 여유를 두고 0.05~0.95로 잡는다.
   */
  test("실루엣이 사람 모양이다 — 0%면 빈칸, 100%면 사각형이다", () => {
    for (const s of HERO_SLUGS) {
      for (const r of manifest[s]!) {
        expect(r.silRatio, r.id).toBeGreaterThan(0.05);
        expect(r.silRatio, r.id).toBeLessThan(0.95);
      }
    }
  });

  /**
   * 크기는 매니페스트가 정하지만(`cards.ts`), 격자 칸이 3:4로 잡혀 있어서
   * (`cardRules.BOX_CELL_H`) 썸네일이 그 비율이 아니면 그림이 눌린다.
   * 상세도 마찬가지다 — `V_ART_*`가 아니라 화면 비율에 맞춰 굽는다.
   */
  test("썸네일 3:4 · 상세 4:7 — 칸 비율과 어긋나면 그림이 눌린다", () => {
    for (const s of HERO_SLUGS) {
      for (const r of manifest[s]!) {
        expect(r.thumbW / r.thumbH, `${r.id} thumb`).toBeCloseTo(3 / 4, 1);
        expect(r.fullW / r.fullH, `${r.id} full`).toBeCloseTo(4 / 7, 1);
      }
    }
  });

  /**
   * **장 수가 파이썬 `SCENES`와 같아야 한다.** 두 벌을 손으로 맞추므로 어긋날
   * 수 있고, 어긋나면 조용히 깨진다: `CARDS_PER_HERO`가 6인데 5장만 구워지면
   * 카드함이 `35`가 아니라 `42`를 세면서 여섯째 칸이 영구히 물음표로 남는다.
   * 열 수도 이 값이라(`BOX_COLS`) 격자 폭까지 같이 틀린다.
   */
  test("캐릭터당 장 수가 생성기 `SCENES`와 같다", () => {
    const body = PY.slice(
      PY.indexOf("SCENES: list[tuple[str, str]] = ["),
    ).split("\n]")[0]!;
    const scenes = [...body.matchAll(/^ {4}\("([0-9a-z_]+)", "(.+)"\),$/gm)];
    expect(scenes.length, "SCENES 항목 수").toBe(CARDS_PER_HERO);
    // 제목까지 대조한다 — 순서가 곧 카드 번호이므로(생성기 주석) 순서가 바뀌면
    // 이미 딴 카드의 이름이 다른 그림을 가리킨다
    for (const s of HERO_SLUGS) {
      const rows = [...manifest[s]!].sort((a, b) => a.no - b.no);
      rows.forEach((r, i) => {
        expect(r.scene, `${s}/${r.no}`).toBe(scenes[i]![1]);
        expect(r.title, `${s}/${r.no}`).toBe(scenes[i]![2]);
      });
    }
  });

  test("모르는 id는 거절한다 — 저장값이 깨져도 카드 수가 늘지 않는다", () => {
    for (const bad of [
      "",
      "crystal_mauler",
      "crystal_mauler_00",
      "crystal_mauler_06",
      "crystal_mauler_1",
      "no_such_hero_01",
      "crystal_mauler_01_s",
      null,
      undefined,
      42,
    ]) {
      expect(isCardId(bad), String(bad)).toBe(false);
    }
    expect(isCardId("crystal_mauler_01")).toBe(true);
  });
});
