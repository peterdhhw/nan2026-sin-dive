import { ColorMatrixFilter, Container, Graphics, Rectangle } from "pixi.js";
import { saturateDelta } from "../color";
import { SCRIM_ALPHA, SCRIM_COLOR } from "../theme";
import { SCRIM_FADE_MS, SCRIM_SATURATE, scrimDimRect, type ScrimRect } from "./scrimRules";

// 순수 규칙은 scrimRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  SCRIM_FADE_MS,
  SCRIM_SATURATE,
  scrimDimRect,
  scrimSaturate,
  type ScrimRect,
} from "./scrimRules";

/**
 * 배경 딤 — 팝업 뒤를 어둡게 + 채도를 낮춘다.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C9
 *
 * **탭을 삼킨다.** 어두워진 뒤 요소를 눌러 상태가 바뀌면 유저는 무엇을 눌렀는지
 * 모르는 채 게임이 변한 것을 본다 — 팝업이 뜬 동안의 오조작은 되돌릴 수 없다.
 */

export interface ScrimOpts {
  w: number;
  h: number;
  /**
   * 채도를 깎을 대상. 스크림 자신에 필터를 걸면 단색이라 아무 효과가 없다 —
   * 뒤에 있는 컨테이너를 넘겨야 한다. 없으면 딤만 적용된다.
   */
  target?: Container | null;
  /** 스크림을 탭했을 때 (팝업 닫기용). 없으면 삼키기만 한다 */
  onTap?: () => void;
  /**
   * 어둡게 **칠할** 구역(디자인 좌표). 생략하면 전면이다.
   *
   * 탭 삼키기는 여기와 무관하게 늘 전면이다 — 왜 두 구역이 다른지는
   * `scrimRules.scrimDimRect` 주석에 있다.
   */
  dimRect?: ScrimRect | null;
}

export interface Scrim {
  view: Container;
  show(): void;
  /** 페이드 아웃 후 숨긴다. 완료를 기다리려면 `update`를 계속 돌려야 한다 */
  hide(): void;
  readonly visible: boolean;
  resize(w: number, h: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createScrim(opts: ScrimOpts): Scrim {
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  view.visible = false;
  view.alpha = 0;

  let w = Math.max(1, opts.w);
  let h = Math.max(1, opts.h);
  const dim = opts.dimRect ?? null;
  const paint = (): void => {
    const r = scrimDimRect(w, h, dim);
    g.clear().rect(r.x, r.y, r.w, r.h).fill({ color: SCRIM_COLOR, alpha: SCRIM_ALPHA });
    /* **히트 영역을 명시한다.** `hitArea`를 안 주면 Pixi가 자식의 경계로
     * 잡으므로, 칠하는 구역을 좁힌 순간 삼키는 구역도 같이 좁아진다 — 그러면
     * 시트가 열린 동안 HUD의 타이틀 버튼이 눌려서 모달 위에서 씬이 바뀐다
     * (`scrimRules.scrimDimRect` 주석). 두 구역을 여기서 갈라 놓는다. */
    view.hitArea = new Rectangle(0, 0, w, h);
  };
  paint();

  // eventMode static + hitArea 전면 = 탭 삼킴. `onTap`이 없어도 이벤트를
  // 여기서 멈춰야 뒤 요소로 흐르지 않는다
  view.eventMode = "static";
  view.cursor = opts.onTap ? "pointer" : "default";
  view.on("pointertap", () => opts.onTap?.());

  const target = opts.target ?? null;
  const desat = new ColorMatrixFilter();
  desat.saturate(saturateDelta(SCRIM_SATURATE), false);

  /** 원래 필터를 복원해야 한다 — 필드가 이미 필터를 갖고 있을 수 있다 */
  const applyFilter = (on: boolean): void => {
    if (!target) return;
    if (on) {
      const cur = target.filters;
      const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
      if (!list.includes(desat)) target.filters = [...list, desat];
      return;
    }
    const cur = target.filters;
    const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
    target.filters = list.filter((f) => f !== desat);
  };

  /** 1 = 보임 목표, 0 = 숨김 목표 */
  let goal = 0;

  return {
    view,
    get visible(): boolean {
      return view.visible;
    },
    show(): void {
      goal = 1;
      view.visible = true;
      applyFilter(true);
    },
    hide(): void {
      goal = 0;
    },
    resize(nextW: number, nextH: number): void {
      w = Math.max(1, nextW);
      h = Math.max(1, nextH);
      paint();
    },
    update(dtMs: number): void {
      if (!view.visible) return;
      const step = dtMs / SCRIM_FADE_MS;
      if (goal === 1) {
        view.alpha = Math.min(1, view.alpha + step);
        return;
      }
      view.alpha = Math.max(0, view.alpha - step);
      if (view.alpha <= 0) {
        view.visible = false;
        applyFilter(false);
      }
    },
    destroy(): void {
      applyFilter(false);
      view.destroy({ children: true });
    },
  };
}
