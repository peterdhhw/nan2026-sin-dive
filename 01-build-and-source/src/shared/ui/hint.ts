import { Container, Graphics, Text } from "pixi.js";
import {
  FONT_FAMILY,
  T_BODY,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  fontWeightOf,
} from "../theme";
import { lighten } from "../color";
import { DESIGN_W } from "../viewport";
import { ART_PX, OUTLINE_PILL, PAD_BUTTON_X, pillRadius } from "./shapeRules";
import {
  fillPixelCircle,
  fillPixelRect,
  strokePixelCircle,
  strokePixelRect,
} from "./pixelShape";
import {
  FINGER_COLOR,
  FINGER_PALM_CY,
  FINGER_PALM_R,
  FINGER_STEM_H,
  FINGER_TIP_DY,
  TOAST_HOLD_MS,
  fingerAlpha,
  fingerOffset,
  readSeen,
  toastAlpha,
  toastDone,
  toastHeight,
  toastMaxW,
  toastRise,
  writeSeen,
} from "./hintRules";

// 순수 규칙은 hintRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  FINGER_AMP_PX,
  FINGER_BOX_R,
  FINGER_H,
  FINGER_PALM_R,
  HINT_SEEN_KEY,
  TOAST_BOTTOM_RATIO,
  TOAST_HOLD_MS,
  TOAST_MAX_W_RATIO,
  fingerAlpha,
  fingerAnchor,
  fingerOffset,
  readSeen,
  toastAlpha,
  toastDone,
  toastHeight,
  toastMaxW,
  writeSeen,
} from "./hintRules";

/**
 * Toast / HintFinger.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C10
 *
 * 둘 다 **조작을 받지 않는다** — 화면에 얹혀 정보만 준다. 힌트가 탭을 먹으면
 * 정작 가리킨 슬롯을 누를 수 없다.
 */

export interface ToastOpts {
  /** 알약 중심 x (보통 화면 폭의 절반) */
  cx: number;
  cy: number;
  /**
   * 알약이 넘어서면 안 되는 폭. **생략하면 디자인 폭(720)으로 본다** —
   * 상한이 없으면 긴 안내문이 화면 밖으로 잘린다(`toastMaxW` 주석의 실측).
   * 좁은 패널 안에 놓을 때만 따로 준다.
   */
  maxW?: number;
}

export interface Toast {
  view: Container;
  show(text: string, holdMs?: number): void;
  move(cx: number, cy: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createToast(opts: ToastOpts): Toast {
  const view = new Container();
  view.eventMode = "none";
  view.visible = false;

  /** 알약이 넘어서면 안 되는 폭 — 라벨 줄바꿈과 알약 폭이 이 값을 공유한다 */
  const maxW = opts.maxW ?? toastMaxW(DESIGN_W);

  const bg = new Graphics();
  const label = new Text({
    text: "",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_BODY.size,
      fontWeight: fontWeightOf(T_BODY),
      // 긴 안내문은 잘리는 대신 줄을 바꾼다. `breakWords`가 필요한 이유:
      // 한글 안내문은 공백이 드물어 단어 경계만으로는 안 접힌다 —
      // "심연 100층에 닿으면 대전이 열린다"의 마지막 덩이가 통째로 넘친다
      wordWrap: true,
      wordWrapWidth: maxW - PAD_BUTTON_X * 2,
      breakWords: true,
      align: "center",
    },
  });
  label.anchor.set(0.5);
  view.addChild(bg, label);

  let cx = opts.cx;
  let cy = opts.cy;
  let elapsed = -1;
  let holdMs = TOAST_HOLD_MS;

  const paint = (): void => {
    // 상한을 씌운다. 줄바꿈이 걸려도 마지막 줄이 상한에 딱 붙을 수 있으므로
    // 알약 폭은 라벨 실측에 **다시** 상한을 걸어야 한다
    const w = Math.min(maxW, label.width + PAD_BUTTON_X * 2);
    const h = toastHeight(label.height);
    const r = pillRadius(h);
    strokePixelRect(
      fillPixelRect(
        fillPixelRect(bg.clear(), -w / 2, -h / 2, w, h, r, {
          color: UI_PANEL,
        }),
        -w / 2,
        -h / 2,
        w,
        h * 0.4,
        r,
        { color: lighten(UI_PANEL, 0.18), alpha: 0.6 },
      ),
      -w / 2,
      -h / 2,
      w,
      h,
      r,
      { color: UI_OUTLINE, width: OUTLINE_PILL, alignment: 1 },
    );
  };

  return {
    view,
    show(text: string, hold: number = TOAST_HOLD_MS): void {
      label.text = text;
      holdMs = hold;
      elapsed = 0;
      paint();
      view.visible = true;
      view.alpha = 0;
    },
    move(nextCx: number, nextCy: number): void {
      cx = nextCx;
      cy = nextCy;
      view.position.set(cx, cy);
    },
    update(dtMs: number): void {
      if (elapsed < 0) return;
      elapsed += dtMs;
      view.alpha = toastAlpha(elapsed, holdMs);
      view.position.set(cx, cy + toastRise(elapsed));
      if (toastDone(elapsed, holdMs)) {
        elapsed = -1;
        view.visible = false;
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

/**
 * 무설명 온보딩용 손 커서.
 *
 * 레퍼런스는 첫 화면에 파란 손 하나만 띄우고 아무 설명도 하지 않는다. 우리도
 * 같은 방식을 쓴다 — 튜토리얼 팝업을 만들지 않는 대신 손가락 하나로 "여기를
 * 눌러라"만 말한다. 한 번 누르면 `localStorage`에 기록하고 영구 해제한다.
 */
export interface HintFinger {
  view: Container;
  /** 아직 안 본 유저면 표시. 이미 봤으면 아무 일도 없다 */
  showAt(x: number, y: number): void;
  /** 유저가 탭했다 — 영구 해제 */
  dismiss(): void;
  readonly active: boolean;
  update(dtMs: number): void;
  destroy(): void;
}

export interface HintFingerOpts {
  /** 테스트에서 갈아끼운다. 기본은 `window.localStorage`(없으면 null) */
  store?: Pick<Storage, "getItem" | "setItem"> | null;
}

function defaultStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function createHintFinger(opts: HintFingerOpts = {}): HintFinger {
  const store = opts.store === undefined ? defaultStore() : opts.store;
  const view = new Container();
  view.eventMode = "none";
  view.visible = false;

  // 손 모양은 텍스처 없이 그린다 — 손바닥 원 + 검지 캡슐. 40px 안에서
  // "손가락으로 가리킨다"만 읽히면 충분하다.
  // 치수는 `hintRules`가 정본이다 — 호출자가 손 위치를 유도해야 하는데
  // (`fingerAnchor`) 여기 박아 두면 그 계산을 아무도 할 수 없다
  const g = new Graphics();
  fillPixelRect(g, -9, FINGER_TIP_DY, 18, FINGER_STEM_H, 9, {
    color: FINGER_COLOR,
  });
  fillPixelCircle(g, 0, FINGER_PALM_CY, FINGER_PALM_R, { color: FINGER_COLOR });
  strokePixelRect(g, -9, FINGER_TIP_DY, 18, FINGER_STEM_H, 9, {
    color: UI_OUTLINE,
    width: ART_PX,
  });
  strokePixelCircle(g, 0, FINGER_PALM_CY, FINGER_PALM_R, {
    color: UI_OUTLINE,
    width: ART_PX,
  });
  // 하이라이트는 한 칸 사각 — 반지름 5px 원은 흐린 점으로만 보인다
  g.rect(-5 - ART_PX / 2, -4 - ART_PX / 2, ART_PX, ART_PX).fill({
    color: lighten(FINGER_COLOR, 0.4),
    alpha: 0.8,
  });
  view.addChild(g);

  let elapsed = -1;
  let baseY = 0;
  let seen = readSeen(store);

  return {
    view,
    get active(): boolean {
      return elapsed >= 0;
    },
    showAt(x: number, y: number): void {
      if (seen) return;
      baseY = y;
      view.position.set(x, y);
      view.visible = true;
      elapsed = 0;
    },
    dismiss(): void {
      if (elapsed < 0 && seen) return;
      seen = true;
      elapsed = -1;
      view.visible = false;
      writeSeen(store);
    },
    update(dtMs: number): void {
      if (elapsed < 0) return;
      elapsed += dtMs;
      view.y = baseY + fingerOffset(elapsed);
      view.alpha = fingerAlpha(elapsed);
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
