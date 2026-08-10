import { describe, expect, it } from "vitest";
import {
  LOGO_IN_MS,
  PREVIEW_ATTACK_PERIOD_MS,
  PREVIEW_GAP_RATIO,
  PREVIEW_PHASE_OFFSET_MS,
  PVP_UNLOCK_FLOOR,
  STATUS_PILL_W_RATIO,
  STATUS_PILL_X_RATIO,
  STATUS_PILL_Y_RATIO,
  TITLE_ARM_MS,
  TITLE_BOX_ENTRY_H,
  TITLE_BOX_ENTRY_MARGIN,
  TITLE_BOX_ENTRY_W,
  TITLE_IDLE_HINT_MS,
  TITLE_PREVIEW_COUNT,
  lastResultBadge,
  logoIntroAlpha,
  logoIntroScale,
  matchButtonLabel,
  matchLockedNotice,
  previewAttacker,
  previewFacing,
  previewXRatio,
  pvpUnlocked,
  showsIdleHint,
  startButtonLabel,
  titleArmed,
  titleBoxEntryPos,
  titleBoxEntryTapRoom,
} from "../src/shared/scenes/titleRules";
import { floorLabel, floorName } from "../src/shared/screenText";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";
import { T_BODY } from "../src/shared/theme";
import { buttonTextMaxW, tapSlack } from "../src/shared/ui/shapeRules";

describe("logoIntro", () => {
  it("첫 진입은 0.85에서 1.0으로 커진다 (§04-3)", () => {
    expect(logoIntroScale(0, false)).toBeCloseTo(0.85, 5);
    expect(logoIntroScale(LOGO_IN_MS, false)).toBe(1);
  });

  it("재진입에서는 연출을 재생하지 않는다 — 반복하면 지루하다 (§04-7)", () => {
    expect(logoIntroScale(0, true)).toBe(1);
    expect(logoIntroScale(120, true)).toBe(1);
  });

  it("알파는 0에서 1까지 올라간다", () => {
    expect(logoIntroAlpha(0)).toBe(0);
    expect(logoIntroAlpha(LOGO_IN_MS)).toBe(1);
    expect(logoIntroAlpha(9_999)).toBe(1);
  });
});

describe("titleArmed", () => {
  it("300ms 뒤부터 눌린다 — 씬 전환 중 오탭 방지 (§04-5)", () => {
    expect(TITLE_ARM_MS).toBe(300);
    expect(titleArmed(0)).toBe(false);
    expect(titleArmed(299)).toBe(false);
    expect(titleArmed(300)).toBe(true);
  });

  it("NaN은 활성으로 보지 않는다", () => {
    expect(titleArmed(NaN)).toBe(false);
  });
});

describe("showsIdleHint", () => {
  it("30초 무입력에 손가락이 뜬다 (§04-5)", () => {
    expect(TITLE_IDLE_HINT_MS).toBe(30_000);
    expect(showsIdleHint(29_999)).toBe(false);
    expect(showsIdleHint(30_000)).toBe(true);
  });
});

describe("previewAttacker", () => {
  it("같은 turn·seed면 항상 같은 캐릭터다 (결정론, §04-4)", () => {
    expect(previewAttacker(3, 7, 2)).toBe(previewAttacker(3, 7, 2));
  });

  it("항상 캐릭터 수 안의 인덱스를 준다", () => {
    for (let turn = 0; turn < 20; turn += 1) {
      const i = previewAttacker(turn, 5, 2);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(2);
    }
  });

  it("0,1,0,1로 번갈아 나오지 않는다 — 두 명뿐이라도 섞여야 한다", () => {
    const seq = Array.from({ length: 12 }, (_, t) => previewAttacker(t, 9, 2));
    const alternating = seq.every((v, i) => v === (seq[0]! + i) % 2);
    expect(alternating).toBe(false);
  });

  it("캐릭터가 없으면 0이다 (나누기 오류 방지)", () => {
    expect(previewAttacker(1, 1, 0)).toBe(0);
  });

  it("위상 오프셋이 공격 주기보다 훨씬 짧다 — 둘이 다른 프레임에 있으면 된다", () => {
    expect(PREVIEW_PHASE_OFFSET_MS).toBeLessThan(PREVIEW_ATTACK_PERIOD_MS);
  });
});

describe("타이틀 프리뷰 인원", () => {
  /**
   * **주 버튼이 데려가는 판의 인원과 같아야 한다.** 타이틀에 둘을 세우고
   * `[심연 하강]`을 누르면 혼자 서 있는 화면이 나오고, 그건 "동료가 사라졌다"로
   * 읽힌다. 값을 박는 이유는 `SINGLE_TEAM_SIZE`가 이 파일에서 안 보이기 때문이다
   * — 두 상수를 서로 비교하면 둘이 같이 2로 돌아가도 통과한다.
   */
  it("1명이다 — 싱글이 1인 진행이기 때문이다", () => {
    expect(TITLE_PREVIEW_COUNT).toBe(1);
  });

  it("혼자면 화면 가운데에 선다", () => {
    expect(previewXRatio(0, 1)).toBeCloseTo(0.5, 6);
  });

  /** 2인 시절의 0.36·0.64가 이 식의 count=2다 — 간격 상수의 유래다 */
  it("둘이면 예전 배치(0.36·0.64)를 그대로 낸다", () => {
    expect(previewXRatio(0, 2)).toBeCloseTo(0.5 - PREVIEW_GAP_RATIO / 2, 6);
    expect(previewXRatio(0, 2)).toBeCloseTo(0.36, 6);
    expect(previewXRatio(1, 2)).toBeCloseTo(0.64, 6);
  });

  it("셋이면 가운데가 정확히 화면 중앙이고 좌우가 대칭이다", () => {
    expect(previewXRatio(1, 3)).toBeCloseTo(0.5, 6);
    expect(previewXRatio(0, 3) + previewXRatio(2, 3)).toBeCloseTo(1.0, 6);
  });

  /**
   * 혼자일 때 오른쪽을 봐야 한다. 2인 시절 코드는 `i === 0 ? 1 : -1`이었는데
   * 그건 혼자여도 맞는 답을 내므로 **이 검사는 개수를 준 쪽을 잡는다**:
   * `count`를 무시하고 "뒷자리는 왼쪽"으로 두면 3인에서 가운데가 틀린다.
   */
  it("혼자면 오른쪽(진행 방향)을 본다", () => {
    expect(previewFacing(0, 1)).toBe(1);
  });

  it("여럿이면 서로를 본다 — 양 끝이 가운데를 향한다", () => {
    expect(previewFacing(0, 2)).toBe(1);
    expect(previewFacing(1, 2)).toBe(-1);
    expect(previewFacing(0, 3)).toBe(1);
    expect(previewFacing(2, 3)).toBe(-1);
  });
});

describe("startButtonLabel", () => {
  it("오프라인이면 라벨에서 미리 말한다 — 거짓 기대를 만들지 않는다 (§04-5)", () => {
    expect(startButtonLabel(true)).toBe("대전 시작");
    expect(startButtonLabel(false)).toContain("오프라인");
  });
});

describe("pvpUnlocked", () => {
  it("100층에 닿아야 대전이 열린다 — 1층 캐릭터로는 무엇을 눌러도 진다", () => {
    expect(PVP_UNLOCK_FLOOR).toBe(100);
    expect(pvpUnlocked(0)).toBe(false);
    expect(pvpUnlocked(99)).toBe(false);
    expect(pvpUnlocked(100)).toBe(true);
    expect(pvpUnlocked(1_200)).toBe(true);
  });

  it("NaN은 열지 않는다 — 값이 없으면 잠긴 쪽이 기본이다", () => {
    expect(pvpUnlocked(NaN)).toBe(false);
  });
});

describe("matchButtonLabel", () => {
  // 잠긴 버튼에 `대전`만 적으면 못 누르는 이유를 알기 위해 반드시 한 번 눌러야
  // 한다. 진열장의 목적은 "지금 무엇을 할 수 있는가"다
  it("잠겨 있으면 조건을 누르기 전에 라벨로 말한다", () => {
    expect(matchButtonLabel(0)).toContain(String(PVP_UNLOCK_FLOOR));
    expect(matchButtonLabel(99)).toContain(String(PVP_UNLOCK_FLOOR));
  });

  it("열렸으면 조건을 지운다 — 이미 만족한 조건은 잡음이다", () => {
    expect(matchButtonLabel(100)).toBe("대전");
    expect(matchButtonLabel(100)).not.toContain("층");
  });
});

describe("matchLockedNotice", () => {
  it("목표와 현재 위치를 같이 말한다 — 얼마나 남았는지 알아야 한다", () => {
    const at12 = matchLockedNotice(12);
    expect(at12).toContain(String(PVP_UNLOCK_FLOOR));
    expect(at12).toContain("12");
  });

  it("현재 층은 천 단위로 끊어 읽는다", () => {
    expect(matchLockedNotice(1_234)).toContain("1,234");
  });

  it("음수·소수·NaN에도 숫자를 뱉는다 (안내문에 NaN이 뜨면 그게 버그다)", () => {
    expect(matchLockedNotice(-5)).toContain("0");
    expect(matchLockedNotice(7.9)).toContain("7");
    expect(matchLockedNotice(NaN)).not.toContain("NaN");
  });
});

describe("lastResultBadge", () => {
  it("직전 결과를 배지로 알린다 (§04-7)", () => {
    expect(lastResultBadge(0)).toContain("승리");
    expect(lastResultBadge(1)).toContain("패배");
  });

  it("첫 진입·무승부에는 배지가 없다", () => {
    expect(lastResultBadge(undefined)).toBeNull();
    expect(lastResultBadge(null)).toBeNull();
  });
});

/**
 * 우상단 카드함 입구 (유저 지시: "맨 처음 화면에서도 카드함 있어서 바로 카드
 * 볼 수 있으면 좋겠어").
 *
 * 이 자리의 위험은 하나다: 위쪽 띠에 이미 **연결 상태 필**이 있다. 겹치면
 * 캡처에서만 드러나고, 탭 관용까지 겹치면 캡처에도 안 드러난다(그림은 안
 * 겹치는데 받는 영역이 겹친다) — 그래서 산술로 묻는다.
 */
describe("타이틀 카드함 입구", () => {
  const pos = titleBoxEntryPos(DESIGN_W);
  const room = titleBoxEntryTapRoom(DESIGN_H);
  const pillTop = DESIGN_H * STATUS_PILL_Y_RATIO;
  const pillLeft = DESIGN_W * STATUS_PILL_X_RATIO;
  const pillRight = pillLeft + DESIGN_W * STATUS_PILL_W_RATIO;

  it("화면 안 오른쪽 위 구석이다 — 여백은 양쪽 같다", () => {
    expect(pos.y).toBe(TITLE_BOX_ENTRY_MARGIN);
    expect(DESIGN_W - (pos.x + TITLE_BOX_ENTRY_W)).toBe(TITLE_BOX_ENTRY_MARGIN);
    expect(pos.x).toBeGreaterThan(0);
  });

  /**
   * **그림이 필을 안 덮는다.** 필 위쪽 변보다 아래 끝이 위여야 한다.
   * 필 좌표를 규칙에서 읽는 것이 핵심이다 — 씬의 `0.05`를 여기 다시 적으면
   * 씬을 옮긴 날 이 검사가 옛 자리를 지킨다.
   */
  it("버튼이 연결 상태 필 위에 앉는다 — 겹치지 않는다", () => {
    expect(pos.y + TITLE_BOX_ENTRY_H).toBeLessThanOrEqual(pillTop);
  });

  /** 탭 관용까지 더해도 필을 안 파고든다 — 그림만 재면 이쪽이 조용히 겹친다 */
  it("탭 영역도 필을 파고들지 않는다", () => {
    const down = tapSlack(TITLE_BOX_ENTRY_H, room.bottom);
    expect(pos.y + TITLE_BOX_ENTRY_H + down).toBeLessThanOrEqual(pillTop);
  });

  it("탭 영역이 화면 위로 나가지 않는다", () => {
    const up = tapSlack(TITLE_BOX_ENTRY_H, room.top);
    expect(pos.y - up).toBeGreaterThanOrEqual(0);
  });

  /**
   * **필 옆에 두는 안이 왜 탈락했는지를 수로 남긴다.** 필 오른쪽에 남는 폭은
   * 160.8px이고 가장 긴 라벨이 차지하는 폭은 160px이다 — 여유 0.8px은 로스터가
   * 늘어 `35/35`가 `50/50`이 되는 순간 사라진다. 그래서 필 **위** 띠를 쓴다.
   */
  it("필 오른쪽에는 이 버튼이 못 들어간다 (자리 선택의 근거)", () => {
    const rightGap = DESIGN_W - pillRight - TITLE_BOX_ENTRY_MARGIN;
    expect(rightGap).toBeLessThan(TITLE_BOX_ENTRY_W);
  });

  /**
   * 폭이 **가장 긴 라벨**에서 나온다. 도트 폰트는 한글이 정폭(글자 크기),
   * ASCII가 반칸이다(`skillBarRules.test.ts`의 같은 추정). `카드함 50/50`까지
   * 들어가야 한다 — 로스터가 커져 라벨이 길어지는 것이 이 폭의 유일한 위험이다.
   */
  it("가장 긴 라벨이 버튼 안쪽 폭에 들어간다", () => {
    const estWidth = (s: string): number =>
      [...s].reduce(
        (a, ch) => a + (ch.charCodeAt(0) < 0x80 ? T_BODY.size / 2 : T_BODY.size),
        0,
      );
    const inner = buttonTextMaxW(TITLE_BOX_ENTRY_W);
    expect(estWidth("카드함 35/35")).toBeLessThanOrEqual(inner);
    expect(estWidth("카드함 50/50")).toBeLessThanOrEqual(inner);
  });
});

describe("floorLabel", () => {
  it("테마 2종만 있다 (§01-1-3)", () => {
    expect(floorName("surface")).not.toBe(floorName("abyss"));
    expect(floorLabel(1, "surface")).toContain("1");
    expect(floorLabel(3, "abyss")).toContain(floorName("abyss"));
  });

  it("0·소수·NaN 웨이브를 1층으로 접는다", () => {
    expect(floorLabel(0, "surface")).toContain("1");
    expect(floorLabel(2.7, "surface")).toContain("2");
    expect(floorLabel(NaN, "surface")).toContain("1");
  });
});
