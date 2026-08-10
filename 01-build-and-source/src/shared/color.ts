/**
 * 색 산술 — 보간·명암 조절.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §3-3 (3단 셰이딩)
 *
 * **왜 별도 모듈인가**: 3단 셰이딩은 모든 위젯이 쓰는 규칙이고(§3-3), 배경
 * 크로스페이드도 같은 보간을 쓴다. 두 곳에 같은 비트 연산을 두면 한쪽만
 * 고쳐져서 UI와 배경의 명암 규칙이 갈라진다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

/** 0..1 → 두 색 사이 선형 보간 (채널별 독립) */
export function mixColor(a: number, b: number, t: number): number {
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const ch = (shift: number): number => {
    const av = (a >> shift) & 0xff;
    const bv = (b >> shift) & 0xff;
    return Math.round(av + (bv - av) * k) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 흰색을 섞는다 (밝은 립) */
export function lighten(color: number, amount: number): number {
  return mixColor(color, 0xffffff, amount);
}

/** 검정을 섞는다 (어두운 굽) */
export function darken(color: number, amount: number): number {
  return mixColor(color, 0x000000, amount);
}

/**
 * 상대 휘도 0..1 (WCAG 근사가 아니라 지각 가중 평균).
 *
 * 어두운 테마에서 패널을 밝힐지(§1-4), 텍스트를 흰색으로 둘지 판단한다.
 * 눈대중으로 "이 색은 어두우니까"를 코드에 흩뿌리면 테마를 늘릴 때 전부 다시 봐야 한다.
 */
export function luminance(color: number): number {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 채도 **배율**(1 = 그대로, 0 = 흑백) → Pixi `ColorMatrixFilter.saturate()`의 인자.
 *
 * **Pixi의 `saturate(amount)`는 배율이 아니라 증감분이다** (0 = 그대로,
 * −1 = 흑백, +1 = 두 배). 배율을 그대로 넘기면 "채도 −20%"가 오히려 채도를
 * 올린다 — 스크린샷 픽셀값에서 확인했다. 우리 규칙 모듈들은 전부 배율로
 * 이야기하므로(§08-1 `fieldSaturate`, §9 `slowSaturate`) 변환을 한 곳에 둔다.
 */
export function saturateDelta(mult: number): number {
  const m = Number.isFinite(mult) ? Math.max(0, mult) : 1;
  return m - 1;
}

/** 이 바탕색 위에서 읽히는 텍스트 색 */
export function readableText(
  bg: number,
  onDark: number,
  onLight: number,
): number {
  return luminance(bg) < 0.55 ? onDark : onLight;
}
