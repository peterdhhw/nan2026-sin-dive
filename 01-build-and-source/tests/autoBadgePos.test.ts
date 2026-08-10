/**
 * AUTO 배지가 **바 밖에서** 어디에 앉는지 — 두 모드의 자리 규칙.
 *
 * ## 왜 이 파일이 있는가 (3단계 결정 기록)
 *
 * 배지는 스킬바 안 왼쪽에 있었다. 그 구역(101px)을 슬롯에 돌려주지 않으면
 * 6번째 칸의 폭이 92.5px로 떨어져 라벨이 옆 칸과 이어 붙는다
 * (`skillBarRules.barLayout`·`skillBarRules.test.ts`의 부등식). 그래서 배지를
 * 밖으로 내보냈고, 나간 뒤의 자리는 바가 알 수 없다 — 이웃이 무엇인지는
 * 모드마다 다르다.
 *
 * **자리를 씬에 인라인으로 적으면 이 파일이 존재할 수 없다.** 겹침은 화면을
 * 죽이지 않으므로(그냥 두 위젯이 한 덩어리로 보인다) 캡처를 열기 전까지
 * 조용하고, 배너처럼 1.26초만 뜨는 이웃과의 겹침은 캡처에도 잘 안 걸린다.
 * 그래서 좌표를 `*Rules.ts`에 두고 이웃과의 부등식을 node가 묻는다.
 */

import { describe, expect, it } from "vitest";
import {
  AUTO_BADGE_GAP_Y,
  AUTO_BADGE_MARGIN_X,
  BADGE_GAP_X,
  BANNER_BOTTOM_Y,
  BANNER_TOP_Y,
  COMBO_TEXT_Y,
  HUD_H,
  autoBadgePos,
  volumeBadgePos,
} from "../src/single/diveHudRules";
import {
  autoBadgePos as pvpAutoBadgePos,
  volumeBadgePos as pvpVolumeBadgePos,
} from "../src/pvp/autoBadgeRules";
import { computeSplit } from "../src/pvp/splitLayout";
import { autoBadgeD, barLayout } from "../src/shared/skillBarRules";
import { BANNER_H, bannerBottomY } from "../src/shared/ui/bannerRules";
import { UPGRADE_ROW_Y } from "../src/single/upgradePanelRules";
import { HIT_SLACK_PX } from "../src/shared/ui/skillSlotRules";
import {
  DESIGN_H,
  DESIGN_W,
  SKILLBAR_RATIO,
} from "../src/shared/viewport";
import { TOAST_BOTTOM_RATIO } from "../src/shared/ui/hintRules";
import {
  ALLY_SLOT_X,
  ENEMY_H_RATIO,
  GROUND_RATIO,
} from "../src/shared/battleFieldRules";

/** 싱글의 스킬바 밴드 높이 = 배지 지름의 출처 */
const SKILL_H = DESIGN_H * SKILLBAR_RATIO;
const D = autoBadgeD(SKILL_H);

/** 배지 사각 영역 — 탭 관용까지 포함한다 (`createCircleButton`의 `hitR`) */
function badgeBox(c: { x: number; y: number }, d: number) {
  const r = d / 2 + HIT_SLACK_PX;
  return { left: c.x - r, right: c.x + r, top: c.y - r, bottom: c.y + r };
}

describe("배너 간격은 규칙이 정본이다", () => {
  /**
   * 두 세션이 `hud 아래 + 16`을 각자 들고 있었다. 배지가 그 띠 **아래**에
   * 앉으므로, 상수가 씬에 있으면 배너를 움직인 날 배지가 따라오지 않는다.
   */
  it("배너 띠 아래 끝을 두 모드가 같은 함수로 구한다", () => {
    expect(BANNER_BOTTOM_Y).toBeCloseTo(bannerBottomY(HUD_H), 6);
    expect(BANNER_BOTTOM_Y - BANNER_TOP_Y).toBeCloseTo(BANNER_H, 6);
  });
});

describe("싱글 — AUTO 배지 자리", () => {
  const c = autoBadgePos(D);
  const box = badgeBox(c, D);

  it("화면 안에 온전히 들어간다", () => {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(DESIGN_W + HIT_SLACK_PX);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(DESIGN_H);
    // 원 자체는 여백 안이다 — 관용 영역만 화면 끝에 걸친다
    expect(c.x + D / 2).toBeCloseTo(DESIGN_W - AUTO_BADGE_MARGIN_X, 6);
  });

  it("HUD 밴드를 침범하지 않는다 — 층·타락도·골드·콤보가 거기 있다", () => {
    expect(box.top).toBeGreaterThan(HUD_H);
    // 콤보 캡션이 밴드 맨 아래 오른쪽이다 (같은 열이므로 세로로 갈려야 한다)
    expect(box.top).toBeGreaterThan(COMBO_TEXT_Y);
  });

  /**
   * **이 부등식이 이 자리의 이유다.** HUD 바로 아래(y 161~263)에 두면 전폭
   * 배너(72px)와 겹친다. 배너는 1.26초만 떠 있으므로 캡처 한 장으로는 안
   * 걸린다 — 겹치면 조용히 잘못된 화면이 된다.
   */
  it("배너 띠와 겹치지 않는다 — 1.26초만 뜨는 이웃이라 캡처가 못 잡는다", () => {
    expect(box.top).toBeGreaterThanOrEqual(BANNER_BOTTOM_Y);
    expect(BANNER_TOP_Y).toBeGreaterThan(HUD_H);
    expect(AUTO_BADGE_GAP_Y).toBeGreaterThan(0);
  });

  it("강화 줄·스킬바와 겹치지 않는다 — 아래쪽 밴드는 이미 꽉 찼다", () => {
    expect(box.bottom).toBeLessThan(UPGRADE_ROW_Y);
    expect(box.bottom).toBeLessThan(DESIGN_H * (1 - SKILLBAR_RATIO));
  });

  /** 탭 공지 토스트(하단 20%)와도 갈려야 한다 — 배지를 눌러 나오는 게 그 토스트다 */
  it("토스트 자리와 겹치지 않는다", () => {
    expect(box.bottom).toBeLessThan(DESIGN_H * (1 - TOAST_BOTTOM_RATIO));
  });

  /**
   * 전장 위 하늘이 남은 자리다. 적은 바닥(`GROUND_RATIO`)에 서고 키가 필드
   * 높이의 `ENEMY_H_RATIO`이므로 머리끝을 계산해 그 위에 있는지 묻는다 —
   * 눈대중으로 "위쪽이니까 괜찮다"고 두면 필드 비율이 바뀐 날 조용히 겹친다.
   */
  it("적 머리끝보다 위에 있다 — 전장 위 하늘이다", () => {
    const fieldY = HUD_H;
    const fieldH = UPGRADE_ROW_Y - HUD_H;
    const enemyTop =
      fieldY + fieldH * GROUND_RATIO - fieldH * ENEMY_H_RATIO;
    expect(box.bottom).toBeLessThan(enemyTop);
  });

  it("지름이 0이어도 유한값이다 (초기 프레임·깨진 입력)", () => {
    for (const d of [0, Number.NaN, -10]) {
      const p = autoBadgePos(d);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("대전 — AUTO 배지 자리", () => {
  /** 게이지가 어디에 있어도 HUD 높이는 고정이다 — 그래서 배지가 안 움직인다 */
  const positions = [-1, -0.5, 0, 0.5, 1].map((g) => {
    const split = computeSplit(g);
    return {
      g,
      split,
      c: pvpAutoBadgePos(split.hud, autoBadgeD(split.skillBar.h)),
    };
  });

  it("게이지가 움직여도 배지가 안 움직인다", () => {
    const first = positions[0]!.c;
    for (const p of positions) {
      expect(p.c.x, `게이지 ${p.g}`).toBeCloseTo(first.x, 6);
      expect(p.c.y, `게이지 ${p.g}`).toBeCloseTo(first.y, 6);
    }
  });

  it("HUD 밴드 아래, 화면 안이다", () => {
    for (const { g, split, c } of positions) {
      const box = badgeBox(c, autoBadgeD(split.skillBar.h));
      expect(box.top, `게이지 ${g}`).toBeGreaterThan(split.hud.y + split.hud.h);
      expect(box.left, `게이지 ${g}`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `게이지 ${g}`).toBeLessThanOrEqual(DESIGN_H);
    }
  });

  it("배너 띠와 겹치지 않는다", () => {
    for (const { g, split, c } of positions) {
      const box = badgeBox(c, autoBadgeD(split.skillBar.h));
      expect(box.top, `게이지 ${g}`).toBeGreaterThanOrEqual(
        bannerBottomY(split.hud.y + split.hud.h),
      );
    }
  });

  /**
   * **상대 필드에는 못 놓는다** — 배지는 내 것이다. 게이지가 우리 쪽으로
   * 최대로 밀렸을 때(상단 필드가 가장 클 때)뿐 아니라 밀렸을 때도 우리 필드
   * 안이어야 한다: 상단이 가장 작아지는 것은 `RATIO_MIN`(0.28)에서다.
   */
  it("어느 게이지에서도 우리 필드(상단) 안이다 — 상대 화면으로 넘어가지 않는다", () => {
    for (const { g, split, c } of positions) {
      const box = badgeBox(c, autoBadgeD(split.skillBar.h));
      expect(box.bottom, `게이지 ${g}`).toBeLessThanOrEqual(
        split.top.y + split.top.h,
      );
    }
  });

  it("게이지 바·스킬바와 겹치지 않는다", () => {
    for (const { g, split, c } of positions) {
      const box = badgeBox(c, autoBadgeD(split.skillBar.h));
      expect(box.bottom, `게이지 ${g}`).toBeLessThan(split.gauge.y);
      expect(box.bottom, `게이지 ${g}`).toBeLessThan(split.skillBar.y);
    }
  });

  /** 두 모드가 같은 위젯으로 읽혀야 한다 — 오른쪽 여백을 공유한다 */
  it("싱글과 같은 오른쪽 여백을 쓴다", () => {
    const split = computeSplit(0);
    const d = autoBadgeD(split.skillBar.h);
    const c = pvpAutoBadgePos(split.hud, d);
    expect(c.x + d / 2).toBeCloseTo(DESIGN_W - AUTO_BADGE_MARGIN_X, 6);
    expect(c.x).toBeCloseTo(autoBadgePos(D).x, 6);
  });

  it("깨진 밴드에서도 유한값이다", () => {
    const p = pvpAutoBadgePos(
      { x: 0, y: Number.NaN, w: DESIGN_W, h: Number.NaN },
      Number.NaN,
    );
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

/**
 * ── 소리 배지 (2026-08-07)
 *
 * AUTO **옆**에 한 칸 더 붙는다. 새 이웃은 **AUTO 자신**이고, 그 겹침이 이
 * 파일에서 가장 조용한 실패다: 두 원이 안 닿아도 **탭 영역**이 겹치면
 * 경계 픽셀의 주인이 그리는 순서로 정해져서, AUTO를 눌렀는데 소리가 줄어든다.
 * 캡처로는 원 사이에 빈 줄이 보이므로 정상으로 읽힌다.
 *
 * **처음에 AUTO 아래로 쌓았고 아래 "우리 필드 안이다"가 그것을 죽였다** —
 * 싱글은 통과했지만(적 머리끝까지 216px) 대전 게이지 −1에서 상대 필드를
 * 76.7px 파고들었다. 자리를 유도할 때 여유를 게이지 0에서 쟀던 것이 원인이다
 * (게이지 0은 최악이 아니라 중립이다). 그래서 세로 대신 가로로 갔다.
 */
describe("싱글 — 소리 배지 자리", () => {
  const autoC = autoBadgePos(D);
  const auto = badgeBox(autoC, D);
  const c = volumeBadgePos(D);
  const box = badgeBox(c, D);

  /**
   * **y가 AUTO와 같아야 한다.** 이게 이 자리의 핵심이다 — 세로로 옮기면
   * AUTO가 증명한 여유(배너 아래·필드 안·적 머리 위)를 다시 증명해야 하고,
   * 대전에서는 그 증명이 실패한다.
   */
  it("AUTO와 같은 줄이다 — 세로 여유를 그대로 물려받는다", () => {
    expect(c.y).toBeCloseTo(autoC.y, 6);
  });

  it("AUTO **왼쪽**이다 — 오른쪽에 두면 화면 밖이다", () => {
    expect(box.right).toBeLessThan(auto.left);
  });

  /**
   * **원이 아니라 탭 영역 사이**를 잰다. 원 간격만 맞추면 관용(`HIT_SLACK_PX`)
   * 두 몫이 겹쳐서 조용히 오작동한다.
   */
  it("탭 영역 사이에 정확히 BADGE_GAP_X가 남는다", () => {
    expect(auto.left - box.right).toBeCloseTo(BADGE_GAP_X, 6);
    // 겹치지 않는다는 것만으로는 부족하다 — 0px 여유도 위 부등식을 통과한다
    expect(auto.left - box.right).toBeGreaterThan(0);
  });

  it("화면 안, 배너 아래, HUD 밖이다", () => {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(DESIGN_W);
    expect(box.top).toBeGreaterThanOrEqual(BANNER_BOTTOM_Y);
    expect(box.top).toBeGreaterThan(HUD_H);
    expect(box.top).toBeGreaterThan(COMBO_TEXT_Y);
  });

  it("강화 줄·스킬바·토스트와 겹치지 않는다", () => {
    expect(box.bottom).toBeLessThan(UPGRADE_ROW_Y);
    expect(box.bottom).toBeLessThan(DESIGN_H * (1 - SKILLBAR_RATIO));
    expect(box.bottom).toBeLessThan(DESIGN_H * (1 - TOAST_BOTTOM_RATIO));
  });

  /**
   * y가 AUTO와 같으니 통과가 보장되지만, 그 등식이 깨지는 날 이 부등식이
   * 울려야 한다 — 자리를 옮긴 사람이 보는 것은 이 이름이다.
   */
  it("적 머리끝보다 위에 있다 — 전장 위 하늘이다", () => {
    const fieldY = HUD_H;
    const fieldH = UPGRADE_ROW_Y - HUD_H;
    const enemyTop = fieldY + fieldH * GROUND_RATIO - fieldH * ENEMY_H_RATIO;
    expect(box.bottom).toBeLessThan(enemyTop);
  });

  /** 왼쪽으로 가므로 아군 쪽으로 다가간다 — 가로로도 갈리는지 묻는다 */
  it("아군 자리보다 오른쪽이다", () => {
    const fieldW = DESIGN_W;
    const allyRight = Math.max(...ALLY_SLOT_X) * fieldW;
    expect(box.left).toBeGreaterThan(allyRight);
  });

  it("지름이 0이어도 유한값이다", () => {
    for (const d of [0, Number.NaN, -10]) {
      const p = volumeBadgePos(d);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe("대전 — 소리 배지 자리", () => {
  const positions = [-1, -0.5, 0, 0.5, 1].map((g) => {
    const split = computeSplit(g);
    const d = autoBadgeD(split.skillBar.h);
    return {
      g,
      split,
      d,
      auto: pvpAutoBadgePos(split.hud, d),
      c: pvpVolumeBadgePos(split.hud, d),
    };
  });

  it("게이지가 움직여도 안 움직인다 — HUD 높이가 고정이므로", () => {
    const first = positions[0]!.c;
    for (const p of positions) {
      expect(p.c.x, `게이지 ${p.g}`).toBeCloseTo(first.x, 6);
      expect(p.c.y, `게이지 ${p.g}`).toBeCloseTo(first.y, 6);
    }
  });

  it("AUTO와 같은 줄이고 탭 영역 사이 간격이 싱글과 같다", () => {
    for (const { g, auto, c, d } of positions) {
      expect(c.y, `게이지 ${g}`).toBeCloseTo(auto.y, 6);
      const gap = badgeBox(auto, d).left - badgeBox(c, d).right;
      expect(gap, `게이지 ${g}`).toBeCloseTo(AUTO_BADGE_GAP_Y, 6);
    }
  });

  /**
   * **최악의 게이지(가장 지는 판)에서 상단 필드가 가장 작다.** 배지가 고정
   * 좌표이므로 그 순간 상대 필드로 넘어갈 수 있고, 넘어가면 "내 배지"가
   * 상대 화면 위에 얹힌다 — 게이지를 다 돌면서 묻는 이유다. **이 검사가
   * 세로 쌓기 안을 죽였다**(게이지 −1에서 76.7px 초과).
   */
  it("어느 게이지에서도 우리 필드(상단) 안이다", () => {
    for (const { g, split, c, d } of positions) {
      const box = badgeBox(c, d);
      expect(box.bottom, `게이지 ${g}`).toBeLessThanOrEqual(
        split.top.y + split.top.h,
      );
      expect(box.bottom, `게이지 ${g}`).toBeLessThan(split.gauge.y);
      expect(box.bottom, `게이지 ${g}`).toBeLessThan(split.skillBar.y);
    }
  });

  it("배너 띠와 겹치지 않는다", () => {
    for (const { g, split, c, d } of positions) {
      const box = badgeBox(c, d);
      expect(box.top, `게이지 ${g}`).toBeGreaterThanOrEqual(
        bannerBottomY(split.hud.y + split.hud.h),
      );
    }
  });

  /** 두 모드에서 같은 열로 읽혀야 한다 — AUTO가 오른쪽 여백을 잡고 이쪽은 그 왼쪽이다 */
  it("싱글과 같은 x다", () => {
    const split = computeSplit(0);
    const d = autoBadgeD(split.skillBar.h);
    const c = pvpVolumeBadgePos(split.hud, d);
    expect(c.x).toBeCloseTo(volumeBadgePos(D).x, 6);
    // 화면 왼쪽으로 넘치지 않는다 — 배지 두 개 + 간격이 폭 안에 들어간다
    expect(c.x - d / 2 - HIT_SLACK_PX).toBeGreaterThan(0);
  });

  it("깨진 밴드에서도 유한값이다", () => {
    const p = pvpVolumeBadgePos(
      { x: 0, y: Number.NaN, w: DESIGN_W, h: Number.NaN },
      Number.NaN,
    );
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("배지 지름은 여전히 바가 정한다", () => {
  /**
   * 자리는 모드가 정하지만 **크기 관계는 바의 것이다** — "슬롯보다 작은 보조
   * 위젯"이 §7의 규칙이다. 모드가 지름까지 정하면 한쪽 모드에서 배지가 슬롯보다
   * 커져도 아무도 안 잡는다.
   */
  it("싱글·대전 모두 슬롯보다 작다", () => {
    const single = barLayout(DESIGN_W, SKILL_H, 4, 0.62);
    expect(autoBadgeD(SKILL_H)).toBeLessThan(single.slotD);
    const split = computeSplit(0);
    const pvp = barLayout(DESIGN_W, split.skillBar.h, 6, 0.62);
    expect(autoBadgeD(split.skillBar.h)).toBeLessThan(pvp.slotD);
  });
});
