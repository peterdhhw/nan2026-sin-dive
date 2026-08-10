/**
 * 형태 언어의 순수 규칙 — 아웃라인 두께·코너 반경·3단 셰이딩 비율·탭 타깃.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §3
 *
 * **왜 규칙을 모듈로 빼는가**: §3은 "모든 UI 요소가 지킨다"고 못박은 규칙이다.
 * 위젯 8개가 각자 `stroke({ width: 5 })`를 하드코딩하면 두께가 슬금슬금
 * 갈라지고(레퍼런스 룩의 정체가 형태 규칙이므로 그 순간 룩이 무너진다),
 * "패널은 6인가 5인가"를 파일마다 확인해야 한다.
 *
 * Pixi를 import하지 않는다 (`ui/*.ts`가 값으로 읽어 쓴다).
 */

import { darken, lighten } from "../color";

export { darken, lighten };

/**
 * **아트 픽셀** 한 칸의 크기(디자인 px).
 *
 * 캐릭터 시트는 128px 원본을 4배로 띄워 쓰고, 도트 폰트는 12px 격자다.
 * UI 도형도 같은 칸 크기를 쓰지 않으면 화면에 굵기가 세 종류(캐릭터 4px 도트,
 * 글자 도트, UI의 1px 벡터 선)로 섞여서 "UI만 해상도가 높다"가 된다.
 *
 * 4로 잡는다 — 캐릭터 도트와 같고, 12px 폰트 격자의 약수라 둘과 다 맞는다.
 */
export const ART_PX = 4;

/**
 * 아트 픽셀 격자로 접는다. 도형 좌표·크기는 전부 이걸 지난다.
 *
 * `-0`을 `0`으로 정규화한다 — 원점 근처 좌표가 `-0`으로 접히면 값으로는 같지만
 * 나머지 연산(`x % ART_PX`)이 `-0`을 내고, 좌표를 문자열로 키를 만드는 코드가
 * `"-0,4"`와 `"0,4"`를 다른 점으로 본다.
 */
export function snapPx(px: number): number {
  const v = Math.round(px / ART_PX) * ART_PX;
  return v === 0 ? 0 : v;
}

/** 임의 칸 크기로 접는다 (`snapPx`는 아트 픽셀 고정) */
function snapTo(v: number, step: number): number {
  const q = Math.round(v / step) * step;
  return q === 0 ? 0 : q;
}

/**
 * 요소 크기별 아웃라인 두께 (§3-1).
 *
 * 원래 6/5/4/3이었다. 도트 격자(4px)의 배수로 접으면 8/8/4/4가 되어 위계가
 * 두 단계로 줄지만, **선 두께가 격자를 벗어나면 같은 선이 화면 위쪽에서는
 * 1칸, 아래쪽에서는 2칸으로 렌더된다** — 벡터 UI에서는 안 보이던 문제가
 * 도트 룩에서는 바로 눈에 띈다. 위계는 두께 대신 색으로 만든다.
 */
export const OUTLINE_PANEL = ART_PX * 2;
export const OUTLINE_BUTTON = ART_PX * 2;
export const OUTLINE_PILL = ART_PX;
export const OUTLINE_ICON = ART_PX;

/**
 * 코너 **깎기** 크기 (§3-2를 도트로 옮긴 것).
 *
 * 도트 그림에는 매끈한 원호가 없다 — 반경 28px 원호를 그리면 그 곡선만
 * 안티에일리어싱되어 캐릭터와 다른 해상도로 보인다. 대신 모서리를 계단으로
 * 깎는다(chamfer): 값은 "몇 칸을 깎는가"이고, 전부 `ART_PX`의 배수다.
 *
 * 28/18/14 → 12/8/8. 원래 반경보다 작다 — 계단 깎기는 같은 크기에서
 * 원호보다 훨씬 크게 보이기 때문이다(모서리를 직선으로 잘라내므로).
 */
export const RADIUS_PANEL = ART_PX * 3;
export const RADIUS_BUTTON = ART_PX * 2;
export const RADIUS_CARD = ART_PX * 2;

/**
 * 계단 깎인 사각형의 외곽선 점 목록.
 *
 * 모서리마다 `cut`만큼을 45° 직선으로 잘라낸다. `step`이 한 칸 크기이고,
 * 잘린 변은 그 칸으로 된 계단이 된다 — 이래야 확대해도 도트로 읽힌다.
 * `cut`이 0이면 그냥 직각 사각형이다(칼같이 각진 것도 도트 룩이다).
 *
 * Pixi를 모른다 — 좌표 배열만 만든다(테스트가 이 배열을 그대로 검증한다).
 */
export function notchedRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
  step: number = ART_PX,
): number[] {
  const cw = Math.max(0, Math.min(cut, w / 2, h / 2));
  // 칸 수로 센다 — 반 칸이 남으면 계단 한 칸이 절반 크기로 튀어나온다
  const n = Math.max(0, Math.floor(cw / Math.max(1, step)));
  const c = n * step;
  const x1 = x + w;
  const y1 = y + h;
  if (n === 0) return [x, y, x1, y, x1, y1, x, y1];

  const pts: number[] = [];
  /**
   * 직전 점과 같은 좌표는 버린다.
   *
   * 깎기가 변 절반에 정확히 닿으면(`cut >= h/2`) 계단의 마지막 칸이 변 중앙에
   * 도착해서, 뒤이어 넣는 변 끝점과 같은 자리가 된다 — 그 겹친 점에서 스트로크가
   * 두 번 겹쳐 모서리 하나만 진하게 찍힌다. 알약 모양(`cut = h/2`)이 정확히
   * 그 경우라 예외가 아니라 정상 입력이다.
   */
  const push = (px: number, py: number): void => {
    const k = pts.length;
    if (k >= 2 && pts[k - 2] === px && pts[k - 1] === py) return;
    pts.push(px, py);
  };
  /** 한 모서리의 계단. `sx`/`sy`는 진행 방향 */
  const stair = (
    cx: number,
    cy: number,
    sx: number,
    sy: number,
    horizFirst: boolean,
  ): void => {
    for (let i = 0; i < n; i++) {
      const ax = cx + sx * step * i;
      const ay = cy + sy * step * i;
      if (horizFirst) {
        push(ax + sx * step, ay);
        push(ax + sx * step, ay + sy * step);
      } else {
        push(ax, ay + sy * step);
        push(ax + sx * step, ay + sy * step);
      }
    }
  };

  // 좌상 → 우상 → 우하 → 좌하. 각 모서리에서 계단을 내려간다
  push(x + c, y);
  push(x1 - c, y);
  stair(x1 - c, y, 1, 1, true);
  push(x1, y1 - c);
  stair(x1, y1 - c, -1, 1, false);
  push(x + c, y1);
  stair(x + c, y1, -1, -1, true);
  push(x, y + c);
  stair(x, y + c, 1, -1, false);
  // 마지막 계단이 시작점으로 정확히 돌아온다 — 중복 정점을 남기면 스트로크가
  // 그 한 점에서 두 번 겹쳐 모서리 하나만 진하게 찍힌다
  if (pts[pts.length - 2] === pts[0] && pts[pts.length - 1] === pts[1]) {
    pts.length -= 2;
  }
  return pts;
}

/** 알약 반경 — 높이의 절반 (§3-2) */
export function pillRadius(height: number): number {
  return Math.max(0, height) / 2;
}

/**
 * 격자로 접힌 원 / 부채꼴의 외곽선 점 목록.
 *
 * **왜 필요한가**: 스킬 슬롯은 원이어야 한다 — hitArea가 원이고(§C4의 반경
 * 관용), 준비 완료 링·쿨다운 파이가 다 원을 전제한다. 그래서 사각으로 바꾸는
 * 대신 원의 **경계를 격자로 접는다**: 도트 게임이 원을 그리는 방식(계단 원)
 * 그대로다. `circle()`이 만드는 매끈한 곡선만 사라지고 실루엣은 남는다.
 *
 * 각도를 촘촘히 훑어 각 점을 칸에 접고, 같은 칸으로 접힌 연속 점은 버린다 —
 * 남는 것은 칸 단위 계단이다. 중복 정점을 남기면 스트로크가 거기서 두 번
 * 겹쳐 한 점만 진하게 찍힌다(`notchedRectPoints`와 같은 이유).
 *
 * @param a0 시작 각(라디안). 12시 = -π/2
 * @param a1 끝 각. `a1 - a0 >= 2π`면 닫힌 원이다
 * @param step 칸 크기
 */
export function pixelArcPoints(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  step: number = ART_PX,
): number[] {
  const rr = Math.max(0, r);
  const st = Math.max(1, step);
  const sweep = a1 - a0;
  if (rr < st || sweep <= 0) return [];
  // 한 칸을 한 번은 밟도록 표본 수를 반지름에 비례로 잡는다. 부족하면 계단이
  // 아니라 다각형이 되고, 과하면 접힌 뒤 전부 중복이라 버려진다
  const samples = Math.max(
    8,
    Math.ceil((rr / st) * 8 * (sweep / (Math.PI * 2))),
  );
  const pts: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const a = a0 + (sweep * i) / samples;
    orthoPush(
      pts,
      snapTo(cx + Math.cos(a) * rr, st),
      snapTo(cy + Math.sin(a) * rr, st),
    );
  }
  // 닫힌 원이면 마지막 점이 첫 점과 같은 칸으로 접힌다
  const n = pts.length;
  if (n >= 4 && pts[n - 2] === pts[0] && pts[n - 1] === pts[1]) {
    pts.length -= 2;
  }
  return pts;
}

/**
 * 점 하나를 경로에 잇는다 — **대각 선분을 남기지 않는다**.
 *
 * 한 칸짜리 대각 선분도 스트로크·채움 경계에서는 안티에일리어싱된 사선으로
 * 찍혀서, 계단으로 접은 의미가 없어진다. 직전 점과 x·y가 둘 다 다르면 중간에
 * 꺾인 점을 하나 끼운다. 같은 칸으로 접힌 연속 점은 버린다(중복 정점을 남기면
 * 스트로크가 그 한 점에서 두 번 겹쳐 모서리 하나만 진하게 찍힌다).
 */
function orthoPush(pts: number[], x: number, y: number): void {
  const n = pts.length;
  if (n >= 2) {
    const px = pts[n - 2] as number;
    const py = pts[n - 1] as number;
    if (px === x && py === y) return;
    if (px !== x && py !== y) pts.push(px, y);
  }
  pts.push(x, y);
}

/**
 * 격자로 접힌 **띠** — 두꺼운 원호를 선이 아니라 면으로 만든다.
 *
 * **왜 선으로 안 되는가**: 계단 폴리라인을 두껍게 stroke하면 꺾이는 자리마다
 * 이음새 처리가 필요한데, 직각 이음새는 미터로 이으면 바깥으로 뾰족하게 튀고
 * 베벨로 깎으면 한 칸 구멍이 남는다. 카운트다운 링(두께 12px)에서 그 구멍이
 * 눈에 보였다 — 금색 호가 점선처럼 끊겼다.
 *
 * 도트 게임은 두꺼운 링을 이렇게 그린다: 바깥 호와 안쪽 호를 각각 계단으로 접고
 * 그 사이를 채운다. 이음새 개념 자체가 없어지므로 구멍이 생길 여지가 없다.
 *
 * 반환값은 **닫힌 폴리곤** 하나다(바깥 호 → 안쪽 호 역순). 띠가 한 칸보다
 * 얇거나 반지름이 두께보다 작으면 빈 배열이다.
 */
export function pixelBandPoints(
  cx: number,
  cy: number,
  rOuter: number,
  width: number,
  a0: number,
  a1: number,
  step: number = ART_PX,
): number[] {
  const st = Math.max(1, step);
  const w = Math.max(st, Math.round(width / st) * st);
  const ro = Math.max(0, rOuter);
  const ri = ro - w;
  if (ri < st || a1 - a0 <= 0) return [];
  const outer = pixelArcPoints(cx, cy, ro, a0, a1, st);
  const inner = pixelArcPoints(cx, cy, ri, a0, a1, st);
  if (outer.length < 4 || inner.length < 4) return [];
  const pts = [...outer];
  // 안쪽 호는 역순으로 이어 붙인다 — 같은 방향으로 붙이면 8자로 꼬여서
  // 채움이 뒤집힌 삼각형 두 개가 된다.
  //
  // 이음매(바깥 호 끝 → 안쪽 호 끝)도 `orthoPush`를 지난다: 두 호의 끝점은
  // 반지름이 달라 x·y가 둘 다 어긋나므로, 그냥 이으면 띠의 마구리가 대각선
  // 한 줄로 찍힌다 — 열린 호(카운트다운)에서는 그 마구리가 그대로 보인다.
  for (let i = inner.length - 2; i >= 0; i -= 2) {
    orthoPush(pts, inner[i] as number, inner[i + 1] as number);
  }
  return pts;
}

/** 격자로 접힌 원. `circle(cx, cy, r)`의 자리를 대신한다 */
export function pixelCirclePoints(
  cx: number,
  cy: number,
  r: number,
  step: number = ART_PX,
): number[] {
  return pixelArcPoints(cx, cy, r, 0, Math.PI * 2, step);
}

/** 내부 패딩 (§3-4) */
export const PAD_PANEL = 24;

/**
 * 패널 헤더 바 높이 (§C1).
 *
 * `ui/panel.ts`가 아니라 여기 있는 이유: 패널 안에 무엇이 들어가는지를 정하는
 * 쪽(`single/upgradePanelRules.sheetFits`)이 이 값을 알아야 "내용이 패널을
 * 넘는다"를 node 테스트가 잡는다. panel.ts는 Pixi를 부르므로 Rules가 못 읽는다.
 * `panel.ts`는 이걸 re-export만 한다.
 */
export const HEADER_H = 64;
export const PAD_BUTTON_X = 20;
export const PAD_BUTTON_Y = 14;

/** 최소 탭 타깃 (디자인 px, 실기기 ≈48dp) (§3-4) */
export const MIN_TAP = 88;

/**
 * 버튼의 **탭 영역**을 `MIN_TAP`까지 넓히는 관용값 — 그려진 사각형 밖으로
 * 각 방향 이만큼 더 받는다.
 *
 * ## 왜 그림이 아니라 탭 영역인가 (2026-08-07)
 *
 * `MIN_TAP`(88)은 §3-4에 있었지만 **`buttonWidth`의 폭 하한으로만** 쓰였다.
 * `h`를 넘기는 호출은 전부 그 검사 밖이었고, 실제로 여덟 곳이 88 아래였다 —
 * 가장 작은 것이 싱글 HUD의 `타이틀`(132×48)이다. 48px은 실기기에서 약 26dp라
 * 엄지로 누르면 절반은 빗나간다.
 *
 * **높이를 88로 올리는 쪽은 못 쓴다.** 여덟 곳 전부 자기 밴드에 여유가 없다:
 * - HUD 밴드(153.6px)에 타이틀 88 + 간격 8 + 골드 필 52 = 148이고 콤보 캡션이
 *   y 126에 있다 — 필이 캡션을 덮는다.
 * - 강화 줄(96px)에 88을 넣으면 그래버(y 6~14)를 파고들고 아래로 2px 넘친다.
 * - 시트 닫기를 88로 하면 `sheetFits`가 깨진다(696 > 680) — 행 높이를 줄여야
 *   하고 그건 행 안의 88px 강화 버튼을 다시 깎는다.
 * 즉 **크기는 이미 다른 부등식들에 갇혀 있다.** 손가락 문제를 그림 크기로 풀면
 * 그 부등식 중 하나를 깨는 것과 맞바꾸게 된다.
 *
 * 그래서 스킬 슬롯이 이미 쓰는 해법을 사각 버튼에도 준다 —
 * `skillSlotRules.HIT_SLACK_PX`(원 반경 관용)의 사각형 판이다. 보이는 그림은
 * 그대로 두고 받는 영역만 넓힌다: 시각 위계(76 기본 vs 96 주 버튼)는 유지되고
 * 손가락은 88을 얻는다.
 *
 * ## 관용은 빈 자리에만 준다
 *
 * `room`을 받는 이유: 싱글 HUD의 `타이틀`(132×48)은 골드 필 위 8px에 붙어 있고,
 * 관용 20px을 그냥 주면 **필의 위쪽 12px을 누르면 하강이 끝난다.** 잔고 표시를
 * 만졌다가 판이 끝나는 것은 작은 버튼보다 나쁘다 — 작은 버튼은 안 눌리는
 * 것이고 이쪽은 **의도하지 않은 것이 눌리는** 것이다.
 *
 * 그래서 위젯은 관용을 요구하고 **자리를 아는 쪽(`*Rules.ts`)이 한도를 준다.**
 * 배지 자리를 바가 아니라 모드가 정하는 것과 같은 가름이다
 * (`skillBarRules.barLayout` 주석) — 이웃이 무엇인지는 위젯이 알 수 없다.
 *
 * @param size 그려진 변의 길이(px)
 * @param room 그 방향으로 실제로 비어 있는 거리(px). 생략하면 무제한이다
 * @returns 그 변의 한쪽에 더할 관용값. 이미 `MIN_TAP` 이상이면 0
 */
export function tapSlack(size: number, room: number = Number.POSITIVE_INFINITY): number {
  const s = Number.isFinite(size) ? Math.max(0, size) : 0;
  const want = Math.max(0, (MIN_TAP - s) / 2);
  // NaN은 "한도를 모른다"가 아니라 계산이 깨진 것이다 — 0으로 접어
  // 이웃을 침범하지 않는 쪽으로 실패한다
  const cap = Number.isNaN(room) ? 0 : Math.max(0, room);
  return Math.min(want, cap);
}

/**
 * 3단 셰이딩 비율 (§3-3).
 *
 * 상단 12%는 흰색 22%, 하단 18%는 검정 25%를 섞는다. 스펙 수치를 그대로 둔다 —
 * 이 값이 레퍼런스에서 실측한 것이다.
 */
export const SHADE_LIP_RATIO = 0.12;
export const SHADE_LIP_MIX = 0.22;
export const SHADE_BOOT_RATIO = 0.18;
export const SHADE_BOOT_MIX = 0.25;

export interface ShadeBands {
  /** 상단 밝은 립 */
  readonly lip: number;
  /** 본체 */
  readonly base: number;
  /** 하단 어두운 굽 */
  readonly boot: number;
  /** 립 높이(px) */
  readonly lipH: number;
  /** 굽 높이(px) */
  readonly bootH: number;
}

/**
 * 밑색과 높이로 3단 셰이딩 값을 만든다.
 *
 * 높이가 아주 작을 때(HP바 16px) 립·굽이 0.5px가 되면 반올림으로 사라지거나
 * 서로 겹친다. 각 밴드에 최소 1px을 보장하고, 둘의 합이 높이를 넘지 않게 접는다 —
 * 넘치면 본체가 사라져 밑색이 안 보인다.
 */
export function shadeBands(base: number, height: number): ShadeBands {
  const h = Math.max(0, height);
  let lipH = Math.max(1, Math.round(h * SHADE_LIP_RATIO));
  let bootH = Math.max(1, Math.round(h * SHADE_BOOT_RATIO));
  if (lipH + bootH > h) {
    // 본체가 남을 여지가 없으면 비율대로 나눠 갖는다
    const total = lipH + bootH;
    lipH = Math.floor((h * lipH) / total);
    bootH = Math.max(0, h - lipH);
  }
  return {
    lip: lighten(base, SHADE_LIP_MIX),
    base,
    boot: darken(base, SHADE_BOOT_MIX),
    lipH,
    bootH,
  };
}

/**
 * 버튼 최소 폭 — 라벨 폭 + 좌우 패딩 (§C2). 탭 타깃도 함께 만족시킨다.
 */
export function buttonWidth(labelWidth: number): number {
  return Math.max(MIN_TAP, Math.max(0, labelWidth) + PAD_BUTTON_X * 2);
}

/**
 * 폭을 **지정받은** 버튼에서 글자가 쓸 수 있는 폭.
 *
 * **왜 필요했나**: `createButton`이 `opts.w`를 받으면 라벨을 그 폭에 맞추는
 * 코드가 없었다. 강화 줄 4칸(폭 162)에서 `공격 속도 Lv.0`(실측 168px)부터
 * 넘쳐 옆 버튼 위로 흘렀고, 버튼 셋의 글자가 이어 붙어 한 줄로 읽혔다
 * (Lv.100이면 194px = 32px 초과). 라벨을 안 재면 위젯은 넘침을 볼 수 없다 —
 * 폭은 호출자가 알고 글자 폭은 위젯만 아는데, 둘을 맞춰 보는 자리가 없었다.
 *
 * **`PAD_BUTTON_X`(20)를 쓰지 않는다.** 그 값은 `buttonWidth`가 글자 **밖에
 * 더할** 여백이고, 이쪽은 이미 정해진 폭 **안에서 뺄** 여백이라 역할이 다르다.
 * 20을 빼면 예산이 122px가 되어 지금 안 넘치는 `공격력 Lv.0`(134px)까지
 * 축소 하한(0.75)에 걸려 말줄임된다 — 즉 겹침을 고치면서 안 깨진 라벨을
 * 깨뜨린다. 여기서 막으려는 것은 "옆 버튼으로 흐르는 것"이므로 필요한 것은
 * 테두리에 닿지 않을 만큼의 안쪽 여백뿐이다.
 */
export const BUTTON_TEXT_INSET = 8;

export function buttonTextMaxW(w: number): number {
  return Math.max(0, w - BUTTON_TEXT_INSET * 2);
}

/** 버튼 기본 높이 (§C2) */
export const BUTTON_H = 76;

// ── 눌림 모션 (§4)

export const PRESS_SCALE = 0.94;
export const PRESS_IN_MS = 90;
export const PRESS_OUT_MS = 120;

/**
 * 눌림 스케일. `heldDown`이면 눌림값으로 들어가고, 떼면 1로 돌아온다.
 *
 * 두 방향의 시간이 다르므로(90/120ms) 한 함수에 넣어 호출부가 분기하지 않게 한다.
 */
export function pressScale(elapsedMs: number, heldDown: boolean): number {
  if (heldDown) {
    const t = Math.max(0, Math.min(1, elapsedMs / PRESS_IN_MS));
    // easeOutQuad — tween.ts를 import하면 순환이 되므로 여기서 직접 쓴다
    const e = 1 - (1 - t) * (1 - t);
    return 1 + (PRESS_SCALE - 1) * e;
  }
  const t = Math.max(0, Math.min(1, elapsedMs / PRESS_OUT_MS));
  const e = 1 - (1 - t) * (1 - t);
  return PRESS_SCALE + (1 - PRESS_SCALE) * e;
}

/**
 * 못 누르는 버튼을 탭했을 때의 좌우 흔들림 (§C2).
 *
 * 무반응은 버그처럼 느껴진다 — ±5px, 160ms, 감쇠 사인.
 */
export const SHAKE_MS = 160;
export const SHAKE_AMP = 5;

export function shakeOffset(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= SHAKE_MS) return 0;
  const t = elapsedMs / SHAKE_MS;
  return Math.sin(t * Math.PI * 3) * SHAKE_AMP * (1 - t);
}
