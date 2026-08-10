import { Container, Graphics } from "pixi.js";
import { ACCENT_GOLD, STATE_OK, TEAM_THEIRS, UI_OUTLINE } from "../theme";
import { approach } from "../tween";
import { fillPixelRect, strokePixelRect } from "./pixelShape";
import { ART_PX, snapPx } from "./shapeRules";

/**
 * 적 머리 위 체력 바.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C5
 *
 * **아군 HP는 표시하지 않는다** — MVP 코어에 아군 사망이 없어서 항상 만피이고,
 * 정보가 없는 바가 화면을 차지하면 정작 봐야 할 적 HP의 주의를 빼앗는다.
 */

/** 채움이 이 비율 미만이면 빨강으로 (§C5) */
const DANGER_RATIO = 0.3;
/** 감소 추종 반감기. 즉시 줄면 얼마나 깎였는지 안 보인다 (§01-4) */
const FILL_HALF_LIFE_MS = 180;
/** 흰 잔상이 따라오기 시작하는 지연 */
const GHOST_DELAY_MS = 400;
const GHOST_HALF_LIFE_MS = 220;

export interface HpBarOpts {
  /** 바 폭. 보통 캐릭터 폭 × 1.1 */
  width: number;
  height?: number;
  /** 보스는 폭 1.8배 + 테두리 2겹 (§C5) */
  boss?: boolean;
}

export interface HpBar {
  view: Container;
  /** 목표 비율 0..1. 실제 표시는 부드럽게 따라간다 */
  setRatio(ratio: number): void;
  /** 애니메이션 없이 즉시 맞춘다 — 웨이브 스폰 시 만피에서 시작하게 */
  snapTo(ratio: number): void;
  resize(width: number, boss?: boolean): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createHpBar(opts: HpBarOpts): HpBar {
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);

  let width = opts.width;
  let height = opts.height ?? 16;
  let boss = opts.boss === true;

  let target = 1;
  /** 실제로 그려지는 채움 비율 */
  let shown = 1;
  /** 흰 잔상 — shown보다 뒤에서 따라온다 */
  let ghost = 1;
  let ghostDelayLeft = 0;

  const paint = (): void => {
    const w = snapPx(width);
    const h = snapPx(height);
    /**
     * 알약(반경 = 높이/2)에서 **한 칸 깎기**로 바뀌었다.
     *
     * 16px 높이 바에 반경 8px 원호를 그리면 바의 양 끝이 완전히 둥근 곡선이
     * 되는데, 그 곡선만 안티에일리어싱되어 도트 캐릭터 머리 위에서 유일하게
     * 흐린 요소가 된다. 한 칸만 깎으면 도트 게임의 체력바 실루엣이 된다.
     */
    const cut = ART_PX;
    const fill = shown < DANGER_RATIO ? TEAM_THEIRS : STATE_OK;
    const bw = ART_PX;

    g.clear();
    // 어두운 아웃라인 → 트랙 → 잔상 → 채움 → 금테 순서. 금테가 맨 위여야 모서리가 깔끔하다.
    fillPixelRect(g, -w / 2 - bw, -h / 2 - bw, w + bw * 2, h + bw * 2, cut, {
      color: UI_OUTLINE,
    });
    fillPixelRect(g, -w / 2, -h / 2, w, h, cut, { color: 0x1a1428 });

    // 채움 폭은 격자로 접는다 — 안 접으면 HP가 줄 때 끝단이 반 칸씩 떨린다
    if (ghost > shown) {
      const gw = snapPx(w * ghost);
      if (gw > 0) {
        fillPixelRect(g, -w / 2, -h / 2, gw, h, cut, {
          color: 0xffffff,
          alpha: 0.55,
        });
      }
    }
    if (shown > 0) {
      const fw = snapPx(w * shown);
      if (fw > 0) {
        fillPixelRect(g, -w / 2, -h / 2, fw, h, cut, { color: fill });
        // 상단 밝은 립 — 3단 셰이딩 규칙 (§01-3). 한 칸 두께로 고정한다
        g.rect(-w / 2, -h / 2, fw, ART_PX).fill({
          color: 0xffffff,
          alpha: 0.22,
        });
      }
    }
    strokePixelRect(g, -w / 2, -h / 2, w, h, cut, {
      color: ACCENT_GOLD,
      width: boss ? ART_PX * 2 : ART_PX,
    });
    if (boss) {
      // 보스는 테두리 2겹 — 한눈에 "이건 다르다"가 읽혀야 한다
      const o = ART_PX * 2;
      strokePixelRect(g, -w / 2 - o, -h / 2 - o, w + o * 2, h + o * 2, cut, {
        color: ACCENT_GOLD,
        width: ART_PX,
        alpha: 0.6,
      });
    }
  };

  paint();

  return {
    view,
    setRatio(ratio: number): void {
      const next = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
      // 늘어나는 경우(웨이브 교체로 같은 슬롯이 새 적이 됨)는 잔상을 남기지 않는다
      if (next > target) {
        ghost = next;
        ghostDelayLeft = 0;
      } else if (next < target) {
        ghostDelayLeft = GHOST_DELAY_MS;
      }
      target = next;
    },
    snapTo(ratio: number): void {
      const next = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
      target = next;
      shown = next;
      ghost = next;
      ghostDelayLeft = 0;
      paint();
    },
    resize(nextWidth: number, nextBoss?: boolean): void {
      width = nextWidth;
      if (nextBoss !== undefined) boss = nextBoss;
      height = boss ? 20 : (opts.height ?? 16);
      paint();
    },
    update(dtMs: number): void {
      const prevShown = shown;
      const prevGhost = ghost;

      shown = approach(shown, target, dtMs, FILL_HALF_LIFE_MS);
      // 0.5% 안쪽이면 붙인다 — 반감기는 영원히 수렴하지 않으므로 잔상이 남는다
      if (Math.abs(shown - target) < 0.005) shown = target;

      if (ghostDelayLeft > 0) {
        ghostDelayLeft -= dtMs;
      } else if (ghost > shown) {
        ghost = approach(ghost, shown, dtMs, GHOST_HALF_LIFE_MS);
        if (ghost - shown < 0.005) ghost = shown;
      }

      if (shown !== prevShown || ghost !== prevGhost) paint();
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
