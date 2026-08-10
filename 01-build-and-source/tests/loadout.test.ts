import { readFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";
import {
  ATTACK_ROLES,
  PresetLoadoutProvider,
  PRESET_SKILLS,
  attackSkillId,
  heroDisplayName,
  presetAttackClip,
  presetCharacterBySlug,
  presetSkillsFor,
} from "../src/loadout/preset";
import {
  INTERFERENCE_KINDS,
  LASTING_INTERFERENCE_KINDS,
  interferenceMagnitude,
} from "../src/core/types";
import { HERO_SLUGS, pickHeroSlugs } from "../src/shared/charManifest";
import { buildSkillImpactTable } from "../src/shared/skillMeleeRules";

/**
 * 6슬롯 = **내 공격 4 + 상대 방해 2** (4단계).
 *
 * 역사: "4슬롯 + 세 kind를 다 덮는다" → "5슬롯 = 3 + 2" → "6슬롯 = 3 + 2 +
 * 타락 버프 1" → 지금. 버프를 뺀 것도 되돌린 것도 다시 지운 것도 튜닝이 아니라
 * 결정이므로 여기서 **개수만** 6으로 고치면 안 된다 — 그러면 공격이 다섯이고
 * 방해가 하나여도 통과한다. **구성 자체를 세어야** 슬롯 하나가 조용히 다른
 * kind로 바뀌는 것을 잡는다.
 *
 * 슬롯 수가 6에서 안 움직인 것이 이 변경의 형태다(`presetSkillsFor`의 결정
 * 기록): 버프 한 칸을 공격 한 칸으로 갈았으므로 `barLayout`의 칸 폭·탭 크기가
 * 하나도 안 바뀐다. **버프 칸이 0인 것을 여기서 못 박는다** — 개수만 세면
 * 버프가 슬그머니 돌아와도 통과한다.
 */
test("스킬바가 공격 4 + 방해 2다 — 개수만 세면 구성이 바뀌어도 통과한다", () => {
  expect(PRESET_SKILLS).toHaveLength(6);
  const byKind = PRESET_SKILLS.map((s) => s.kind);
  expect(byKind.filter((k) => k === "attack")).toHaveLength(4);
  expect(byKind.filter((k) => k === "interference")).toHaveLength(2);
  expect(byKind.filter((k) => k === "buff")).toHaveLength(0);
});

/**
 * 공격 넷이 **앞에** 서고 방해 둘이 뒤다. 순서는 화면의 슬롯 순서라서
 * (`presetSkillsFor` 주석) 여기서 지켜야 캡처와 코드가 같은 말을 한다.
 *
 * 예전에는 이 자리에 "타락 버프 칸이 마지막이다"가 있었다 — 잠긴 칸이 가운데
 * 있으면 구멍으로 읽힌다는 근거였다. 잠기는 칸이 없어졌으므로 남는 요구는
 * "역할 순서가 `ATTACK_ROLES`와 같다"뿐이다: 쿨이 짧은 칸부터 왼쪽에 선다.
 */
test("공격 넷이 ATTACK_ROLES 순서로 앞에 서고 방해 둘이 뒤다", () => {
  const slug = HERO_SLUGS[0];
  expect(presetSkillsFor(slug).slice(0, 4).map((s) => s.id)).toEqual(
    ATTACK_ROLES.map((r) => attackSkillId(slug, r)),
  );
  expect(PRESET_SKILLS.slice(4).map((s) => s.kind)).toEqual([
    "interference",
    "interference",
  ]);
});

/**
 * 한 캐릭터의 여섯 칸이 **id가 다 다르다**. 겹치면 쿨다운 추적기가 두 칸을
 * 한 칸으로 합쳐서, 하나를 누르면 다른 칸의 파이도 같이 돌아간다.
 *
 * 예전에는 "타락 스킬 id가 어떤 캐릭터의 공격 id와도 겹치지 않는다"였다.
 * 그 칸이 사라졌으므로 남는 요구는 공격 넷 + 방해 둘 사이의 유일성이다 —
 * 방해 두 칸은 캐릭터와 무관한 고정 id라 슬러그마다 확인해야 한다.
 */
test("일곱 다 여섯 칸의 id가 서로 다르다", () => {
  for (const slug of HERO_SLUGS) {
    const ids = presetSkillsFor(slug).map((s) => s.id);
    expect(new Set(ids).size, `${slug}: ${ids.join(",")}`).toBe(ids.length);
  }
});

/**
 * 방해 두 칸이 같은 효과면 칸이 두 개인 이유가 없다.
 *
 * **`kind`가 다른 것으로는 부족하다** (2026-08-06). 예전 이 검사는 종류가 두
 * 가지인지만 봤고, 그때 `blind`는 어떤 수치도 바꾸지 않는 연출이었다 —
 * 종류는 둘인데 **효과는 하나**였고 이 검사는 통과하고 있었다. 그래서 두 칸이
 * 각자 코어에 지속을 남기는지(`LASTING_INTERFERENCE_KINDS`)까지 묻는다.
 * 축이 다른지(딜 vs 시전)는 `tests/battle.test.ts`가 수치로 잡는다.
 */
test("방해 두 칸이 서로 다른 효과다 — 종류도, 코어에 남기는 것도", () => {
  const intf = PRESET_SKILLS.filter((s) => s.kind === "interference");
  const kinds = intf.map((s) => s.interferenceKind);
  expect(new Set(kinds).size).toBe(2);
  // 둘 다 지속형이고 지속시간을 갖는다 — 하나가 연출로 돌아가면 여기가 깨진다
  for (const s of intf) {
    expect(LASTING_INTERFERENCE_KINDS, s.id).toContain(s.interferenceKind);
    expect(interferenceMagnitude(s), s.id).toBeGreaterThan(0);
  }
});

test("skill ids are unique", () => {
  const ids = PRESET_SKILLS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

/**
 * 캐릭터를 바꾸면 스킬 id·이름·클립이 **같이** 바뀐다.
 *
 * 일곱이 `quick`이라는 같은 id를 쓰면 쿨다운 추적기·AI 룰렛·`SKILL_MELEE`
 * 표가 한 캐릭터의 값으로 합쳐져서, 캐릭터를 골라도 나오는 동작이 그대로인
 * 것을 아무 검사도 잡지 못한다.
 */
test("캐릭터마다 다른 스킬 id·이름이 실린다 — 고른 것이 화면에 남아야 한다", () => {
  const perChar = HERO_SLUGS.map((s) => presetSkillsFor(s));
  const attackIds = perChar.map((skills) =>
    skills
      .filter((s) => s.kind === "attack")
      .map((s) => s.id)
      .join(","),
  );
  expect(new Set(attackIds).size).toBe(HERO_SLUGS.length);
  const names = perChar.flatMap((skills) =>
    skills.filter((s) => s.kind === "attack").map((s) => s.name),
  );
  expect(new Set(names).size).toBe(HERO_SLUGS.length * ATTACK_ROLES.length);
});

/**
 * 네 공격 칸이 **서로 다른 클립**을 써야 한다. 같은 클립이 두 칸에 들어가면
 * 두 슬롯이 화면에서 구별되지 않는다 — chierit는 캐릭터마다 `attack1/2/3 +
 * special` 네 벌이 있으므로 넷을 다 갈라 쓸 수 있고(그래서 다섯 번째 칸은
 * 만들 수 없다), 이것이 7종으로 갈아탄 이유다.
 *
 * **이 검사가 실제로 결함을 잡았다** (2026-08-10): 네 번째 칸을 넣을 때
 * `ground_monk.ult`이 `attack2`를 가리켰는데 그건 그 캐릭터의 `combo`가 이미
 * 쓰는 클립이었다 — 화면에서는 두 칸이 같은 동작을 하는 것으로만 보이고,
 * 남은 클립이 하나뿐이라는 배정 근거는 주석에 그대로 적혀 있었다.
 *
 * 개수를 `ATTACK_ROLES.length`로 적는다 — 3을 박아 두면 역할이 늘 때 새 칸이
 * 옆 칸의 클립을 그대로 써도 통과한다(그게 방금 잡은 결함의 형태다).
 */
test("일곱 다 공격 네 칸이 서로 다른 클립이다", () => {
  for (const slug of HERO_SLUGS) {
    const clips = ATTACK_ROLES.map((r) => presetAttackClip(slug, r));
    expect(new Set(clips).size, `${slug}: ${clips.join(",")}`).toBe(
      ATTACK_ROLES.length,
    );
  }
});

test("every interference skill names a valid interferenceKind", () => {
  for (const s of PRESET_SKILLS.filter((x) => x.kind === "interference")) {
    expect(s.interferenceKind).toBeDefined();
    expect(INTERFERENCE_KINDS as readonly string[]).toContain(s.interferenceKind!);
  }
});

test("every buff and interference skill declares a durationMs", () => {
  for (const s of PRESET_SKILLS) {
    if (s.kind === "attack") continue;
    expect(s.durationMs).toBeGreaterThan(0);
  }
});

test("all cooldowns are positive", () => {
  for (const s of PRESET_SKILLS) expect(s.cooldownMs).toBeGreaterThan(0);
});

/**
 * **쿨다운이 임팩트보다 짧으면 안 된다** — 유저 지시 "모션 안 끊기면서 제일 짧은
 * 수치"의 하한이 여기서 계산된다.
 *
 * 왜 값을 박지 않는가: 하한의 재료가 세 곳에 흩어져 있다 — 로드아웃의 접근
 * 시간(`melee.approachMs`), 역할의 접근 배율(`ROLE_MOTIONS`), 스프라이트의
 * 임팩트 프레임(`chars.json`). 615/997/1392/1643이라는 실측값을 여기 적으면
 * 그 셋 중 하나가 바뀔 때 **테스트는 통과하면서 의미만 달라진다**(파생 상수엔
 * 유래를 남겨야 한다는 그 형태다). 그래서 매니페스트에서 다시 센다.
 *
 * 이 검사가 못 잡는 것: 칸 **사이**의 끊김. 쿨은 칸마다 따로 도므로 1번 직후
 * 2번을 누르면 값과 무관하게 끊긴다 — 그쪽은 `castGateRules.test.ts`가 본다.
 */
describe("쿨다운이 그 역할의 최악 임팩트 위에 있다 — 계산해서 묻는다", () => {
  const chars = (
    JSON.parse(readFileSync("public/assets/chars/chars.json", "utf-8")) as {
      chars: Record<
        string,
        { actions: Record<string, { frames: number; impact?: number; fps: number }> }
      >;
    }
  ).chars;

  /**
   * 임팩트 표를 **프로덕션 함수로** 세운다(`buildSkillImpactTable` — 싱글
   * 세션이 부르는 그것이다). 여기서 접근 배율을 다시 곱해 계산하면 그 사본이
   * 갈라져서, 역할의 배율이 바뀔 때 검사만 옛 값으로 통과한다.
   */
  const table = buildSkillImpactTable(
    HERO_SLUGS.map((s) => ({
      charSlug: s,
      melee: presetCharacterBySlug(s, "x0")!.melee,
    })),
    (slug, clip) => {
      const a = chars[slug]?.actions[clip];
      return a === undefined ? null : { impactFrame: a.impact ?? 0, fps: a.fps };
    },
  );

  /** 이 캐릭터가 이 역할을 쓸 때 임팩트까지 걸리는 시간(ms) */
  const impactMs = (slug: string, role: (typeof ATTACK_ROLES)[number]): number =>
    table.get(attackSkillId(slug, role))!;

  test.each([...ATTACK_ROLES])("%s의 쿨이 일곱 중 최악 임팩트보다 길다", (role) => {
    const worst = Math.max(...HERO_SLUGS.map((s) => impactMs(s, role)));
    const cd = presetSkillsFor(HERO_SLUGS[0]).find(
      (s) => s.id === attackSkillId(HERO_SLUGS[0], role),
    )!.cooldownMs;
    expect(cd, `${role}: 최악 임팩트 ${Math.round(worst)}ms`).toBeGreaterThan(worst);
  });

  /**
   * 대조군. 위 시험은 쿨을 키우면 언제나 통과하므로 "임팩트를 실제로 재고
   * 있는가"를 묻지 않는다 — 재고 있다면 로스터 최악(셀린 `ult`)이 1.4초보다는
   * 커야 한다. 이 값이 0에 가깝게 떨어지면 위 네 시험은 전부 무의미해진다.
   */
  test("최악 임팩트가 실제로 늦다 — 지표가 0으로 떨어지면 위 시험이 빈다", () => {
    const worst = Math.max(
      ...HERO_SLUGS.flatMap((s) => ATTACK_ROLES.map((r) => impactMs(s, r))),
    );
    expect(worst).toBeGreaterThan(1400);
  });

  /**
   * 네 칸의 시전 빈도 합이 오토의 실측 대역(1.35~1.61회/s) 안에 있어야 한다 —
   * 이것이 유저가 고치라고 한 괴리 그 자체다. 대역 밖으로 나가면 수동이 다시
   * 느리거나(아래로) 오토보다 빨라진다(위로).
   */
  test("네 칸의 시전 빈도 합이 오토의 대역 안이다", () => {
    const perSec = presetSkillsFor(HERO_SLUGS[0])
      .filter((s) => s.kind === "attack")
      .reduce((sum, s) => sum + 1000 / s.cooldownMs, 0);
    expect(perSec).toBeGreaterThanOrEqual(1.35);
    expect(perSec).toBeLessThanOrEqual(1.61);
  });
});

test("loads teamSize characters with unique ids", () => {
  const lo = new PresetLoadoutProvider().load(2);
  expect(lo.characters).toHaveLength(2);
  expect(new Set(lo.characters.map((c) => c.memberId)).size).toBe(2);
});

test("generalizes to 3 members without code change", () => {
  const lo = new PresetLoadoutProvider().load(3);
  expect(lo.characters).toHaveLength(3);
  expect(new Set(lo.characters.map((c) => c.memberId)).size).toBe(3);
});

test("members are visually distinguished by sprite or tint (spec 4-2)", () => {
  const cs = new PresetLoadoutProvider().load(2).characters;
  const signatures = cs.map((c) => `${c.charSlug}|${c.tintHex}`);
  expect(new Set(signatures).size).toBe(2);
});

test("every preset character points at a real hero sprite", () => {
  // 슬러그 오타는 런타임에 초록 사각형(플레이스홀더)으로만 드러난다 —
  // 스크린샷을 열어 보지 않으면 지나친다
  for (const c of new PresetLoadoutProvider().load(3).characters) {
    expect(HERO_SLUGS).toContain(c.charSlug);
  }
});

test("attacker and guardian use different sprites — 실루엣으로 역할이 읽혀야 한다", () => {
  const cs = new PresetLoadoutProvider().load(2).characters;
  expect(cs[0]!.charSlug).not.toBe(cs[1]!.charSlug);
});

test("teamSize of 1 works and teamSize below 1 throws", () => {
  expect(new PresetLoadoutProvider().load(1).characters).toHaveLength(1);
  expect(() => new PresetLoadoutProvider().load(0)).toThrow();
});

/**
 * 고른 캐릭터가 **1번 자리**에 서고, 스킬바가 그 캐릭터의 것이어야 한다.
 *
 * `session.castSkill`은 `characters[0]`의 몸으로 스킬을 낸다 — 고른 캐릭터가
 * 뒤에 서면 내가 누른 스킬이 옆의 팀원 몸에서 나가고, 화면에서는 "내 캐릭터가
 * 아무 반응이 없다"로 보인다.
 */
test("고른 캐릭터가 1번 자리에 서고 그 캐릭터의 스킬이 실린다", () => {
  for (const slug of HERO_SLUGS) {
    const lo = new PresetLoadoutProvider(slug).load(2);
    expect(lo.characters[0]!.charSlug, slug).toBe(slug);
    expect(lo.skills.map((s) => s.id)).toEqual(
      presetSkillsFor(slug).map((s) => s.id),
    );
    // 뒷자리는 다른 캐릭터다 — 같으면 둘이 한 명으로 보인다
    expect(lo.characters[1]!.charSlug, slug).not.toBe(slug);
  }
});

test("안 고르면 목록 순서 그대로다 — 선택 화면이 없어도 돈다", () => {
  const lo = new PresetLoadoutProvider().load(2);
  expect(lo.characters.map((c) => c.charSlug)).toEqual([
    HERO_SLUGS[0],
    HERO_SLUGS[1],
  ]);
  expect(lo.skills.map((s) => s.id)).toEqual(PRESET_SKILLS.map((s) => s.id));
});

test("each load returns a fresh array (no shared mutable state)", () => {
  const p = new PresetLoadoutProvider();
  const a = p.load(2);
  a.characters[0]!.level = 99;
  expect(p.load(2).characters[0]!.level).not.toBe(99);
});

/**
 * 상대 필드가 쓰는 조회다. 슬러그만 갈아 끼우면 실비아 스프라이트가 리제의
 * 접근 곡선으로 움직여서, 캐릭터별로 동작을 갈라 둔 것이 아래 필드에서 지워진다.
 */
describe("presetCharacterBySlug", () => {
  test("모든 주인공 슬러그를 찾는다 — 못 찾으면 상대 팀이 내 동작을 쓴다", () => {
    for (const s of HERO_SLUGS) {
      const c = presetCharacterBySlug(s, "x0");
      expect(c, s).not.toBeNull();
      expect(c!.charSlug).toBe(s);
      expect(c!.memberId).toBe("x0");
    }
  });

  test("모르는 슬러그는 null — 호출자가 원래 캐릭터로 떨어진다", () => {
    expect(presetCharacterBySlug("rat", "x0")).toBeNull();
  });

  test("부를 때마다 새 객체다 — 상대 필드가 변형해도 프리셋이 안 오염된다", () => {
    const slug = HERO_SLUGS[0];
    const a = presetCharacterBySlug(slug, "x0")!;
    const b = presetCharacterBySlug(slug, "x1")!;
    expect(a).not.toBe(b);
    expect(a.melee).not.toBe(b.melee);
    expect(a.melee.clips).not.toBe(b.melee.clips);
    expect(a.stats).not.toBe(b.stats);
    a.level = 99;
    expect(presetCharacterBySlug(slug, "x0")!.level).not.toBe(99);
  });

  /**
   * 2:2 화면의 네 자리다. 슬러그가 다르기만 하면 안 된다 — 접근 방식·속도·
   * 사거리·클립까지 달라야 "색만 다른 같은 사람"에서 벗어난다.
   */
  test("네 자리가 서로 다른 캐릭터·다른 동작으로 채워진다", () => {
    const mine = new PresetLoadoutProvider().load(2).characters;
    const theirSlugs = pickHeroSlugs(1, 2, mine.map((c) => c.charSlug));
    const theirs = theirSlugs.map((s, i) => presetCharacterBySlug(s, `t${i}`)!);
    const four = [...mine, ...theirs];
    expect(new Set(four.map((c) => c.charSlug)).size).toBe(4);
    const moves = four.map(
      (c) =>
        `${c.melee.approach}|${c.melee.approachMs}|${c.melee.returnMs}` +
        `|${c.melee.reach}|${c.melee.clips.join(",")}`,
    );
    expect(new Set(moves).size).toBe(4);
  });
});

describe("표시 이름은 두 곳에 있고 둘이 갈리면 안 된다", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/chars/chars.json", "utf-8"),
  ) as { chars: Record<string, { displayName?: string }> };

  /**
   * `preset.ts`의 주석이 "표시 이름은 `chars.json`의 `displayName`과 같게
   * 유지한다"고 적고 있는데 **그 대조를 하는 검사가 없었다.** 한쪽만 바꾸면
   * 선택 화면(`heroDisplayName` → `ROLE_TEMPLATES`)과 전투 HUD 카드
   * (`chars.json`)가 다른 이름을 말한다. 주석은 지키지 않는다 — 검사가 지킨다.
   */
  it("ROLE_TEMPLATES의 displayName이 chars.json과 같다 — 7종 전부", () => {
    for (const slug of HERO_SLUGS) {
      expect(heroDisplayName(slug), slug).toBe(
        manifest.chars[slug]!.displayName,
      );
    }
  });

  /**
   * 격자 4인은 기획서 이름이다. **값을 박는다** — 위 대조만 있으면 양쪽을 같이
   * 옛 이름으로 되돌려도 통과한다(`mocks-hide-the-mocked-function`의 형태:
   * 두 사본을 서로 비교하면 둘이 같이 틀린 경우를 못 본다).
   */
  it("격자 4인이 기획서 이름을 쓴다", () => {
    expect(heroDisplayName("metal_bladekeeper")).toBe("리제");
    expect(heroDisplayName("leaf_ranger")).toBe("노라");
    expect(heroDisplayName("water_priestess")).toBe("실비아");
    expect(heroDisplayName("wind_hashashin")).toBe("클로에");
  });

  /**
   * 격자 밖 3종도 **사람 이름**이다. 원본 소스의 직업명(`불의 기사`)을 그대로
   * 두던 것을 유저 지시로 바꿨다: "나머지 3개는 다른 랜덤한 여자 이름 넣어줘."
   *
   * 값을 박는 이유는 위 4인과 같다 — `chars.json`과의 대조만 있으면 양쪽을
   * 같이 직업명으로 되돌려도 통과한다.
   */
  it("격자 밖 3종도 사람 이름을 쓴다", () => {
    expect(heroDisplayName("fire_knight")).toBe("이리스");
    expect(heroDisplayName("crystal_mauler")).toBe("미라");
    expect(heroDisplayName("ground_monk")).toBe("셀린");
  });

  /**
   * **일곱 다 직업명이 아니다.** 위 검사는 슬러그 셋을 값으로 묻지만, 로스터가
   * 늘거나 임포터가 새 캐릭터를 얹으면 그 새 이름이 다시 `~의 ~`가 된다 —
   * 그때 카드함은 또 두 세계에서 온 목록이 된다(이 변경의 원래 이유).
   *
   * "조사 `의`가 없다"로 묻는다. 사람 이름 넷·셋 모두 한 단어이고, 원본
   * 소스의 직업명은 전부 `불의 기사`꼴이었다.
   */
  it("일곱 이름에 직업명이 섞이지 않는다", () => {
    for (const slug of HERO_SLUGS) {
      const name = heroDisplayName(slug);
      expect(name, slug).not.toMatch(/의\s/);
    }
  });

  /**
   * **일곱 이름이 서로 달라야 한다.** 위 두 검사는 슬러그를 하나씩 묻기 때문에
   * 격자 배정이 옮겨 갈 때 옛 슬러그에 남은 이름을 못 본다 — 실측으로 봤다:
   * 리제가 `fire_knight`(옛 배정)와 `metal_bladekeeper`(새 배정) 둘에 붙어
   * 있었고 클로에도 마찬가지였는데, `PICK_SLUGS` 넷만 확인하는 동안 통과했다.
   * 화면에서는 PvP 상대 팀에 "리제"가 한 명 더 서는 형태로만 드러난다.
   */
  it("일곱 표시 이름이 서로 다르다", () => {
    const names = HERO_SLUGS.map((s) => heroDisplayName(s));
    expect(new Set(names).size, names.join(",")).toBe(HERO_SLUGS.length);
  });

  /**
   * 생성기도 같이 봐야 한다 — `import_chars.py`를 다시 돌리면 `chars.json`이
   * 재생성되고, 거기 옛 이름이 남아 있으면 **조용히 되돌아간다.** 실제로 그
   * 형태의 사고가 있었다: 크레딧 생성기가 지워진 슬러그 4종을 계속 적었다
   * (`charManifest.test.ts:186`의 주석).
   */
  it("임포터의 HEROES 이름이 chars.json과 같다", () => {
    const py = readFileSync("tools/import_chars.py", "utf-8");
    const body = py.slice(py.indexOf("HEROES = [")).split("]")[0]!;
    const pairs = [...body.matchAll(/\("([a-z0-9_]+)",\s*"([^"]+)"\)/g)];
    expect(pairs).toHaveLength(HERO_SLUGS.length);
    for (const [, slug, name] of pairs) {
      expect(name, slug).toBe(manifest.chars[slug!]!.displayName);
    }
  });
});
