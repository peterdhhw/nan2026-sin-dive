import { Container, Graphics, Text } from "pixi.js";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  T_TITLE,
  UI_OUTLINE,
  UI_TEXT,
  UI_TEXT_ON_CREAM,
} from "../theme";
import { darken, lighten, readableText } from "../color";
import {
  BANNER_COLOR,
  BANNER_H,
  BANNER_HOLD_MS,
  BANNER_IN_MS,
  type BannerKind,
  type BannerRequest,
  SLANT,
  bannerAction,
  bannerOffset,
  bannerPhase,
  enqueue,
} from "./bannerRules";

// 순수 규칙은 bannerRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  BANNER_COLOR,
  BANNER_H,
  BANNER_HOLD_MS,
  bannerAction,
  bannerOffset,
  bannerPhase,
  enqueue,
  type BannerKind,
} from "./bannerRules";

/**
 * 전폭 공지 배너.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C8
 *
 * `hud.setNotice()`의 맨 텍스트 한 줄을 대체한다 — 방해를 맞았다는 사실은
 * 게임의 판단 재료이므로 텍스트가 스르륵 나타나는 정도로는 놓친다.
 */

export interface BannerOpts {
  /** 전폭 (디자인 좌표) */
  w: number;
}

export interface Banner {
  view: Container;
  /**
   * 배너를 띄운다. 이미 하나가 떠 있으면 큐에 넣고, 같은 것이 연속으로 오면
   * 유지 시간만 갱신한다 (§C8).
   */
  show(kind: BannerKind, text: string, holdMs?: number): void;
  resize(w: number): void;
  update(dtMs: number): void;
  /** 씬 전환 시 즉시 비운다 */
  clear(): void;
  destroy(): void;
}

export function createBanner(opts: BannerOpts): Banner {
  const view = new Container();
  view.visible = false;

  const bg = new Graphics();
  const label = new Text({
    text: "",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_TITLE.size,
      fontWeight: "700",
    },
  });
  label.anchor.set(0.5);
  view.addChild(bg, label);

  let w = Math.max(1, opts.w);
  let current: BannerRequest | null = null;
  let elapsed = 0;
  /** 병합으로 늘어날 수 있으므로 요청값을 따로 들고 있는다 */
  let holdMs = BANNER_HOLD_MS;
  let queue: BannerRequest[] = [];

  const paint = (req: BannerRequest): void => {
    const base = BANNER_COLOR[req.kind];
    bg.clear();
    // 좌우 끝이 사선인 리본. 위/아래 변은 수평이므로 전폭을 가로지른 느낌이 산다
    const pts = [SLANT, 0, w, 0, w - SLANT, BANNER_H, 0, BANNER_H];
    bg.poly(pts).fill({ color: base });
    // 3단 셰이딩 — 상단 밝은 립 / 하단 어두운 굽. 사선을 유지하려면 poly로 잘라야 한다
    const lipH = Math.round(BANNER_H * 0.16);
    const bootH = Math.round(BANNER_H * 0.2);
    bg.poly([
      SLANT,
      0,
      w,
      0,
      w - Math.round(SLANT * (1 - lipH / BANNER_H)),
      lipH,
      SLANT - Math.round(SLANT * (lipH / BANNER_H)),
      lipH,
    ]).fill({ color: lighten(base, 0.22) });
    bg.poly([
      Math.round(SLANT * (bootH / BANNER_H)),
      BANNER_H - bootH,
      w - Math.round(SLANT * (1 - bootH / BANNER_H)),
      BANNER_H - bootH,
      w - SLANT,
      BANNER_H,
      0,
      BANNER_H,
    ]).fill({ color: darken(base, 0.25) });
    // 상하 금색 1px — 리본이 프레임에 물려 있는 느낌
    bg.moveTo(SLANT, 1)
      .lineTo(w, 1)
      .stroke({ color: ACCENT_GOLD, width: 2, alpha: 0.8 });
    bg.moveTo(0, BANNER_H - 1)
      .lineTo(w - SLANT, BANNER_H - 1)
      .stroke({ color: ACCENT_GOLD, width: 2, alpha: 0.8 });
    bg.poly(pts).stroke({ color: UI_OUTLINE, width: 4, alignment: 1 });

    label.text = req.text;
    // 금색 배너 위 흰 글씨는 안 읽힌다 — 명도로 글자색을 고른다 (§01-6)
    label.style.fill = readableText(base, UI_TEXT, UI_TEXT_ON_CREAM);
    label.position.set(w / 2, BANNER_H / 2);
  };

  const start = (req: BannerRequest): void => {
    current = req;
    holdMs = req.holdMs;
    elapsed = 0;
    paint(req);
    view.visible = true;
  };

  return {
    view,
    show(kind: BannerKind, text: string, hold: number = BANNER_HOLD_MS): void {
      const req: BannerRequest = { kind, text, holdMs: hold };
      /**
       * 배너는 1.26초만 떠 있다 — 캡처 한 장으로는 "떴는가"를 물을 수 없다
       * (찍는 순간이 그 창을 비껴가면 화면에 없다). 헤드리스 하네스가 이
       * 로그로 종류·문구·처리를 읽는다. `kind`가 로그에 있어야 팀원 시전이
       * 정말 `teammate`로 갈렸는지 셀 수 있다 — 문구만 보면 접두사가 붙은
       * 것까지는 알지만 색·슬롯이 갈렸는지는 모른다.
       */
      if (import.meta.env.DEV) {
        console.log(
          `[banner] kind=${kind} act=${bannerAction(current, req)} text=${text}`,
        );
      }
      switch (bannerAction(current, req)) {
        case "start":
          start(req);
          return;
        case "refill":
          // 유지 구간을 다시 채운다 — 이미 퇴장 중이면 유지로 되돌린다
          elapsed = Math.min(elapsed, BANNER_IN_MS);
          holdMs = hold;
          return;
        case "retarget":
          // 문구만 갈아탄다. 스와이프를 처음부터 다시 하면 화면이 계속
          // 배너로 덮여 필드를 못 본다 — 위치는 유지하고 내용을 바꾼다
          current = req;
          holdMs = hold;
          elapsed = Math.min(elapsed, BANNER_IN_MS);
          paint(req);
          return;
        default:
          // 같은 종류의 대기 중 배너를 밀어낸다 — 대기 줄에서도 지난 내용을
          // 들고 있지 않는다
          queue = enqueue(queue, req);
          return;
      }
    },
    resize(nextW: number): void {
      w = Math.max(1, nextW);
      if (current) paint(current);
    },
    update(dtMs: number): void {
      if (!current) return;
      elapsed += dtMs;
      const phase = bannerPhase(elapsed, holdMs);
      if (phase === "done") {
        current = null;
        const next = queue.shift();
        if (next) {
          start(next);
          return;
        }
        view.visible = false;
        return;
      }
      view.x = bannerOffset(elapsed, holdMs) * w;
    },
    clear(): void {
      queue = [];
      current = null;
      view.visible = false;
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
