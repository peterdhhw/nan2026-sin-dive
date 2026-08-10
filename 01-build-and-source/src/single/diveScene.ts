/**
 * S-dive. 하강(싱글) — 씬 셸 + 스와이프 제스처 배선.
 *
 * PvP의 battleScene처럼 화면은 그리지 않는다 — 전장·HUD·강화 UI는
 * `createDiveSession()`이 `app.layers.*`에 직접 붙인다. PvP와 달리 세션을
 * **씬이 만들고 씬이 파괴한다**: 싱글에는 결과 씬이 없어 세션과 씬의 수명이
 * 같기 때문이다 (PvP는 결과 화면 뒤에 전장이 남아야 해서 main이 소유한다).
 *
 * 제스처: 이 코드베이스에 처음 생기는 포인터 제스처 처리다. 판정은
 * `swipeRules.ts`(순수)가 하고, 씬은 스테이지에서 다운/업 좌표만 모아 넘긴다.
 * - 전장에서 위로 스와이프 → `session.swipe()` (하강 가속)
 * - 아래 밴드(강화 줄·스킬바)에서 위로 드래그 → 강화 시트 열기
 */

import { Container, type FederatedPointerEvent } from "pixi.js";
import type { Scene, SceneCtx } from "../shared/sceneManager";
import type { Loadout } from "../loadout/types";
import { DESIGN_H } from "../shared/viewport";
import { createDiveSession, type DiveSession } from "./session";
import type { IdleReward } from "./idleRules";
import type { SingleSave, SingleStore } from "./saveRules";
import type { CardReward } from "../shared/scenes/cardRules";
import { classifySwipe, fieldSwipeAllowed, type SwipeSample } from "./swipeRules";
import { SHEET_DRAG_OPEN_PX } from "./upgradePanelRules";
import { SWIPE_MAX_MS } from "./swipeRules";

export interface DiveSceneOpts {
  ctx: SceneCtx;
  loadout: Loadout;
  save: SingleSave;
  idle: IdleReward | null;
  store: SingleStore;
  seed: number;
  /** 보유 카드 장수 → 팀 딜 배율. 카드함 저장은 main만 본다 (session.ts 주석) */
  cardCount: number;
  /** 카드 한 장 뽑기 — 뽑고 저장하는 곳도 main이다 (session.ts 주석) */
  drawCard(): CardReward;
  /** 세션 생성 시각(epoch ms) — main만 Date.now()를 읽는다 */
  baseEpochMs: number;
  onExit(): void;
}

export async function createDiveScene(opts: DiveSceneOpts): Promise<Scene> {
  const { ctx } = opts;
  const view = new Container();
  view.label = "dive";

  // 전장이 자기 배경을 그린다 — 공용 전면 배경은 가려지므로 끈다
  ctx.manager.showBackground(false);

  const session: DiveSession = await createDiveSession({
    app: ctx.app,
    loadout: opts.loadout,
    save: opts.save,
    idle: opts.idle,
    store: opts.store,
    seed: opts.seed,
    cardCount: opts.cardCount,
    drawCard: opts.drawCard,
    baseEpochMs: opts.baseEpochMs,
    onExit: opts.onExit,
    debug: ctx.debug,
  });

  // ── 제스처 — 스테이지 전역에서 다운/업을 모은다 ──────────────────────
  // 씬 view(sceneRoot)는 레이어들 위에 있어서 여기에 hitArea를 깔면 아래
  // 버튼·슬롯이 탭을 못 받는다. 스테이지 리스너는 버블링으로 오는 이벤트만
  // 듣는다 — 버튼 탭도 스와이프 시작점이 될 수 있지만 판정(거리·시간)이
  // 탭과 스와이프를 가른다.
  const stage = ctx.app.app.stage;
  const prevEventMode = stage.eventMode;
  const prevHitArea = stage.hitArea;
  stage.eventMode = "static";
  stage.hitArea = ctx.app.app.screen;

  /** 제스처 시계 — 프레임 델타 누적 (벽시계를 읽지 않는다) */
  let gestureClockMs = 0;
  let downSample: SwipeSample | null = null;

  const toSample = (e: FederatedPointerEvent): SwipeSample => {
    // 화면 px → 디자인 좌표(720×1280). root가 캔버스에 스케일되어 있다
    const p = ctx.app.root.toLocal(e.global);
    return { x: p.x, y: p.y, atMs: gestureClockMs };
  };

  const onDown = (e: FederatedPointerEvent): void => {
    downSample = toSample(e);
  };

  const onUp = (e: FederatedPointerEvent): void => {
    if (!downSample) return;
    const start = downSample;
    const end = toSample(e);
    downSample = null;
    if (session.modalOpen) return; // 모달(스토리·시트) 위에서는 하강 제스처를 누른다

    const verdict = classifySwipe(start, end, DESIGN_H);
    if (verdict === "descend") {
      session.swipe();
      return;
    }
    // 아래 밴드에서 시작한 위 드래그 = 강화 시트 열기 (하강 스와이프가 아니다)
    const dy = end.y - start.y;
    const dt = end.atMs - start.atMs;
    if (!fieldSwipeAllowed(start.y, DESIGN_H) && dy <= -SHEET_DRAG_OPEN_PX && dt <= SWIPE_MAX_MS) {
      session.openUpgradeSheet();
    }
  };

  const onCancel = (): void => {
    downSample = null;
  };

  stage.on("pointerdown", onDown);
  stage.on("pointerup", onUp);
  stage.on("pointerupoutside", onCancel);

  return {
    view,
    enter(): void {
      session.start();
    },
    exit(): void {
      session.stop();
    },
    update(dtMs: number): void {
      // 전투 루프는 createLoop이 스스로 돈다 (여기서 돌리면 2배속) —
      // 씬은 제스처 시계만 굴린다
      gestureClockMs += dtMs;
    },
    destroy(): void {
      stage.off("pointerdown", onDown);
      stage.off("pointerup", onUp);
      stage.off("pointerupoutside", onCancel);
      stage.eventMode = prevEventMode;
      stage.hitArea = prevHitArea;
      session.destroy();
      view.destroy({ children: true });
    },
  };
}
