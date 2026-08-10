import { Container, Graphics, Text } from "pixi.js";
import {
  FONT_FAMILY,
  T_BODY,
  T_LABEL,
  UI_OUTLINE,
  fontWeightOf,
} from "../theme";
import { playSfx } from "../audio";
import { fillPixelRect, strokePixelRect } from "./pixelShape";
import {
  HIGHLIGHT_ALPHA,
  HIGHLIGHT_W_RATIO,
  type ButtonState,
  buttonSkin,
  hasDiagonalHighlight,
} from "./buttonRules";
import {
  BUTTON_H,
  OUTLINE_BUTTON,
  PAD_BUTTON_X,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  RADIUS_BUTTON,
  SHAKE_MS,
  buttonTextMaxW,
  buttonWidth,
  pressScale,
  shadeBands,
  shakeOffset,
  tapSlack,
} from "./shapeRules";
import { fitText } from "./fitText";

// 순수 규칙은 buttonRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  buttonSkin,
  hasDiagonalHighlight,
  type ButtonState,
} from "./buttonRules";

/**
 * 사각 버튼.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C2
 *
 * **`disabled`에서도 hitArea를 살려 둔다** — 탭하면 좌우로 짧게 흔들려
 * "지금은 안 된다"를 알린다. 무반응은 버그처럼 느껴진다 (§C2).
 */

export interface ButtonOpts {
  label: string;
  /** 비용 등 두 번째 줄. 있으면 2줄 구성이 된다 */
  sublabel?: string;
  state?: ButtonState;
  /** 지정하지 않으면 라벨 폭 + 패딩으로 정한다 */
  w?: number;
  h?: number;
  onTap?: () => void;
  /**
   * 잠긴 상태(`disabled`)에서 탭했을 때. **흔들림만으로는 이유를 못 말한다** —
   * 왜 안 되는지는 버튼 밖(토스트)에서 알려야 한다.
   *
   * 옵셔널이다. 없으면 예전대로 흔들림 + `ui_locked` 소리만 낸다.
   */
  onLocked?: () => void;
  /**
   * 탭 관용(`tapSlack`)이 각 방향으로 쓸 수 있는 **빈 거리**(px).
   *
   * 88px(§3-4)보다 작은 버튼은 그림 밖까지 탭을 받는데, 그 영역이 이웃 위젯을
   * 덮으면 "엉뚱한 것이 눌린다"가 된다. 이웃이 무엇인지는 버튼이 모르므로
   * 자리를 아는 쪽이 한도를 넘긴다. 생략한 방향은 무제한이다 — 화면 여백이나
   * 빈 하늘에 놓인 버튼이 대부분이다.
   */
  tapRoom?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface Button {
  view: Container;
  readonly width: number;
  readonly height: number;
  setState(state: ButtonState): void;
  setLabel(label: string, sublabel?: string): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createButton(opts: ButtonOpts): Button {
  const view = new Container();
  const g = new Graphics();
  /** 눌림 스케일이 라벨까지 같이 먹어야 한다 — 배경만 줄면 글자가 떠 보인다 */
  const inner = new Container();
  inner.addChild(g);
  view.addChild(inner);

  let state: ButtonState = opts.state ?? "ready";
  const h = opts.h ?? BUTTON_H;

  const label = new Text({
    text: opts.label,
    style: {
      fill: 0xffffff,
      fontFamily: FONT_FAMILY,
      fontSize: T_BODY.size,
      fontWeight: fontWeightOf(T_BODY),
      align: "center",
    },
  });
  label.anchor.set(0.5);
  inner.addChild(label);

  const sub = new Text({
    text: opts.sublabel ?? "",
    style: {
      fill: 0xffffff,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: fontWeightOf(T_LABEL),
    },
  });
  sub.anchor.set(0.5);
  sub.visible = typeof opts.sublabel === "string" && opts.sublabel.length > 0;
  inner.addChild(sub);

  let w = opts.w ?? buttonWidth(label.width);

  /** 눌림 상태 추적. -1 = 모션 없음 */
  let pressMs = -1;
  let held = false;
  let shakeMs = -1;

  const paint = (): void => {
    const skin = buttonSkin(state);
    const bands = shadeBands(skin.base, h);
    g.clear();
    fillPixelRect(g, 0, 0, w, h, RADIUS_BUTTON, { color: bands.base });
    // 립·굽은 몸통 안쪽에만 — 둥근 모서리 밖으로 새면 아웃라인과 어긋난다
    fillPixelRect(g, 0, 0, w, bands.lipH + RADIUS_BUTTON, RADIUS_BUTTON, {
      color: bands.lip,
    });
    fillPixelRect(
      g,
      0,
      h - bands.bootH - RADIUS_BUTTON,
      w,
      bands.bootH + RADIUS_BUTTON,
      RADIUS_BUTTON,
      { color: bands.boot },
    );
    g.rect(0, bands.lipH, w, h - bands.lipH - bands.bootH).fill({
      color: bands.base,
    });

    if (hasDiagonalHighlight(state)) {
      // 좌상단 대각 하이라이트 — 초록 버튼만 (레퍼런스 frame_02)
      g.poly([
        { x: 0, y: 0 },
        { x: w * HIGHLIGHT_W_RATIO, y: 0 },
        { x: 0, y: h * 0.9 },
      ]).fill({ color: 0xffffff, alpha: HIGHLIGHT_ALPHA });
    }

    strokePixelRect(g, 0, 0, w, h, RADIUS_BUTTON, {
      color: UI_OUTLINE,
      width: OUTLINE_BUTTON,
      alignment: 1,
    });

    label.style.fill = skin.label;
    sub.style.fill = skin.sub;
    label.text = skin.glyph === null ? labelText : `${skin.glyph} ${labelText}`;

    // 폭을 지정받은 버튼은 라벨이 그 폭을 넘을 수 있다 — 여기서 맞춘다.
    // `paint()`에 두는 이유: 글리프(`ad`의 ▶)가 상태에 따라 붙으므로 라벨 폭은
    // 상태가 바뀔 때도 변한다. `setLabel`에만 두면 `setState`로 넘칠 수 있다.
    //
    // **두 줄 다 원문에서 다시 맞춘다.** `fitText`는 말줄임할 때 `text`를 고치므로
    // 줄어든 글자에 또 걸면 배율·말줄임이 누적된다("120 G" → "12…" → "1…").
    if (opts.w !== undefined) {
      sub.text = subText;
      fitText(label, buttonTextMaxW(w));
      if (sub.visible) fitText(sub, buttonTextMaxW(w));
    }

    // 2줄이면 라벨을 위로 올린다. 1줄이면 정중앙 (§C2)
    if (sub.visible) {
      label.position.set(w / 2, h * 0.36);
      sub.position.set(w / 2, h * 0.71);
    } else {
      label.position.set(w / 2, h / 2);
    }
    // 눌림 스케일의 중심을 버튼 중앙으로 — 좌상단 기준이면 버튼이 왼쪽으로 쏠린다
    inner.pivot.set(w / 2, h / 2);
    inner.position.set(w / 2, h / 2);
  };

  /** 라벨·서브라벨의 원문. `fitText`가 말줄임으로 `text`를 고치므로 정본을 따로 든다 */
  let labelText = opts.label;
  let subText = opts.sublabel ?? "";
  paint();

  view.eventMode = "static";
  view.cursor = "pointer";
  // disabled에서도 hitArea를 유지한다 — 흔들림으로 답하기 위해서다.
  //
  // **그려진 사각형보다 넓다** (`tapSlack`): 작은 버튼이 88px(§3-4 최소 탭
  // 타깃)에 못 미치면 그 차이를 여기서 메운다. 그림을 키우는 쪽은 못 썼다 —
  // 여덟 곳 전부 밴드 높이에 여유가 없다(근거는 `tapSlack` 주석).
  //
  // 방향마다 따로 잰다: 관용은 대칭이지만 **빈 자리는 대칭이 아니다**(HUD
  // 타이틀은 위가 화면 끝, 아래가 골드 필이다).
  const room = opts.tapRoom;
  const up = tapSlack(h, room?.top);
  const down = tapSlack(h, room?.bottom);
  const left = tapSlack(w, room?.left);
  const right = tapSlack(w, room?.right);
  view.hitArea = {
    contains: (x, y) =>
      x >= -left && y >= -up && x <= w + right && y <= h + down,
  };

  // 눌림은 pointerdown에 즉시 반응한다. pointertap까지 기다리면 손가락을 뗄 때까지
  // 아무 일도 안 일어나 "먹었나?" 싶어진다 (§C2)
  view.on("pointerdown", () => {
    held = true;
    pressMs = 0;
  });
  const release = (): void => {
    if (!held) return;
    held = false;
    pressMs = 0;
  };
  view.on("pointerup", release);
  view.on("pointerupoutside", release);
  view.on("pointertap", () => {
    if (!buttonSkin(state).interactive) {
      shakeMs = 0;
      playSfx("ui_locked");
      // 흔들림은 "안 된다"까지만 말한다. 이유는 호출자가 낸다 (`onLocked`)
      opts.onLocked?.();
      return;
    }
    playSfx("ui_tap");
    opts.onTap?.();
  });

  return {
    view,
    get width(): number {
      return w;
    },
    get height(): number {
      return h;
    },
    setState(next: ButtonState): void {
      if (next === state) return;
      state = next;
      paint();
    },
    setLabel(nextLabel: string, nextSub?: string): void {
      labelText = nextLabel;
      subText = nextSub ?? "";
      sub.text = subText;
      sub.visible = typeof nextSub === "string" && nextSub.length > 0;
      // 폭을 지정받지 않았으면 라벨에 맞춰 다시 잰다.
      // 축소가 남아 있으면 `label.width`가 줄어든 값이라 폭이 계속 작아진다 — 원문·배율을
      // 되돌려 재고, 지정 폭 쪽은 `paint()`가 다시 맞춘다
      if (opts.w === undefined) {
        label.scale.set(1);
        label.text = nextLabel;
        w = buttonWidth(label.width);
      }
      paint();
    },
    update(dtMs: number): void {
      if (pressMs >= 0) {
        pressMs += dtMs;
        inner.scale.set(pressScale(pressMs, held));
        if (!held && pressMs >= PRESS_OUT_MS) {
          pressMs = -1;
          inner.scale.set(1);
        } else if (held && pressMs >= PRESS_IN_MS) {
          // 누르고 있는 동안은 눌린 값에 머문다 (모션만 끝난다)
          pressMs = PRESS_IN_MS;
        }
      }
      if (shakeMs >= 0) {
        shakeMs += dtMs;
        inner.x = w / 2 + shakeOffset(shakeMs);
        if (shakeMs >= SHAKE_MS) {
          shakeMs = -1;
          inner.x = w / 2;
        }
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

export { BUTTON_H, PAD_BUTTON_X };
