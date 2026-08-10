import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { SkillDef } from "../../core/types";
import {
  FONT_FAMILY,
  STATE_OFF,
  STATE_OK,
  T_LABEL,
  UI_OUTLINE,
  UI_TEXT,
  UI_TEXT_DIM,
  fontWeightOf,
  snapFontSize,
} from "../theme";
import { darken, lighten } from "../color";
import { LABEL_GAP_PX } from "../skillBarRules";
import { loadIconAtlas } from "./iconAtlas";
import { fitLabel, fitText } from "./fitText";
import {
  AUTO_PULSE_MS,
  COOL_PIE_ALPHA,
  HIT_SLACK_PX,
  READY_PULSE_MS,
  READY_RING_W,
  type SlotState,
  autoPulseAlpha,
  cooldownLabel,
  iconRegionFor,
  readyFlashAlpha,
  readyPulse,
  slotState,
} from "./skillSlotRules";
import {
  ART_PX,
  OUTLINE_BUTTON,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  pressScale,
} from "./shapeRules";
import {
  fillPixelCircle,
  fillPixelPie,
  fillPixelRect,
  strokePixelCircle,
} from "./pixelShape";

// 순수 규칙은 skillSlotRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  SLOT_DIAMETER_RATIO,
  cooldownLabel,
  iconRegionFor,
  slotState,
  type SlotState,
} from "./skillSlotRules";

/**
 * 원형 스킬 슬롯 / 원형 버튼.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C4,
 *           specs/2026-07-27-ux/07-scene-battle.md §7
 *
 * **쿨다운 완료 피드백이 이 위젯의 존재 이유다.** 레퍼런스의 "초록 버튼을 누르는"
 * 도파민 루프를 우리는 이 순간으로 대체한다 (§07-7) — 흰 플래시 + 스케일 펄스 +
 * 초록 링 점등을 동시에 준다. 소리는 세션이 같은 프레임에 울린다.
 */

export interface SkillSlotOpts {
  skill: SkillDef;
  /** 슬롯 지름 */
  diameter: number;
  /** 내부 원 색 (kind별) */
  color: number;
  /** 슬롯 아래 라벨을 그리는지 */
  label?: boolean;
  /**
   * 라벨이 쓸 수 있는 최대 폭. 넘치면 축소 → 말줄임 (§05-7-1과 같은 규칙).
   *
   * 없으면 지름을 쓴다. **호출부가 칸 폭을 줘야 한다** — 지름만으로 자르면
   * 원보다 조금 넓은 이름이 불필요하게 잘리고, 안 주면 옆 칸을 침범한다.
   */
  labelMaxW?: number;
  /**
   * 라벨이 쓸 수 있는 높이. 두 줄이 들어가면 두 단어 이름을 접어서 온전히
   * 보여준다 — 안 주면 한 줄로 두고 넘치는 만큼 말줄임한다.
   */
  labelMaxH?: number;
  onTap?: () => void;
}

export interface SkillSlot {
  view: Container;
  readonly skill: SkillDef;
  /**
   * 남은 쿨다운을 밀어 넣는다. 상태·파이·숫자·완료 펄스가 여기서 갈린다 —
   * 호출부가 "준비됐는지"를 따로 판단하지 않아야 두 값이 갈라지지 않는다.
   */
  setRemaining(remainingMs: number): void;
  /**
   * 이 칸이 아직 안 열렸다 — 회색 판 + 죽은 아이콘 (`slotState`의 `locked`).
   *
   * **`setRemaining`과 따로 받는다.** 잠금의 출처는 쿨다운이 아니라 진행도
   * (싱글의 타락 단계)이고, 남은 시간에 섞어 보내면 "잠김"과 "쿨다운 중"이
   * 같은 값으로 들어와 둘을 다른 그림으로 그릴 수 없다.
   *
   * 매 프레임 불러도 싸다 — 값이 안 바뀌면 아무 일도 하지 않는다.
   */
  setLocked(locked: boolean): void;
  /** 지금 잠겨 있는가. 세션이 시전을 막는 데 쓴다 */
  readonly locked: boolean;
  /** AUTO가 이 슬롯을 썼다 — 짧은 링 펄스 (§07-7) */
  pulseAuto(): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createSkillSlot(opts: SkillSlotOpts): SkillSlot {
  const view = new Container();
  /** 펄스·눌림 스케일이 아이콘까지 같이 먹는다 (라벨은 밖) */
  const inner = new Container();
  view.addChild(inner);

  const r = opts.diameter / 2;
  const bevel = new Graphics();
  const face = new Graphics();
  /** 쿨다운 파이 + 링 — 매 프레임 다시 그린다 */
  const overlay = new Graphics();
  inner.addChild(bevel, face, overlay);

  const icon = new Sprite();
  icon.anchor.set(0.5);
  icon.visible = false;
  inner.addChild(icon);
  // 아이콘은 비동기로 도착한다. 없어도 색 원 + 라벨로 읽을 수 있으므로
  // 슬롯 생성을 기다리게 하지 않는다 (스킬바가 async가 되면 세션 전체가 늦어진다)
  void loadIconAtlas().then((regions) => {
    const tex = regions.get(iconRegionFor(opts.skill));
    if (!tex) return;
    icon.texture = tex;
    // 슬롯 안쪽 60%. 더 키우면 쿨다운 파이가 아이콘을 가려 남은 초가 안 보인다
    const k = (r * 1.2) / Math.max(tex.width, tex.height);
    icon.scale.set(k);
    icon.visible = true;
  });

  const remainText = new Text({
    text: "",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      // 남은 시간 숫자는 라벨보다 크게. 격자에 맞춰 접는다(1.3배=31.2px는 어긋난다)
      fontSize: snapFontSize(T_LABEL.size * 1.3),
      fontWeight: "700",
    },
  });
  remainText.anchor.set(0.5);
  inner.addChild(remainText);

  const label =
    opts.label === false
      ? null
      : new Text({
          text: opts.skill.name,
          style: {
            fill: UI_TEXT_DIM,
            fontFamily: FONT_FAMILY,
            fontSize: T_LABEL.size,
            fontWeight: fontWeightOf(T_LABEL),
            align: "center",
          },
        });
  if (label) {
    label.anchor.set(0.5, 0);
    label.position.set(0, r + LABEL_GAP_PX);
    // 칸 폭에 맞춘다. 이걸 빼면 5칸에서 이름 다섯 개가 이어 붙어 한 줄로 읽힌다.
    // 높이를 받으면 두 단어를 접는다 — 폭만 맞추면 `조류 가…`로 잘린다
    const maxW = opts.labelMaxW ?? opts.diameter;
    if (opts.labelMaxH === undefined) fitText(label, maxW);
    else fitLabel(label, maxW, opts.labelMaxH);
    view.addChild(label);
  }

  /** 금속 그레이 베벨 + 어두운 외곽 링 — pos와 무관하므로 한 번만 그린다 */
  const paintStatic = (): void => {
    bevel.clear();
    // 바깥 어두운 테두리 → 금속 링 → 안쪽 어두운 홈. 3겹이 "박혀 있다"를 만든다.
    // 원은 격자로 접은 계단 원이다 — 매끈한 원호는 4배 도트 화면에서
    // 이 위젯만 해상도가 다른 그림으로 만든다 (`pixelCircle` 참고)
    fillPixelCircle(bevel, 0, 0, r + OUTLINE_BUTTON, { color: UI_OUTLINE });
    fillPixelCircle(bevel, 0, 0, r + ART_PX / 2, { color: 0x6b6480 });
    strokePixelCircle(bevel, 0, 0, r + ART_PX / 2, {
      color: lighten(0x6b6480, 0.35),
      width: ART_PX,
    });
    fillPixelCircle(bevel, 0, 0, r - ART_PX / 4, { color: UI_OUTLINE });

    face.clear();
    fillPixelCircle(face, 0, 0, r - ART_PX, { color: opts.color });
    // 3단 셰이딩 — 타원 반달 대신 가로 블록. 곡선을 쓰면 밑색과의 경계가
    // 슬롯 안에서 유일하게 흐린 선이 된다
    fillPixelRect(face, -r * 0.82, -r * 0.86, r * 1.64, r * 0.44, ART_PX, {
      color: lighten(opts.color, 0.26),
      alpha: 0.85,
    });
    fillPixelRect(face, -r * 0.78, r * 0.5, r * 1.56, r * 0.32, ART_PX, {
      color: darken(opts.color, 0.3),
      alpha: 0.7,
    });
  };
  paintStatic();

  let state: SlotState = "ready";
  let remaining = 0;
  /** 진행도 잠금 (쿨다운과 다른 축이다 — `setLocked` 주석) */
  let locked = false;
  /** 완료 펄스. -1 = 진행 중 아님 */
  let readyMs = -1;
  let autoMs = -1;
  let pressMs = -1;
  let held = false;

  const paintOverlay = (): void => {
    overlay.clear();
    if (state === "locked") {
      icon.alpha = 0.3;
      fillPixelCircle(overlay, 0, 0, r - ART_PX, {
        color: STATE_OFF,
        alpha: 0.75,
      });
      // 이름도 같이 죽인다 — 회색 원 아래 라벨만 또렷하면 "쓸 수 있는데
      // 아이콘만 흐린 칸"으로 읽힌다 (§C4의 잠금은 칸 전체가 잠긴 것이다)
      if (label) label.alpha = 0.45;
      return;
    }
    if (label) label.alpha = 1;
    if (state === "cooling") {
      // 12시부터 시계방향 파이 (§C4)
      const sweep = Math.max(
        0,
        Math.min(1, remaining / Math.max(1, opts.skill.cooldownMs)),
      );
      fillPixelPie(overlay, 0, 0, r - ART_PX, sweep, {
        color: 0x000000,
        alpha: COOL_PIE_ALPHA,
      });
      // 남은 초 뒤에 어두운 판을 깐다. 흰 아이콘 위에 흰 숫자를 얹으면
      // "몇 초 남았나"라는 유일한 필요 정보가 아이콘 실루엣에 묻힌다
      fillPixelCircle(overlay, 0, 0, r * 0.42, { color: 0x000000, alpha: 0.5 });
      // 쿨다운 중에는 아이콘을 죽인다 — 어떤 스킬인지는 라벨로 이미 안다.
      // 지금 필요한 정보는 남은 초 하나다
      icon.alpha = 0.3;
    } else {
      icon.alpha = 1;
      // 초록 링 = "지금 누를 수 있다" (§C4). 이게 레퍼런스의 초록 버튼 자리다
      strokePixelCircle(overlay, 0, 0, r - READY_RING_W, {
        color: STATE_OK,
        width: READY_RING_W,
      });
    }
    const flash = readyFlashAlpha(readyMs);
    if (flash > 0) {
      fillPixelCircle(overlay, 0, 0, r - ART_PX / 2, {
        color: 0xffffff,
        alpha: flash * 0.75,
      });
    }
    const auto = autoPulseAlpha(autoMs);
    if (auto > 0) {
      // AUTO는 링만 — 면을 채우면 내 조작과 구분이 안 된다
      strokePixelCircle(overlay, 0, 0, r + ART_PX, {
        color: UI_TEXT,
        width: ART_PX,
        alpha: auto,
      });
    }
  };
  paintOverlay();

  view.eventMode = "static";
  view.cursor = "pointer";
  // 원형 + 반경 관용 (§C4). 사각 hitArea면 모서리를 눌러도 반응해서
  // 옆 슬롯과 경계가 흐려진다
  const hitR = r + HIT_SLACK_PX;
  view.hitArea = { contains: (x, y) => x * x + y * y <= hitR * hitR };
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
  view.on("pointertap", () => opts.onTap?.());

  /**
   * 상태·파이·숫자·완료 펄스를 **한 곳에서만** 파생시킨다. `setRemaining`과
   * `setLocked`이 각자 계산하면 잠금이 풀리는 프레임에 쿨다운 파이가 한 번
   * 사라진다(두 경로가 서로의 값을 모른다).
   */
  const applyRemaining = (remainingMs: number): void => {
    const next = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;
    // **잠금을 같이 넘긴다.** 안 넘기면 `paintOverlay`의 locked 분기가
    // 영원히 안 도는 죽은 코드가 된다 — 실제로 그랬다(3단계에 발견).
    const nextState = slotState(next, locked);
    // 쿨다운 → 준비 전이 순간에만 완료 연출을 준다. 매 프레임 ready를
    // 다시 알려도 펄스가 재시작되지 않아야 한다
    if (nextState === "ready" && state === "cooling") readyMs = 0;
    state = nextState;
    remaining = next;
    // 잠긴 칸에는 남은 초를 안 적는다 — 회색 판 위의 숫자는 "곧 열린다"로
    // 읽히지만 잠금은 시간이 아니라 진행도로 풀린다
    remainText.text = locked ? "" : cooldownLabel(next);
    paintOverlay();
  };

  return {
    view,
    skill: opts.skill,
    setRemaining: applyRemaining,
    setLocked(next: boolean): void {
      if (next === locked) return;
      locked = next;
      applyRemaining(remaining);
    },
    get locked(): boolean {
      return locked;
    },
    pulseAuto(): void {
      autoMs = 0;
    },
    update(dtMs: number): void {
      let repaint = false;
      if (readyMs >= 0) {
        readyMs += dtMs;
        inner.scale.set(readyPulse(readyMs));
        repaint = true;
        if (readyMs >= READY_PULSE_MS) {
          readyMs = -1;
          inner.scale.set(1);
        }
      }
      if (autoMs >= 0) {
        autoMs += dtMs;
        repaint = true;
        if (autoMs >= AUTO_PULSE_MS) autoMs = -1;
      }
      if (pressMs >= 0) {
        pressMs += dtMs;
        // 완료 펄스가 돌고 있으면 눌림 스케일을 덮지 않는다 — 두 스케일이
        // 같은 프레임에 싸우면 슬롯이 떨린다. 완료 쪽이 더 중요한 정보다
        if (readyMs < 0) inner.scale.set(pressScale(pressMs, held));
        if (!held && pressMs >= PRESS_OUT_MS) {
          pressMs = -1;
          if (readyMs < 0) inner.scale.set(1);
        } else if (held && pressMs >= PRESS_IN_MS) {
          pressMs = PRESS_IN_MS;
        }
      }
      if (repaint) paintOverlay();
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

/**
 * 라벨 2줄짜리 원형 배지 (AUTO 토글).
 *
 * `SkillSlot`과 형태 규칙을 공유하지만 쿨다운·아이콘이 없다. 따로 두는 이유는
 * 스킬 슬롯에 "스킬이 없는 경우" 분기를 넣으면 위 코드가 전부 옵셔널이 된다.
 */
export interface CircleButtonOpts {
  diameter: number;
  color: number;
  /** 위 줄 (굵게) */
  top: string;
  /** 아래 줄 */
  bottom?: string;
  onTap?: () => void;
}

export interface CircleButton {
  view: Container;
  setColor(color: number): void;
  setText(top: string, bottom?: string): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createCircleButton(opts: CircleButtonOpts): CircleButton {
  const view = new Container();
  const inner = new Container();
  view.addChild(inner);
  const r = opts.diameter / 2;
  const g = new Graphics();
  inner.addChild(g);

  let color = opts.color;

  const top = new Text({
    text: opts.top,
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      // 격자에 맞춰 접는다 — 1.15배(27.6px)는 획 두께가 섞인다
      fontSize: snapFontSize(T_LABEL.size * 1.15),
      fontWeight: "700",
    },
  });
  top.anchor.set(0.5);
  const bottom = new Text({
    text: opts.bottom ?? "",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: fontWeightOf(T_LABEL),
    },
  });
  bottom.anchor.set(0.5);
  bottom.visible = typeof opts.bottom === "string" && opts.bottom.length > 0;
  inner.addChild(top, bottom);

  const paint = (): void => {
    g.clear();
    // 스킬 슬롯과 같은 계단 원 3겹 — 두 위젯이 같은 형태 규칙을 쓴다
    fillPixelCircle(g, 0, 0, r + OUTLINE_BUTTON, { color: UI_OUTLINE });
    fillPixelCircle(g, 0, 0, r + ART_PX / 2, { color: 0x6b6480 });
    fillPixelCircle(g, 0, 0, r - ART_PX / 4, { color: UI_OUTLINE });
    fillPixelCircle(g, 0, 0, r - ART_PX, { color });
    fillPixelRect(g, -r * 0.82, -r * 0.86, r * 1.64, r * 0.44, ART_PX, {
      color: lighten(color, 0.26),
      alpha: 0.85,
    });
    fillPixelRect(g, -r * 0.78, r * 0.5, r * 1.56, r * 0.32, ART_PX, {
      color: darken(color, 0.3),
      alpha: 0.7,
    });
    // 2줄이면 위아래로 벌린다. 1줄이면 정중앙
    if (bottom.visible) {
      top.position.set(0, -r * 0.26);
      bottom.position.set(0, r * 0.3);
    } else {
      top.position.set(0, 0);
    }
  };
  paint();

  view.eventMode = "static";
  view.cursor = "pointer";
  const hitR = r + HIT_SLACK_PX;
  view.hitArea = { contains: (x, y) => x * x + y * y <= hitR * hitR };

  let pressMs = -1;
  let held = false;
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
  view.on("pointertap", () => opts.onTap?.());

  return {
    view,
    setColor(next: number): void {
      if (next === color) return;
      color = next;
      paint();
    },
    setText(nextTop: string, nextBottom?: string): void {
      top.text = nextTop;
      bottom.text = nextBottom ?? "";
      bottom.visible = typeof nextBottom === "string" && nextBottom.length > 0;
      paint();
    },
    update(dtMs: number): void {
      if (pressMs < 0) return;
      pressMs += dtMs;
      inner.scale.set(pressScale(pressMs, held));
      if (!held && pressMs >= PRESS_OUT_MS) {
        pressMs = -1;
        inner.scale.set(1);
      } else if (held && pressMs >= PRESS_IN_MS) {
        pressMs = PRESS_IN_MS;
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
