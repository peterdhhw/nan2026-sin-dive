import { describe, expect, it } from "vitest";
import { THEIR_SEED_OFFSET, theirRoster } from "../src/pvp/rosterRules";
import { PresetLoadoutProvider } from "../src/loadout/preset";
import { HERO_SLUGS, type HeroSlug } from "../src/shared/charManifest";

/**
 * 상대 로스터 — **VS 인트로와 전장이 같은 넷을 세워야 한다.**
 *
 * 유저 신고: "pvp에서 건너뛰기 누르고 VS 누를 때 매번 같은 상대방이랑 우리쪽이랑
 * 같은 캐릭터 나와." 원인은 `vsScene.buildSide`가 팀 번호와 무관하게
 * `loadout.characters`를 읽은 것이었다 — 상대 칸에 내 캐릭터가 붉은 틴트만 입고
 * 섰다(캡처 확인). 전장(`session.ts`)은 이미 시드에서 뽑고 있었으므로 두 화면이
 * 서로 다른 상대를 세우고 있었다.
 *
 * 그래서 이 테스트가 무는 것은 "다른 캐릭터가 나온다" 하나가 아니다:
 * **한 함수가 두 화면의 유일한 출처인가**를 같이 물어야 다음에 또 갈리지 않는다.
 * 화면 쪽은 코드를 읽어서 안 잡힌다(둘 다 컴파일되고 둘 다 캐릭터를 그린다) —
 * `pvpIntegration`이 아니라 여기서 값으로 잡는다.
 */

const TEAM_SIZE = 2;
const mineFor = (lead: HeroSlug) =>
  new PresetLoadoutProvider(lead).load(TEAM_SIZE).characters;

describe("theirRoster", () => {
  it("상대 팀에 내 캐릭터가 하나도 안 섞인다 — 거울 그림이 되면 팀 구분이 늦는다", () => {
    const mine = mineFor("water_priestess");
    for (const seed of [0, 1, 7, 42, 999_999]) {
      const theirs = theirRoster(seed, mine);
      const mySlugs = new Set(mine.map((c) => c.charSlug));
      for (const t of theirs) expect(mySlugs.has(t.charSlug)).toBe(false);
    }
  });

  it("시드를 바꾸면 조합이 바뀐다 — 매판 같은 상대가 나오면 안 된다", () => {
    const mine = mineFor("water_priestess");
    // 시드 40개면 3종(=7 − 내 2 − 뽑는 2 이후 남는 폭)에서 조합이 갈린다.
    // **부분집합 하나로 세지 않는다** — 조합을 문자열로 묶어야 "둘 다 같이
    // 바뀌었나"를 묻게 되고, 한쪽만 고정된 상태를 통과시키지 않는다
    const combos = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      combos.add(
        theirRoster(seed, mine)
          .map((c) => c.charSlug)
          .join("+"),
      );
    }
    expect(combos.size).toBeGreaterThan(1);
  });

  it("같은 시드는 같은 상대를 준다 — 재대전에서 같은 판이 재현되어야 한다", () => {
    const mine = mineFor("metal_bladekeeper");
    const a = theirRoster(4242, mine).map((c) => c.charSlug);
    const b = theirRoster(4242, mine).map((c) => c.charSlug);
    expect(a).toEqual(b);
  });

  it("내 리드를 바꾸면 상대도 따라 바뀐다 — 제외 목록이 실제로 먹는다", () => {
    // 리드가 바뀌면 내 두 명이 바뀌고, 제외 목록이 그것을 물어야 상대가 움직인다.
    // 안 먹으면 여기서 두 조합이 같아진다
    const a = theirRoster(9, mineFor("water_priestess")).map((c) => c.charSlug);
    const b = theirRoster(9, mineFor("wind_hashashin")).map((c) => c.charSlug);
    expect(a).not.toEqual(b);
  });

  it("동작까지 그 캐릭터의 것이다 — 슬러그만 갈아 끼우면 앞 캐릭터 클립으로 움직인다", () => {
    const mine = mineFor("water_priestess");
    const theirs = theirRoster(11, mine);
    for (const [i, t] of theirs.entries()) {
      const m = mine[i]!;
      // 프리셋에 있는 슬러그이므로 `presetCharacterBySlug`가 잡아야 한다 —
      // 폴백(`{...c, charSlug}`)으로 떨어지면 클립이 내 캐릭터 것으로 남는다
      expect(HERO_SLUGS).toContain(t.charSlug);
      expect(t.melee.clips).not.toBe(m.melee.clips);
      expect(t.displayName).not.toBe(m.displayName);
    }
  });

  it("memberId는 내 자리 것을 물려받는다 — 필드가 슬롯을 이 id로 찾는다", () => {
    const mine = mineFor("leaf_ranger");
    const theirs = theirRoster(3, mine);
    expect(theirs.map((c) => c.memberId)).toEqual(mine.map((c) => c.memberId));
  });

  it("인원수가 내 팀과 같다 — 빈 자리는 필드에서 사라진 캐릭터가 된다", () => {
    for (const n of [1, 2, 3]) {
      const mine = new PresetLoadoutProvider().load(n).characters;
      expect(theirRoster(5, mine)).toHaveLength(n);
    }
  });

  it("시드 오프셋이 0이 아니다 — 0이면 양 팀이 같은 해시로 뽑는다", () => {
    expect(THEIR_SEED_OFFSET).not.toBe(0);
  });
});
