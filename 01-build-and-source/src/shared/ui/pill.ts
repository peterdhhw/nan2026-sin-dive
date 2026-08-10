import { Container, Graphics, Text } from "pixi.js";
import {
  FONT_FAMILY,
  T_BODY,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  fontWeightOf,
} from "../theme";
import { darken, lighten } from "../color";
import { OUTLINE_PILL, pillRadius } from "./shapeRules";
import {
  fillPixelCircle,
  fillPixelRect,
  strokePixelCircle,
  strokePixelRect,
} from "./pixelShape";
import {
  COUNTUP_MS,
  ICON_OVERHANG,
  PILL_H,
  PULSE_MS,
  countUpValue,
  iconDiameter,
  pillTextWidth,
  pulseScale,
} from "./pillRules";
import { fitText } from "./fitText";

// 순수 규칙은 pillRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export { PILL_H, countUpValue, pulseScale } from "./pillRules";

/**
 * 정보 필 — 상단 HUD의 값 표기 형태.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C3
 *
 * 값은 축약하지 않는다 (§01-2) — 우리 수치는 네 자리를 넘지 않는다.
 */

export interface PillOpts {
  w: number;
  h?: number;
  /** 좌측 아이콘 원의 색. 없으면 아이콘을 그리지 않는다 */
  iconColor?: number;
  /** 초기 텍스트. 숫자 카운트업을 쓰려면 `setValue`를 쓴다 */
  text?: string;
  bg?: number;
  textColor?: number;
}

export interface Pill {
  view: Container;
  /** 문자열을 그대로 넣는다 (시계 등 — 카운트업이 의미 없는 값) */
  setText(text: string): void;
  /** 숫자를 카운트업으로 바꾼다 (§C3) */
  setValue(value: number): void;
  resize(w: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createPill(opts: PillOpts): Pill {
  const view = new Container();
  /** 펄스 스케일이 아이콘·텍스트까지 같이 먹어야 한다 */
  const inner = new Container();
  const g = new Graphics();
  inner.addChild(g);
  view.addChild(inner);

  let w = opts.w;
  const h = opts.h ?? PILL_H;
  const bg = opts.bg ?? UI_PANEL;
  const iconColor = opts.iconColor;

  const label = new Text({
    text: opts.text ?? "",
    style: {
      fill: opts.textColor ?? UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_BODY.size,
      fontWeight: fontWeightOf(T_BODY),
    },
  });
  label.anchor.set(0, 0.5);
  inner.addChild(label);

  /** 카운트업 상태. -1 = 진행 중 아님 */
  let countMs = -1;
  let countFrom = 0;
  let countTo = 0;
  let pulseMs = -1;
  /** `paint`가 정하는 글자 허용 폭. `setText`도 이 폭을 지켜야 한다 */
  let textMaxW = w;
  /**
   * 줄이기 전 원문. `fitText`는 넘칠 때 `label.text` 자체를 말줄임으로 **덮어쓴다** —
   * 원문을 안 들고 있으면 `resize`로 넓혀도 잘린 글자가 그대로 남고, 두 번 리페인트하면
   * `물의 여…` → `물의…`로 계속 깎인다.
   */
  let rawText = opts.text ?? "";

  const paint = (): void => {
    const r = pillRadius(h);
    g.clear();
    fillPixelRect(g, 0, 0, w, h, r, { color: bg, alpha: 0.85 });
    // 상단 밝은 립 — 알약도 3단 셰이딩을 지킨다 (§3-3)
    fillPixelRect(g, 2, 2, w - 4, h * 0.34, r, {
      color: lighten(bg, 0.2),
      alpha: 0.5,
    });
    strokePixelRect(g, 0, 0, w, h, r, {
      color: UI_OUTLINE,
      width: OUTLINE_PILL,
      alignment: 1,
    });

    // 아이콘 동전은 왼쪽 끝에서 밖으로 튀어나온다 (레퍼런스의 동전 배치).
    // 계단 원이다 — 매끈한 원호는 도트 룩에서 유일하게 흐린 요소가 된다
    let textX = r;
    if (iconColor !== undefined) {
      const d = iconDiameter(h);
      const cx = -ICON_OVERHANG + d / 2;
      fillPixelCircle(g, cx, h / 2, d / 2, { color: iconColor });
      fillPixelCircle(g, cx, h / 2, (d / 2) * 0.55, {
        color: darken(iconColor, 0.28),
      });
      strokePixelCircle(g, cx, h / 2, d / 2, {
        color: UI_OUTLINE,
        width: OUTLINE_PILL,
        alignment: 1,
      });
      textX = cx + d / 2 + 10;
    }
    label.position.set(textX, h / 2);
    // 글자를 알약 안에 가둔다. 이게 없으면 긴 이름이 테두리를 넘어 옆 위젯 위로 흐른다
    // 오른쪽은 라운드 코너만 피한다 (왼쪽 여백을 그대로 빼면 글자 자리가 두 글자로 준다)
    textMaxW = pillTextWidth(w, textX, r);
    label.text = rawText;
    fitText(label, textMaxW);
    inner.pivot.set(w / 2, h / 2);
    inner.position.set(w / 2, h / 2);
  };

  paint();

  return {
    view,
    setText(text: string): void {
      countMs = -1;
      rawText = text;
      label.text = text;
      // 시계·이름이 여기로 들어온다 — 생성 시와 같은 폭 규칙을 적용한다
      fitText(label, textMaxW);
    },
    setValue(value: number): void {
      const next = Number.isFinite(value) ? Math.round(value) : 0;
      if (next === countTo && countMs < 0) return;
      countFrom = countUpValue(countFrom, countTo, countMs);
      countTo = next;
      countMs = 0;
      pulseMs = 0;
    },
    resize(nextW: number): void {
      w = nextW;
      paint();
    },
    update(dtMs: number): void {
      if (countMs >= 0) {
        countMs += dtMs;
        rawText = String(countUpValue(countFrom, countTo, countMs));
        label.text = rawText;
        // 숫자도 같은 폭을 지킨다. 앞서 이름이 축소돼 있었다면 배율도 여기서 되돌아간다
        fitText(label, textMaxW);
        if (countMs >= COUNTUP_MS) {
          countMs = -1;
          countFrom = countTo;
        }
      }
      if (pulseMs >= 0) {
        pulseMs += dtMs;
        inner.scale.set(pulseScale(pulseMs));
        if (pulseMs >= PULSE_MS) {
          pulseMs = -1;
          inner.scale.set(1);
        }
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
