/**
 * 근접 임팩트 연출 — 캐릭터별로 무엇이 터지는지.
 *
 * **왜 갈라야 하나**: 넷 다 같은 `impact` 별이 터지면 접근 곡선과 클립을
 * 갈라 놓은 것이 화면에서 지워진다. 타격의 종류(그었나 / 찍었나)가 곧
 * 캐릭터의 인상이다.
 *
 * Pixi를 import하지 않는다 — `battleField`가 매 임팩트에 부르는 규칙이므로
 * node 테스트가 그대로 검증해야 한다. (`fxMapping.ts`와 같은 이유다.)
 */
import type { ApproachKind, AttackClip } from "./meleeRules";
import type { HeroSlug } from "./charManifest";
// 값으로 가져온다 — `fxManifest`는 pixi를 import하지 않아 node 테스트에서 안전하다
import { FX_SHEETS } from "./fxManifest";
// `battleFieldRules`도 pixi를 import하지 않는다 — 캐릭터 표시 크기가 여기 있다
import { FX_COVER_RATIO, allyDisplayPx } from "./battleFieldRules";

export type FxSheetName = keyof typeof FX_SHEETS;

/** 시트별 프레임 폭. 목표 px → 배율 변환에 쓴다 */
const FX_FRAME_W: Record<FxSheetName, number> = {
  missile: FX_SHEETS.missile.frameW,
  impact: FX_SHEETS.impact.frameW,
  aura: FX_SHEETS.aura.frameW,
  slash: FX_SHEETS.slash.frameW,
  spark: FX_SHEETS.spark.frameW,
  dust: FX_SHEETS.dust.frameW,
};

export interface MeleeFxSpec {
  /** 타격 순간 적 몸에 터지는 시트 */
  sheet: FxSheetName;
  /** 기준 배율. 시트 크기가 달라서(96 vs 64) 여기서 화면 크기를 맞춘다 */
  scale: number;
  /**
   * 히트 지점을 아군 기준 앞으로 얼마나 밀지 — 필드 폭 대비 비율.
   * 사거리가 긴 캐릭터는 더 앞에서 터져야 무기 끝과 맞는다.
   */
  offsetRatio: number;
  /** 궤적을 기울인다(rad). 베기만 의미가 있다 — 점 폭발은 회전이 안 보인다 */
  rotation: number;
}

/**
 * 화면에 나올 목표 크기 — **캐릭터 키 대비 비율**이다.
 *
 * 예전에는 px 상수(48/66)였다. 그 숫자는 아군이 231px일 때 정한 것이라,
 * 캐릭터를 줄이자(0.55 → 0.40) 이펙트가 상대적으로 **더 커져** 캐릭터를
 * 덮었다 — 상수는 크기가 바뀌면 조용히 의미가 달라진다. 비율로 적으면
 * `ALLY_H_RATIO`를 다시 만지더라도 화면의 관계가 유지된다.
 *
 * 배율(`sprite.scale`)로 적지 않는 이유는 그대로다: 시트가 96과 64로 달라서
 * 같은 배율이 같은 크기가 아니다.
 */
const HIT_RATIO = { normal: 0.42, special: 0.58 } as const;

/**
 * 캐릭터 키 대비 비율 → 목표 px. 상한을 여기서 물린다.
 *
 * **`fieldH`는 선택형이 아니다 (2026-08-07).** 예전에는 `allyDisplayPx()`를
 * 인자 없이 불렀고, 그 기본값이 `REF_FIELD_H`(512)라서 **필드 높이가 얼마든
 * 이펙트는 512 기준으로 계산됐다.** PvP 필드가 정확히 512라 거기서는 맞았고,
 * 싱글 필드는 800이라(HUD 아래 ~ 강화 줄 위) 캐릭터는 272px인데 이펙트는
 * 512×0.34×0.42 = 73px — 키의 **27%**였다. 의도한 42%가 아니다. 비율로 적어
 * 근거를 살렸는데 그 비율을 잘못된 키에 곱하고 있었던 것이다.
 *
 * 기본값을 주면 안 되는 이유가 바로 그것이다: 안 넘기면 조용히 기준 필드로
 * 떨어지고, 화면에는 "이펙트가 좀 작네"로만 보인다. 필수 인자로 두면 새 호출자가
 * 컴파일에서 걸린다.
 */
function ratioToPx(ratio: number, fieldH: number): number {
  return allyDisplayPx(fieldH) * Math.min(ratio, FX_COVER_RATIO);
}

/**
 * **무기가 궤적을 그리는** 캐릭터 — 타격이 `slash`로 터진다.
 *
 * 값의 근거는 코드가 아니라 **캡처다.** 일곱을 한 장씩 공격 프레임으로 찍어서
 * 무기가 호를 그리는지 한 점에서 터지는지 보고 갈랐다 — 무기 이름으로 정하면
 * 안 된다(`crystal_mauler`는 망치인데 시트에 파란 호가 그려져 있고,
 * `leaf_ranger`는 활이라 팔은 안 휘두른다).
 *
 * 호를 그리는 넷: fire_knight(대검), metal_bladekeeper(쌍검),
 * wind_hashashin(곡도), crystal_mauler(대형 망치 — 시트에 호가 있다).
 *
 * 한 점에서 터지는 셋: ground_monk(맨손 + 흰 에너지 폭발),
 * water_priestess(긴 지팡이 — 물이 앞에서 솟는다), leaf_ranger(활 — 화살이 나간다).
 *
 * `Set<HeroSlug>`이 아니라 **7종 전부의 표**로 적는다. 집합이면 새 캐릭터를
 * 넣을 때 아무 곳도 안 고쳐도 컴파일이 통과하고, 조용히 `spark` 쪽으로 떨어져서
 * "왜 이 캐릭터만 타격이 밋밋하지"를 화면에서 찾아야 한다.
 */
const BLADED: Readonly<Record<HeroSlug, boolean>> = {
  water_priestess: false,
  leaf_ranger: false,
  metal_bladekeeper: true,
  wind_hashashin: true,
  fire_knight: true,
  crystal_mauler: true,
  ground_monk: false,
};

export function meleeFx(
  slug: string,
  clip: AttackClip,
  approach: ApproachKind,
  /** 필드 높이(px, 디자인 좌표). 모드마다 다르다 — `ratioToPx` 주석 참고 */
  fieldH: number,
): MeleeFxSpec {
  // 모르는 슬러그(잡몹·보스)는 점 폭발이다 — 호를 그릴 무기가 있는지 모른다
  const bladed = BLADED[slug as HeroSlug] === true;
  const wantPx = ratioToPx(
    clip === "special" ? HIT_RATIO.special : HIT_RATIO.normal,
    fieldH,
  );
  const sheet: FxSheetName = bladed ? "slash" : "spark";
  return {
    sheet,
    // 시트 크기로 나눠 목표 px를 만든다 — 시트를 다시 그려 크기가 바뀌어도
    // 화면 크기는 그대로 남는다
    scale: wantPx / FX_FRAME_W[sheet],
    // 검은 팔을 뻗어 베므로 더 앞에서 터진다
    offsetRatio: bladed ? 0.05 : 0.04,
    // 점에서 터지는 쪽은 회전이 무의미하다 — 0으로 고정해 프레임마다 안 흔들리게 한다
    rotation: bladed ? SLASH_TILT[approach] : 0,
  };
}

/**
 * 접근 동작별 궤적 기울기(rad).
 *
 * 굴러 들어온 쪽은 아래에서 위로 올려 베는 것으로 읽힌다(음수). 걷는 쪽은
 * 제자리에 서서 휘두르므로 뛰어든 것보다 눕는다 — `run` 값을 그대로 주면
 * 접근 클립만 다르고 타격은 똑같아서 걷는 것이 화면에 남지 않는다.
 */
const SLASH_TILT: Readonly<Record<ApproachKind, number>> = {
  run: 0.25,
  roll: -0.5,
  walk: 0.12,
};

/**
 * 돌진이 시작될 때 발밑에 깔 먼지 — 캐릭터 키 대비 비율.
 *
 * 굴르기는 몸 전체가 지면을 긁으므로 크게, 달리기는 발만 미므로 작게 깐다.
 * 이것이 없으면 짧은 접근(metal_bladekeeper 200ms)이 순간이동으로 읽힌다.
 *
 * **걷기는 가장 작다.** 걷는 캐릭터(water_priestess)는 접근이 340ms로 가장
 * 느려서 순간이동으로 보일 위험이 없다 — 여기에 달리기와 같은 먼지를 깔면
 * 천천히 걸어가면서 발밑이 폭발하는 그림이 된다.
 */
const DUST_RATIO: Readonly<Record<ApproachKind, number>> = {
  run: 0.36,
  roll: 0.5,
  walk: 0.22,
};

export function dashDustFx(
  approach: ApproachKind,
  /** 필드 높이(px, 디자인 좌표) — `ratioToPx` 주석 참고 */
  fieldH: number,
): {
  sheet: FxSheetName;
  scale: number;
} {
  const wantPx = ratioToPx(DUST_RATIO[approach], fieldH);
  return { sheet: "dust", scale: wantPx / FX_FRAME_W.dust };
}
