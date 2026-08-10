import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOSS_SLUGS,
  CHAR_MANIFEST_URL,
  HERO_SLUGS,
  MINION_SLUGS,
  type CharManifest,
  facingFlip,
  hashString,
  minionPool,
  pickEnemySlug,
  pickHeroSlugs,
} from "../src/shared/charManifest";
import { WAVE_THEMES } from "../src/shared/theme";

/** Rec.709. 임포터·배경 생성기가 쓰는 계수와 같아야 비교가 성립한다 */
function luminance(hex: number): number {
  return (
    (0.2126 * ((hex >> 16) & 0xff) +
      0.7152 * ((hex >> 8) & 0xff) +
      0.0722 * (hex & 0xff)) /
    255
  );
}

/** 임포터가 만든 실제 매니페스트. 목록과 파일이 어긋나면 초록 사각형이 나온다 */
const manifest = JSON.parse(
  readFileSync(`public/${CHAR_MANIFEST_URL}`, "utf-8"),
) as CharManifest;

describe("minionPool", () => {
  it("첫 웨이브는 앞 3종만 — 1층에서 미믹이 나오면 난이도 곡선이 무너진다", () => {
    expect(minionPool(0)).toEqual(["rat", "slime", "mushroom"]);
  });

  it("두 웨이브마다 한 종이 열린다", () => {
    expect(minionPool(1)).toHaveLength(3);
    expect(minionPool(2)).toHaveLength(4);
    expect(minionPool(4)).toHaveLength(5);
  });

  it("전체 목록을 넘지 않는다 — 999층까지 내려가도 인덱스가 새면 안 된다", () => {
    expect(minionPool(999)).toHaveLength(MINION_SLUGS.length);
  });

  it("깊은 웨이브는 얕은 웨이브의 풀을 포함한다 (뒤에 붙기만 한다)", () => {
    expect(minionPool(6).slice(0, 3)).toEqual([...minionPool(0)]);
  });

  it("이상한 입력에도 비지 않는다", () => {
    expect(minionPool(NaN)).toHaveLength(3);
    expect(minionPool(-5)).toHaveLength(3);
    expect(minionPool(2.9)).toHaveLength(4);
  });
});

describe("pickEnemySlug", () => {
  it("같은 ID는 항상 같은 종족 — 양 팀이 같은 적을 봐야 한다 (AC-4)", () => {
    for (const id of ["w0-m0", "w3-m2", "w7-m1"]) {
      expect(pickEnemySlug(id, 3, false)).toBe(pickEnemySlug(id, 3, false));
    }
  });

  it("웨이브 풀 안에서만 뽑는다", () => {
    for (let w = 0; w < 12; w++) {
      const pool = minionPool(w);
      for (let i = 0; i < 4; i++) {
        expect(pool).toContain(pickEnemySlug(`w${w}-m${i}`, w, false));
      }
    }
  });

  it("보스는 보스 목록에서만 나온다 — 웨이브 풀과 무관하다", () => {
    for (let w = 0; w < 20; w += 5) {
      expect(BOSS_SLUGS).toContain(pickEnemySlug(`w${w}-boss`, w, true));
    }
  });

  it("한 웨이브 안에서 종족이 갈린다 — 4마리가 전부 같으면 다양성이 없다", () => {
    const kinds = new Set(
      [0, 1, 2, 3].map((i) => pickEnemySlug(`w8-m${i}`, 8, false)),
    );
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe("pickHeroSlugs", () => {
  it("중복 없이 뽑는다 — 같은 리그가 둘이면 한 명으로 보인다", () => {
    for (const seed of [0, 1, 77, 1234]) {
      const got = pickHeroSlugs(seed, 3);
      expect(got).toHaveLength(3);
      expect(new Set(got).size).toBe(3);
    }
  });

  it("결정론이다 — 같은 시드면 같은 팀", () => {
    expect(pickHeroSlugs(42, 2)).toEqual(pickHeroSlugs(42, 2));
  });

  it("제외 목록과 겹치지 않는다 — 위아래가 같은 팀인 거울 그림을 막는다", () => {
    const mine = [HERO_SLUGS[0], HERO_SLUGS[1]];
    for (let seed = 0; seed < 30; seed++) {
      for (const s of pickHeroSlugs(seed, 2, mine)) {
        expect(mine).not.toContain(s);
      }
    }
  });

  it("후보가 모자라면 제외를 포기한다 — 빈 슬롯이 더 나쁘다", () => {
    const got = pickHeroSlugs(3, HERO_SLUGS.length, HERO_SLUGS.slice(0, 5));
    expect(got).toHaveLength(HERO_SLUGS.length);
  });

  it("0명도 요청할 수 있다", () => {
    expect(pickHeroSlugs(1, 0)).toEqual([]);
    expect(pickHeroSlugs(1, -2)).toEqual([]);
  });

  it("모든 슬러그가 HERO_SLUGS 안에 있다", () => {
    for (const s of pickHeroSlugs(9, 4)) expect(HERO_SLUGS).toContain(s);
  });
});

describe("hashString", () => {
  it("32비트 부호 없는 정수다 — 음수 나머지는 배열 밖을 가리킨다", () => {
    for (const s of ["", "w0-m0", "team1", "가레스"]) {
      const h = hashString(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it("비슷한 ID를 다르게 흩는다", () => {
    const hs = ["w0-m0", "w0-m1", "w0-m2", "w0-m3"].map(hashString);
    expect(new Set(hs.map((h) => h % 3)).size).toBeGreaterThan(1);
  });
});

describe("chars.json (임포터 산출물)", () => {
  test("목록과 매니페스트가 일치한다 — 오타는 초록 사각형으로만 드러난다", () => {
    for (const s of [...HERO_SLUGS, ...MINION_SLUGS, ...BOSS_SLUGS]) {
      expect(manifest.chars[s], s).toBeDefined();
    }
    expect(Object.keys(manifest.chars).sort()).toEqual(
      [...HERO_SLUGS, ...MINION_SLUGS, ...BOSS_SLUGS].sort(),
    );
  });

  /**
   * 판매 가능성은 **세 갈래**로만 성립한다: CC0 / 우리가 만든 것 / chierit CC-BY.
   *
   * 예전에는 두 갈래(CC0·자작)였다. 주인공을 chierit Elementals로 바꾸면서
   * 한 갈래를 열었다 — 검사를 **지우지 않고** 갈랐다. 지우면 재배포금지 에셋
   * (Clembod)이 슬며시 들어오는 길이 같이 열린다.
   *
   * CC-BY는 크레딧 의무가 있으므로 표기가 실제로 있는지도 같이 본다
   * (`public/assets/CREDITS.md`) — 의무를 안 지키면 라이선스 위반이고,
   * 그건 코드를 읽어서는 절대 안 드러난다.
   */
  test("CC0·자작·chierit CC-BY 세 갈래뿐이다 — 재배포금지 에셋이 새는 길을 막는다", () => {
    const credits = readFileSync("public/assets/CREDITS.md", "utf-8");
    for (const [slug, d] of Object.entries(manifest.chars)) {
      const ok =
        d.license === "CC0" ||
        d.generated ||
        (d.author === "chierit" && d.license.startsWith("CC-BY"));
      expect(ok, `${slug} (${d.author} / ${d.license})`).toBe(true);
      // CC0도 자작도 아니면 **그 캐릭터의** 표기가 문서에 실제로 있어야 한다.
      //
      // 작가 이름만 찾으면 안 된다: 일곱 중 하나만 적혀 있어도 문자열은 걸린다.
      // CC-BY의 조건은 쓴 저작물마다의 표시이므로 슬러그와 원본 URL을 같이 본다.
      if (d.license !== "CC0" && !d.generated) {
        expect(credits, `${slug} 작가 표기`).toContain(d.author);
        expect(credits, `${slug} 항목`).toContain(`\`${slug}\``);
        expect(credits, `${slug} 원본 URL`).toContain(d.url);
      }
    }
  });

  /**
   * 크레딧의 캐릭터 표에 **매니페스트에 없는 슬러그가 남아 있으면 안 된다**.
   *
   * 실제로 그렇게 됐다: 주인공을 chierit로 교체한 뒤에도 생성기가 지워진 자체
   * 생성 4종(`p_riese`·`p_nora`·`p_sylvia`·`p_chloe`)을 계속 적어서, 문서가
   * 없는 파일의 출처를 주장하고 있었다. 위 검사는 "있어야 할 것이 있는지"만
   * 보므로 그 방향을 못 잡는다 — 양쪽을 다 봐야 한다.
   */
  test("크레딧 캐릭터 표가 매니페스트와 정확히 같다 — 사라진 캐릭터가 남지 않는다", () => {
    const credits = readFileSync("public/assets/CREDITS.md", "utf-8");
    const charSection = credits.slice(credits.indexOf("## 캐릭터 스프라이트"));
    expect(charSection, "캐릭터 섹션").not.toBe("");
    const listed = [...charSection.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map(
      (m) => m[1]!,
    );
    expect(listed.sort()).toEqual(Object.keys(manifest.chars).sort());
  });

  test("잡몹·보스는 전부 CC0다 — 주인공만 다른 트랙을 쓴다", () => {
    for (const s of [...MINION_SLUGS, ...BOSS_SLUGS]) {
      expect(manifest.chars[s]!.license, s).toBe("CC0");
      expect(manifest.chars[s]!.generated, s).toBe(false);
    }
  });

  /**
   * 주인공 7종은 **한 작가의 한 시리즈**여야 한다.
   *
   * 로스터를 여러 출처에서 모으면 선 굵기·팔레트·등신이 섞여서 같은 팀으로
   * 안 보인다. 실제로 그래서 자체 생성 4종을 통째로 교체했다 — 그쪽은
   * 3D 렌더라 CC0 픽셀아트 잡몹과 톤이 안 맞았다.
   */
  test("주인공은 7종 전부 chierit 한 시리즈다 — 톤이 섞이면 한 팀으로 안 보인다", () => {
    for (const s of HERO_SLUGS) {
      expect(manifest.chars[s]!.author, s).toBe("chierit");
      expect(manifest.chars[s]!.license, s).toMatch(/^CC-BY/);
    }
  });

  /**
   * 원본 방향을 매니페스트가 들고 있어야 한다.
   *
   * chierit 시트는 **오른쪽을 본다**(자체 생성 4인은 왼쪽이었다). 이 값이 틀리면
   * 런타임이 반대로 뒤집어서 주인공이 등을 보인 채 뒷걸음질로 적에게 다가가고,
   * 달리기가 진행 방향과 반대로 다리를 젓는다 — 화면에서는 "왜 왼쪽으로 가지?"로
   * 보인다. 좌표는 전부 맞기 때문에 코드를 읽어서는 안 잡힌다.
   */
  test("주인공 시트는 오른쪽을 본다고 기록되어 있다", () => {
    for (const s of HERO_SLUGS) {
      expect(manifest.chars[s]!.faces, s).toBe(1);
    }
  });

  test("CC0 잡몹·보스는 원본 방향 표시가 없다 = 오른쪽 (기본값)", () => {
    for (const s of [...MINION_SLUGS, ...BOSS_SLUGS]) {
      const faces = manifest.chars[s]!.faces;
      expect(faces === undefined || faces === 1, s).toBe(true);
    }
  });

  test("kind가 목록과 맞는다", () => {
    for (const s of HERO_SLUGS) expect(manifest.chars[s]!.kind).toBe("hero");
    for (const s of MINION_SLUGS) expect(manifest.chars[s]!.kind).toBe("minion");
    for (const s of BOSS_SLUGS) expect(manifest.chars[s]!.kind).toBe("boss");
  });

  test("모든 캐릭터가 대기·공격·사망을 가진다 — 없으면 얼어붙거나 안 죽는다", () => {
    for (const [slug, d] of Object.entries(manifest.chars)) {
      const names = Object.keys(d.actions);
      // idle이 없는 에셋(flying_eye)은 walk로 대체한다 — 둘 중 하나는 있어야 한다
      expect(names.some((n) => n === "idle" || n === "walk"), slug).toBe(true);
      expect(names.some((n) => n.startsWith("attack")), slug).toBe(true);
      expect(names, slug).toContain("death");
    }
  });

  test("액션 메타가 시트 안을 가리킨다 — 넘치면 빈 프레임이 나온다", () => {
    for (const [slug, d] of Object.entries(manifest.chars)) {
      expect(d.refSubjH, slug).toBeGreaterThan(0);
      for (const [name, a] of Object.entries(d.actions)) {
        const where = `${slug}/${name}`;
        expect(a.frames, where).toBeGreaterThan(0);
        expect(a.cols, where).toBeGreaterThan(0);
        expect(a.fps, where).toBeGreaterThan(0);
        const rows = Math.ceil(a.frames / a.cols);
        expect(a.y + rows * a.cellH, where).toBeLessThanOrEqual(d.h);
        expect(a.cols * a.cellW, where).toBeLessThanOrEqual(d.w);
      }
    }
  });

  test("발밑 여백이 셀 안에 있다 — 넘으면 앵커가 셀 밖으로 나가 캐릭터가 사라진다", () => {
    for (const [slug, d] of Object.entries(manifest.chars)) {
      for (const [name, a] of Object.entries(d.actions)) {
        const footY = a.cellH - d.baseGap - a.dy;
        expect(footY, `${slug}/${name}`).toBeGreaterThan(0);
        expect(footY, `${slug}/${name}`).toBeLessThanOrEqual(a.cellH);
      }
    }
  });

  /**
   * 주인공 시트가 배경에 녹지 않을 만큼 밝은가.
   *
   * **화면으로만 드러나는 결함이라 숫자로 박아 둔다.** 리제 0.063·실비아
   * 0.057이 그렇게 들어왔다 — 3D 렌더의 조명은 4종이 같은데 의상 알베도가
   * 달라서 노출이 6배 벌어진 것이고(노라 0.403), 배경이 어두운 동안에는
   * 아무도 몰랐다. 삽화 배경으로 밝히자 캐릭터가 **배경보다 어두워져서**
   * 구멍처럼 보였다.
   *
   * 런타임 `tint`로는 못 고친다(곱셈이라 밝힐 수 없고, 테마 환경광은 네 명에게
   * 같은 값으로 걸려서 캐릭터별 편차를 지울 수 없다). 그래서 임포터가
   * `lift_luminance`로 맞추고, 이 테스트가 그 결과를 지킨다.
   */
  test("주인공은 배경보다 밝다 — 어두운 재렌더가 조용히 돌아오는 것을 막는다", () => {
    const bg = JSON.parse(
      readFileSync("public/assets/bg/bg.json", "utf-8"),
    ) as Record<string, { regions: Record<string, { medLum?: number }> }>;
    // 캐릭터 뒤에 오는 것은 삽화 3겹 중 아무 층이나 될 수 있다 — 어느 층 앞에
    // 서든 녹지 않아야 하므로 **가장 밝은** 층과 견준다
    const brightest = Math.max(
      ...Object.values(bg)
        .flatMap((a) => Object.values(a.regions))
        .map((r) => r.medLum ?? 0),
    );
    // 배경 쪽 숫자가 사라지면(생성기에서 medLum을 빼면) 위 max가 0이 되어
    // 이 테스트가 아무것도 검사하지 않게 된다
    expect(brightest, "배경 medLum").toBeGreaterThan(0);
    // 환경광(`theme.ambient`)이 곱해진 뒤로 봐야 화면과 같다. `tint`는 캐릭터에만
    // 걸리므로 캐릭터만 어두워지고 배경은 그대로다 — 이걸 빼면 통과하고도 녹는다.
    // 가장 어두운 테마를 쓴다: 심연에서 안 보이면 안 보이는 것이다
    const worst = Math.min(...WAVE_THEMES.map((t) => luminance(t.ambient)));
    for (const s of HERO_SLUGS) {
      const lit = manifest.chars[s]!.medLum * worst;
      expect(lit, `${s} 환경광 적용 후 명도 vs 배경 ${brightest}`).toBeGreaterThan(
        brightest,
      );
    }
  });

  // 잡몹·보스는 리프트하지 않는다 — 손으로 그린 픽셀아트의 명암은 작가의
  // 선택이고(박쥐 0.071은 "어두운 적"이 의도다), 감마로 들면 팔레트가 씻겨
  // 도트가 뭉갠 것처럼 보인다. 다만 숫자는 재서 남긴다(회귀 추적용)
  test("모든 캐릭터가 명도를 기록한다 — 없으면 위 검사가 조용히 통과한다", () => {
    for (const [slug, d] of Object.entries(manifest.chars)) {
      expect(d.medLum, slug).toBeGreaterThan(0);
      expect(d.medLum, slug).toBeLessThanOrEqual(1);
    }
  });

  test("잡몹·보스는 키 배율을 가진다 — 쥐와 해골이 같은 키면 위협이 구별되지 않는다", () => {
    for (const s of [...MINION_SLUGS, ...BOSS_SLUGS]) {
      const d = manifest.chars[s]!;
      expect(d.hMul, s).toBeGreaterThan(0);
      expect(d.hMul, s).toBeLessThanOrEqual(1.5);
    }
    // 쥐는 해골보다 확실히 작아야 한다
    expect(manifest.chars["rat"]!.hMul!).toBeLessThan(
      manifest.chars["skeleton"]!.hMul!,
    );
  });

  test("공중 몹만 lift를 가진다", () => {
    const airborne = MINION_SLUGS.filter((s) => (manifest.chars[s]!.lift ?? 0) > 0);
    expect(airborne.sort()).toEqual(["bat", "flying_eye"]);
  });

  /**
   * 근접 돌진은 이 액션들 위에 세워진다 — 하나만 빠져도 대체 사슬을 타
   * 다른 캐릭터와 똑같은 동작이 나온다(= 넷이 같은 사람으로 보인다).
   */
  /**
   * "내 공격 4 + 상대 방해 2" 6슬롯을 **각 캐릭터의 자기 클립**으로 채운다.
   * 공격이 넷 다 있어야 네 슬롯이 서로 다른 동작으로 보인다 — 하나라도 없으면
   * 대체 사슬(`spriteChar` FALLBACK)을 타서 두 슬롯이 같은 클립을 재생한다.
   * 네 칸이 네 벌을 하나씩 받으므로 **여유분이 0이다** — 다섯 번째 공격 칸을
   * 검토했다가 버린 이유이고, 액션 하나가 빠지면 곧바로 겹친다.
   */
  test("주인공은 접근·공격 4종을 다 가진다 — 6슬롯의 재료다", () => {
    for (const s of HERO_SLUGS) {
      const names = Object.keys(manifest.chars[s]!.actions);
      for (const a of ["roll", "attack1", "attack2", "attack3", "special"]) {
        expect(names, `${s}/${a}`).toContain(a);
      }
      // 접근 클립은 `run` 또는 `walk` 중 하나면 된다 — water_priestess만 walk다
      expect(names.some((n) => n === "run" || n === "walk"), `${s} 접근`).toBe(
        true,
      );
    }
  });

  /**
   * 콤보 2·3타에서 **앞 타의 재생분이 남아 있지 않다**.
   *
   * chierit는 콤보를 **누적**으로 그려 놨다: `2_atk`는 "1타+2타", `3_atk`는
   * "1·2타+3타"다(7종 중 5종). 우리는 세 공격을 독립 슬롯으로 쓰므로 그대로 넣으면
   * 두 가지가 동시에 깨진다 — attack3을 누르면 남의 공격을 1.3초 재생한 뒤에야
   * 3타가 나오고(fire_knight는 28프레임 중 18이 앞 타), `impact`의 전역 argmax가
   * 그 앞 타에 걸려서 metal_bladekeeper의 attack1/2/3이 **셋 다 impact=1**로
   * 들어왔다(= 칼을 휘두르기 1.2초 전에 HP가 깎인다).
   *
   * **`comboTrim`이 0이라도 있어야 한다.** 필드가 없으면 "재고 0이었다"와
   * "임포터가 검사를 건너뛰었다"가 구별되지 않는다 — 판정을 프레임 해시로 하던
   * 동안 5종이 조용히 안 잘린 채 통과했다(앞 타를 다시 그리면서 몇 픽셀이 달라져
   * 해시만 어긋났다). 측정하지 않은 것을 성공으로 취급하면 안 되므로 존재를 먼저
   * 확인한다.
   *
   * 잘라낸 **양**은 여기서 검사하지 않는다 — 정답은 캐릭터마다 다르고
   * (0 ~ 18프레임) 픽셀에만 있다. 이 테스트가 지키는 것은 "쟀다"뿐이고, 실제
   * 프레임 판정은 임포터가 `COMBO_SAME_RATIO`로 한다.
   */
  test("콤보 2·3타의 앞 타 재생분을 재서 기록했다 — 안 재면 남의 공격이 앞에 붙는다", () => {
    for (const s of HERO_SLUGS) {
      const acts = manifest.chars[s]!.actions;
      for (const n of ["attack2", "attack3"]) {
        const a = acts[n]!;
        expect(a.comboTrim, `${s}/${n} comboTrim`).toBeDefined();
        /**
         * 너무 많이 자르지 않았는가. **`comboTrim`과 `frames`를 견주면 안 된다** —
         * `frames`는 이미 자른 **뒤**의 수라 둘은 다른 양이고, 비교하면 항상
         * 참이거나 항상 거짓인 무의미한 검사가 된다(처음에 그렇게 써서 16 < 11로
         * 터졌다). 남은 것이 휘두름으로 읽히는지를 `frames`만으로 본다:
         * 준비·타격·회수 세 프레임이 최소다. 실측 최소는 4(metal_bladekeeper).
         */
        expect(a.frames, `${s}/${n} 자른 뒤 남은 프레임`).toBeGreaterThanOrEqual(3);
      }
    }
    // 누적 콤보를 실제로 하나라도 잘라냈는가. 전부 0이면 판정이 다시 고장 난
    // 것이다(해시 시절이 그랬다) — chierit 5종은 반드시 잘려야 한다
    const trimmed = HERO_SLUGS.filter((s) =>
      ["attack2", "attack3"].some(
        (n) => (manifest.chars[s]!.actions[n]!.comboTrim ?? 0) > 0,
      ),
    );
    expect(trimmed.length, `잘린 캐릭터 ${trimmed.join(",")}`).toBe(5);
  });

  /**
   * 임팩트가 클립 **안**에 있어야 한다. 0번이면 모션이 시작하기도 전에 HP가 깎인다.
   *
   * **마지막 프레임은 막지 않는다.** 막고 싶었지만 `mimic/attack1`이 14프레임 중
   * 13에서 때린다 — 캡처로 보면 그 프레임에 상자가 앞으로 덮치는 것이 맞다
   * (`/tmp/mimic_attack1.png`). `impactDelayMs`가 `n-1`로 클램프하므로 재생도
   * 정상이다. 에셋이 그렇게 그려진 것을 결함으로 세면 이 테스트는 거짓말이 된다.
   */
  test("임팩트가 클립 첫 프레임이 아니다 — 0이면 모션 전에 HP가 깎인다", () => {
    for (const [slug, d] of Object.entries(manifest.chars)) {
      for (const [name, a] of Object.entries(d.actions)) {
        if (a.impact === undefined) continue;
        const where = `${slug}/${name} (${a.frames}프레임 중 ${a.impact})`;
        expect(a.impact, where).toBeGreaterThan(0);
        expect(a.impact, where).toBeLessThan(a.frames);
      }
    }
  });

  test("주인공 7종이면 2:2에서 양 팀이 전부 다른 캐릭터다", () => {
    // 내가 하나를 고르고 나머지 셋을 시드가 뽑아도 겹치지 않아야 한다.
    // 4종이던 시절에는 상대 팀이 남은 둘로 강제되어 매판 같은 넷이 섰다
    expect(HERO_SLUGS.length).toBeGreaterThanOrEqual(7);
    for (let seed = 0; seed < 40; seed++) {
      const mine = pickHeroSlugs(seed, 2);
      const theirs = pickHeroSlugs(seed + 1, 2, mine);
      expect(new Set([...mine, ...theirs]).size).toBe(4);
    }
  });

  test("주인공은 한글 표시 이름을 가진다 (§HUD 카드)", () => {
    for (const s of HERO_SLUGS) {
      expect(manifest.chars[s]!.displayName, s).toMatch(/[가-힣]/);
    }
  });

  test("주인공 스프라이트가 실제로 존재한다", () => {
    for (const s of HERO_SLUGS) {
      expect(() => readFileSync(`public/assets/chars/${s}.png`), s).not.toThrow();
    }
  });

  /**
   * 텍스처 예산 — **부팅이 시트를 전부 올린다**(`bootScene`의 `chars` 단계가
   * `Object.keys(m.chars)` 전체를 로드한다). 그래서 시트 하나가 커지는 것이
   * 곧 상시 GPU 점유이고, 모바일에서는 그게 탭 강제 종료로 나타난다.
   *
   * **디스크 KB로 재면 안 된다.** PNG는 압축돼서 1128KB지만, GPU에 올라가는
   * 것은 압축이 풀린 `w × h × 4바이트`다 — 지금 134MB다. 두 수의 배가 100배를
   * 넘으므로 파일 크기를 보면 "가볍네"로 오독한다.
   *
   * 상한의 유래: chierit 원본 셀은 288×128인데 캐릭터는 그 안에서 26~50px만
   * 쓴다 — 캔버스째 넣으면 주인공만 132MB였다. 셀 재단(`crop_window`)과 콤보
   * 누적분 잘라내기(`trim_combo_prefix`)로 줄였다. 여유를 두되 두 배는 안 준다:
   * 상한이 느슨하면 다음 캐릭터가 288×128을 그대로 들고 들어와도 통과한다.
   */
  test("모든 시트를 올려도 GPU 텍스처 예산 안이다 — 부팅이 전부 로드한다", () => {
    const bytes = Object.values(manifest.chars).reduce(
      (n, d) => n + d.w * d.h * 4,
      0,
    );
    const mb = bytes / 1024 / 1024;
    expect(mb, `캐릭터 시트 합계 ${mb.toFixed(0)}MB`).toBeLessThanOrEqual(160);
  });

  test("TS 목록이 임포터 목록과 같다 — 두 벌을 손으로 맞추므로 대조가 필요하다", () => {
    const py = readFileSync("tools/import_chars.py", "utf-8");
    /** `HEROES = [ ("slug", "이름"), … ]` 같은 파이썬 리터럴에서 슬러그만 뽑는다 */
    const slugsIn = (name: string): string[] => {
      const body = py.slice(py.indexOf(`${name} = [`)).split("]")[0]!;
      return [...body.matchAll(/\("([a-z0-9_]+)"/g)].map((m) => m[1]!);
    };
    expect(slugsIn("HEROES")).toEqual([...HERO_SLUGS]);
    // 잡몹은 순서에 의미가 있다(약→강)지만 임포터 쪽은 표시 순서라 집합만 본다
    expect(slugsIn("MINIONS").sort()).toEqual([...MINION_SLUGS].sort());
    expect(slugsIn("BOSSES").sort()).toEqual([...BOSS_SLUGS].sort());
  });
});

/**
 * 반전 규칙. 화면에서 확인한 실패를 그대로 박아 둔다 — 왼쪽 보는 시트에
 * `setFacing(1)`을 주면 뒤집혀야 하고, 오른쪽 보는 시트는 그대로 둬야 한다.
 */
describe("facingFlip", () => {
  it("원본과 원하는 방향이 같으면 안 뒤집는다", () => {
    expect(facingFlip(1, 1)).toBe(1);
    expect(facingFlip(-1, -1)).toBe(1);
  });

  it("다르면 뒤집는다 — 왼쪽 시트를 오른쪽으로 보내는 우리 주인공 경우다", () => {
    expect(facingFlip(1, -1)).toBe(-1);
    expect(facingFlip(-1, 1)).toBe(-1);
  });

  it("원본 방향을 안 주면 오른쪽으로 본다 — 기존 CC0 에셋 전부가 그랬다", () => {
    expect(facingFlip(1)).toBe(1);
    expect(facingFlip(-1)).toBe(-1);
  });

  /**
   * 아래 필드는 `mirrorX`로 **좌우** 반전된다(화면에서 상대 팀은 오른쪽에서
   * 왼쪽으로 공격한다). 그 반전은 `world` 컨테이너가 통째로 하므로 **스프라이트에
   * 주는 방향은 두 필드가 같다** — `battleField`는 양쪽 모두 `setFacing(1)`이다.
   * 여기서 부호가 꼬이면 한쪽 팀만 뒷걸음질한다.
   */
  it("주인공 7인이 두 필드 모두 (로컬 좌표계에서) 오른쪽을 향한다", () => {
    for (const s of HERO_SLUGS) {
      // 매니페스트의 실제 값을 먹인다. chierit 시트는 오른쪽을 보므로 안 뒤집는다 —
      // 여기서 부호가 꼬이면 화면에서 뒷걸음질하고, 좌표는 다 맞아서 안 잡힌다
      expect(facingFlip(1, manifest.chars[s]!.faces ?? 1), s).toBe(1);
    }
  });
});
