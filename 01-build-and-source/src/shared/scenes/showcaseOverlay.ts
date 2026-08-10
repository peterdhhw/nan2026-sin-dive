import { Container, Graphics, Sprite, Text } from "pixi.js";
import { DESIGN_H, DESIGN_W } from "../viewport";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FONT_FAMILY,
  T_BODY,
  T_CAPTION,
  T_LOGO,
  UI_OUTLINE,
  UI_TEXT,
  UI_TEXT_DIM,
  fontWeightOf,
} from "../theme";
import { darken } from "../color";
import { playSfx } from "../audio";
import type { PortraitSet } from "../portraits";
import type { PortraitVariant } from "../portraitManifest";
import type { CardArt } from "../cards";
import { cardSprite } from "../cards";
import { ART_PX, RADIUS_CARD, snapPx } from "../ui/shapeRules";
import { fillPixelRect, strokePixelRect } from "../ui/pixelShape";
import { caption, fitText } from "./common";
import {
  V_ART_BOTTOM_Y,
  V_CARD_Y,
  V_WORD_Y,
  victoryAlpha,
  victoryArtRise,
  victoryArtSize,
  victoryCardAlpha,
  victoryLive,
  victorySkippable,
  victoryWordFlash,
  victoryWordScale,
  // 규칙 본체가 있는 곳에서 직접 가져온다. `pvp/resultRules`도 같은 심볼을
  // 재export하지만(그쪽 88군데 호출자를 위해) 이 파일은 `shared/`이므로 그
  // 경로로 부르면 공용이 모드를 import한다 — `check:boundaries`가 잡는다.
} from "./showcaseRules";

/**
 * 승리 삽화 오버레이 — 결과 화면(S5) 위에 뜬다.
 *
 * 설계 문서: specs/2026-07-27-ux/10-cards.md §2
 *
 * 유저 지시: "이겼을 때 내가 고른 캐릭터의 이미지랑 그 위에 Victory라는 메세지
 * 오버레이 애니메이션으로 올려줘."
 *
 * 타임라인·게이트는 `resultRules`의 `V_*`에 있다 — **결과 화면의 마디는 하나도
 * 건드리지 않는다.** 그 근거(왜 밀어 넣지 않고 덮는가)도 거기 적혀 있다.
 *
 * ## 왜 씬이 아니라 위젯인가
 *
 * 이 오버레이가 걷히면 그 아래에 **이미 조립이 끝난** 결과 화면이 있어야 한다.
 * 씬으로 만들면 결과 씬을 나갔다 들어오는 것이 되어 딤·채도 필터·전장 오프셋을
 * 두 번 걸고 두 번 되돌린다(`resultScene`의 `applyFieldFilter` 주석) — 그리고
 * 그 사이 한 프레임에 전장이 원색으로 돌아온다.
 */

export interface ShowcaseOverlayOpts {
  /** 삽화. `null`이면 워드마크만 뜬다 — 삽화는 늦게 도착할 수 있다 */
  portraits: PortraitSet | null;
  slug: string;
  /**
   * 큰 워드마크. PvP는 `"VICTORY"`, 싱글 층 돌파는 층수다.
   *
   * **인자로 받는다.** 씬마다 다른 문구를 여기 삼항으로 두면 이 파일이 어느
   * 모드에서 왔는지를 알아야 하고, 그게 방금 없앤 의존이다.
   */
  word: string;
  /** 워드마크 아래 한글 한 줄 — 무엇을 해서 이 화면이 떴는가 */
  sub: string;
  /**
   * 어느 삽화를 쓰는가. PvP 승리는 `win`, 싱글 층 돌파도 `win`이다 —
   * 같은 값이지만 **씬이 말한다.** `loadPortraits`가 받을 variant를 씬이
   * 정하는 것과 같은 값이어야 하고(안 그러면 빈 삽화가 뜬다), 오버레이가
   * 고르면 그 두 곳이 갈린다(`V_ART_VARIANT` 주석의 16.4MB 근거).
   */
  variant: PortraitVariant;
  /**
   * 획득 줄 (#19). 없으면 그 줄을 아예 안 그린다(진 판·디버그 진입).
   *
   * `title`은 비어 있을 수 있다 — 카드 이름은 `cards.json`에 있고 그건 늦게
   * 도착한다. 줄 자체는 **먼저** 세운다: 매니페스트를 기다리면 획득 문구가
   * 오버레이가 걷힌 뒤에 뜰 수 있다(0.4초 안에 안 오면 못 본다).
   */
  card?: { title: string; caption: string } | undefined;
  /** 걷히는 것이 끝났다 — 결과 씬이 자기 입력을 다시 켠다 */
  onDone(): void;
}

export interface ShowcaseOverlay {
  view: Container;
  /** 아직 화면에 있는가. 결과 씬 버튼은 이때 잠겨 있어야 한다 */
  readonly live: boolean;
  /** 삽화가 늦게 도착했다 — 아직 걷히지 않았으면 세운다 */
  setPortraits(portraits: PortraitSet): void;
  /** 카드가 늦게 도착했다 — 그림과 이름을 채운다 */
  setCard(art: CardArt | null, title: string): void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 카드 줄의 썸네일 표시 크기 — 격자보다 크게, 얼굴이 읽혀야 한다 */
const CARD_W = 110;
const CARD_H = 147;

export function createShowcaseOverlay(
  opts: ShowcaseOverlayOpts,
): ShowcaseOverlay {
  const view = new Container();
  view.label = "victory";

  /**
   * 전면 딤. 결과 씬의 딤(`R_SCRIM_ALPHA` 0.72)이 이미 아래에 깔려 있지만
   * 그것만으로는 전적 패널·버튼이 삽화 뒤에서 그대로 읽힌다 — 삽화의 팔다리
   * 사이로 숫자가 보이면 축하가 아니라 겹친 화면이다.
   *
   * **탭을 삼킨다.** 결과 버튼은 1400ms에 살아나는데(`buttonsLive`) 그때
   * 화면에는 이 오버레이가 있다. 안 삼키면 안 보이는 버튼이 눌린다.
   */
  const dim = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x0a0812, alpha: 0.78 });
  dim.eventMode = "static";
  dim.hitArea = {
    contains: (x, y) => x >= 0 && y >= 0 && x <= DESIGN_W && y <= DESIGN_H,
  };
  dim.on("pointertap", () => skip());
  view.addChild(dim);

  /**
   * 삽화 뒤의 방사 빛. 삽화가 딤 위에 그냥 놓이면 인물이 어두운 데 떠 있는
   * 스티커로 보인다 — 뒤에서 빛이 나오면 "이 인물이 이겼다"가 된다.
   *
   * 부채꼴 12장이다. 원형 그라디언트를 쓰지 않는 이유는 도트 룩과 같다 —
   * 번지는 면은 이 화면에서 유일하게 흐린 요소가 된다.
   */
  const rays = new Graphics();
  const RAY_N = 12;
  const RAY_R = DESIGN_H * 0.42;
  for (let i = 0; i < RAY_N; i += 1) {
    const a0 = (i / RAY_N) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / RAY_N / 2;
    rays
      .poly([
        { x: 0, y: 0 },
        { x: Math.cos(a0) * RAY_R, y: Math.sin(a0) * RAY_R },
        { x: Math.cos(a1) * RAY_R, y: Math.sin(a1) * RAY_R },
      ])
      .fill({ color: ACCENT_GOLD_DEEP, alpha: 0.16 });
  }
  rays.position.set(DESIGN_W / 2, DESIGN_H * 0.42);
  view.addChild(rays);

  /** 삽화가 들어가는 자리. 발밑이 원점이다 — `V_ART_BOTTOM_Y`가 그 y다 */
  const artSlot = new Container();
  artSlot.position.set(DESIGN_W / 2, V_ART_BOTTOM_Y);
  view.addChild(artSlot);
  let art: Sprite | null = null;

  /**
   * 워드마크. PvP는 `VICTORY`를 **영문 그대로** 쓴다 — 유저 지시가 "Victory라는
   * 메세지"다. 아래에 한글 부제를 붙인다: 영문 한 단어만으로는 이 게임의 다른
   * 문구와 결이 다르고(전부 한글이다), 스탬프 `승 리 !`와 겹쳐 읽히지 않는다.
   */
  const word = new Container();
  const wordText = new Text({
    text: opts.word,
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      fontSize: T_LOGO.size,
      fontWeight: "700",
      letterSpacing: 6,
      // 도트 글리프의 직각을 굴리지 않는다 (`resultScene`의 헤드라인과 같은 이유)
      stroke: { color: UI_OUTLINE, width: 10, join: "miter", miterLimit: 1 },
      dropShadow: {
        color: 0x000000,
        alpha: 0.55,
        blur: 0,
        distance: 6,
        angle: Math.PI / 2,
      },
      align: "center",
      wordWrap: true,
      wordWrapWidth: DESIGN_W - 40,
    },
  });
  wordText.anchor.set(0.5);
  fitText(wordText, DESIGN_W - 40);
  word.addChild(wordText);
  word.position.set(DESIGN_W / 2, V_WORD_Y);
  word.scale.set(0);
  view.addChild(word);

  const sub = caption(opts.sub);
  sub.style.fill = UI_TEXT;
  sub.position.set(DESIGN_W / 2, snapPx(V_WORD_Y + T_LOGO.size * 0.85));
  sub.alpha = 0;
  view.addChild(sub);

  // ── 획득 카드 한 줄 (#19)
  const cardRow = new Container();
  cardRow.visible = opts.card !== undefined;
  cardRow.alpha = 0;
  view.addChild(cardRow);
  let cardArt: Sprite | null = null;
  const cardFrame = new Graphics();
  const cardSlot = new Container();
  /** 카드 이름 줄. 매니페스트가 늦게 오므로 나중에 채운다 */
  let cardTitle: Text | null = null;

  if (opts.card) {
    const label = new Text({
      text: opts.card.caption,
      style: {
        fill: ACCENT_GOLD,
        fontFamily: FONT_FAMILY,
        fontSize: T_BODY.size,
        fontWeight: fontWeightOf(T_BODY),
        wordWrap: true,
        wordWrapWidth: DESIGN_W * 0.5,
      },
    });
    label.anchor.set(0, 0);
    const title = new Text({
      text: opts.card.title,
      style: {
        fill: UI_TEXT,
        fontFamily: FONT_FAMILY,
        fontSize: T_CAPTION.size,
        fontWeight: fontWeightOf(T_CAPTION),
        wordWrap: true,
        wordWrapWidth: DESIGN_W * 0.5,
      },
    });
    title.anchor.set(0, 0);
    const hint = new Text({
      text: "카드함에서 볼 수 있습니다",
      style: {
        fill: UI_TEXT_DIM,
        fontFamily: FONT_FAMILY,
        fontSize: T_CAPTION.size,
        fontWeight: fontWeightOf(T_CAPTION),
        wordWrap: true,
        wordWrapWidth: DESIGN_W * 0.5,
      },
    });
    hint.anchor.set(0, 0);

    // 카드 그림 왼쪽, 글자 오른쪽. 글자를 아래에 두면 줄 전체가 200px을 넘어
    // 삽화 발밑과 겹친다
    const rowX = (DESIGN_W - (CARD_W + 16 + DESIGN_W * 0.5)) / 2;
    const rowY = V_CARD_Y - CARD_H / 2;
    fillPixelRect(cardFrame, 0, 0, CARD_W, CARD_H, RADIUS_CARD, {
      color: darken(ACCENT_GOLD_DEEP, 0.7),
    });
    strokePixelRect(cardFrame, 0, 0, CARD_W, CARD_H, RADIUS_CARD, {
      color: ACCENT_GOLD,
      width: ART_PX,
      alignment: 1,
    });
    cardSlot.position.set(0, 0);
    const textX = CARD_W + 16;
    label.position.set(textX, 8);
    title.position.set(textX, 8 + T_BODY.size * 1.5);
    hint.position.set(textX, 8 + T_BODY.size * 1.5 + T_CAPTION.size * 1.6);
    for (const t of [label, title, hint]) fitText(t, DESIGN_W * 0.5);
    cardRow.addChild(cardFrame, cardSlot, label, title, hint);
    cardRow.position.set(snapPx(rowX), snapPx(rowY));
    cardTitle = title;
  }

  let elapsedMs = 0;
  /** 탭이 들어온 시각. -1 = 없음 */
  let skipAtMs = -1;
  let done = false;
  let worded = false;

  /**
   * 삽화를 세운다. 늦게 도착할 수 있다 — 결과 씬은 `loadPortraits`를
   * fire-and-forget으로 부른다(§08-8: 삽화를 기다리면 결과 화면 자체가 늦는다).
   */
  function layoutArt(portraits: PortraitSet): void {
    art?.destroy();
    art = portraits.sprite(opts.slug, opts.variant);
    if (!art) return;
    // 폭·높이 **둘 다** 상한을 지킨다 — 근거는 `victoryArtSize`
    const size = victoryArtSize(art.width, art.height);
    art.width = size.w;
    art.height = size.h;
    // 발밑이 기준이다 — 중앙 기준으로 두면 캐릭터마다 다른 높이에 뜬다
    art.anchor.set(0.5, 1);
    artSlot.addChild(art);
  }

  function putCard(a: CardArt | null, title: string): void {
    if (a) {
      cardArt?.destroy();
      cardArt = cardSprite(a, {
        maxW: CARD_W - ART_PX * 2,
        maxH: CARD_H - ART_PX * 2,
      });
      cardArt.anchor.set(0.5, 0.5);
      cardArt.position.set(CARD_W / 2, CARD_H / 2);
      cardSlot.addChild(cardArt);
    }
    if (cardTitle && title.length > 0) {
      cardTitle.text = title;
      fitText(cardTitle, DESIGN_W * 0.5);
    }
  }

  function skip(): void {
    // 워드마크가 멈추기 전에는 안 걷힌다 — 전투 마지막의 연타가 그대로 여기로
    // 들어온다(`victorySkippable`)
    if (skipAtMs >= 0 || !victorySkippable(elapsedMs)) return;
    skipAtMs = elapsedMs;
    playSfx("ui_tap");
  }

  if (opts.portraits) layoutArt(opts.portraits);

  return {
    view,
    get live(): boolean {
      return !done && victoryLive(elapsedMs, skipAtMs);
    },
    setPortraits(portraits: PortraitSet): void {
      // 이미 걷혔으면 세우지 않는다 — 사라진 오버레이에 그림을 붙이면 다음
      // 프레임에 알파 0으로 덮인 텍스처가 메모리에 남는다
      if (done) return;
      layoutArt(portraits);
    },
    setCard(a: CardArt | null, title: string): void {
      if (done) return;
      putCard(a, title);
    },
    update(dtMs: number): void {
      if (done) return;
      elapsedMs += dtMs;

      const a = victoryAlpha(elapsedMs, skipAtMs);
      view.alpha = a;
      if (a <= 0) {
        done = true;
        // 걷힌 뒤에는 탭을 삼키지 않는다 — 알파 0인 판이 결과 버튼을 먹으면
        // 화면에 아무것도 없는데 버튼이 안 눌린다
        view.visible = false;
        dim.eventMode = "none";
        opts.onDone();
        return;
      }

      artSlot.y = V_ART_BOTTOM_Y + victoryArtRise(elapsedMs);
      // 빛도 삽화와 같이 올라온다 — 고정하면 인물이 빛을 뚫고 지나간다
      rays.rotation += dtMs / 9_000;

      const ws = victoryWordScale(elapsedMs);
      word.scale.set(ws);
      if (!worded && ws > 0) {
        worded = true;
        // `win`은 결과 씬이 이미 울린다(§08-7) — 같은 소리를 겹치면 두 번 이긴
        // 것처럼 들린다. 워드마크가 찍히는 것은 그 위의 한 칸이다
        playSfx("cooldown_ready", 0.9);
      }
      sub.alpha = ws >= 1 ? 1 : Math.max(0, ws - 0.7) * 3.3;

      if (cardRow.visible) cardRow.alpha = victoryCardAlpha(elapsedMs);

      const flash = victoryWordFlash(elapsedMs);
      if (flash > 0) {
        // 워드마크가 찍히는 순간만 딤이 하얘진다 — 판을 하나 더 얹지 않고
        // 딤 자체의 알파를 올린다(층을 늘리면 그 층이 카드 줄을 덮는다)
        dim.tint = 0xffffff;
        dim.alpha = 0.78 + flash * 0.22;
      } else {
        dim.alpha = 0.78;
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
