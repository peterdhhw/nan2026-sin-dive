/**
 * 로딩(S0)·타이틀(S1)의 **전면 배경** 순수 규칙 — 매니페스트 스키마와 cover 배율.
 *
 * ## 왜 별도 배경인가
 *
 * 두 화면은 여태 공용 필드 무대(`BackgroundStage`)를 그대로 깔고 있었다. 그
 * 무대는 **전투용 무한 스크롤 띠**다: 하늘은 코드가 그린 그라디언트, 그 위에
 * 삽화 3겹이 좌우로 흐르고, 천체(가산 합성 균열)와 지면 프롭이 얹힌다.
 * 정지 화면에서 그것을 보면 흐르는 타일의 이음새와 공중에 뜬 균열·풀포기가
 * 같이 보인다 — 유저의 말이 정확하다: "뭔가 덜 만든거 처럼 느껴져."
 *
 * 그래서 두 화면은 **한 장짜리 키 아트**를 쓴다(`tools/gen_ui_bg.py`가 굽는다).
 * 스크롤도 반전도 없으므로 하늘을 지울 필요가 없고, 이음새도 없다.
 *
 * ## 왜 `bg.json`이 아니라 `ui.json`인가
 *
 * `backgroundRules.test.ts`가 `bg.json`의 최상위 키가 `BG_ATLASES`와 **정확히
 * 같다**고 못박는다(빠진 아틀라스를 조용히 넘기지 않으려는 방어다). 여기에
 * UI 배경을 얹으면 그 검사가 설계대로 깨진다. 두 파일은 소비자도 다르다 —
 * 필드 배경은 아틀라스+region이고 이쪽은 전면 이미지 한 장이다.
 *
 * Pixi를 import하지 않는다 — node 테스트가 이 규칙으로 `ui.json`을 검증한다.
 */

/** `ui.json`의 경로. PNG는 같은 폴더(`assets/bg/`)에 있다 */
export const UI_BG_MANIFEST_URL = "assets/bg/ui.json";

/**
 * 매니페스트가 반드시 가진 키. 화면 이름이다.
 *
 * `BG_ATLASES`와 같은 취급으로 **정확히 이 집합**을 요구한다 — 한 장이 없으면
 * 그 화면만 조용히 옛 배경으로 돌아가는데, 그게 이번에 고치는 결함이다.
 */
export const UI_BG_KEYS = ["boot", "title"] as const;
export type UiBgKey = (typeof UI_BG_KEYS)[number];

export interface UiBgEntry {
  /** public/ 기준 상대 경로 */
  url: string;
  /** 텍스처 크기(px). cover 배율을 여기서 계산한다 */
  w: number;
  h: number;
  /**
   * 그림의 지평선 y ÷ 높이. **타이틀의 캐릭터 프리뷰가 이 선에 발을 붙인다.**
   *
   * TS에 복사하지 않는 이유: 그림을 다시 뽑아 지평선이 옮겨가면 캐릭터가 옛
   * 자리에 뜬다(허공에 서거나 땅에 묻힌다). 생성기가 프롬프트로 요구한 값을
   * 그대로 들고 온다.
   */
  groundRatio: number;
  /** 전체 중앙 명도(0~1). 캐릭터·글자가 배경보다 밝은지 테스트가 대조한다 */
  medLum: number;
  /**
   * 위젯이 앉는 가로 띠(30%~70%)의 중앙 명도.
   *
   * 전체 중앙값만 보면 **가운데가 밝아도 통과한다** — 가장자리가 어두우면
   * 중앙값이 끌려 내려가기 때문이다. 로고·진행 바·버튼이 다 그 띠에 있으므로
   * 거기가 밝으면 글자가 그림에 먹힌다(고치기 전 캡처에서 실제로 그랬다).
   */
  midLum: number;
  /**
   * 바닥 띠(80%~100%)의 중앙 명도.
   *
   * **`midLum`이 이 자리를 못 잰다.** 두 그림 다 아래쪽이 협곡 바닥이라
   * 가장 밝은데(boot 0.247 / title 0.256 — 30~70% 띠의 두 배다) 30~70%
   * 밖이라 그 지표가 침묵했다. 그 사이에 로딩의 팁(84%)·느린 안내(89%)와
   * 타이틀의 요약(93%)이 앉아서, 캡처에서 팁이 밝은 자갈에 먹혔다.
   *
   * 여기를 딤으로 누르는 것은 답이 아니다(전체 딤은 그림도 지운다) — 그래서
   * 바닥에만 스크림을 깔고(`footerScrimBands`), 이 값이 **그 스크림이 충분히
   * 진한가**를 테스트에서 묻는 근거가 된다.
   */
  lowLum: number;
}

export type UiBgManifest = Record<string, UiBgEntry>;

/**
 * 위젯 띠 명도의 상한.
 *
 * 근거: 글자는 `UI_TEXT`(0xf2eefb, 명도 ≈0.94)와 `ACCENT_GOLD`로 찍힌다. 명도
 * 0.34면 대비가 대략 3:1 위에 남는다 — 도트 글자는 획이 얇아 그보다 낮은 대비에서
 * 먼저 읽히지 않는다. 생성기가 뽑은 실측은 boot 0.133 / title 0.255다.
 *
 * **딤을 올려 통과시키는 것은 답이 아니다.** 딤은 그림도 같이 지워서 배경을
 * 새로 뽑은 의미를 없앤다 — 구도를 프롬프트로 비우는 쪽이 옳다(생성기 docstring).
 */
export const UI_BG_MID_LUM_MAX = 0.34;

/**
 * 짧은 축을 채우는 배율(cover). 텍스처를 화면에 꽉 채우되 종횡비를 지킨다.
 *
 * **`Math.max`다** — `min`(contain)이면 위아래나 좌우에 검은 띠가 남고, 그
 * 띠가 정확히 "덜 만든 화면"으로 읽힌다.
 *
 * 9:16 원본(768×1344 → 288×504)과 720×1280 화면은 비가 0.571 대 0.5625이라
 * 배율이 2.540 대 2.500으로 갈린다 — 큰 쪽을 골라 가로를 조금 넘치게 두고
 * 중앙 정렬로 좌우를 균등히 잘라낸다.
 */
export function backdropCover(
  texW: number,
  texH: number,
  screenW: number,
  screenH: number,
): number {
  const tw = Number.isFinite(texW) && texW > 0 ? texW : 1;
  const th = Number.isFinite(texH) && texH > 0 ? texH : 1;
  const sw = Number.isFinite(screenW) && screenW > 0 ? screenW : 0;
  const sh = Number.isFinite(screenH) && screenH > 0 ? screenH : 0;
  return Math.max(sw / tw, sh / th);
}

/**
 * 바닥에 글자가 앉는 줄. **이 목록이 스크림의 치수를 정한다** — 숫자를 손으로
 * 고르면 하필 글자가 있는 줄만 옅게 덮이는 일이 생긴다(실제로 그랬다: 처음에는
 * 0.76에서 선형으로 올렸더니 팁(0.84)이 알파 0.23밖에 못 받아 캡처에서 여전히
 * 밝은 자갈에 먹혔다).
 *
 * - 0.84 로딩의 팁 (`TIP_AFTER_MS` 뒤)
 * - 0.89 로딩의 느린 네트워크 안내
 * - 0.93 타이틀의 모드 요약
 */
export const FOOTER_TEXT_RATIOS = [0.84, 0.89, 0.93] as const;

/** 스크림이 시작되는 비율 — 여기서 알파 0에서 출발한다 */
export const FOOTER_SCRIM_TOP = 0.74;

/**
 * 알파가 최대에 **도달하는** 비율. 첫 글자 줄(0.84)보다 위여야 한다 —
 * 램프 도중에 글자가 앉으면 그 줄만 옅게 덮인다(위 주석의 그 결함).
 */
export const FOOTER_SCRIM_FULL = 0.82;

/**
 * 바닥 스크림의 가장 진한 알파.
 *
 * 근거는 캡처다. 스크림 전 팁 줄(0.84)의 중앙 명도가 0.365였고, 스크림 색은
 * 거의 검으므로(`SCRIM_COLOR` 0x07050e) 덮인 명도는 `0.365 × (1 - a)`다.
 * a=0.70이면 0.11로 내려가 `UI_TEXT_DIM`(≈0.72)과 6:1 위가 남는다.
 * a=0.62로는 0.14였고 캡처에서 아직 자갈이 글자를 갈랐다.
 *
 * **전체 딤을 올리는 것과 다르다** — 글자가 없는 위쪽 3/4는 그대로다.
 */
export const FOOTER_SCRIM_ALPHA = 0.7;

/** `footerScrimBands`가 돌려주는 띠 하나 */
export interface ScrimBand {
  y: number;
  h: number;
  alpha: number;
}

/**
 * 비율 `r`에서의 스크림 알파. `FOOTER_SCRIM_TOP`에서 0, `FOOTER_SCRIM_FULL`부터
 * 아래는 전부 `maxAlpha`다.
 *
 * 층이 아니라 연속 함수로 따로 두는 이유: 테스트가 **글자 줄마다** 알파를 물을
 * 수 있어야 한다. 층 목록으로 물으면 "덮였는가"만 알고 "얼마나"는 못 묻는다 —
 * 그 차이가 이 스크림을 두 번 고치게 만든 것이다.
 */
export function scrimAlphaAt(
  r: number,
  top: number = FOOTER_SCRIM_TOP,
  full: number = FOOTER_SCRIM_FULL,
  maxAlpha: number = FOOTER_SCRIM_ALPHA,
): number {
  if (!Number.isFinite(r) || r <= top) return 0;
  if (r >= full) return maxAlpha;
  const span = full - top;
  return span <= 0 ? maxAlpha : (maxAlpha * (r - top)) / span;
}

/**
 * 한 층의 높이(디자인 px). `ART_PX`(4)의 두 배다 — 도트 격자에 맞아 떨어지고,
 * 램프 100px 즈음을 13층으로 나눠 층당 알파 증가가 0.054가 된다(명도 차이로는
 * 0.015 — 눈에 안 잡히는 크기다).
 */
export const FOOTER_SCRIM_BAND_H = 8;

/**
 * 바닥 스크림을 **여러 겹의 사각형**으로 쪼갠다 — 위로 갈수록 옅어져서 그림과
 * 만나는 경계가 선으로 보이지 않게 한다.
 *
 * 사각형 하나로 두면 그 위쪽 변이 화면을 가로지르는 실선이 되고, 그게 정확히
 * 타이틀에서 지운 "코드가 그린 지면 밴드"와 같은 결함이다. Pixi의 그라디언트
 * 채움을 쓰지 않는 이유는 이 게임의 도트 규칙이다 — 부드러운 보간은 텍셀
 * 격자를 깨서 배경의 도트와 어긋난다.
 *
 * **층은 겹치지 않고 정수 px에 맞춘다.** 처음에는 0.5px씩 겹쳐 경계를 지우려
 * 했는데 정반대였다 — 알파 합성은 곱셈이라 두 번 덮인 줄만 **더 어두워져서**
 * 없애려던 가로줄이 오히려 층 경계마다 생겼다(캡처에서 y=998·1024에 명도가
 * 0.07씩 내려앉았다). 정수 경계로 딱 붙이면 겹침도 빈틈도 없다.
 *
 * 층은 램프 구간(`top`~`full`)만 쪼갠다. 그 아래는 알파가 일정하므로 한 장이다.
 */
export function footerScrimBands(
  screenH: number,
  bandH: number = FOOTER_SCRIM_BAND_H,
  top: number = FOOTER_SCRIM_TOP,
  maxAlpha: number = FOOTER_SCRIM_ALPHA,
  full: number = FOOTER_SCRIM_FULL,
): ScrimBand[] {
  const h = Math.max(1, Math.round(bandH));
  const y0 = Math.round(screenH * top);
  const yFull = Math.max(y0, Math.round(screenH * Math.min(1, full)));
  const n = Math.max(1, Math.ceil((yFull - y0) / h));
  const out: ScrimBand[] = [];
  let y = y0;
  for (let i = 0; i < n; i += 1) {
    // 마지막 층은 램프 끝에 정확히 닿는다 — 넘치면 글자 줄이 램프 안에 들어온다
    const next = Math.min(yFull, y + h);
    out.push({
      y,
      h: next - y,
      // (i+1)/n: 첫 층도 0이 아니다. 0인 층은 아무것도 안 그리는 낭비다
      alpha: (maxAlpha * (i + 1)) / n,
    });
    y = next;
  }
  // 램프 아래는 한 장. 글자 줄은 전부 여기 앉는다
  out.push({ y: yFull, h: Math.max(0, screenH - yFull), alpha: maxAlpha });
  return out;
}

/**
 * 스크림을 덮은 뒤 바닥 명도. 테스트가 "글자가 읽히는가"를 이 값으로 묻는다.
 *
 * 곱셈이다 — 스크림 색은 거의 검고(`SCRIM_COLOR` 0x07050e) 알파 합성은
 * `lum * (1 - a) + scrimLum * a`이므로 `scrimLum ≈ 0`에서 `lum * (1 - a)`다.
 * **틴트로는 밝게 할 수 없다**와 같은 이야기의 뒷면이다.
 */
export function scrimmedLum(lowLum: number, alpha: number = FOOTER_SCRIM_ALPHA): number {
  const l = Number.isFinite(lowLum) ? Math.max(0, lowLum) : 0;
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  return l * (1 - a);
}

/**
 * 스크림을 덮은 바닥의 명도 상한. `UI_TEXT_DIM`(≈0.72)과 6:1 위를 남긴다 —
 * 도트 글자는 획이 얇아 본문 기준(4.5:1)보다 여유가 필요하다.
 */
export const UI_BG_LOW_LUM_SCRIMMED_MAX = 0.12;

/**
 * 매니페스트 한 항목이 쓸 만한가. 못 쓰면 호출자가 그 화면만 배경 없이 간다.
 *
 * **크기가 0이면 못 쓴다** — `backdropCover`가 1로 대체해 배율이 폭발하고
 * 화면 하나를 픽셀 몇 개로 덮는다. 조용히 그러지 않게 여기서 거른다.
 */
export function isUsableUiBg(e: unknown): e is UiBgEntry {
  if (typeof e !== "object" || e === null) return false;
  const r = e as Partial<UiBgEntry>;
  if (typeof r.url !== "string" || r.url.length === 0) return false;
  if (!Number.isFinite(r.w) || (r.w as number) <= 0) return false;
  if (!Number.isFinite(r.h) || (r.h as number) <= 0) return false;
  return true;
}
