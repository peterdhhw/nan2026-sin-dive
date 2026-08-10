import { describe, expect, it } from "vitest";
import { luminance } from "../src/shared/color";
import {
  ART_PX,
  BUTTON_H,
  MIN_TAP,
  OUTLINE_BUTTON,
  OUTLINE_ICON,
  OUTLINE_PANEL,
  OUTLINE_PILL,
  PAD_BUTTON_X,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  PRESS_SCALE,
  RADIUS_BUTTON,
  RADIUS_CARD,
  RADIUS_PANEL,
  SHAKE_MS,
  SHAKE_AMP,
  buttonWidth,
  notchedRectPoints,
  pillRadius,
  pixelArcPoints,
  pixelBandPoints,
  pixelCirclePoints,
  pressScale,
  shadeBands,
  shakeOffset,
  snapPx,
  tapSlack,
} from "../src/shared/ui/shapeRules";

/**
 * 격자 위 좌표인지 본다.
 *
 * `%`로 직접 재면 안 된다 — `-44 % 4`는 `-0`이라 `toBe(0)`이 실패한다(좌표는
 * 격자에 있는데도). 나눗셈이 정수인지로 묻는다. `-0`도 정수라 부호는 무해하다.
 */
function expectOnGrid(x: number, y: number): void {
  expect(Number.isInteger(x / ART_PX)).toBe(true);
  expect(Number.isInteger(y / ART_PX)).toBe(true);
}

/** 점 배열을 (x, y) 쌍으로 본다 — 아래 도형 검사가 전부 이 형태를 쓴다 */
function pairs(pts: number[]): [number, number][] {
  expect(pts.length % 2).toBe(0);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2) {
    out.push([pts[i] as number, pts[i + 1] as number]);
  }
  return out;
}

describe("형태 토큰", () => {
  it("아웃라인은 요소가 클수록 두껍다 — 같아도 되지만 역전은 안 된다 (§3-1)", () => {
    // 도트 격자로 접은 뒤로는 위계가 8/8/4/4 두 단계다. 등호를 허용하는 대신
    // **역전은 금지한다** — 큰 요소가 더 얇으면 위계가 뒤집혀 읽힌다
    expect(OUTLINE_PANEL).toBeGreaterThanOrEqual(OUTLINE_BUTTON);
    expect(OUTLINE_BUTTON).toBeGreaterThanOrEqual(OUTLINE_PILL);
    expect(OUTLINE_PILL).toBeGreaterThanOrEqual(OUTLINE_ICON);
    // 두 단계는 남아 있어야 한다 — 전부 같으면 위계가 아예 사라진다
    expect(OUTLINE_PANEL).toBeGreaterThan(OUTLINE_ICON);
  });

  it("모든 형태 토큰이 아트 픽셀의 배수다 (도트 룩의 전제)", () => {
    // 격자를 벗어난 두께·깎기는 화면 위쪽에서 1칸, 아래쪽에서 2칸으로 렌더된다.
    // 캐릭터가 4px 도트라 그 불일치가 바로 "UI만 해상도가 높다"로 보인다
    for (const v of [
      OUTLINE_PANEL,
      OUTLINE_BUTTON,
      OUTLINE_PILL,
      OUTLINE_ICON,
      RADIUS_PANEL,
      RADIUS_BUTTON,
      RADIUS_CARD,
    ]) {
      expect(Number.isInteger(v / ART_PX)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("코너 깎기는 요소가 클수록 크다 (§3-2)", () => {
    expect(RADIUS_PANEL).toBeGreaterThan(RADIUS_BUTTON);
    expect(RADIUS_BUTTON).toBeGreaterThanOrEqual(RADIUS_CARD);
  });

  it("탭 타깃 최소치는 그대로다 (§3-4)", () => {
    expect(MIN_TAP).toBe(88);
  });

  /**
   * **예전 주석이 틀렸다** (2026-08-07). 여기엔 "88 미만이어도 폭이 88을 넘으므로
   * 실제 탭 면적은 확보된다"고 적혀 있었는데, 손가락은 면적이 아니라 **가장 짧은
   * 변**에 걸린다 — 720×20 버튼의 면적은 넉넉하지만 세로로는 못 맞춘다. 그 문장
   * 때문에 여덟 곳(48~76px)이 검사 없이 통과했다.
   *
   * 지금은 높이가 88 미만인 것 자체를 결함으로 보지 않는다(시각 위계가 높이로
   * 만들어진다). 대신 부족분을 `tapSlack`이 메우는지를 아래에서 묻는다.
   */
  it("기본 버튼 높이는 88 미만일 수 있다 — 그래서 관용이 필요하다", () => {
    expect(BUTTON_H).toBeLessThan(MIN_TAP);
    expect(BUTTON_H + tapSlack(BUTTON_H) * 2).toBeGreaterThanOrEqual(MIN_TAP);
  });
});

/**
 * 탭 관용 — 88px(§3-4)에 못 미치는 변을 hitArea로 메운다.
 *
 * **왜 필요했나:** `MIN_TAP`은 §3-4에 있었지만 `buttonWidth`의 폭 하한으로만
 * 쓰였고, `h:`를 넘기는 호출은 전부 검사 밖이었다 — 싱글 HUD의 `타이틀`이
 * 132×48(실기기 ≈26dp)이다. 높이를 올리는 쪽은 못 썼다(밴드가 꽉 찼다).
 */
describe("tapSlack — 부족한 변은 hitArea로 메운다", () => {
  it("모자란 만큼을 양쪽에 나눠 준다", () => {
    expect(tapSlack(48)).toBe(20);
    expect(48 + tapSlack(48) * 2).toBe(MIN_TAP);
    expect(tapSlack(64)).toBe(12);
    expect(tapSlack(76)).toBe(6);
  });

  it("이미 88 이상이면 아무것도 안 넓힌다 — 큰 버튼이 이웃을 삼키면 안 된다", () => {
    expect(tapSlack(MIN_TAP)).toBe(0);
    expect(tapSlack(96)).toBe(0);
    expect(tapSlack(720)).toBe(0);
  });

  /**
   * **한도가 이 함수의 핵심이다.** 한도 없이 관용을 주면 HUD 타이틀의 20px이
   * 골드 필 위쪽 12px을 덮어서 **잔고를 누르면 하강이 끝난다** — 안 눌리는
   * 버튼보다 나쁜 결함이다(엉뚱한 것이 눌린다).
   */
  it("빈 자리가 없으면 관용도 없다 — 이웃을 파고들지 않는다", () => {
    expect(tapSlack(48, 0)).toBe(0);
    expect(tapSlack(48, 8)).toBe(8);
    // 한도가 필요분보다 크면 필요분에서 멈춘다
    expect(tapSlack(48, 500)).toBe(20);
    expect(tapSlack(48)).toBe(20);
  });

  it("쓰레기 값에 이웃을 침범하지 않는다 — NaN은 0으로 접는다", () => {
    expect(tapSlack(48, Number.NaN)).toBe(0);
    expect(tapSlack(48, -30)).toBe(0);
    expect(tapSlack(Number.NaN)).toBe(MIN_TAP / 2);
    expect(tapSlack(-10)).toBe(MIN_TAP / 2);
  });
});

describe("snapPx", () => {
  it("가장 가까운 칸으로 접는다", () => {
    expect(snapPx(0)).toBe(0);
    expect(snapPx(1)).toBe(0);
    expect(snapPx(3)).toBe(4);
    expect(snapPx(4)).toBe(4);
    expect(snapPx(13)).toBe(12);
    expect(snapPx(-3)).toBe(-4);
  });
});

describe("notchedRectPoints", () => {
  it("깎기가 0이면 그냥 직각 사각형이다", () => {
    expect(notchedRectPoints(0, 0, 40, 20, 0)).toEqual([
      0, 0, 40, 0, 40, 20, 0, 20,
    ]);
  });

  it("모든 점이 격자에 있다", () => {
    for (const [x, y] of pairs(notchedRectPoints(0, 0, 80, 48, ART_PX * 3))) {
      expectOnGrid(x, y);
    }
  });

  it("계단만 남는다 — 대각 선분이 하나도 없다", () => {
    // 한 칸짜리 대각 선분도 스트로크에서는 안티에일리어싱된 사선으로 찍힌다.
    // 그 한 줄이 도트 룩을 깨므로 개수로 못박는다
    const pts = pairs(notchedRectPoints(0, 0, 96, 64, ART_PX * 2));
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % pts.length]!;
      expect(ax === bx || ay === by).toBe(true);
    }
  });

  it("중복 정점을 남기지 않는다 — 겹친 점은 모서리 하나만 진하게 찍는다", () => {
    for (const cut of [0, ART_PX, ART_PX * 2, ART_PX * 3, 100]) {
      const pts = pairs(notchedRectPoints(0, 0, 96, 64, cut));
      const seen = new Set(pts.map(([x, y]) => `${x},${y}`));
      expect(seen.size).toBe(pts.length);
    }
  });

  it("깎기가 변 절반을 넘어도 사각형 밖으로 나가지 않는다", () => {
    const pts = pairs(notchedRectPoints(0, 0, 40, 20, 500));
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(40);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(20);
    }
  });
});

describe("pixelArcPoints", () => {
  it("모든 점이 격자에 있다", () => {
    for (const [x, y] of pairs(pixelCirclePoints(0, 0, 44))) {
      expectOnGrid(x, y);
    }
  });

  it("대각 선분이 하나도 없다 — 원도 계단으로만 그린다", () => {
    const pts = pairs(pixelCirclePoints(0, 0, 44));
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % pts.length]!;
      expect(ax === bx || ay === by).toBe(true);
    }
  });

  it("연속 중복 정점을 남기지 않는다", () => {
    const pts = pairs(pixelCirclePoints(0, 0, 44));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
    }
  });

  it("실루엣이 반지름을 지킨다 — 접힌 뒤에도 원이어야 한다", () => {
    // 중심과 반지름이 격자에 맞으면 경계도 정확히 맞는다
    const r = 44;
    const pts = pairs(pixelCirclePoints(8, 20, r));
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...xs)).toBe(8 - r);
    expect(Math.max(...xs)).toBe(8 + r);
    expect(Math.min(...ys)).toBe(20 - r);
    expect(Math.max(...ys)).toBe(20 + r);
  });

  it("격자에서 벗어난 중심·반지름도 한 칸 안에서 맞는다", () => {
    // 호출부가 늘 격자값을 넘기지는 않는다(레이아웃 비율에서 나온 좌표).
    // 접기 오차가 한 칸을 넘으면 원이 눈에 띄게 작아진다
    const pts = pairs(pixelCirclePoints(10, 21, 43));
    const xs = pts.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 43 - ART_PX);
    expect(Math.min(...xs)).toBeLessThanOrEqual(10 - 43 + ART_PX);
  });

  it("한 칸보다 작은 반지름은 빈 배열이다 — 그리는 쪽이 한 칸 점으로 대체한다", () => {
    // 예전에는 점 1~2개짜리 경로가 나와서 조용히 아무것도 안 그려졌다
    for (const r of [0, 1, 2, 3]) {
      expect(pixelCirclePoints(0, 0, r)).toEqual([]);
    }
    expect(pixelCirclePoints(0, 0, ART_PX).length).toBeGreaterThanOrEqual(6);
  });

  it("음수·0 스윕은 빈 배열이다", () => {
    expect(pixelArcPoints(0, 0, 40, 0, 0)).toEqual([]);
    expect(pixelArcPoints(0, 0, 40, 1, 0)).toEqual([]);
  });

  it("부분 호는 시작·끝 각의 사분면 안에 머문다", () => {
    // 12시에서 3시까지 — 우상단 사분면이다
    const pts = pairs(pixelArcPoints(0, 0, 40, -Math.PI / 2, 0));
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-ART_PX);
      expect(y).toBeLessThanOrEqual(ART_PX);
    }
  });

  it("반지름이 커지면 점이 더 촘촘해진다 — 큰 원이 다각형으로 보이면 안 된다", () => {
    const small = pixelCirclePoints(0, 0, 20).length;
    const big = pixelCirclePoints(0, 0, 80).length;
    expect(big).toBeGreaterThan(small);
  });
});

describe("pixelBandPoints", () => {
  const band = (a1 = Math.PI * 2): number[] =>
    pixelBandPoints(0, 0, 74, 12, 0, a1);

  it("격자 위에 있고 대각 선분이 없다 — 마구리 이음매까지", () => {
    // 열린 호의 마구리는 바깥 호 끝과 안쪽 호 끝을 잇는 자리다. 반지름이 다르니
    // 그냥 이으면 대각선 한 줄이 남는다 — 카운트다운 링에서 그대로 보인다
    for (const a1 of [Math.PI * 2, Math.PI * 0.8, Math.PI * 1.7]) {
      const pts = pairs(band(a1));
      for (const [x, y] of pts) expectOnGrid(x, y);
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i]!;
        const [bx, by] = pts[(i + 1) % pts.length]!;
        expect(ax === bx || ay === by).toBe(true);
      }
    }
  });

  it("연속 중복 정점을 남기지 않는다", () => {
    const pts = pairs(band());
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
    }
  });

  it("두께가 격자로 접힌다 — 13은 12와 같은 띠다", () => {
    expect(pixelBandPoints(0, 0, 74, 13, 0, Math.PI * 2)).toEqual(band());
  });

  it("두께가 반지름을 먹으면 빈 배열이다", () => {
    // 안쪽 반지름이 한 칸 아래로 내려가면 띠가 아니라 원판이다 — 조용히
    // 원판을 그리면 링이 갑자기 채워진 원이 되므로 호출부가 알 수 있게 비운다
    expect(pixelBandPoints(0, 0, 10, 12, 0, Math.PI * 2)).toEqual([]);
    expect(pixelBandPoints(0, 0, 3, 4, 0, Math.PI * 2)).toEqual([]);
  });

  it("음수·0 스윕은 빈 배열이다", () => {
    expect(pixelBandPoints(0, 0, 74, 12, 1, 1)).toEqual([]);
    expect(pixelBandPoints(0, 0, 74, 12, 1, 0)).toEqual([]);
  });

  it("바깥 경계가 바깥 반지름을 지킨다", () => {
    const xs = pairs(band()).map(([x]) => x);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(74 - ART_PX);
    expect(Math.max(...xs)).toBeLessThanOrEqual(74 + ART_PX);
  });

  it("스윕이 좁아지면 점이 줄어든다 — 호는 부분만 그린다", () => {
    expect(pairs(band(Math.PI * 0.5)).length).toBeLessThan(
      pairs(band()).length,
    );
  });
});

describe("pillRadius", () => {
  it("높이의 절반 (§3-2)", () => {
    expect(pillRadius(52)).toBe(26);
    expect(pillRadius(0)).toBe(0);
  });

  it("음수 높이를 0으로 접는다", () => {
    expect(pillRadius(-10)).toBe(0);
  });
});

describe("buttonWidth", () => {
  it("라벨 폭 + 좌우 패딩", () => {
    expect(buttonWidth(200)).toBe(200 + PAD_BUTTON_X * 2);
  });

  it("짧은 라벨에서도 최소 탭 타깃을 지킨다", () => {
    expect(buttonWidth(0)).toBe(MIN_TAP);
    expect(buttonWidth(10)).toBe(MIN_TAP);
  });

  it("음수 라벨 폭을 0으로 본다", () => {
    expect(buttonWidth(-40)).toBe(MIN_TAP);
  });
});

describe("shadeBands", () => {
  it("립이 밑색보다 밝고 굽이 어둡다", () => {
    const b = shadeBands(0x504030, 76);
    expect(luminance(b.lip)).toBeGreaterThan(luminance(b.base));
    expect(luminance(b.boot)).toBeLessThan(luminance(b.base));
  });

  it("스펙 비율대로 높이를 나눈다 (12% / 18%)", () => {
    const b = shadeBands(0x808080, 100);
    expect(b.lipH).toBe(12);
    expect(b.bootH).toBe(18);
  });

  it("아주 낮은 요소에서도 각 밴드가 1px 이상이다", () => {
    const b = shadeBands(0x808080, 6);
    expect(b.lipH).toBeGreaterThanOrEqual(1);
    expect(b.bootH).toBeGreaterThanOrEqual(1);
  });

  it("립 + 굽이 전체 높이를 넘지 않는다 — 본체가 사라지면 밑색이 안 보인다", () => {
    for (const h of [0, 1, 2, 3, 4, 6, 12, 16, 56]) {
      const b = shadeBands(0x336699, h);
      expect(b.lipH + b.bootH).toBeLessThanOrEqual(Math.max(0, h));
    }
  });

  it("높이 0을 안전하게 처리한다", () => {
    const b = shadeBands(0x336699, 0);
    expect(b.lipH + b.bootH).toBe(0);
  });
});

describe("pressScale", () => {
  it("누르면 눌림값으로 수축한다", () => {
    expect(pressScale(0, true)).toBeCloseTo(1, 5);
    expect(pressScale(PRESS_IN_MS, true)).toBeCloseTo(PRESS_SCALE, 5);
  });

  it("떼면 1로 복귀한다", () => {
    expect(pressScale(0, false)).toBeCloseTo(PRESS_SCALE, 5);
    expect(pressScale(PRESS_OUT_MS, false)).toBeCloseTo(1, 5);
  });

  it("두 방향 모두 단조롭다 — 되돌아가면 떨림으로 보인다", () => {
    let prev = 2;
    for (let t = 0; t <= PRESS_IN_MS; t += 10) {
      const v = pressScale(t, true);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    prev = 0;
    for (let t = 0; t <= PRESS_OUT_MS; t += 10) {
      const v = pressScale(t, false);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("시간이 넘쳐도 값이 튀지 않는다", () => {
    expect(pressScale(9999, true)).toBeCloseTo(PRESS_SCALE, 5);
    expect(pressScale(9999, false)).toBeCloseTo(1, 5);
  });
});

describe("shakeOffset", () => {
  it("구간 밖에서는 0", () => {
    expect(shakeOffset(-1)).toBe(0);
    expect(shakeOffset(SHAKE_MS)).toBe(0);
    expect(shakeOffset(SHAKE_MS + 100)).toBe(0);
  });

  it("진폭 안에 머문다", () => {
    for (let t = 0; t < SHAKE_MS; t += 4) {
      expect(Math.abs(shakeOffset(t))).toBeLessThanOrEqual(SHAKE_AMP);
    }
  });

  it("좌우 양방향으로 흔든다 — 한쪽으로만 밀리면 이동으로 보인다", () => {
    let min = 0;
    let max = 0;
    for (let t = 0; t < SHAKE_MS; t += 2) {
      const v = shakeOffset(t);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeLessThan(-1);
    expect(max).toBeGreaterThan(1);
  });

  it("끝으로 갈수록 감쇠한다", () => {
    const early = Math.abs(shakeOffset(20));
    const late = Math.abs(shakeOffset(SHAKE_MS - 20));
    expect(late).toBeLessThan(early);
  });
});
