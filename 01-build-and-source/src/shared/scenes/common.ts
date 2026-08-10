import { Container, Graphics, Text } from "pixi.js";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FONT_FAMILY,
  SCRIM_COLOR,
  TEAM_OURS,
  T_CAPTION,
  T_LABEL,
  T_LOGO,
  UI_OUTLINE,
  UI_TEXT,
  UI_TEXT_DIM,
  type TypeToken,
  fontWeightOf,
  snapFontSize,
} from "../theme";
import { DESIGN_W } from "../viewport";
import { LOGO_LINE_W_RATIO } from "./titleRules";

import { fillPixelRect } from "../ui/pixelShape";
/**
 * 씬들이 공유하는 조각 — 로고, 캡션, 섹션 라벨, 전면 딤.
 *
 * 설계 문서: specs/2026-07-27-ux/04-scene-title.md §3, 05-scene-matchmaking.md §2
 *
 * **모든 `Text`에 `wordWrapWidth`를 준다** (§01-6·§05-7-1). 지정하지 않은 Text는
 * 실기기에서 화면 밖으로 나간다 — 여기서 강제하는 게 호출부마다 기억하는 것보다 낫다.
 */

/** 화면 폭에서 좌우 여백을 뺀 기본 줄바꿈 폭 (§05-7-1: 화면폭 − 80) */
export const WRAP_W = DESIGN_W - 80;

export function sceneText(
  content: string,
  token: TypeToken,
  color: number = UI_TEXT,
  wrapWidth: number = WRAP_W,
): Text {
  const t = new Text({
    text: content,
    style: {
      fill: color,
      fontFamily: FONT_FAMILY,
      fontSize: token.size,
      fontWeight: fontWeightOf(token),
      align: "center",
      wordWrap: true,
      wordWrapWidth: wrapWidth,
    },
  });
  t.anchor.set(0.5);
  return t;
}

/** 캡션 한 줄 — 중앙 정렬, 흐린 색 */
export function caption(content: string, wrapWidth: number = WRAP_W): Text {
  return sceneText(content, T_CAPTION, UI_TEXT_DIM, wrapWidth);
}

/**
 * `SIN DIVE` 로고. 두 줄이 어긋난 배치 + 금색 (§04-3).
 *
 * 이미지 에셋을 쓰지 않는다 — 폰트로 조립하면 다국어·해상도에 자유롭고
 * 아틀라스 한 장을 아낀다.
 */
export function createLogo(scale = 1): Container {
  const view = new Container();
  /**
   * 호출부가 0.42·0.9 같은 배율을 준다. 폰트 크기는 도트 격자로 접어야
   * 하지만(획 두께가 섞인다) 나머지 장식은 그대로 배율을 따른다 — 접힌
   * 크기와 요청 배율의 비를 다시 구해 자간·외곽선을 같은 비로 키운다.
   */
  const size = snapFontSize(T_LOGO.size * scale);
  const s = size / T_LOGO.size;
  const mk = (content: string, color: number): Text => {
    const t = new Text({
      text: content,
      style: {
        fill: color,
        fontFamily: FONT_FAMILY,
        fontSize: size,
        fontWeight: "700",
        letterSpacing: Math.round(8 * s),
        stroke: {
          color: UI_OUTLINE,
          width: Math.round(8 * s),
          // 도트 룩에서는 모서리를 둥글리지 않는다 — 각진 외곽선이어야
          // 글자 실루엣이 픽셀처럼 읽힌다
          join: "miter",
        },
        /**
         * 그림자는 **번지지 않는다**(blur 0). 도트 그림에 가우시안 블러가
         * 끼면 그 부분만 해상도가 다른 그림처럼 보인다 — 대신 한 칸 밀어
         * 낸 단단한 그림자로 두께를 만든다(도트 게임의 관용 표현).
         */
        dropShadow: {
          color: 0x000000,
          alpha: 0.5,
          blur: 0,
          distance: Math.max(2, Math.round(6 * s)),
          angle: Math.PI / 2,
        },
        wordWrap: false,
      },
    });
    t.anchor.set(0.5);
    return t;
  };
  const top = mk("SIN", UI_TEXT);
  const bottom = mk("DIVE", ACCENT_GOLD);
  /**
   * 아래 줄을 오른쪽으로 어긋나게 — 정렬을 맞추면 그냥 두 단어가 된다.
   *
   * **어긋남을 고정 px로 두지 않는다.** `ABYSS`(5글자) 시절에는 ±24였는데,
   * `SIN`(3글자)으로 줄자 위 줄이 아래 줄보다 좁아져서 같은 24를 주면 위 줄이
   * 왼쪽으로 밀려난 짧은 토막처럼 보인다. 두 줄의 **폭 차**에서 유도한다:
   * 좁은 쪽을 그 차이의 절반만큼 왼쪽으로, 넓은 쪽을 그만큼 오른쪽으로 밀면
   * 어긋남이 글자 수에 따라 스스로 맞는다(폭이 같으면 예전과 같은 그림이다).
   *
   * 하한 `12 * s`: 폭이 거의 같은 단어 쌍에서 어긋남이 0이 되어 두 줄이
   * 정렬돼 버리는 것을 막는다. 배율은 `s`(접힌 크기 기준)를 쓴다 —
   * `scale`을 쓰면 글자만 접혀서 어긋난다.
   */
  const stagger = Math.max(
    Math.round(12 * s),
    Math.round(Math.abs(bottom.width - top.width) / 2),
  );
  top.position.set(-stagger, Math.round(-size * 0.46));
  bottom.position.set(stagger, Math.round(size * 0.46));

  const line = new Graphics();
  // 비율은 `titleRules`가 갖는다 — 로고 옆에 무엇을 놓을 때 겹치는지를 node
  // 테스트가 물어야 한다(`logoWidth`)
  const lw = Math.round(DESIGN_W * LOGO_LINE_W_RATIO * s);
  const ly = size;
  line
    .rect(-Math.round(lw / 2), ly, lw, Math.max(2, Math.round(3 * s)))
    .fill({ color: ACCENT_GOLD_DEEP, alpha: 0.9 });
  const diamond = new Graphics();
  // 마름모는 정수 좌표여야 변이 깨끗한 계단으로 떨어진다
  const ds = Math.max(4, Math.round(9 * s));
  diamond
    .poly([0, -ds, ds, 0, 0, ds, -ds, 0])
    .fill({ color: ACCENT_GOLD })
    .poly([0, -ds, ds, 0, 0, ds, -ds, 0])
    .stroke({ color: UI_OUTLINE, width: 2 });
  diamond.position.set(0, ly + 1);

  view.addChild(line, diamond, top, bottom);
  return view;
}

/** 좌측 진영색 바 + 라벨 (§05-2의 `── 우리 팀 ───`) */
export function sectionLabel(
  content: string,
  accent: number = TEAM_OURS,
  w = 240,
): Container {
  const view = new Container();
  const bar = new Graphics();
  fillPixelRect(bar, 0, -8, 6, 16, 3, { color: accent });
  bar.rect(0, -1, w, 2).fill({ color: accent, alpha: 0.35 });
  const t = new Text({
    text: content,
    style: {
      fill: UI_TEXT_DIM,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: "700",
      wordWrap: true,
      wordWrapWidth: w,
    },
  });
  t.anchor.set(0, 0.5);
  t.position.set(14, 0);
  // 라벨 뒤로 지나는 얇은 선은 글자에 가리면 지저분하다 — 글자 폭만큼 지운다
  bar.clear();
  fillPixelRect(bar, 0, -8, 6, 16, 3, { color: accent });
  bar
    .rect(t.width + 24, -1, Math.max(0, w - t.width - 24), 2)
    .fill({ color: accent, alpha: 0.35 });
  view.addChild(bar, t);
  return view;
}

/** 씬 전면 딤 — 배경 위에 씬 UI를 얹을 때 대비를 만든다 (§05-2 Scrim 0.55) */
export function dimLayer(w: number, h: number, alpha = 0.55): Graphics {
  return new Graphics().rect(0, 0, w, h).fill({ color: SCRIM_COLOR, alpha });
}

/**
 * 카드 폭에 맞춰 글자를 줄이고, 그래도 넘치면 말줄임 (§05-7-1).
 *
 * 구현은 `ui/fitText.ts`에 있다 — 위젯(`ui/skillSlot`)도 같은 규칙을 쓰는데
 * 위젯이 씬을 import하면 방향이 거꾸로다. 씬들은 계속 여기서 가져다 쓴다.
 */
export { fitText } from "../ui/fitText";
