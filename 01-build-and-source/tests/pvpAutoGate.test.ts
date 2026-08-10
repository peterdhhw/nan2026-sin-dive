import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { myAutoDamage } from "../src/pvp/sessionRules";
import { autoAttackDamage, sumTeamRawDamage } from "../src/core/team";
import { PresetLoadoutProvider } from "../src/loadout/preset";

/**
 * PvP AUTO OFF — **내 캐릭터는 자기 몸도 딜도 멈춘다.**
 *
 * 유저 신고: "auto off여도 내 캐릭터가 공격하는 이슈 있어."
 *
 * ## 앞선 결정이 뒤집힌 이유
 *
 * 이 자리의 결정 기록은 배지를 딜에 걸면 "승패가 배지 하나로 결정된다"고 적었다
 * (양 팀이 같은 코어 식을 쓰므로 한쪽만 끄면 기울어진다는 논거). 그 논거를
 * 12시드 시뮬레이션으로 재 봤고 **틀렸다**: 내 칸만 껐을 때 손을 쓰는 판은
 * 여전히 12/12 승(65~98초)이고, 지는 것은 손을 놓은 판뿐이다(게이지 −0.80).
 * 즉 판을 정하는 것은 배지가 아니라 **행동**이다. 그 측정이 이 파일의 근거다.
 *
 * ## 왜 팀 전원이 아니라 내 칸 하나인가 — 같은 측정에서 갈렸다
 *
 * 팀 전원을 끄면 난사해도 이길 수 없었다(12/12 시간초과, 게이지 +0.13~+0.64).
 * 내 스킬만으로는 임계선에 못 닿기 때문이다. 그러면 배지가 "손을 놓아도 되는가"가
 * 아니라 "이 판을 포기하는가"가 되므로, 끄는 범위는 내 칸까지다.
 */

const TEAM = new PresetLoadoutProvider().load(2).characters;
const STEP = 1000 / 60;

describe("myAutoDamage — 배지가 내 자동 공격을 끈다", () => {
  /**
   * **대조군이 먼저다.** 이 함수가 늘 `[]`를 돌려줘도 아래 "OFF면 0" 검사는
   * 통과한다 — 켠 상태가 실제로 딜을 낸다는 것을 같이 물어야 검사가 성립한다
   * (`autoTeamDamage`의 대조군과 같은 이유).
   */
  it("ON이면 팀 전원이 딜을 낸다 — 코어 식과 한 값이다", () => {
    const on = myAutoDamage(TEAM, STEP, true);
    expect(on).toHaveLength(TEAM.length);
    expect(sumTeamRawDamage(on)).toBeCloseTo(
      sumTeamRawDamage(autoAttackDamage(TEAM, STEP)),
      6,
    );
    expect(sumTeamRawDamage(on)).toBeGreaterThan(0);
  });

  it("OFF면 내 칸(0번)이 빠진다 — 팀원은 계속 싸운다", () => {
    const off = myAutoDamage(TEAM, STEP, false);
    expect(off.map((m) => m.memberId)).toEqual(
      TEAM.slice(1).map((c) => c.memberId),
    );
    // 팀원 몫은 켠 상태와 **같은 값**이어야 한다 — 배지가 팀원 딜을 깎으면
    // 그건 유저가 고른 범위가 아니다
    expect(sumTeamRawDamage(off)).toBeCloseTo(
      sumTeamRawDamage(autoAttackDamage(TEAM.slice(1), STEP)),
      6,
    );
  });

  it("OFF면 내 칸 몫이 0이다 — 빠진 만큼이 정확히 내 딜이다", () => {
    const mine =
      sumTeamRawDamage(myAutoDamage(TEAM, STEP, true)) -
      sumTeamRawDamage(myAutoDamage(TEAM, STEP, false));
    expect(mine).toBeCloseTo(
      sumTeamRawDamage(autoAttackDamage(TEAM.slice(0, 1), STEP)),
      6,
    );
    expect(mine).toBeGreaterThan(0);
  });

  it("OFF에 내 memberId가 한 번도 안 나온다 — 0으로 채워 넣지 않는다", () => {
    // `rawDamage: 0`으로 남기면 합은 맞지만 필드가 그 id로 슬롯을 찾아
    // 타격 연출을 세운다(`onEnemyHit`) — 딜 0인 타격이 화면에 뜬다
    const myId = TEAM[0]!.memberId;
    for (let t = 0; t < 40; t += 1) {
      expect(
        myAutoDamage(TEAM, STEP, false).some((m) => m.memberId === myId),
      ).toBe(false);
    }
  });

  it("1인 팀에서 OFF면 자동 딜이 아예 없다 — 내 칸이 팀 전체다", () => {
    const solo = TEAM.slice(0, 1);
    expect(myAutoDamage(solo, STEP, false)).toEqual([]);
    expect(sumTeamRawDamage(myAutoDamage(solo, STEP, true))).toBeGreaterThan(0);
  });

  it("빈 팀을 넣어도 던지지 않는다 — 로드아웃이 늦게 오는 프레임이 있다", () => {
    expect(myAutoDamage([], STEP, false)).toEqual([]);
    expect(myAutoDamage([], STEP, true)).toEqual([]);
  });
});

describe("PvP 세션이 이 게이트를 실제로 쓴다", () => {
  const src = readFileSync("src/pvp/session.ts", "utf8");

  /**
   * 세션이 `autoAttackDamage`를 직접 부르면 게이트를 지나치게 된다 — 그때
   * 위의 순수 테스트는 전부 통과하면서 화면에서는 결함이 그대로 남는다.
   * 배선은 값으로 못 잡으므로(그 파일은 Pixi를 끌어온다) 소스로 잡는다.
   */
  it("session.ts가 autoAttackDamage를 직접 부르지 않는다", () => {
    expect(src).not.toMatch(/\bautoAttackDamage\(/);
  });

  it("게이트 인자가 배지가 아니라 필드 상태다 — 두 값이 갈리면 안 된다", () => {
    // `skillBar.auto`를 넘기면 배지와 전장이 두 시계를 갖는다. 싱글이 같은
    // 이유로 `field.auto`를 읽는다(`autoTeamDamage`의 결정 기록)
    expect(src).toMatch(/myAutoDamage\([^)]*topField\.auto/s);
  });

  it("모션 게이트도 같이 걸린다 — 딜만 끄면 몸이 코어를 배신한다", () => {
    // 딜만 끄면 내 캐릭터는 돌진·타격을 계속하는데 적 HP가 안 줄어든다.
    // 반대 방향(모션만 끄기)이 실측된 결함이었다(팀 딜의 45.3%)
    expect(src).toMatch(/topField\.setAuto\(/);
  });
});
