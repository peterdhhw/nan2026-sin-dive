/**
 * 팔레트·타이포 토큰과 웨이브 테마.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §1·§2
 *
 * 색상값은 레퍼런스 프레임에서 실측 추출한 것이다(§1-1) — 눈대중으로 고치지 말 것.
 * Pixi를 import하지 않으므로 node 테스트에서 그대로 로드된다.
 */

import { mixColor } from "./color";

// ── 필드: 지상 테마 (웨이브 1~2) — 레퍼런스와 동일 계열
export const FIELD_SKY_TOP = 0x8fd6c8;
export const FIELD_SKY_BOTTOM = 0x78c0b8;
export const FIELD_GROUND = 0x688850;
export const FIELD_GROUND_LIP = 0x7a9c5e;
export const FIELD_SOIL = 0x4a5c3a;
export const FIELD_GRASS_TUFT = 0xa8b878;

// ── UI 셸
export const UI_PANEL = 0x404058;
/** `abyss` 테마용 밝은 패널. 필드가 어두워지면 UI를 밝힌다 (§1-4) */
export const UI_PANEL_LIT = 0x5a5478;
export const UI_PANEL_EDGE = 0x505070;
export const UI_CARD = 0x787098;
export const UI_CARD_HI = 0x9088b8;
/** 모든 요소의 어두운 아웃라인. 레퍼런스 룩의 핵심 */
export const UI_OUTLINE = 0x211c2e;
/** 어두운 테마에서 패널 안쪽에 1px 덧대는 밝은 림 (§1-4) */
export const UI_INNER_RIM = 0xf0ecff;
export const UI_TEXT = 0xffffff;
export const UI_TEXT_DIM = 0xc9c2e0;
export const UI_TEXT_ON_CREAM = 0x3a2c1e;
/** 결과·보상 팝업 몸통 (레퍼런스 frame_12) */
export const UI_PANEL_CREAM = 0xd0b078;
export const UI_HEADER_PURPLE = 0x8030c0;

// ── 상태색 (레퍼런스 색코드 그대로)
export const STATE_OK = 0x30a858;
export const STATE_OFF = 0x505058;
export const STATE_AD = 0xb07028;
export const STATE_CONFIRM = 0x2878d0;
export const STATE_CLOSE = 0xd8486a;
export const STATE_ALERT = 0xf83840;

// ── 액센트
export const ACCENT_GOLD = 0xffc94a;
export const ACCENT_GOLD_DEEP = 0xd89a1e;
export const ACCENT_MAGENTA = 0xa850e8;

// ── 진영색 (우리 고유 — 줄다리기 식별)
export const TEAM_OURS = 0x7b6ad8;
export const TEAM_OURS_HI = 0xa899f0;
export const TEAM_THEIRS = 0xd8486a;
export const TEAM_THEIRS_HI = 0xf07a92;

// ── 스크림
export const SCRIM_COLOR = 0x07050e;
export const SCRIM_ALPHA = 0.72;

/**
 * 웨이브 배경 테마.
 *
 * 2종만 만든다 (§1-3 결정 기록). 120초 대전에서 웨이브는 3~4까지만 도달하므로
 * 4·5번째 테마는 대부분의 판에서 아무도 보지 못한다.
 * 확장은 이 테이블에 항목을 추가하고 `tools/gen_bg_art.py`에 그 테마의 삽화
 * 3겹(far/mid/near)을 넣으면 된다 — `id`가 아틀라스 이름이 된다.
 *
 * **실루엣 색 3겹이 있었다.** 단색 실루엣을 런타임 `tint`로 물들여 텍스처 한 장을
 * 두 테마에 돌려 썼는데, 그러니 지상과 심연이 "같은 나무의 색만 다른 것"이 됐다.
 * 지금은 테마마다 그린 삽화를 쓰므로 색이 그림에 있다. 깊이감(대기 원근)은 색이
 * 아니라 `SCENERY_LAYERS[i].alpha`가 하늘색을 배어 나오게 해서 만든다 — 그림의
 * 명도 순서에 의존하지 않으므로 밝은 원경(지상)과 밝은 근경(심연)이 다 성립한다.
 */
export interface WaveTheme {
  readonly id: "surface" | "abyss";
  readonly skyTop: number;
  readonly skyBottom: number;
  readonly ground: number;
  readonly groundLip: number;
  readonly soil: number;
  readonly prop: number;
  /**
   * 캐릭터에 곱하는 환경광. 어두운 배경에서 캐릭터가 죽지 않게 한다 (§1-3).
   *
   * **거의 흰색이어야 한다.** `tint`는 곱셈이라 밝힐 수 없다 — 환경광 명도가
   * 곧 캐릭터 감광률이다. 심연 값이 `0xb8a8e0`(명도 0.69)이었는데, 그러면
   * 캐릭터가 31% 어두워지고 적은 깊이 감광(×0.72)까지 겹친다. 삽화 배경으로
   * 갈면서 배경이 밝아지자 캐릭터(명도 0.16)가 **배경(0.25)보다 어두워져서**
   * 구멍처럼 보였다 — 환경광이 자기 목적의 반대로 작동한 것이다.
   *
   * 색조는 남긴다(보라 쪽). 그게 "같은 캐릭터가 다른 층에 있다"를 만든다.
   * 감광은 8% 이하로 둘 것 — 이 값을 어둡게 하고 싶으면 그건 환경광이 아니라
   * 연출이므로 다른 손잡이를 만들어야 한다.
   */
  readonly ambient: number;
  /** 이 테마에서 쓰는 패널 바탕 (§1-4 명도 반전 규칙) */
  readonly uiPanel: number;
  /** 패널 안쪽 밝은 림을 그리는지. 어두운 테마에서만 필요하다 */
  readonly uiInnerRim: boolean;
}

export const THEME_SURFACE: WaveTheme = {
  id: "surface",
  skyTop: FIELD_SKY_TOP,
  skyBottom: FIELD_SKY_BOTTOM,
  ground: FIELD_GROUND,
  groundLip: FIELD_GROUND_LIP,
  soil: FIELD_SOIL,
  prop: FIELD_GRASS_TUFT,
  ambient: 0xffffff,
  uiPanel: UI_PANEL,
  uiInnerRim: false,
};

export const THEME_ABYSS: WaveTheme = {
  id: "abyss",
  skyTop: 0x231c38,
  skyBottom: 0x0f0a1c,
  ground: 0x2a2038,
  groundLip: 0x3d2f52,
  soil: 0x1c1428,
  prop: 0x8a6ad0,
  // 감광 8%, 보라 색조는 유지 (위 주석 — 0xb8a8e0은 31%였다)
  ambient: 0xeee6ff,
  uiPanel: UI_PANEL_LIT,
  uiInnerRim: true,
};

/** 웨이브 인덱스 → 테마. 확장 시 이 배열만 늘린다 */
export const WAVE_THEMES: readonly WaveTheme[] = [THEME_SURFACE, THEME_ABYSS];

/** 테마가 바뀔 때 크로스페이드 시간. 배경·패널색·환경광이 같이 움직인다 (§1-3) */
export const THEME_FADE_MS = 600;

/**
 * 하강 깊이 0..1 — 배경이 지상에서 심연으로 내려가는 진행도.
 *
 * **웨이브 번호로 정하지 않는다 (결정 기록).** 예전에는 `themeForWave(n)`이
 * 웨이브 3부터 심연으로 클램프했다. 그런데 실측하면 웨이브 1~5가 **0.3초
 * 안에** 다 녹는다(쿨다운 4개가 판 시작에 동시에 준비된다) — 그래서 배경이
 * 0.2초에 심연으로 바뀌고 남은 80초를 **한 장으로 고정**돼 있었다. 웨이브는
 * 초반에 너무 빠르고 후반에 너무 느려서 하강의 시간축이 될 수 없다.
 *
 * 실측 근거: 시드 3·7·42에서 판은 81~84초에 끝나고 웨이브 24~25에 닿는다.
 * `DESCENT_FULL_MS`를 90초로 두면 판이 끝날 때 깊이 0.9 부근이다 — **끝까지
 * 계속 내려가고 있다.** 60초로 두면 마지막 20초가 다시 고정된다.
 */
export const DESCENT_FULL_MS = 90_000;

/**
 * 삽화(아틀라스)가 갈리는 깊이. 색은 연속이지만 그림은 한 번에 바뀐다 —
 * 테마별로 구운 삽화가 두 벌뿐이기 때문이다(`BG_ATLASES`).
 *
 * 절반에 두면 **바뀌는 순간의 팔레트가 양쪽에서 같다**(둘 다 mix 0.5)
 * — 하늘색은 그대로 흐르고 그림만 600ms 크로스페이드로 갈린다.
 */
export const DESCENT_SWAP_AT = 0.5;

/**
 * 경과 시간 → 하강 깊이 0..1.
 *
 * @param floorDepth 여기부터 시작한다 (디버그 진입 `?wave=`용, `debugDepthFloor`)
 */
export function descentDepth(elapsedMs: number, floorDepth = 0): number {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const floor = Number.isFinite(floorDepth)
    ? Math.max(0, Math.min(1, floorDepth))
    : 0;
  const d = Math.min(1, t / DESCENT_FULL_MS);
  // 바닥값과 시간값 중 깊은 쪽 — 디버그로 심연에서 시작해도 계속 내려간다
  return Math.max(floor, d);
}

/**
 * `?wave=` 디버그 진입이 요구하는 시작 깊이.
 *
 * 웨이브 3의 심연 테마를 스크린샷으로 검증하는 경로다(설계 문서 09-3). 하강이
 * 시간축으로 옮겨간 뒤에도 그 파라미터가 계속 심연을 보여줘야 한다 — 안 그러면
 * 검증 진입점이 조용히 죽는다.
 */
export function debugDepthFloor(waveNumber: number | null): number {
  if (waveNumber === null || !Number.isFinite(waveNumber)) return 0;
  // 3 이상 = 심연. 예전 `themeForWave`의 경계를 그대로 옮겼다
  return waveNumber >= 3 ? DESCENT_SWAP_AT : 0;
}

/**
 * 깊이 → 그 지점의 테마.
 *
 * **색은 연속이고 그림은 단계다.** 하늘·지면·환경광·패널색은 두 테마 사이를
 * 선형 보간해서 매 프레임 조금씩 내려가고, `id`(=삽화 아틀라스)는
 * `DESCENT_SWAP_AT`에서 한 번 갈린다. 그래서 "계속 내려가는 중"이 화면에
 * 남으면서도 삽화는 두 벌로 끝난다.
 */
export function themeAtDepth(depth: number): WaveTheme {
  const d = Number.isFinite(depth) ? Math.max(0, Math.min(1, depth)) : 0;
  // 경계에서 반올림 오차로 색이 튀지 않게, 끝값은 원본 객체를 그대로 준다 —
  // 첫 배치(0)와 최심부(1)는 §1-2 실측값 그대로여야 한다
  if (d <= 0) return THEME_SURFACE;
  if (d >= 1) return THEME_ABYSS;
  const mix = (pick: (t: WaveTheme) => number): number =>
    mixColor(pick(THEME_SURFACE), pick(THEME_ABYSS), d);
  return {
    id: d < DESCENT_SWAP_AT ? "surface" : "abyss",
    skyTop: mix((t) => t.skyTop),
    skyBottom: mix((t) => t.skyBottom),
    ground: mix((t) => t.ground),
    groundLip: mix((t) => t.groundLip),
    soil: mix((t) => t.soil),
    prop: mix((t) => t.prop),
    ambient: mix((t) => t.ambient),
    uiPanel: mix((t) => t.uiPanel),
    // 림은 켜지거나 꺼진다 — 삽화와 같은 경계에서 같이 넘어간다
    uiInnerRim: d >= DESCENT_SWAP_AT,
  };
}

/**
 * 같은 그림·같은 색인가. 깊이는 매 프레임 조금씩 오르므로 호출자가 이걸로
 * 걸러야 하늘을 매 프레임 다시 칠하지 않는다.
 */
export function sameTheme(a: WaveTheme, b: WaveTheme): boolean {
  return (
    a.id === b.id &&
    a.skyTop === b.skyTop &&
    a.skyBottom === b.skyBottom &&
    a.ground === b.ground &&
    a.groundLip === b.groundLip &&
    a.soil === b.soil &&
    a.prop === b.prop &&
    a.ambient === b.ambient &&
    a.uiPanel === b.uiPanel &&
    a.uiInnerRim === b.uiInnerRim
  );
}

// ── 타이포 스케일 (720×1280 디자인 좌표, §2)

/**
 * 도트 폰트는 **굵기가 두 벌뿐이다**(400/700). 600·800을 지정하면 브라우저가
 * 합성 볼드를 만드는데, 그러면 획이 반 픽셀씩 번져서 도트가 아니게 된다 —
 * 도트 폰트를 실은 이유가 사라진다. 그래서 굵기를 두 개로 줄였다.
 */
export type FontWeight = 400 | 700;

export interface TypeToken {
  readonly size: number;
  readonly weight: FontWeight;
}

/**
 * 크기는 전부 `FONT_PX_GRID`(12px)의 배수다 — 그래야 글리프가 도트로 떨어진다.
 *
 * **9단계였던 스케일이 4개 크기로 접혔다.** 12px 격자에서는 34px·30px·26px 같은
 * 중간값을 만들 수 없고, 억지로 24와 36으로 갈라 놓으면 위계가 과장된다.
 * 대신 작은 단계는 **굵기로** 구분한다(라벨=굵게, 캡션=보통) — 도트 UI가
 * 원래 그렇게 위계를 만든다. 크기가 같아도 굵기가 다르면 층이 읽힌다.
 *
 * 24px가 최소다: 12px는 720 폭 화면에서 한글이 뭉개져 안 읽힌다(도트 폰트는
 * 한글 한 글자에 11×11 도트를 쓴다).
 */
export const T_LOGO: TypeToken = { size: 72, weight: 700 };
export const T_HEADLINE: TypeToken = { size: 48, weight: 700 };
export const T_TITLE: TypeToken = { size: 36, weight: 700 };
export const T_NUM_L: TypeToken = { size: 36, weight: 700 };
export const T_BODY: TypeToken = { size: 24, weight: 700 };
export const T_LABEL: TypeToken = { size: 24, weight: 700 };
/** 캡션만 보통 굵기다 — 라벨과 크기가 같으므로 굵기가 유일한 구분이다 */
export const T_CAPTION: TypeToken = { size: 24, weight: 400 };
export const T_DMG: TypeToken = { size: 24, weight: 700 };
export const T_DMG_CRIT: TypeToken = { size: 36, weight: 700 };

/**
 * 토큰 굵기 → Pixi `TextStyle.fontWeight` 문자열.
 *
 * 호출부가 `String(t.weight) as "700"`으로 캐스팅하고 있었는데, 그 캐스팅은
 * 실제 값이 뭐든 컴파일을 통과시킨다 — 토큰 굵기를 600에서 400으로 바꿨을 때
 * 타입 검사가 아무 말도 하지 않았다. 좁은 유니온을 여기서 한 번만 만든다.
 */
export function fontWeightOf(token: TypeToken): "400" | "700" {
  return token.weight === 700 ? "700" : "400";
}

/**
 * 도트 폰트. CDN에 의존하지 않는다 — 폰트가 죽으면 룩이 무너진다 (§2).
 *
 * `index.html`의 `@font-face`가 `public/assets/fonts/`에서 싣는다(SIL OFL).
 * 예전 값은 `"Pretendard"`였는데 그 파일을 실은 적이 없어서 실제로는 항상
 * `system-ui`로 떨어지고 있었다 — 저해상도 캐릭터 위에 매끈한 벡터 고딕이
 * 얹혀서 "UI 해상도만 높아 보인다"의 가장 큰 원인이었다.
 *
 * 폴백에 `monospace`를 둔다: 도트 폰트가 못 뜨면 최소한 고정폭이라 숫자
 * 자리가 흔들리지 않는다(HP·데미지가 매 프레임 폭이 바뀌면 덜덜 떨린다).
 */
export const FONT_FAMILY = '"Galmuri11", monospace';

/**
 * 글리프가 도트로 떨어지는 폰트 크기 배수.
 *
 * Galmuri11은 em당 12픽셀 격자로 그려져 있다(글리프 좌표 GCD 실측: upem
 * 1200 / 100). 12의 배수가 아닌 크기를 쓰면 한 글자 안에서 획 두께가
 * 1px과 2px로 섞이며 글자가 지저분해진다 — 도트 폰트를 쓰는 의미가 없어진다.
 * `T_*` 토큰이 전부 이 배수다(테스트로 고정).
 */
export const FONT_PX_GRID = 12;

/** 가장 가까운 도트 격자 크기로 접는다. 최소 한 칸은 남긴다 */
export function snapFontSize(px: number): number {
  const n = Math.round(px / FONT_PX_GRID);
  return Math.max(1, n) * FONT_PX_GRID;
}

/**
 * 필드 위에 얹히는 텍스트의 아웃라인. 배경색이 무엇이든 읽히게 한다 (§2).
 *
 * 이음새는 각지게 둔다(`miter`) — 둥근 이음새는 도트 글리프의 직각 모서리를
 * 반 칸 굴려서, 아웃라인이 글자보다 매끄러워진다.
 */
export const FIELD_TEXT_STROKE = {
  color: UI_OUTLINE,
  width: 4,
  join: "miter",
  miterLimit: 1,
} as const;
