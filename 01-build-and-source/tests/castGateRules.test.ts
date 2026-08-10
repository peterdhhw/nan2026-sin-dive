import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAST_GATE_MAX_MS,
  castGateMs,
  createCastGate,
  skillImpactMs,
  timeToImpactMs,
} from "../src/shared/castGateRules";

/**
 * **모션 게이트** — 방금 지른 타격의 임팩트를 다음 입력이 지우지 않게 막는다.
 *
 * `loadout.test.ts`가 "그쪽은 `castGateRules.test.ts`가 본다"고 가리키고 있었는데
 * **그 파일이 없었다**. 그래서 게이트 규칙 자체가 한 줄도 검사받지 않았고, 그
 * 상태에서 PvP가 게이트를 아예 배선하지 않은 것도 드러나지 않았다 —
 * 유저 신고: "스킬 눌러도 동작안하고".
 */
describe("castGateMs — 잠그는 시간", () => {
  it("임팩트까지 시간을 그대로 쓴다 — 상한 아래에서는", () => {
    expect(castGateMs(200)).toBe(200);
    expect(castGateMs(CAST_GATE_MAX_MS - 1)).toBe(CAST_GATE_MAX_MS - 1);
  });

  it("상한에서 접는다 — 늦은 임팩트를 다 기다리면 박자가 죽는다", () => {
    expect(castGateMs(1643)).toBe(CAST_GATE_MAX_MS);
    expect(castGateMs(CAST_GATE_MAX_MS + 1)).toBe(CAST_GATE_MAX_MS);
  });

  /**
   * 0·음수·NaN은 **게이트를 걸지 않는다**는 뜻이다(광선 스킬처럼 끊길 모션이
   * 없는 경우). 여기서 상한을 돌려주면 방해 두 칸이 서로를 막는다.
   */
  it("걸 것이 없으면 0이다 — 광선 스킬을 서로 막지 않는다", () => {
    expect(castGateMs(0)).toBe(0);
    expect(castGateMs(-5)).toBe(0);
    expect(castGateMs(Number.NaN)).toBe(0);
    expect(castGateMs(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("createCastGate — 한 시전자의 잠금", () => {
  it("아무것도 안 질렀으면 열려 있다 — 판 첫 입력이 막히면 안 된다", () => {
    const g = createCastGate();
    expect(g.canCast(0)).toBe(true);
    expect(g.remainingMs(0)).toBe(0);
  });

  it("지른 뒤 임팩트까지는 막고, 지나면 다시 연다", () => {
    const g = createCastGate();
    g.mark(1000, 300);
    expect(g.canCast(1000)).toBe(false);
    expect(g.canCast(1299)).toBe(false);
    expect(g.remainingMs(1100)).toBe(200);
    // 임팩트 시각에 정확히 열린다 — 경계에서 한 프레임 더 막으면 박자가 밀린다
    expect(g.canCast(1300)).toBe(true);
    expect(g.remainingMs(1300)).toBe(0);
  });

  it("긴 임팩트도 상한만큼만 막는다", () => {
    const g = createCastGate();
    g.mark(0, 5000);
    expect(g.canCast(CAST_GATE_MAX_MS - 1)).toBe(false);
    expect(g.canCast(CAST_GATE_MAX_MS)).toBe(true);
  });

  /**
   * 게이트를 **미루기만** 한다 — 이미 열린 뒤 임팩트 0인 스킬(광선)을 지르면
   * 잠금이 새로 걸리지 않아야 한다. 걸리면 방해를 누른 대가로 공격 칸이 막힌다.
   */
  it("임팩트 0을 지르면 잠기지 않는다", () => {
    const g = createCastGate();
    g.mark(1000, 0);
    expect(g.canCast(1000)).toBe(true);
  });

  it("NaN 시각에 안 무너진다 — 잠금 상태를 잃지 않는다", () => {
    const g = createCastGate();
    g.mark(1000, 300);
    g.mark(Number.NaN, 300);
    // NaN 표시는 무시된다: 앞서 걸린 잠금이 그대로 남아 있어야 한다
    expect(g.canCast(1100)).toBe(false);
    expect(g.canCast(Number.NaN)).toBe(false);
    expect(g.remainingMs(Number.NaN)).toBe(0);
  });
});

describe("timeToImpactMs / skillImpactMs", () => {
  it("접근 + 임팩트 프레임이다 — 복귀는 안 센다", () => {
    // 접근 200ms × 1배 + 6프레임 / 12fps = 500ms
    expect(timeToImpactMs(200, 1, 6, 12, 0)).toBe(700);
  });

  it("접근에 최소값이 걸린다 — 배율이 작아도 0으로 안 떨어진다", () => {
    expect(timeToImpactMs(100, 0.01, 0, 12, 124)).toBe(124);
  });

  it("fps가 깨져도 유한값이다", () => {
    expect(Number.isFinite(timeToImpactMs(200, 1, 6, 0, 0))).toBe(true);
    expect(Number.isFinite(timeToImpactMs(200, 1, -6, 12, 0))).toBe(true);
  });

  it("표에 없는 스킬은 0 — 게이트를 걸지 않는다", () => {
    const table = new Map([["a", 300]]);
    expect(skillImpactMs(table, "a")).toBe(300);
    expect(skillImpactMs(table, "b")).toBe(0);
    expect(skillImpactMs(table, undefined)).toBe(0);
  });
});

/**
 * ── **PvP도 게이트를 배선한다** (2026-08-10, 유저 신고 "스킬 눌러도 동작안하고")
 *
 * 게이트는 싱글에만 있었다(`single/session.ts`의 `castGates`). PvP의 `castSkill`은
 * `blinded()`와 쿨다운만 보고 바로 `onAllyAttack`으로 넘긴다 — 그런데
 * `battleField.onAllyAttack`은 **진행 중인 사이클을 끊고 갈아탄다**. 쿨다운은
 * 칸마다 따로 도니까 1번 직후 2번은 통과하고, 2번의 돌진이 1번의 임팩트 프레임을
 * 지워 버린다. 즉 **눌렀는데 아무 타격도 안 나간다**. 쿨다운 값을 아무리 만져도
 * 막히지 않는다(`castGateRules` 머리 주석: 쿨은 한 칸의 연타만 막는다).
 *
 * 여기는 Pixi 없이 세션을 못 세우므로(전장·스킬바가 Pixi다) **소스로** 묻는다.
 * 메모리 [[mocks-hide-the-mocked-function]]: 대역을 끼우면 대역 밖은 못 잰다 —
 * 실제로 빠진 것이 배선 자체이므로 배선을 봐야 한다.
 */
describe("pvp/session이 모션 게이트를 배선한다", () => {
  const pvpSrc = readFileSync(
    new URL("../src/pvp/session.ts", import.meta.url),
    "utf8",
  );

  /**
   * **`memberId`로 찾는지**까지 묻는다. `castGates`/`gateOf`라는 이름이 있는지만
   * 보면 통과하는 형태가 있다: 키를 `"shared"` 같은 상수로 바꿔 **전원이 게이트
   * 하나를 나눠 쓰는** 것. 돌연변이로 확인했더니 이름만 보던 앞선 판이 그걸
   * 그대로 통과시켰다. 그러면 AI 팀원이 지를 때마다 내 탭이 삼켜져서, 고치려던
   * 신고("스킬 눌러도 동작안하고")가 다른 원인으로 되돌아온다.
   */
  it("게이트를 시전자별로 들고 있다 — 팀원 게이트가 내 것을 막으면 안 된다", () => {
    expect(pvpSrc).toMatch(/createCastGate\(\)/);
    // 찾기와 넣기 둘 다 memberId를 키로 써야 한다 — 상수 키면 전원 공용이 된다
    expect(pvpSrc).toMatch(/castGates\.get\(memberId\)/);
    expect(pvpSrc).toMatch(/castGates\.set\(memberId\s*,/);
  });

  it("쿨다운을 태우기 전에 막는다 — 뒤면 쿨만 잃고 딜은 못 낸다", () => {
    const gateIdx = pvpSrc.search(/if \(!\w*[gG]ate\w*\.canCast\(/);
    const triggerIdx = pvpSrc.search(/cooldowns\.trigger\(/);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(triggerIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(triggerIdx);
  });

  it("지른 뒤 잠금을 건다 — mark 없으면 게이트가 영원히 열려 있다", () => {
    expect(pvpSrc).toMatch(/\.mark\(\s*nowMs/);
  });

  /**
   * 임팩트 시간을 **표에서** 받아야 한다. 상수를 적으면 캐릭터마다 다른 클립
   * 길이를 한 값으로 뭉개서, 늦은 임팩트는 여전히 끊기고 이른 임팩트는 필요
   * 이상으로 막힌다(메모리 [[derived-constants-need-their-derivation]]).
   */
  it("임팩트 시간을 표에서 읽는다 — 상수를 적지 않는다", () => {
    expect(pvpSrc).toMatch(/buildSkillImpactTable\(/);
    expect(pvpSrc).toMatch(/skillImpactMs\(/);
  });
});

/**
 * ── **게이트에 걸린 탭도 반응해야 한다** (2026-08-10, 캡처로 발견)
 *
 * 게이트를 넣고 A/B로 찍어보니 착지율은 고쳐졌다 — 빠른 두 번 탭에서 돌진 6회
 * 중 타격 2회(33%)였던 것이 돌진 2회 타격 2회(100%)가 됐다. 그런데 **거부된 탭 4번이
 * 아무 반응도 없다**: `skillBar`가 `ui_tap`을 울리고 `onCast`를 부른 뒤, 세션이
 * 조용히 `return`한다. 그게 정확히 유저가 신고한 화면이다 — "스킬 눌러도
 * 동작안하고". 원인을 고치면서 증상을 그대로 남길 수는 없다.
 *
 * 바에는 이미 그 반응이 있다(쿨 안 된 칸·잠긴 칸: 흔들림 + `ui_locked`).
 * 그래서 새 연출을 만들지 않고 **`onCast`가 받아들여졌는지 돌려주게** 한다 —
 * 판정은 세션만 할 수 있고(게이트는 세션이 쥔다), 반응은 바만 할 수 있다.
 */
describe("게이트에 걸린 탭이 무반응으로 끝나지 않는다", () => {
  const barSrc = readFileSync(
    new URL("../src/shared/skillBar.ts", import.meta.url),
    "utf8",
  );
  const pvpSrc = readFileSync(
    new URL("../src/pvp/session.ts", import.meta.url),
    "utf8",
  );
  const singleSrc = readFileSync(
    new URL("../src/single/session.ts", import.meta.url),
    "utf8",
  );

  it("onCast가 받아들여졌는지 돌려준다 — void면 바가 알 수 없다", () => {
    expect(barSrc).toMatch(/onCast\(skill: SkillDef, nowMs: number\): boolean/);
  });

  /**
   * 거부되면 **쿨 안 된 칸과 같은 반응**을 준다. 새 연출을 만들면 유저가 배울
   * 것이 하나 늘고, 두 경우가 화면에서 다르게 보일 이유도 없다("아직 아니다").
   */
  it("거부된 탭에 흔들림 + 잠김 소리를 준다", () => {
    const tapBlock = barSrc.slice(
      barSrc.indexOf("onTap: () => {"),
      barSrc.indexOf("slot.view.position.set"),
    );
    /**
     * **반환을 실제로 보는지**를 묻는다. `shakeMs = 0`·`ui_locked`가 이 블록에
     * 있는지만 보면 앞의 "쿨 안 된 칸" 분기 때문에 **고치기 전에도 통과한다** —
     * 그 상태로 red를 확인했다. 그래서 `onCast(...)`가 조건으로 쓰였는지를 본다.
     */
    expect(tapBlock).toMatch(/if \(!opts\.onCast\(/);
    // 거부 반응 자체는 쿨 안 된 칸과 같은 두 가지다
    expect(tapBlock).toMatch(/shakeMs = 0/);
    expect(tapBlock).toMatch(/ui_locked/);
  });

  /**
   * **두 세션이 다 boolean을 돌려줘야 한다.** 한쪽만 고치면 타입은 통과하고
   * (`void` 반환 함수를 `boolean` 자리에 넣는 것은 TS가 막지만, 암묵적
   * `undefined`는 falsy라서) 안 고친 쪽은 **성공한 탭마다 흔들린다** —
   * 반응이 거꾸로 붙는다.
   */
  it("PvP·싱글 둘 다 시전 성공을 boolean으로 돌려준다", () => {
    for (const [name, src] of [
      ["pvp", pvpSrc],
      ["single", singleSrc],
    ] as const) {
      // castSkill 선언이 boolean을 돌려준다
      expect(src, name).toMatch(/castSkill = \([^)]*\)[\s\S]{0,120}?: boolean =>/);
      // 거부 경로는 false, 성공 경로는 true
      expect(src, name).toMatch(/return false;/);
      expect(src, name).toMatch(/return true;/);
    }
  });

  /**
   * AUTO 경로는 이 반응을 쓰지 않는다 — 배지가 고른 시전이 게이트에 걸리면
   * 슬롯이 흔들릴 이유가 없다(유저가 누른 것이 아니다). `AUTO_INTERVAL_MS`가
   * 게이트 상한보다 길어서 구조적으로 안 걸리기도 한다(`skillBarRules`).
   */
  it("AUTO 시전은 거부 반응을 쓰지 않는다 — 유저가 누른 것이 아니다", () => {
    const autoStart = barSrc.indexOf("if (auto && nowMs >= nextAutoMs)");
    /**
     * 끝을 **`autoStart` 뒤에서** 찾는다. 처음 판은 `indexOf("animate(dtMs")`를
     * 그냥 썼는데 그게 잡는 것은 위쪽 **인터페이스 선언**(`animate(dtMs: number): void;`)
     * 이라 시작보다 앞이었다 — 슬라이스가 `""`가 되어 아래 두 `not.toMatch`가
     * 빈 문자열을 통과했다(메모리 [[controls-must-hit-target-branch]]: 검사가
     * 겨냥한 갈래를 실제로 밟았는지 먼저 확인해야 한다). 그래서 구간이 비지
     * 않았다는 것을 먼저 묻는다.
     */
    const autoBlock = barSrc.slice(
      autoStart,
      barSrc.indexOf("animate(dtMs", autoStart),
    );
    expect(autoStart).toBeGreaterThan(-1);
    expect(autoBlock.length).toBeGreaterThan(0);
    expect(autoBlock).toMatch(/opts\.onCast\(/);
    expect(autoBlock).not.toMatch(/shakeMs = 0/);
    expect(autoBlock).not.toMatch(/ui_locked/);
  });
});
