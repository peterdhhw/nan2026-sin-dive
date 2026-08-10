import { describe, expect, it } from "vitest";
import {
  COMBO_GOLD_CAP,
  COMBO_WINDOW_MS,
  DIVE_SLIDE_IN_MS,
  DIVE_SLIDE_OUT_MS,
  DIVE_SLIDE_TOTAL_MS,
  RUSH_DAMAGE_MULT,
  RUSH_MS,
  SINGLE_SKILL_CASTERS,
  SINGLE_TEAM_SIZE,
  WINDOW_FLOORS,
  WINDOW_REBUILD_MARGIN,
  autoTeamDamage,
  comboGoldMul,
  diveSlideOffset,
  endingReached,
  floorClearLabel,
  floorLabel,
  choiceOffersUpTo,
  isChoiceFloor,
  isShowcaseFloor,
  needsWindowRebuild,
  nextCombo,
  rushActive,
  sameFloorStamp,
  showcaseSub,
  showcaseWord,
  totalDamageMult,
} from "../src/single/sessionRules";
import {
  corruptionAtkMul,
  corruptionOf,
  corruptionSkillUnlocked,
} from "../src/core/corruption/corruption";
import { DEATH_MS } from "../src/shared/battleFieldRules";
import { PVP_UNLOCK_FLOOR } from "../src/shared/scenes/titleRules";
import { cardAtkMul, cardsForFloorClear } from "../src/core/deck/deck";
import { floorKindOf } from "../src/core/phase/phaseWaves";
import { sumTeamRawDamage } from "../src/core/team";
import { FINAL_FLOOR } from "../src/core/phase/floors";

describe("needsWindowRebuild — 창 갈아타기", () => {
  it("남은 웨이브가 여유 있으면 거짓, 끝에 가까우면 참이다", () => {
    expect(needsWindowRebuild(0, WINDOW_FLOORS)).toBe(false);
    expect(needsWindowRebuild(WINDOW_FLOORS - 1 - WINDOW_REBUILD_MARGIN - 1, WINDOW_FLOORS)).toBe(
      false,
    );
    expect(needsWindowRebuild(WINDOW_FLOORS - 1 - WINDOW_REBUILD_MARGIN, WINDOW_FLOORS)).toBe(true);
    expect(needsWindowRebuild(WINDOW_FLOORS - 1, WINDOW_FLOORS)).toBe(true);
  });

  it("비유한 입력은 거짓이다 (러너를 함부로 갈지 않는다)", () => {
    expect(needsWindowRebuild(Number.NaN, WINDOW_FLOORS)).toBe(false);
  });
});

describe("rushActive / totalDamageMult — 스와이프 러시", () => {
  it("러시는 만료 시각 전까지만 산다", () => {
    expect(rushActive(0, RUSH_MS)).toBe(true);
    expect(rushActive(RUSH_MS - 1, RUSH_MS)).toBe(true);
    expect(rushActive(RUSH_MS, RUSH_MS)).toBe(false);
  });

  it("배율 = 버프 × 타락도 × 러시", () => {
    expect(totalDamageMult(1, 0, false)).toBe(1);
    expect(totalDamageMult(1, 0, true)).toBe(RUSH_DAMAGE_MULT);
    expect(totalDamageMult(1.5, 0, false)).toBeCloseTo(1.5);
    expect(totalDamageMult(1, 30, false)).toBeCloseTo(corruptionAtkMul(30));
    expect(totalDamageMult(1.5, 50, true)).toBeCloseTo(1.5 * corruptionAtkMul(50) * 1.5);
  });

  it("깨진 버프 배율은 1로 본다", () => {
    expect(totalDamageMult(Number.NaN, 0, false)).toBe(1);
    expect(totalDamageMult(0, 0, false)).toBe(1);
  });

  /**
   * 덱(카드 수)이 네 번째 인자로 들어온다 (3단계).
   *
   * **기본값이 0이어야 하는 이유**: 위의 세 인자 검사들이 그대로 통과해야
   * 한다 — 안 주면 배율이 1이라, 카드함을 모르는 호출부(갤러리·디버그
   * 프리뷰)가 3단계 전과 같은 값을 본다. 여기서 기본을 1장으로 잡으면
   * 그 호출부들이 조용히 2% 센 판을 그린다.
   */
  it("덱이 곱해진다 — 안 주면 효과 없음", () => {
    expect(totalDamageMult(1, 0, false, 0)).toBe(1);
    expect(totalDamageMult(1, 0, false)).toBe(totalDamageMult(1, 0, false, 0));
    expect(totalDamageMult(1, 0, false, 10)).toBeCloseTo(cardAtkMul(10));
    // 네 배율이 전부 한 곱에 모인다 — 한 곳에서만 곱하는 것이 이 함수의 이유다
    expect(totalDamageMult(1.5, 50, true, 20)).toBeCloseTo(
      1.5 * corruptionAtkMul(50) * RUSH_DAMAGE_MULT * cardAtkMul(20),
    );
  });

  it("깨진 카드 수는 배율을 NaN으로 만들지 않는다", () => {
    expect(totalDamageMult(1, 0, false, Number.NaN)).toBe(1);
    expect(totalDamageMult(1, 0, false, -3)).toBe(1);
  });
});

describe("콤보 — 창 안 연속 클리어", () => {
  it("창 안이면 +1, 벗어나면 0으로 돌아간다", () => {
    expect(nextCombo(0, 1000)).toBe(1);
    expect(nextCombo(3, COMBO_WINDOW_MS)).toBe(4);
    expect(nextCombo(3, COMBO_WINDOW_MS + 1)).toBe(0);
  });

  it("골드 배율은 콤보당 +0.25, 3배에서 멈춘다", () => {
    expect(comboGoldMul(0)).toBe(1);
    expect(comboGoldMul(2)).toBeCloseTo(1.5);
    expect(comboGoldMul(8)).toBe(COMBO_GOLD_CAP);
    expect(comboGoldMul(100)).toBe(COMBO_GOLD_CAP);
  });
});

describe("diveSlideOffset — 세로 하강 슬라이드", () => {
  const H = 800;

  it("시작 전·끝 이후에는 오프셋 0(제자리)이다", () => {
    expect(diveSlideOffset(0, H)).toBe(0);
    expect(diveSlideOffset(DIVE_SLIDE_TOTAL_MS, H)).toBe(0);
    expect(diveSlideOffset(DIVE_SLIDE_TOTAL_MS + 100, H)).toBe(0);
  });

  it("나가는 구간은 위(음수)로 가속하며 스왑 직전 −H에 근접한다", () => {
    const early = diveSlideOffset(DIVE_SLIDE_OUT_MS * 0.3, H);
    const late = diveSlideOffset(DIVE_SLIDE_OUT_MS - 1, H);
    expect(early).toBeLessThan(0);
    expect(late).toBeLessThan(early); // 더 멀리(더 음수) — 가속
    expect(late).toBeLessThan(-H * 0.95); // 스왑 직전엔 거의 다 빠져나가 있다
  });

  it("스왑 직후에는 +H(아래)에서 시작해 0으로 감속 착지한다", () => {
    const justIn = diveSlideOffset(DIVE_SLIDE_OUT_MS, H);
    const mid = diveSlideOffset(DIVE_SLIDE_OUT_MS + DIVE_SLIDE_IN_MS * 0.5, H);
    expect(justIn).toBeCloseTo(H, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(justIn);
  });

  it("비유한 입력은 0이다", () => {
    expect(diveSlideOffset(Number.NaN, H)).toBe(0);
    expect(diveSlideOffset(100, Number.NaN)).toBe(0);
  });

  /**
   * 하강을 시작할 때 세션이 `field.flushHits()`로 결정타를 내므로(`startAdvance`),
   * 마지막 적은 **슬라이드가 시작되는 프레임에** 쓰러지기 시작한다. 그 사망
   * 연출이 층이 갈리는 시점(스왑)까지 끝나야 "쓸어버리고 내려간다"가 된다 —
   * 안 끝나면 쓰러지는 도중에 층이 바뀌어 시체가 새 층에 얹히거나 사라진다
   * (`spawnWave`가 `deathMs`를 -1로 되돌린다).
   *
   * **두 상수를 한 부등식으로 묶는 것이 요점이다.** 어느 쪽을 만져도 이
   * 검사가 먼저 깨진다: 슬라이드를 빠르게 줄이는 것도, 사망을 길게 늘리는
   * 것도 같은 그림을 깨뜨리는데 각자의 파일만 보면 둘 다 무해해 보인다.
   */
  it("사망 연출이 층 스왑 전에 끝난다 — 결정타는 하강 시작에 플러시된다", () => {
    expect(DEATH_MS).toBeLessThanOrEqual(DIVE_SLIDE_OUT_MS);
  });
});

describe("isChoiceFloor / endingReached", () => {
  it("심연의 선택은 보스 층(CHOICE_EVERY의 배수)에서만 제안된다", () => {
    expect(isChoiceFloor(50)).toBe(true);
    expect(isChoiceFloor(100)).toBe(true);
    expect(isChoiceFloor(300)).toBe(true);
    expect(isChoiceFloor(110)).toBe(false);
    expect(isChoiceFloor(99)).toBe(false);
    expect(isChoiceFloor(0)).toBe(false);
  });

  /**
   * ── 6번째 칸이 대전에서 **도달 가능한가** (2026-08-06)
   *
   * 이 부등식이 깨져 있었다: 제안 주기가 100층이면 대전 해금(100층)까지 제안이
   * 한 번이라 타락도가 22에서 멈추고, 각성(30)에서 열리는 타락 칸이 대전에
   * 구조적으로 안 나왔다. 세 상수가 서로를 배제하는데 **어느 상수의 테스트도
   * 그걸 볼 수 없었다** — 각자는 옳았기 때문이다.
   *
   * 그래서 상수 세 개를 한 검사로 묶는다. 하드코딩한 22/32를 쓰지 않는 이유:
   * 그러면 주기를 옮긴 날 이 검사가 새 결함을 통과시킨다.
   */
  it("대전 해금 층까지 선택을 다 받으면 6번째 칸이 열린다 — 세 상수의 도달성 계약", () => {
    const offers = choiceOffersUpTo(PVP_UNLOCK_FLOOR);
    // 제안이 한 번뿐이면 아래 부등식은 우연히 참이 될 수 없다 (12+10=22 < 30)
    expect(offers).toBeGreaterThanOrEqual(2);
    expect(
      corruptionSkillUnlocked(corruptionOf(PVP_UNLOCK_FLOOR, offers)),
    ).toBe(true);
    // 그리고 **선택이 실제로 필요하다** — 깊이만으로 열리면 "타락을 받아들여야
    // 강해진다"는 축이 사라진다 (corruption.ts의 625층 근거)
    expect(corruptionSkillUnlocked(corruptionOf(PVP_UNLOCK_FLOOR, 0))).toBe(
      false,
    );
  });

  /**
   * 반대쪽 끝 — 선택만으로 첫 세션에 5단계를 다 지나가면 엔딩 분기(70)가
   * 의미를 잃는다. 주기를 더 잘게 쪼갤 때 이 검사가 막는다.
   */
  it("대전 해금 층에서 엔딩 분기(타락 70)까지는 못 간다", () => {
    const offers = choiceOffersUpTo(PVP_UNLOCK_FLOOR);
    expect(corruptionOf(PVP_UNLOCK_FLOOR, offers)).toBeLessThan(70);
  });

  it("엔딩은 9,999층 무리를 다 쓸었을 때다 (loops가 돈다)", () => {
    expect(endingReached(FINAL_FLOOR, 0)).toBe(false);
    expect(endingReached(FINAL_FLOOR, 1)).toBe(true);
    expect(endingReached(9998, 1)).toBe(false);
  });
});

describe("sameFloorStamp / 라벨", () => {
  it("층 도장은 층+loops가 모두 같아야 같다", () => {
    expect(sameFloorStamp({ floor: 5, loops: 0 }, { floor: 5, loops: 0 })).toBe(true);
    expect(sameFloorStamp({ floor: 5, loops: 0 }, { floor: 5, loops: 1 })).toBe(false);
    expect(sameFloorStamp({ floor: 5, loops: 0 }, { floor: 6, loops: 0 })).toBe(false);
  });

  it("층 라벨은 데모 표기(53F)와 클리어 문구를 따른다", () => {
    expect(floorLabel(53)).toBe("53F");
    expect(floorClearLabel(53)).toBe("53층 돌파");
  });

  /**
   * 값을 `toBe(1)`로 박으면 검사가 상수를 복창하는 줄이 된다. 묶어야 하는 것은
   * 팀 크기와 **시전자 수**다 — 시전자보다 팀이 크면 나머지는 평타만 내는
   * 장식이고, 그것이 2인이었던 시절의 실제 상태였다(총딜 기여 16%).
   */
  it("팀 전원이 스킬을 쓴다 — 시전자보다 팀이 크면 나머지는 장식이다", () => {
    expect(SINGLE_TEAM_SIZE).toBe(SINGLE_SKILL_CASTERS);
    // 0인 팀은 게임이 아니다 — 부등식만 있으면 0 === 0도 통과한다
    expect(SINGLE_TEAM_SIZE).toBeGreaterThanOrEqual(1);
  });
});

/**
 * AUTO 배지의 범위 (유저 신고 2번, 유저가 고른 안: "동작도 딜도 함께 멈춘다").
 *
 * 화면 쪽 게이트(`battleField`의 `autoOn` → `beginDash`)는 Pixi 안이라 여기서
 * 못 부른다. 여기서 묻는 것은 **딜 쪽 절반**이고, 그 절반이 예전에 빠져 있었다:
 * 동작만 멈춘 판에서 내 캐릭터가 돌진 0회·타격 0회인데 팀 딜의 45.3%를 냈다.
 */
describe("autoTeamDamage — AUTO OFF면 코어 딜도 0이다", () => {
  const chars = [
    { memberId: "me", stats: { attack: 100, attackIntervalMs: 1000 } },
    { memberId: "ally", stats: { attack: 50, attackIntervalMs: 500 } },
  ];
  const STEP = 250;

  /**
   * **대조군이 먼저다.** 이 검사가 없으면 `autoTeamDamage`가 늘 `[]`를 돌려줘도
   * 아래 OFF 검사가 통과한다 — 그러면 AUTO를 켜도 아무도 안 싸우는 게임이
   * "검사 통과"로 남는다(`controls-must-hit-target-branch`).
   */
  it("ON이면 코어 식이 그대로 흐른다 — 배지가 딜을 만들지도 않는다", () => {
    const on = autoTeamDamage(chars, STEP, true);
    expect(on).toHaveLength(chars.length);
    // 100/1000 × 250 = 25, 50/500 × 250 = 25
    expect(sumTeamRawDamage(on)).toBeCloseTo(50, 6);
  });

  it("OFF면 아무 멤버도 딜을 내지 않는다", () => {
    const off = autoTeamDamage(chars, STEP, false);
    expect(off).toEqual([]);
    expect(sumTeamRawDamage(off)).toBe(0);
  });

  /**
   * **0이 아니라 "한 명도 없음"이어야 한다.** rawDamage 0인 멤버를 돌려주면
   * `accumulateHit`·dps 창이 그 멤버를 "때렸지만 0"으로 세고, 그러면 화면에
   * 0 데미지 숫자가 뜬다(유저 눈에는 배지가 고장난 것으로 보인다).
   */
  it("OFF는 0딜 멤버를 만들지 않는다 — 목록 자체가 빈다", () => {
    expect(autoTeamDamage(chars, STEP, false).some((m) => m.rawDamage === 0)).toBe(
      false,
    );
  });

  /**
   * OFF 동안 시간이 흘러도 **쌓이지 않는다.** 켜는 순간 몰아서 나오면
   * "안 싸운 시간만큼 한꺼번에 맞는" 화면이 되고, 그건 배지를 끈 목적과 반대다.
   */
  it("OFF로 오래 있어도 다시 ON한 첫 틱은 한 틱 몫만 낸다", () => {
    for (let t = 0; t < 40; t += 1) expect(autoTeamDamage(chars, STEP, false)).toEqual([]);
    expect(sumTeamRawDamage(autoTeamDamage(chars, STEP, true))).toBeCloseTo(50, 6);
  });
});

/**
 * **층 돌파 쇼케이스** — 유저 신고 2026-08-09: "10층 내려갈 때마다 pvp 이겼을
 * 때처럼 캐릭터 보여주고, 카드 얻어달라고 했는데, 반영 안 된 것 같아."
 *
 * 카드 지급은 이미 있었다(`cardsForFloorClear`) — 빠져 있던 것은 연출이다.
 * 그래서 이 검사들이 묻는 것은 **뜨는 층이 카드가 나오는 층과 같은가**다.
 * 두 값이 갈리면 신고가 그대로 재현된다(한쪽만 일어나면 "반영 안 됐다"다).
 */
describe("층 돌파 쇼케이스 — 카드가 나오는 층에서만, 그 층 전부에서 뜬다", () => {
  /**
   * 이 파일의 이유. `cardsForFloorClear`가 0을 주는 층에 축하가 뜨면 카드 줄이
   * 빈 축하가 되고, 1을 주는 층에 안 뜨면 카드가 조용히 들어온다 — 후자가
   * 신고받은 상태다. **두 함수를 200층에 걸쳐 대조한다**(숫자를 여기 적지
   * 않는다: 주기를 고친 날 이 검사가 자기 사본을 보고 통과하면 안 된다).
   */
  it("카드가 나오는 층 = 쇼케이스가 뜨는 층 (200층 전수 대조)", () => {
    let showcases = 0;
    for (let f = 1; f <= 200; f += 1) {
      const cards = cardsForFloorClear(floorKindOf(f));
      expect(isShowcaseFloor(f), `${f}F cards=${cards}`).toBe(cards > 0);
      if (cards > 0) showcases += 1;
    }
    // 200층에 20번(10층마다) — 0이면 위 루프가 "둘 다 false"로 통과한다
    expect(showcases).toBe(20);
  });

  /** 잡몹 층·0층·NaN은 안 뜬다 — 그 층에는 줄 카드가 없다 */
  it("잡몹 층과 잘못된 값에는 뜨지 않는다", () => {
    for (const f of [1, 2, 9, 11, 99, 101]) {
      expect(isShowcaseFloor(f), `${f}F`).toBe(false);
    }
    expect(isShowcaseFloor(0)).toBe(false);
    expect(isShowcaseFloor(-10)).toBe(false);
    expect(isShowcaseFloor(Number.NaN)).toBe(false);
  });

  /**
   * 워드마크는 HUD 층 표기와 **같은 함수**를 쓴다. 큰 글자와 HUD가 다른 표기로
   * 같은 수를 말하면 표기를 고친 날 한쪽만 바뀐다.
   */
  it("워드마크가 HUD 층 표기와 같다", () => {
    for (const f of [10, 50, 100, 1000]) {
      expect(showcaseWord(f)).toBe(floorLabel(f));
    }
  });

  /**
   * 배너와 **다른 문구**여야 한다 — 둘은 같은 프레임에 겹쳐 뜬다
   * (`DIVE_FX_STACK`에서 showcase가 banner 위다). 같으면 한 줄이 두 크기로
   * 두 번 찍힌 화면이 된다.
   */
  it("층 돌파 배너와 같은 문구가 아니다 — 같은 프레임에 겹친다", () => {
    expect(showcaseWord(10)).not.toBe(floorClearLabel(10));
  });

  /**
   * 부제가 보스와 미니보스를 **가른다.** 한 문구로 두면 100층(네임드 보스)에서
   * "미니보스 격파"가 뜨고, 그 층은 심연석 20 + 카드가 나오는 판의 마디다.
   */
  it("부제가 네임드 보스와 미니보스를 구별한다", () => {
    expect(showcaseSub(100)).not.toBe(showcaseSub(10));
    expect(showcaseSub(200)).toBe(showcaseSub(100));
    expect(showcaseSub(20)).toBe(showcaseSub(10));
  });
});
