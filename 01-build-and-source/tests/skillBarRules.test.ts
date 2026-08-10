import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { luminance } from "../src/shared/color";
import {
  AUTO_DEFAULT_ON,
  AUTO_DIAMETER_RATIO,
  AUTO_INTERVAL_MS,
  BAR_PAD_RATIO,
  GOLD_LINE_H,
  LABEL_GAP_PX,
  WOOD_BASE,
  autoBadgeD,
  autoLabel,
  autoScopeNotice,
  barLayout,
  initialAutoFor,
  woodBands,
} from "../src/shared/skillBarRules";
import { DESIGN_W, SKILLBAR_RATIO, DESIGN_H } from "../src/shared/viewport";
import { T_BODY, T_LABEL } from "../src/shared/theme";
import { PAD_BUTTON_X } from "../src/shared/ui/shapeRules";
import { CAST_GATE_MAX_MS } from "../src/shared/castGateRules";
import { HERO_SLUGS } from "../src/shared/charManifest";
import { presetSkillsFor } from "../src/loadout/preset";

describe("woodBands", () => {
  it("위가 밝고 아래가 어둡다 (§7 세로 그라디언트)", () => {
    const b = woodBands();
    expect(luminance(b.top)).toBeGreaterThan(luminance(b.mid));
    expect(luminance(b.mid)).toBeGreaterThan(luminance(b.bottom));
  });

  it("가운데는 밑색 그대로다", () => {
    expect(woodBands(0x123456).mid).toBe(0x123456);
    expect(woodBands().mid).toBe(WOOD_BASE);
  });

  it("스펙 밑색을 유지한다 (§7: #504030)", () => {
    expect(WOOD_BASE).toBe(0x504030);
  });

  it("상단 금색 라인은 2px (§7)", () => {
    expect(GOLD_LINE_H).toBe(2);
  });
});

describe("barLayout", () => {
  const W = DESIGN_W;
  const H = Math.round(DESIGN_H * SKILLBAR_RATIO);

  it("AUTO 배지가 슬롯보다 작다 — 스킬이 주인공이다", () => {
    const l = barLayout(W, H, 4, 0.62);
    expect(autoBadgeD(H)).toBeLessThan(l.slotD);
    expect(AUTO_DIAMETER_RATIO).toBeLessThan(0.62);
  });

  /**
   * **배지 좌표는 바의 기하가 아니다** (3단계). 배지가 바 밖으로 나갔으므로
   * `barLayout`이 자리를 돌려주면 그 값을 쓰는 쪽이 바 안에 그리게 된다 —
   * 자리는 모드별 규칙(`diveHudRules`·`pvpBadgeRules`)이 갖는다.
   */
  it("배지 자리를 바가 돌려주지 않는다 — 지름만 준다", () => {
    const l = barLayout(W, H, 4, 0.62) as unknown as Record<string, unknown>;
    expect(l.autoX).toBeUndefined();
    expect(l.autoY).toBeUndefined();
    expect(l.autoD).toBeUndefined();
    expect(autoBadgeD(H)).toBeCloseTo(H * AUTO_DIAMETER_RATIO, 6);
    // 깨진 입력에서도 유한값 (바 높이 0 = 갤러리·초기 프레임)
    expect(autoBadgeD(0)).toBe(0);
    expect(autoBadgeD(Number.NaN)).toBe(0);
  });

  it("첫 슬롯이 왼쪽 여백에서 시작한다 — AUTO가 먹던 폭을 되찾았다", () => {
    for (const n of [4, 5, 6]) {
      const l = barLayout(W, H, n, 0.62);
      expect(l.slotX(0) - l.slotD / 2, `${n}칸`).toBeGreaterThanOrEqual(
        W * BAR_PAD_RATIO,
      );
    }
  });

  it("슬롯 간격이 균등하고 오른쪽 여백을 넘지 않는다", () => {
    const l = barLayout(W, H, 4, 0.62);
    const xs = [0, 1, 2, 3].map((i) => l.slotX(i));
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
    expect(xs[3]! + l.slotD / 2).toBeLessThanOrEqual(W);
  });

  it("슬롯이 늘어나면 겹치지 않게 지름이 줄어든다", () => {
    const four = barLayout(W, H, 4, 0.62);
    const eight = barLayout(W, H, 8, 0.62);
    expect(eight.slotD).toBeLessThan(four.slotD);
    // 여전히 서로 안 겹친다
    expect(eight.slotX(1) - eight.slotX(0)).toBeGreaterThanOrEqual(eight.slotD);
  });

  it("슬롯 지름이 바 높이를 넘지 않는다 — 라벨 자리를 남긴다", () => {
    const l = barLayout(W, H, 4, 0.62);
    expect(l.slotD).toBeLessThanOrEqual(H);
    expect(l.slotY + l.slotD / 2).toBeLessThanOrEqual(H * 1.05);
  });

  it("슬롯 0개·폭 0에서도 유한값을 준다", () => {
    const l = barLayout(0, 0, 0, 0.62);
    expect(Number.isFinite(l.slotD)).toBe(true);
    expect(Number.isFinite(l.slotX(0))).toBe(true);
    expect(Number.isFinite(l.labelMaxW)).toBe(true);
  });

  /**
   * **라벨 폭이 옆 칸을 넘지 않아야 한다.**
   *
   * 4칸에서는 칸이 넓어 우연히 안 겹쳤고, 5칸으로 늘리자 캡처에서 이름 다섯 개가
   * 이어 붙어 `물살 베기조류 가르기심해 세례…` 한 줄로 읽혔다(양 끝은 화면 밖으로
   * 잘렸다). 지름이 아니라 **칸 폭**에서 나와야 잡힌다 — 지름은 이미 칸에 맞춰
   * 줄어들지만 이름은 원보다 넓다.
   */
  it("라벨 폭이 칸 간격보다 좁다 — 옆 칸 이름과 이어 붙지 않는다", () => {
    for (const n of [2, 4, 5, 6, 8]) {
      const l = barLayout(W, H, n, 0.62);
      const pitch = l.slotX(1) - l.slotX(0);
      expect(l.labelMaxW, `${n}칸`).toBeLessThan(pitch);
      // 원보다는 넓어야 한다 — 원 폭으로 자르면 다섯 자 이름이 늘 말줄임된다
      expect(l.labelMaxW, `${n}칸`).toBeGreaterThan(l.slotD);
    }
  });

  it("라벨 폭이 슬롯 수에 따라 줄어든다 — 상수면 늘어난 칸에서 넘친다", () => {
    expect(barLayout(W, H, 5, 0.62).labelMaxW).toBeLessThan(
      barLayout(W, H, 4, 0.62).labelMaxW,
    );
  });

  /**
   * **라벨 두 줄이 바 안에 들어가야 한다.**
   *
   * 폭만 제한했을 때 캡처에서 5칸 중 3개가 `조류 가…`로 잘렸다 — 축소 하한에
   * 걸려서다. 두 단어를 접으면 온전히 읽히지만 그건 아랫줄이 바 안에 있을
   * 때만 맞다. `labelMaxH`가 두 줄보다 작아지면 접기가 오히려 글자를 지운다.
   */
  it("칸마다 한 줄로 넓거나 두 줄로 높다 — 둘 다 아니면 이름이 잘린다", () => {
    /**
     * 가장 긴 스킬 이름은 `파쇄 삼연참`·`불꽃 상승참` — 한글 5자 + 공백.
     * 도트 폰트는 한글이 정폭(글자 크기)이고 공백이 반칸이라 5.5칸으로 잡는다.
     * (실측은 Pixi가 필요하다. 이 값이 어긋나면 캡처에서 말줄임으로 드러난다 —
     * 실제로 그렇게 발견했다.)
     */
    const oneLineW = T_LABEL.size * 5.5;
    /** 줄 높이는 글자 크기보다 크다 — 두 줄 + 행간 여유 */
    const twoLinesH = T_LABEL.size * 2 * 1.2;
    for (const n of [2, 3, 4, 5, 6]) {
      const l = barLayout(W, H, n, 0.62);
      const wide = l.labelMaxW >= oneLineW;
      const tall = l.labelMaxH >= twoLinesH;
      expect(wide || tall, `${n}칸: W=${l.labelMaxW} H=${l.labelMaxH}`).toBe(
        true,
      );
    }
  });

  it("칸이 좁아지면 라벨 높이가 늘어난다 — 접을 자리가 같이 생긴다", () => {
    // 슬롯 지름이 칸에 걸려 줄어드는 구간에서 성립해야 한다 (4칸부터)
    const hs = [4, 5, 6, 8].map((n) => barLayout(W, H, n, 0.62).labelMaxH);
    for (let i = 1; i < hs.length; i += 1) {
      expect(hs[i]!, `${i}`).toBeGreaterThan(hs[i - 1]!);
    }
  });

  it("라벨 높이가 슬롯 아래 남는 공간이다 — 원과 겹치지 않는다", () => {
    const l = barLayout(W, H, 5, 0.62);
    expect(l.slotY + l.slotD / 2 + LABEL_GAP_PX + l.labelMaxH).toBeCloseTo(H, 6);
  });

  /** 여섯 칸이 양쪽 여백 안에 들어간다 — 6번째가 타락도 해금 슬롯이다 (3단계) */
  it("6칸이 바 안에 온전히 들어간다", () => {
    const l = barLayout(W, H, 6, 0.62);
    expect(l.slotX(0) - l.slotD / 2).toBeGreaterThanOrEqual(W * BAR_PAD_RATIO);
    expect(l.slotX(5) + l.slotD / 2).toBeLessThanOrEqual(W);
    // 라벨은 원보다 넓다 — 마지막 칸의 이름이 화면 밖으로 나가지 않아야 한다
    expect(l.slotX(5) + l.labelMaxW / 2).toBeLessThanOrEqual(W);
  });

  /**
   * **AUTO 구역을 되찾은 것이 6번째 칸의 대가다** (3단계 결정 기록).
   *
   * 옛 기하에서 슬롯 구역은 `pad + autoD + pad`부터 시작했다. 그때 5칸의 칸 폭이
   * 얼마였는지를 여기서 다시 계산해, 지금의 **6칸**이 그보다 넓다는 것을 못박는다.
   * 이 부등식이 깨지는 유일한 방법은 배지를 바 안으로 되돌리는 것이다 — 그러면
   * 6칸이 옛 5칸보다 좁아지고, 라벨이 옆 칸과 이어 붙는 그 실패로 되돌아간다.
   *
   * **옛 비율 0.44는 여기 박아둔 숫자여야 한다.** 처음에는 `autoBadgeD(H)`로
   * 계산했는데, 배지 비율을 0.44→0.36으로 내리자 **기준선이 같이 줄어들면서**
   * 이 테스트가 깨졌다(옛 5칸이 114.5로 부풀어 지금 6칸 112.8을 앞질렀다).
   * 기준선은 과거의 기하이므로 지금 상수를 읽으면 안 된다 — 읽으면 비율을 만질
   * 때마다 비교 대상이 함께 움직여 부등식이 아무것도 안 지킨다.
   */
  it("6칸 폭이 옛 5칸(AUTO 구역 있던 시절)보다 넓다", () => {
    /** §7의 옛 배지 비율. 지금 상수(`AUTO_DIAMETER_RATIO`)가 아니다 — 위 주석 참조 */
    const OLD_AUTO_RATIO = 0.44;
    const pad = W * BAR_PAD_RATIO;
    const oldZoneX = pad + H * OLD_AUTO_RATIO + pad;
    const oldFiveCell = (W - oldZoneX - pad) / 5;
    const nowSix = barLayout(W, H, 6, 0.62);
    const nowSixCell = nowSix.slotX(1) - nowSix.slotX(0);
    expect(nowSixCell).toBeGreaterThan(oldFiveCell);
  });
});

describe("autoLabel", () => {
  it("ON/OFF를 2줄로 준다 (§7)", () => {
    expect(autoLabel(true)).toEqual(["AUTO", "ON"]);
    expect(autoLabel(false)).toEqual(["AUTO", "OFF"]);
  });
});

/**
 * **배지가 적은 상태와 전장이 실제로 하는 일이 같은가** — 유저 신고 2번의
 * 남은 절반이다.
 *
 * 게이트는 이미 한 값(`field.auto`)을 본다. 그런데 배지는 `setAuto(false)`로,
 * 전장은 `autoOn = true`로 **출발**하고 있었다. 싱글 진입 직후 배지에
 * `AUTO OFF`가 적힌 채 캐릭터가 돌진하고 적을 죽인다 — 1:1 캡처와 같은 순간의
 * `[dash] ally=m0 skill=auto` 로그로 같이 확인했다. 게이트를 아무리 한 값으로
 * 모아도 시작점이 갈리면 화면은 계속 거짓말을 한다.
 */
describe("initialAutoFor — 배지의 처음 상태", () => {
  it("싱글은 전장의 기본값을 물려받는다 — 여기가 갈려서 신고가 났다", () => {
    // 리터럴 `true`가 아니라 전장이 쓰는 상수와 **같은 값**인지를 묻는다
    expect(initialAutoFor("battle")).toBe(AUTO_DEFAULT_ON);
  });

  it("전장의 기본은 ON이다 — 방치형 첫 진입에 아무 일도 없으면 멈춘 것으로 읽힌다", () => {
    expect(AUTO_DEFAULT_ON).toBe(true);
  });

  /**
   * 대조군이다. 전역 기본값 하나로 고치면 이쪽까지 ON이 되는데, PvP의 `OFF`는
   * 거짓말이 아니다 — `field.setAuto`를 안 부르므로 배지가 말하는 것은 내 스킬
   * 자동 시전 하나다. 고칠 필요 없는 모드를 바꾸지 않았다는 사실을 고정한다.
   */
  it("PvP는 OFF에서 시작한다 — 그쪽 배지는 전장을 쥐고 있지 않다", () => {
    expect(initialAutoFor("skill")).toBe(false);
  });

  it("두 범위가 다르다 — 같으면 범위를 묻는 의미가 없다", () => {
    expect(initialAutoFor("battle")).not.toBe(initialAutoFor("skill"));
  });

  /**
   * 처음 상태와 그 상태의 문구가 서로 맞는지. 싱글은 ON에서 출발하므로 첫
   * 문구가 "알아서 싸운다" 계열이어야 하고, PvP는 OFF이므로 "직접 누른다"다.
   * 둘이 어긋나면 배지는 켜져 있는데 공지가 꺼진 쪽을 설명한다.
   */
  it("처음 상태의 문구가 그 상태를 설명한다", () => {
    for (const scope of ["battle", "skill"] as const) {
      const on = initialAutoFor(scope);
      expect(autoScopeNotice(on, scope)).toContain(autoLabel(on).join(" "));
    }
  });

  /**
   * 바가 초기 상태를 **그리는** 것까지는 여기서 못 본다(Pixi). 그 자리는
   * `setAuto(auto)` 한 줄이고, 예전에 `setAuto(false)`라서 초기값이 조용히
   * 무효였다 — 리터럴로 되돌아가면 이 결함이 그대로 돌아오므로 소스로 막는다
   * (메모리 [[mocks-hide-the-mocked-function]]: 대역은 대역 밖을 못 잰다).
   */
  it("바가 초기 상태를 그린다 — 리터럴로 덮어쓰지 않는다", () => {
    const src = readFileSync(
      new URL("../src/shared/skillBar.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("let auto = initialAutoFor(opts.autoScope);");
    expect(src).toContain("setAuto(auto);");
    expect(src).not.toMatch(/^\s*setAuto\((true|false)\);/m);
  });

  it("전장의 초기값도 같은 상수다 — 리터럴이면 다시 갈린다", () => {
    const src = readFileSync(
      new URL("../src/shared/battleField.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("let autoOn = AUTO_DEFAULT_ON;");
    expect(src).not.toMatch(/let autoOn = (true|false);/);
  });
});

/**
 * **배지 라벨은 자기 범위보다 크게 말한다 — 그리고 범위는 모드마다 다르다.**
 *
 * PvP(`"skill"`)에서 `AUTO OFF`가 끄는 것은 **내 캐릭터**다(동작 + 자동 공격 딜
 * + 내 스킬 자동 시전). AI 팀원과 상대 필드는 배지를 보지 않으므로 판은 계속
 * 흐른다. 싱글(`"battle"`)은 전투 전체를 세운다 — 상대가 없다.
 *
 * 두 모드가 같은 신고를 받았다: "Auto를 안 키면 캐릭터가 움직이면 안 된다고
 * 생각하거든? 근데 계속 움직여"(싱글), "auto off여도 내 캐릭터가 공격하는 이슈
 * 있어"(PvP). 그래서 두 문구 다 내 캐릭터가 멈춘다고 말해야 하고, 갈리는 것은
 * **팀원까지 멈추는가**다.
 *
 * 라벨(`AUTO`/`ON`)은 짧은 고정 토큰이라 늘릴 수 없으므로 탭 순간의 공지가
 * 범위를 말한다.
 */
describe("autoScopeNotice", () => {
  const SCOPES = ["skill", "battle"] as const;

  it("ON/OFF가 다른 문구다 — 같으면 무엇이 바뀌었는지 모른다", () => {
    for (const scope of SCOPES) {
      expect(autoScopeNotice(true, scope)).not.toBe(
        autoScopeNotice(false, scope),
      );
      for (const on of [true, false]) {
        expect(autoScopeNotice(on, scope).length).toBeGreaterThan(0);
      }
    }
  });

  it("배지 상태를 문구가 먼저 밝힌다 — 배지를 다시 볼 필요가 없다", () => {
    for (const scope of SCOPES) {
      expect(autoScopeNotice(true, scope)).toContain(autoLabel(true).join(" "));
      expect(autoScopeNotice(false, scope)).toContain(
        autoLabel(false).join(" "),
      );
    }
  });

  /**
   * 이게 이 문구의 존재 이유다 — OFF가 **무엇을 끄고 무엇을 안 끄는지**를
   * 같이 말해야 한다. 두 절 중 하나라도 빠지면 라벨의 과장이 남는다:
   * "내 캐릭터가 멈춘다"가 없으면 배지가 아무것도 안 하는 것처럼 읽히고,
   * "팀은 계속 싸운다"가 없으면 판이 멈추는 줄 안다.
   */
  it("PvP OFF 문구가 내 캐릭터는 멈추고 팀은 계속 싸운다고 말한다", () => {
    const off = autoScopeNotice(false, "skill");
    expect(off).toMatch(/내 캐릭터/);
    expect(off).toMatch(/멈춘다|정지/);
    expect(off).toMatch(/팀은.*싸운다/);
  });

  it("PvP ON 문구는 내 캐릭터가 싸운다고만 말한다 — 팀 전체를 약속하지 않는다", () => {
    const on = autoScopeNotice(true, "skill");
    expect(on).toMatch(/내 캐릭터/);
  });

  /**
   * **싱글 OFF는 반대를 말해야 한다.** 여기서 "계속 싸운다"가 나오면 그건
   * 화면과 어긋난 거짓말이다 — 싱글은 `field.setAuto`와 딜 게이트로 실제로
   * 전투를 세운다. 한 문구를 두 모드에 돌려 쓰던 앞선 회차가 정확히 이
   * 상태였고, 그래서 인자가 생겼다.
   */
  it("싱글 OFF 문구는 전투가 멈춘다고 말한다 — 계속 싸운다고 말하지 않는다", () => {
    const off = autoScopeNotice(false, "battle");
    expect(off).toMatch(/멈춘다|정지/);
    expect(off).not.toMatch(/계속 싸운다/);
  });

  it("두 모드의 OFF 문구가 서로 다르다 — 같으면 한쪽이 거짓이다", () => {
    expect(autoScopeNotice(false, "battle")).not.toBe(
      autoScopeNotice(false, "skill"),
    );
  });

  /**
   * **토스트 알약이 화면 폭을 넘지 않아야 한다** (§C10).
   *
   * 글자 수 상한을 손으로 적지 않는다 — 그러면 한글/영문 폭이 2배 다른 것을
   * 못 담아 실제로 맞는 문구를 막거나 넘치는 문구를 통과시킨다. 토스트 기하에서
   * 직접 유도한다: 폭은 `label.width + PAD_BUTTON_X * 2`이고(`createToast`)
   * 알약이 `DESIGN_W` 안에 있어야 한다. 도트 폰트는 한글이 정폭(글자 크기),
   * ASCII가 반칸이다 — 실측은 Pixi가 필요하고 여기 있는 것은 그 상한이다.
   *
   * **네 문구를 다 잰다.** 모드를 갈랐으므로 한쪽만 재면 새로 쓴 문구가
   * 검사 밖에 남는다.
   */
  it("토스트 알약이 화면 폭 안에 들어간다", () => {
    const estWidth = (s: string): number =>
      [...s].reduce(
        (a, ch) => a + (ch.charCodeAt(0) < 0x80 ? T_BODY.size / 2 : T_BODY.size),
        0,
      );
    for (const scope of SCOPES) {
      for (const on of [true, false]) {
        const text = autoScopeNotice(on, scope);
        const pillW = estWidth(text) + PAD_BUTTON_X * 2;
        expect(pillW, text).toBeLessThanOrEqual(DESIGN_W);
      }
    }
  });
});

describe("AUTO_INTERVAL_MS", () => {
  it("프레임보다 충분히 길다 — 매 프레임 난사를 막는다", () => {
    expect(AUTO_INTERVAL_MS).toBeGreaterThan(1000 / 60);
  });

  /**
   * **오토가 쿨보다 빨리 지르려 하면 안 된다.** 이 값이 네 칸의 평균 간격보다
   * 작으면 동시에 준비된 칸들을 연달아 태우고 그 뒤에 길게 쉰다 — 평균은 쿨이
   * 정하므로 총량 지표로는 드러나지 않고, 화면에서만 "난타 → 정적"으로 보인다.
   * 그게 유저가 신고한 오토/수동 괴리다.
   *
   * 프리셋에서 다시 계산한다 — 상수를 여기 적으면 쿨을 만진 날 이 검사가
   * 옛 박자를 지키게 된다(`derived-constants-need-their-derivation`).
   */
  it("네 칸의 쿨이 허용하는 평균 간격 아래로 내려가지 않는다", () => {
    const attacks = presetSkillsFor(HERO_SLUGS[0]).filter(
      (s) => s.kind === "attack",
    );
    const perSec = attacks.reduce((a, s) => a + 1000 / s.cooldownMs, 0);
    const meanGapMs = 1000 / perSec;
    expect(AUTO_INTERVAL_MS).toBeGreaterThanOrEqual(Math.floor(meanGapMs));
  });

  /**
   * **모션 게이트보다 길어야 한다.** 게이트에 걸린 시전은 `castSkill`이 쿨을
   * 태우기 전에 돌아가지만, 슬롯은 그 전에 `pulseAuto()`를 이미 찍는다
   * (`skillBar.update`) — 링은 반짝이고 딜은 없는 상태가 된다. 오토가 자기
   * 지표를 속이는 형태라서 로그로도 안 잡힌다.
   */
  it("모션 게이트 상한보다 길다 — 오토 시전이 조용히 버려지지 않는다", () => {
    expect(AUTO_INTERVAL_MS).toBeGreaterThan(CAST_GATE_MAX_MS);
  });
});
