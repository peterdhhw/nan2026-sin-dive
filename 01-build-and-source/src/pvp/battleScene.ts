import { Container } from "pixi.js";
import type { Scene, SceneCtx } from "../shared/sceneManager";
import type { BattleHandle } from "./runtime";

/**
 * S4. 전투 — 씬 셸.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md
 *
 * **이 씬은 화면을 그리지 않는다.** 전장은 `createSession()`이 `app.layers.*`에
 * 직접 붙인다 (HUD·필드·게이지·스킬바가 각기 다른 레이어에 있어야 z 순서가 성립한다).
 * 세션도 여기서 만들지 않는다 — VS 인트로(S3)가 화면을 가리고 있는 동안 미리
 * 만들어 둔 `BattleHandle`을 받는다 (§06-5).
 *
 * **세션을 파괴하지도 않는다.** 결과 씬(S5)이 전장을 뒤에 남긴 채 뜨기 때문이다
 * (§08-1: 뒤 전장은 계속 아이들 애니메이션). 그래서 `BattleHandle`의 수명은
 * `main.ts`가 갖는다 — 다음 대전을 시작하기 전에 거기서 파괴한다 (§09-4).
 */

export interface BattleSceneOpts {
  ctx: SceneCtx;
  /** S3에서 준비해 둔 세션 */
  handle: BattleHandle;
}

export function createBattleScene(opts: BattleSceneOpts): Scene {
  const { ctx, handle } = opts;
  const view = new Container();
  view.label = "battle";

  // 상/하 필드가 각자 배경을 그린다 — 공용 전면 배경은 완전히 가려지므로 끈다
  // (드로우콜만 버린다, §07-10 예산)
  ctx.manager.showBackground(false);

  return {
    view,
    enter(): void {
      handle.session.start();
    },
    exit(): void {
      // 루프를 멈추지 않는다. 승패가 확정되면 코어 스텝이 스스로 no-op이 되고
      // 렌더만 남아, 결과 화면 뒤에서 전장이 계속 숨을 쉰다 (§08-1)
    },
    update(): void {
      // 전투 루프는 `createLoop`이 고정 타임스텝으로 스스로 돈다 —
      // 씬 update에서 다시 돌리면 두 배속이 된다
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
