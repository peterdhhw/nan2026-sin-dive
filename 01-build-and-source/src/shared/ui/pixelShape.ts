import type { Graphics } from "pixi.js";
import {
  ART_PX,
  RADIUS_CARD,
  notchedRectPoints,
  pixelArcPoints,
  pixelBandPoints,
  pixelCirclePoints,
  snapPx,
} from "./shapeRules";

/** 한 바퀴. `Math.PI * 2`를 세 군데서 반복하지 않는다 */
const TAU = Math.PI * 2;

/**
 * 도트 룩 도형 그리기 — `roundRect`의 자리를 대신한다.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §3을 도트로 옮긴 것.
 *
 * **왜 `roundRect`를 버렸나**: 반경 28px 원호는 어떤 배율에서도 매끈한 곡선으로
 * 렌더된다 — 캐릭터가 4배로 띄운 128px 도트라서, 그 곡선만 해상도가 다른
 * 그림처럼 보인다. "UI/UX 해상도가 너무 높다"의 정체가 이거였다. 모서리를
 * 계단으로 깎으면(chamfer) 같은 실루엣을 유지하면서 도트 격자에 얹힌다.
 *
 * 좌표 계산은 `shapeRules.notchedRectPoints`가 한다(node 테스트가 검증한다).
 * 여기는 Pixi 호출만 담당한다.
 */

/** 채우기·선 옵션 — Pixi의 `FillStyle`을 그대로 받는다 */
export interface PixelFill {
  color: number;
  alpha?: number;
}

export interface PixelStroke {
  color: number;
  width: number;
  alpha?: number;
  /** 1 = 도형 바깥쪽 정렬 (§3-1: 내부 색 면적을 줄이지 않는다) */
  alignment?: number;
}

/**
 * 계단 경로의 이음새 규칙.
 *
 * 이음새는 각지게 둔다(`miter`) — 둥글리면 계단 모서리가 뭉개진다.
 *
 * **`miterLimit`은 1이면 안 된다.** 그 값은 "미터 길이가 선 두께를 넘으면
 * 베벨로 떨어뜨려라"는 뜻인데, 계단 경로의 이음새는 전부 정확히 90°이고 직각
 * 미터의 길이 비는 √2다. 즉 **모든** 이음새가 베벨로 깎여서 꺾이는 자리마다
 * 바깥쪽에 한 칸 구멍이 생겼다 — 카운트다운 링의 금색 호가 점선처럼 끊겨
 * 보였다(스크린샷에서 확인). √2보다 조금 크게 잡아 직각은 미터로 잇고,
 * 그보다 뾰족한 각(있으면 스파이크가 된다)만 베벨로 떨어뜨린다.
 */
const PIXEL_JOIN = { join: "miter", miterLimit: 1.5 } as const;

/**
 * 계단 깎인 사각형 경로를 `g`에 얹는다. 좌표·크기를 아트 픽셀 격자로 접는다.
 *
 * 격자로 접는 이유: 720×1280 디자인 좌표가 실기기 폭에 맞춰 소수 배율로
 * 스케일되므로(`app.ts`), 도형이 격자에서 반 칸 어긋나 있으면 같은 두께의
 * 선이 화면 위/아래에서 1칸과 2칸으로 갈라져 찍힌다.
 */
export function pixelRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number = RADIUS_CARD,
): Graphics {
  return g.poly(
    notchedRectPoints(snapPx(x), snapPx(y), snapPx(w), snapPx(h), cut),
  );
}

/**
 * 계단 사각형을 채운다. `roundRect(...).fill(...)` 한 줄을 대체한다.
 */
export function fillPixelRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
  fill: PixelFill,
): Graphics {
  return pixelRect(g, x, y, w, h, cut).fill(fill);
}

/**
 * 계단 사각형에 외곽선을 두른다.
 *
 * 선 두께도 격자로 접는다 — 3px 선은 도트 격자에서 1칸과 2칸 사이를 오간다.
 */
export function strokePixelRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
  stroke: PixelStroke,
): Graphics {
  return pixelRect(g, x, y, w, h, cut).stroke({
    ...stroke,
    width: Math.max(1, snapPx(stroke.width)),
    ...PIXEL_JOIN,
  });
}

/**
 * 격자로 접힌 원 경로. `circle(cx, cy, r)`의 자리를 대신한다.
 *
 * 반지름이 한 칸보다 작으면 계단을 만들 수 없다 — 그 크기에서 도트로 옳은
 * 그림은 한 칸 사각이므로 그렇게 그린다(빈 경로를 넘기면 아무것도 안 찍힌다).
 */
export function pixelCircle(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
): Graphics {
  const pts = pixelCirclePoints(snapPx(cx), snapPx(cy), r);
  if (pts.length < 6) {
    return g.rect(
      snapPx(cx) - ART_PX / 2,
      snapPx(cy) - ART_PX / 2,
      ART_PX,
      ART_PX,
    );
  }
  return g.poly(pts);
}

export function fillPixelCircle(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  fill: PixelFill,
): Graphics {
  return pixelCircle(g, cx, cy, r).fill(fill);
}

/**
 * 격자로 접힌 원의 테두리.
 *
 * 두께가 두 칸을 넘으면 `strokePixelArc`와 같은 이유로 **띠를 채운다** —
 * 계단 폴리라인의 직각 이음새는 미터로 이으면 튀고 베벨로 깎으면 구멍이 남는다.
 * 한두 칸짜리 얇은 테두리는 이음새가 두께보다 크지 않아 티가 안 나므로 그냥
 * stroke한다(경로 하나가 정점 수도 절반이다).
 *
 * `alignment`는 얇은 경로에서만 의미가 있다 — 띠는 반지름에서 안쪽으로 자란다.
 */
export function strokePixelCircle(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  stroke: PixelStroke,
): Graphics {
  const w = Math.max(1, snapPx(stroke.width));
  if (w > ART_PX * 2) {
    const pts = pixelBandPoints(snapPx(cx), snapPx(cy), r + w / 2, w, 0, TAU);
    if (pts.length >= 6) {
      return g
        .poly(pts)
        .fill({ color: stroke.color, alpha: stroke.alpha ?? 1 });
    }
  }
  return pixelCircle(g, cx, cy, r).stroke({
    ...stroke,
    width: w,
    ...PIXEL_JOIN,
  });
}

/**
 * 계단 호를 그린다 — 카운트다운 링처럼 **채우지 않는** 원호용.
 *
 * **선이 아니라 띠를 채운다.** 계단 폴리라인을 두껍게 stroke하면 꺾이는 자리의
 * 이음새를 어떻게 처리해도 어색해진다(미터는 바깥으로 튀고, 베벨은 한 칸
 * 구멍을 남긴다 — 링 두께 12px에서 금색 호가 점선처럼 끊겨 보였다). 바깥
 * 호와 안쪽 호 사이를 면으로 채우면 이음새가 아예 없다.
 *
 * `stroke.width`가 띠의 두께이므로 시그니처는 그대로 둔다 — 호출부는 여전히
 * "반지름 r에 두께 w의 호"로 생각한다. `alignment`는 무시된다(면이라 안팎이
 * 없다): 두께는 항상 반지름에서 **안쪽으로** 자란다.
 */
export function strokePixelArc(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  stroke: PixelStroke,
): void {
  const w = Math.max(ART_PX, snapPx(stroke.width));
  const pts = pixelBandPoints(snapPx(cx), snapPx(cy), r + w / 2, w, a0, a1);
  if (pts.length < 6) return;
  g.poly(pts).fill({ color: stroke.color, alpha: stroke.alpha ?? 1 });
}

/**
 * 12시부터 시계방향으로 도는 계단 부채꼴 — 쿨다운 파이 (§C4)용.
 *
 * `arc()`로 그리면 남은 시간의 경계가 매끈한 곡선이라, 슬롯 안에서 그 선만
 * 다른 해상도로 보인다. 각도 자체는 접지 않는다 — 접으면 남은 초가 칸 단위로
 * 튀어서 "줄어들고 있다"가 안 읽힌다. 접는 것은 **호의 좌표**뿐이다.
 *
 * @param sweep 0..1. 0이면 아무것도 그리지 않는다
 */
export function fillPixelPie(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  sweep: number,
  fill: PixelFill,
): void {
  const t = Math.max(0, Math.min(1, sweep));
  if (t <= 0 || r < ART_PX) return;
  const a0 = -Math.PI / 2;
  const pts = pixelArcPoints(
    snapPx(cx),
    snapPx(cy),
    r,
    a0,
    a0 + t * Math.PI * 2,
  );
  if (pts.length < 4) return;
  // 중심 → 호 → 중심. 부채꼴이므로 중심점을 앞에 넣는다
  g.poly([snapPx(cx), snapPx(cy), ...pts]).fill(fill);
}

/**
 * 바닥 그림자 — **타원이 아니라 계단 블록**이다.
 *
 * `ellipse`는 매끈한 곡선이라 도트 캐릭터 밑에서 유일하게 흐린 요소가 된다.
 * 가로로 긴 블록 3단으로 쌓으면 같은 "둥근 그림자" 인상을 도트로 만든다.
 *
 * @param w 그림자 전체 폭
 * @param h 그림자 전체 높이
 */
export function drawPixelShadow(
  g: Graphics,
  w: number,
  h: number,
  color: number,
  alpha: number,
): void {
  const step = Math.max(1, snapPx(h / 3));
  // 3단: 가운데가 가장 넓고 위아래로 한 칸씩 좁아진다
  const bands: readonly [number, number][] = [
    [0.7, -step],
    [1, 0],
    [0.7, step],
  ];
  for (const [wr, dy] of bands) {
    const bw = snapPx(w * wr);
    if (bw <= 0) continue;
    g.rect(-bw / 2, dy - step / 2, bw, step).fill({ color, alpha });
  }
}
