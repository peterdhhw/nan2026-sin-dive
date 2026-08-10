import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, test } from "vitest";
import { allSfxNames } from "../src/shared/audioRules";

/**
 * `audioRules.ts`의 파일 표와 `public/assets/sfx/`의 실제 파일을 대조한다.
 *
 * 이게 없으면 표에만 있고 파일이 없는 음원이 조용히 무음으로 굴러간다 —
 * `playSfx()`가 절대 throw하지 않도록 설계했기 때문에(설계 문서 01-7)
 * 런타임에서는 절대 눈치챌 수 없다. 빌드 시점에 잡아야 한다.
 */

const DIR = new URL("../public/assets/sfx/", import.meta.url);

/** 파일당 예산 40KB (설계 문서 01-7) */
const MAX_FILE_BYTES = 40 * 1024;
/** 총합 예산 400KB */
const MAX_TOTAL_BYTES = 400 * 1024;

test("every sfx in the table exists as both ogg and m4a", () => {
  for (const name of allSfxNames()) {
    for (const ext of ["ogg", "m4a"]) {
      const path = new URL(`${name}.${ext}`, DIR);
      expect(existsSync(path), `${name}.${ext}`).toBe(true);
    }
  }
});

// Safari는 ogg를 못 읽는다 — m4a 폴백이 빠지면 iOS에서 전부 무음이 된다
test("no sfx file is empty and none exceeds the per-file budget", () => {
  for (const name of allSfxNames()) {
    for (const ext of ["ogg", "m4a"]) {
      const size = statSync(new URL(`${name}.${ext}`, DIR)).size;
      expect(size, `${name}.${ext}`).toBeGreaterThan(0);
      expect(size, `${name}.${ext}`).toBeLessThanOrEqual(MAX_FILE_BYTES);
    }
  }
});

test("total sfx payload stays inside the budget", () => {
  let total = 0;
  for (const name of allSfxNames()) {
    for (const ext of ["ogg", "m4a"]) {
      total += statSync(new URL(`${name}.${ext}`, DIR)).size;
    }
  }
  expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
});

// CC0 기록 의무 (설계 문서 01-5-3). 상용 판매 시 라이선스 감사가 가능해야 한다
test("credits file is present and names its sources", () => {
  const credits = new URL("../public/assets/CREDITS.md", import.meta.url);
  expect(existsSync(credits)).toBe(true);
  const text = readFileSync(credits, "utf8");
  expect(text).toContain("CC0");
  expect(text).toContain("kenney");
});

// 파일 단위 기록이 있어야 나중에 "이 소리 어디서 왔지"에 답할 수 있다
test("per-file sfx sources are recorded", () => {
  const sources = new URL("../public/assets/sfx/SOURCES.md", import.meta.url);
  expect(existsSync(sources)).toBe(true);
  const text = readFileSync(sources, "utf8");
  for (const name of allSfxNames()) {
    expect(text, name).toContain(name);
  }
});
