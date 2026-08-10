/**
 * 캐릭터 삽화 매니페스트 타입 + 표시 크기 규칙.
 *
 * 원본은 `tools/gen_portraits.py`(SD3.5 Large + 배경 제거 모델)가 굽는다.
 * 주인공 7종 × 5장(카드·선택·승리·패배·무승부) = 35장.
 *
 * **Pixi를 import하지 않는다** — node 테스트가 이 규칙을 그대로 검증한다
 * (`charManifest.ts`·`fxManifest.ts`와 같은 취급).
 *
 * region 좌표를 TS에 복사하지 않는 이유도 배경과 같다: 크기·명도는 그림의
 * 성질이므로 그림과 같은 파일에 있어야 한다. 두 벌이면 생성기에서 고쳐도
 * 화면은 그대로고 아무 테스트도 안 깨진다.
 */

import { CARD_H, DESIGN_H } from "./viewport";

/** `portraits.json`의 경로. PNG는 같은 폴더의 `<slug>_<variant>.png` */
export const PORTRAIT_MANIFEST_URL = "assets/portraits/portraits.json";

/**
 * 다섯 용도. **한 장을 잘라 돌려 쓰지 않는다** — 크기와 구도가 다르다.
 *
 * - `card` — 대기/매칭 슬롯 카드 안. 가슴 위. 90px에 얼굴이 읽혀야 한다
 * - `select` — 캐릭터 선택. 전신. 무기·실루엣으로 직업이 구별돼야 한다
 * - `win` — 결과 화면. 상반신 + 승리 포즈
 * - `lose` — 결과 화면. 팔짱 + 턱 든 표정("졌지만 안 끝났다")
 * - `draw` — 결과 화면. 숨 고르고 자세 다시 잡는 순간
 *
 * **결과가 셋인 이유:** 한 장으로 세 결과를 다 받으면 진 화면에 승리 포즈가
 * 뜬다 — 결과 화면이 결과를 말하지 않는다. `resultRules`의 판정 세 갈래와
 * 1:1로 맞춘다.
 */
export const PORTRAIT_VARIANTS = ["card", "select", "win", "lose", "draw"] as const;
export type PortraitVariant = (typeof PORTRAIT_VARIANTS)[number];

export interface PortraitRegion {
  /** public/ 기준 상대 경로 — Vite base와 무관하게 동작한다 */
  url: string;
  w: number;
  h: number;
  /**
   * 표시 높이 ÷ **기준 높이**(`PORTRAIT_BASE_H`). 생성기가 정하고 런타임이 읽는다.
   *
   * 굽힌 px를 그대로 쓰지 않는 이유: 화면·카드 크기가 바뀌면 그림만 옛 크기로
   * 남는다. 배경 삽화(`BgRegion.ratio`)와 같은 규칙이다.
   */
  ratio: number;
  /**
   * 불투명 텍셀의 **중앙** 명도(0~1). 생성기가 재서 남긴다.
   *
   * **런타임은 안 쓴다 — 테스트가 쓴다.** 캐릭터 시트 쪽과 같은 계수·같은
   * 통계여야 비교가 성립한다(`CharDef.medLum`). 평균이면 머리카락 하이라이트
   * 몇 픽셀이 값을 끌어올려 "괜찮은데?"로 보인다.
   */
  medLum: number;
  /**
   * 완전 투명 텍셀 비율.
   *
   * **0이면 배경 제거가 실패한 것이다** — 인물이 아니라 불투명 사각형이다.
   * 실제로 그렇게 나왔다(마젠타 키잉 시절 세 장 모두 0%). 숫자를 남겨야
   * 테스트가 잡는다.
   */
  alphaRatio: number;
}

/** 슬러그 → variant → region */
export type PortraitManifest = Record<
  string,
  Partial<Record<PortraitVariant, PortraitRegion>>
>;

/**
 * `ratio`의 분모. 용도마다 기준이 다르다 — 카드는 **카드 높이**에 맞추고
 * 선택·결과는 **화면 높이**에 맞춘다. 카드를 화면 기준으로 재면 카드 밖으로
 * 넘친다.
 *
 * `tools/gen_portraits.py`의 `REF_BASE`와 같아야 한다(테스트로 대조). 생성기는
 * 이 기준으로 목표 텍셀 수를 유도하므로, 어긋나면 밀도만 조용히 달라진다.
 */
export const PORTRAIT_BASE_H: Record<PortraitVariant, number> = {
  card: CARD_H,
  select: DESIGN_H,
  win: DESIGN_H,
  lose: DESIGN_H,
  draw: DESIGN_H,
};

/** 표시 높이(디자인 px). 텍스처 px가 아니라 **이 값**이 화면 크기다 */
export function portraitDisplayHeight(
  variant: PortraitVariant,
  ratio: number,
): number {
  const r = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  return PORTRAIT_BASE_H[variant] * r;
}

/**
 * 종횡비를 지킨 표시 크기. **높이를 정하고 폭을 유도한다** — 둘을 다 지시하면
 * 캐릭터마다 폭이 달라서(카드 54~134px) 누군가는 늘어난다.
 */
export function portraitDisplaySize(
  variant: PortraitVariant,
  r: Pick<PortraitRegion, "w" | "h" | "ratio">,
): { w: number; h: number } {
  const h = portraitDisplayHeight(variant, r.ratio);
  const w = r.h > 0 ? (r.w * h) / r.h : 0;
  return { w, h };
}
