import { describe, expect, it } from "vitest";
import {
  FINGER_AMP_PX,
  FINGER_H,
  FINGER_PALM_R,
  FINGER_BOTTOM_DY,
  FINGER_BOX_BOTTOM,
  FINGER_BOX_CY,
  FINGER_BOX_R,
  FINGER_BOX_TOP,
  FINGER_HALF_W,
  FINGER_PERIOD_MS,
  FINGER_TIP_DY,
  HINT_SEEN_KEY,
  TOAST_BOTTOM_RATIO,
  TOAST_HOLD_MS,
  TOAST_IN_MS,
  TOAST_MAX_W_RATIO,
  TOAST_MIN_H,
  TOAST_OUT_MS,
  TOAST_RISE_PX,
  fingerAlpha,
  fingerAnchor,
  fingerOffset,
  readSeen,
  toastAlpha,
  toastDone,
  toastHeight,
  toastMaxW,
  toastRise,
  writeSeen,
} from "../src/shared/ui/hintRules";
import { barLayout } from "../src/shared/skillBarRules";
import { SLOT_DIAMETER_RATIO } from "../src/shared/ui/skillSlotRules";
import {
  DESIGN_H,
  DESIGN_W,
  SKILLBAR_RATIO,
} from "../src/shared/viewport";

describe("toastAlpha", () => {
  it("페이드 인 → 유지 → 페이드 아웃", () => {
    expect(toastAlpha(0)).toBe(0);
    expect(toastAlpha(TOAST_IN_MS)).toBe(1);
    expect(toastAlpha(TOAST_IN_MS + TOAST_HOLD_MS)).toBe(1);
    expect(toastAlpha(TOAST_IN_MS + TOAST_HOLD_MS + TOAST_OUT_MS)).toBe(0);
  });

  it("항상 0..1 안에 있다", () => {
    for (let t = -50; t < TOAST_IN_MS + TOAST_HOLD_MS + TOAST_OUT_MS + 200; t += 13) {
      const a = toastAlpha(t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it("유지 시간을 바꾸면 그만큼 오래 남는다", () => {
    expect(toastAlpha(TOAST_IN_MS + 3000, 4000)).toBe(1);
    expect(toastAlpha(TOAST_IN_MS + 3000, 900)).toBe(0);
  });
});

describe("toastDone", () => {
  it("전체 구간이 끝나야 true다", () => {
    expect(toastDone(0)).toBe(false);
    expect(toastDone(TOAST_IN_MS + TOAST_HOLD_MS)).toBe(false);
    expect(toastDone(TOAST_IN_MS + TOAST_HOLD_MS + TOAST_OUT_MS)).toBe(true);
  });

  it("done 시점의 알파가 0이다 — 남은 잔상 없이 제거된다", () => {
    const t = TOAST_IN_MS + TOAST_HOLD_MS + TOAST_OUT_MS;
    expect(toastDone(t)).toBe(true);
    expect(toastAlpha(t)).toBe(0);
  });

  it("1.8초 자동 소멸 스펙을 유지한다 (§C10)", () => {
    expect(TOAST_HOLD_MS).toBe(1800);
  });
});

describe("toastRise", () => {
  it("아래에서 올라와 제자리에 멈춘다", () => {
    expect(toastRise(0)).toBeCloseTo(TOAST_RISE_PX, 5);
    expect(toastRise(TOAST_IN_MS)).toBe(0);
    expect(toastRise(9999)).toBe(0);
  });

  it("단조 감소한다", () => {
    let prev = TOAST_RISE_PX + 1;
    for (let t = 0; t <= TOAST_IN_MS; t += 6) {
      const v = toastRise(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe("토스트 위치", () => {
  it("하단에서 20% 지점 — 스킬바를 가리지 않는다 (§C10)", () => {
    expect(TOAST_BOTTOM_RATIO).toBe(0.2);
  });
});

describe("toastMaxW", () => {
  // 안내문은 못 누르는 이유를 말하는 유일한 수단이다 — 잘리면 기능이 죽는데
  // 잘려도 화면은 멀쩡해 보인다
  it("화면 안에 좌우 여백을 남긴다", () => {
    const w = toastMaxW(DESIGN_W);
    expect(w).toBeLessThan(DESIGN_W);
    // 여백이 한쪽 3% 미만이면 "꽉 찬 것"과 구분이 안 된다
    expect(DESIGN_W - w).toBeGreaterThanOrEqual(DESIGN_W * 0.06);
  });

  it("폭 기준 비율이다 — px 상수가 아니다 (디자인 폭이 바뀌면 같이 움직인다)", () => {
    expect(toastMaxW(1000)).toBe(Math.round(1000 * TOAST_MAX_W_RATIO));
    expect(toastMaxW(DESIGN_W)).toBe(Math.round(DESIGN_W * TOAST_MAX_W_RATIO));
  });

  it("음수·0에도 음수 폭을 만들지 않는다", () => {
    expect(toastMaxW(0)).toBe(0);
    expect(toastMaxW(-100)).toBe(0);
  });
});

describe("toastHeight", () => {
  it("한 줄은 기본 높이를 쓴다 (§C10)", () => {
    expect(TOAST_MIN_H).toBe(56);
    expect(toastHeight(24)).toBe(TOAST_MIN_H);
    expect(toastHeight(0)).toBe(TOAST_MIN_H);
  });

  // 줄바꿈이 걸린 라벨을 고정 높이 알약에 넣으면 글자가 위아래로 새어 나온다
  it("두 줄이 되면 알약이 같이 자란다", () => {
    const twoLines = toastHeight(24 * 2 + 6);
    expect(twoLines).toBeGreaterThan(TOAST_MIN_H);
    expect(twoLines).toBeGreaterThan(24 * 2 + 6);
  });

  it("라벨 높이에 대해 단조 증가한다", () => {
    let prev = 0;
    for (let h = 0; h <= 200; h += 7) {
      const v = toastHeight(h);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("NaN·음수에도 기본 높이로 떨어진다", () => {
    expect(toastHeight(NaN)).toBe(TOAST_MIN_H);
    expect(toastHeight(-40)).toBe(TOAST_MIN_H);
  });
});

describe("fingerOffset / fingerAlpha", () => {
  it("진폭 안에서 상하로 흔든다", () => {
    let min = 0;
    let max = 0;
    for (let t = 0; t < FINGER_PERIOD_MS; t += 5) {
      const v = fingerOffset(t);
      expect(Math.abs(v)).toBeLessThanOrEqual(FINGER_AMP_PX + 1e-9);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(-FINGER_AMP_PX * 0.9);
    expect(max).toBeGreaterThan(FINGER_AMP_PX * 0.9);
  });

  it("주기적으로 반복한다", () => {
    expect(fingerOffset(200)).toBeCloseTo(fingerOffset(200 + FINGER_PERIOD_MS), 8);
    expect(fingerAlpha(200)).toBeCloseTo(fingerAlpha(200 + FINGER_PERIOD_MS), 8);
  });

  it("완전히 투명해지지 않는다 — 무엇을 가리켰는지 놓친다", () => {
    for (let t = 0; t < FINGER_PERIOD_MS; t += 7) {
      expect(fingerAlpha(t)).toBeGreaterThanOrEqual(0.55);
      expect(fingerAlpha(t)).toBeLessThanOrEqual(1);
    }
  });

  it("음수 시간은 0", () => {
    expect(fingerOffset(-1)).toBe(0);
    expect(fingerAlpha(-1)).toBe(0);
  });
});

describe("readSeen / writeSeen", () => {
  function fakeStore(): Storage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      length: 0,
    } as Storage & { data: Map<string, string> };
  }

  it("쓰고 나면 봤다고 읽힌다", () => {
    const store = fakeStore();
    expect(readSeen(store)).toBe(false);
    writeSeen(store);
    expect(readSeen(store)).toBe(true);
    expect(store.data.get(HINT_SEEN_KEY)).toBe("1");
  });

  it("store가 null이면 항상 안 봤다 — 갤러리가 실제 온보딩을 먹지 않는다", () => {
    expect(readSeen(null)).toBe(false);
    expect(() => writeSeen(null)).not.toThrow();
  });

  it("localStorage가 던져도 부팅을 죽이지 않는다 (사파리 프라이빗)", () => {
    const boom = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readSeen(boom)).toBe(false);
    expect(() => writeSeen(boom)).not.toThrow();
  });

  it("다른 값이 들어 있으면 안 본 것으로 본다", () => {
    const store = fakeStore();
    store.setItem(HINT_SEEN_KEY, "0");
    expect(readSeen(store)).toBe(false);
  });
});

/**
 * 손가락이 슬롯도, 슬롯 위 이웃도 가리지 않는다 (2026-08-07).
 *
 * 두 세션이 `firstSlot.y - 70`을 똑같이 눈대중으로 적고 있었다. 70은 어디서도
 * 유도되지 않았고, 슬롯 지름은 **칸 수에 따라 변한다**(`cell * 0.82`) — 그래서
 * 같은 상수가 4칸 바에서는 18px 침범이고 6칸 바에서는 5px 여유였다. 1:1 캡처에
 * 파란 얼룩으로 찍혔지만 화면은 안 죽으니 아무 검사도 울리지 않았다.
 *
 * 첫 수정안(슬롯 **위** 빈 줄에 세우기)은 캡처에 뒤집혔다 — 4칸 바 위에는 그
 * 빈 줄이 없어서(강화 줄까지 44.6px, 손은 81px) 침범 대상만 슬롯에서 강화
 * 버튼으로 옮겼다. 그래서 손을 슬롯 반지름에 매달았다.
 *
 * **실제 바 두 개로 묻는다** — 한 칸 수만 재면 다른 칸 수에서 다시 깨진다.
 */
describe("fingerAnchor — 손이 슬롯 원 안에 온전히 든다", () => {
  const barH = DESIGN_H * SKILLBAR_RATIO;
  const geoOf = (n: number) =>
    barLayout(DESIGN_W, barH, n, SLOT_DIAMETER_RATIO);

  /**
   * 손 사각의 네 꼭지가 다 슬롯 원 안에 있는가 — **테두리를 걸치지 않는 것**이
   * 원래 결함의 조건이다(걸치면 두 아웃라인이 이어 붙어 얼룩이 된다).
   * 흔들림은 `FINGER_BOX_*`에 이미 들어 있다.
   */
  const worstOverhang = (slotD: number): number => {
    const at = fingerAnchor(0, 0, slotD);
    let worst = -Infinity;
    for (const dx of [-FINGER_HALF_W, FINGER_HALF_W])
      for (const dy of [FINGER_BOX_TOP, FINGER_BOX_BOTTOM])
        worst = Math.max(worst, Math.hypot(at.x + dx, at.y + dy) - slotD / 2);
    return worst;
  };

  it("싱글(4칸)·PvP(6칸) 둘 다 테두리를 안 넘는다", () => {
    for (const n of [4, 6]) {
      expect(worstOverhang(geoOf(n).slotD), `${n}칸`).toBeLessThanOrEqual(0);
    }
  });

  it("옆 칸까지 넘어갈 여지가 없다 — 자기 원 안이므로 구조적으로 불가능", () => {
    for (const n of [4, 6]) {
      const g = geoOf(n);
      const at = fingerAnchor(g.slotX(0), g.slotY, g.slotD);
      expect(at.x + FINGER_HALF_W, `${n}칸`).toBeLessThan(
        g.slotX(1) - g.slotD / 2,
      );
    }
  });

  /**
   * 눈대중 상수가 왜 안 되는지를 검사로 남긴다: 칸 수가 지름을 바꾸므로
   * 두 바의 자리는 **달라야** 한다. 같으면 한쪽은 반드시 어긋난 것이다.
   */
  it("칸 수가 다르면 자리도 다르다", () => {
    const g4 = geoOf(4);
    const g6 = geoOf(6);
    expect(g4.slotD).not.toBe(g6.slotD);
    const a4 = fingerAnchor(0, g4.slotY, g4.slotD);
    const a6 = fingerAnchor(0, g6.slotY, g6.slotD);
    expect(a4.x).toBeGreaterThan(a6.x);
    expect(a4.y).toBeGreaterThan(a6.y);
  });

  it("치우는 거리가 슬롯 반지름에서 손 크기를 뺀 만큼이다", () => {
    const g = geoOf(4);
    const at = fingerAnchor(0, 0, g.slotD);
    expect(at.x).toBeCloseTo((g.slotD / 2 - FINGER_BOX_R) / Math.SQRT2, 6);
    // 세로는 사각 중심을 맞추느라 되민다 — 손끝이 위로 길기 때문이다
    expect(at.y).toBeCloseTo(at.x - FINGER_BOX_CY, 6);
    expect(FINGER_BOX_CY).toBeLessThan(0);
  });

  it("손보다 작은 슬롯이면 중심에 놓는다 — 밀 여지가 없다", () => {
    const tiny = fingerAnchor(50, 60, FINGER_BOX_R); // 반지름이 손 반지름의 절반
    expect(tiny.x).toBe(50);
    expect(fingerAnchor(50, 60, -30).x).toBe(50);
  });

  it("손 사각이 그림과 같은 치수에서 나온다", () => {
    expect(FINGER_HALF_W).toBe(FINGER_PALM_R);
    expect(FINGER_BOX_TOP).toBe(FINGER_TIP_DY - FINGER_AMP_PX);
    expect(FINGER_BOX_BOTTOM).toBe(FINGER_BOTTOM_DY + FINGER_AMP_PX);
    expect(FINGER_H).toBe(FINGER_BOTTOM_DY - FINGER_TIP_DY);
  });
});
