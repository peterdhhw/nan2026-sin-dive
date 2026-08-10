import { expect, test } from "vitest";
import {
  SFX_FILES,
  SFX_THROTTLE_MS,
  SFX_VOLUME,
  type SfxId,
  allSfxNames,
  canPlay,
  rotationIndex,
  sfxFileFor,
} from "../src/shared/audioRules";

const IDS = Object.keys(SFX_FILES) as SfxId[];

test("every sfx id has files, a throttle and a volume", () => {
  for (const id of IDS) {
    expect(SFX_FILES[id].length, id).toBeGreaterThan(0);
    expect(SFX_THROTTLE_MS[id], id).toBeGreaterThanOrEqual(0);
    expect(SFX_VOLUME[id], id).toBeGreaterThan(0);
    expect(SFX_VOLUME[id], id).toBeLessThanOrEqual(1);
  }
});

// 설계 문서 01-7의 9개 항목 (win/lose를 2개로 세면 10개 ID)
test("the spec's sfx set is present", () => {
  expect(IDS.sort()).toEqual(
    [
      "cooldown_ready",
      "enemy_death",
      "gauge_danger",
      "hit",
      "interference",
      "lose",
      "skill_cast",
      "ui_locked",
      "ui_tap",
      "win",
    ].sort(),
  );
});

// 같은 소리 반복은 피로하다 (설계 문서 01-7)
test("hit rotates across three variants and others are single", () => {
  expect(SFX_FILES.hit).toHaveLength(3);
  for (const id of IDS) {
    if (id !== "hit") expect(SFX_FILES[id], id).toHaveLength(1);
  }
});

test("file names are unique so nothing overwrites another", () => {
  const names = allSfxNames();
  expect(new Set(names).size).toBe(names.length);
});

test("first play is always allowed", () => {
  for (const id of IDS) {
    expect(canPlay(id, 0, undefined), id).toBe(true);
    expect(canPlay(id, 12_345, undefined), id).toBe(true);
  }
});

// 타격음은 초당 여러 번 발생한다 — 스로틀이 없으면 소리가 뭉쳐서 노이즈가 된다
test("hit is throttled to 40ms", () => {
  expect(SFX_THROTTLE_MS.hit).toBe(40);
  expect(canPlay("hit", 1_000, 1_000)).toBe(false);
  expect(canPlay("hit", 1_039, 1_000)).toBe(false);
  expect(canPlay("hit", 1_040, 1_000)).toBe(true);
});

// 판에 한 번뿐인 소리는 스로틀이 무의미하다
test("one-shot results are never throttled", () => {
  for (const id of ["win", "lose", "gauge_danger"] as SfxId[]) {
    expect(SFX_THROTTLE_MS[id], id).toBe(0);
    expect(canPlay(id, 0, 0), id).toBe(true);
  }
});

// AudioContext.currentTime 기준이 리셋되면 시간이 뒤로 갈 수 있다.
// 막으면 소리가 영구히 죽으므로 허용해야 한다
test("time going backwards does not silence a sound forever", () => {
  expect(canPlay("hit", 500, 10_000)).toBe(true);
});

test("rotation cycles deterministically and stays in range", () => {
  expect(rotationIndex("hit", 0)).toBe(0);
  expect(rotationIndex("hit", 1)).toBe(1);
  expect(rotationIndex("hit", 2)).toBe(2);
  expect(rotationIndex("hit", 3)).toBe(0);
  expect(rotationIndex("hit", 100)).toBe(1);
  expect(rotationIndex("ui_tap", 7)).toBe(0);
});

test("rotation survives negative and fractional counts", () => {
  expect(rotationIndex("hit", -1)).toBe(2);
  expect(rotationIndex("hit", 2.9)).toBe(2);
  expect(rotationIndex("hit", Number.NaN)).toBe(0);
});

// 3연속 같은 소리가 나오지 않는다 — 순환이 랜덤보다 균등하게 들린다
test("rotation never repeats a variant back to back", () => {
  let prev = "";
  for (let i = 0; i < 12; i++) {
    const file = sfxFileFor("hit", i);
    expect(file).not.toBe(prev);
    prev = file;
  }
});

test("file lookup returns a real file name for every id", () => {
  const known = new Set(allSfxNames());
  for (const id of IDS) {
    for (let i = 0; i < 5; i++) {
      expect(known.has(sfxFileFor(id, i)), `${id}#${i}`).toBe(true);
    }
  }
});

// 타격음은 겹쳐 울리므로 결과 스팅어보다 조용해야 한다
test("overlapping sounds are mixed quieter than one-shot stingers", () => {
  expect(SFX_VOLUME.hit).toBeLessThan(SFX_VOLUME.win);
  expect(SFX_VOLUME.ui_tap).toBeLessThan(SFX_VOLUME.skill_cast);
});
