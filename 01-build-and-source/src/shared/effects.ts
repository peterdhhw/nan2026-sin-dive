import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { FX_SHEETS, type FxSheet } from "./fxManifest";
import { loadPixelTexture } from "./pixelTexture";
import { fxFollowAt, fxRevealAt, interferenceFx } from "./fxMapping";
import type { InterferenceKind } from "../core/types";
import type { SplitRect } from "./viewport";

export { interferenceFx };

/** 지연된 이펙트가 뜰 때 그 순간의 자리를 물어보는 함수 */
export type FxAnchor = () => { x: number; y: number };

export interface FxRequest {
  sheet: keyof typeof FX_SHEETS;
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
  tintHex?: number;
  /**
   * 이만큼 뒤에 나타난다(ms). 생략하면 즉시.
   *
   * **층을 다 같은 프레임에 깔면 한 덩어리로 뭉쳐 한 장으로 읽힌다.** 타격감은
   * 층의 개수가 아니라 층이 시간에 걸쳐 번지는 것에서 나온다
   * (`skillMeleeRules`의 `delayMs` 주석). 호출자가 `setTimeout`으로 하면 씬을
   * 나간 뒤에도 타이머가 살아서 파괴된 레이어에 스프라이트를 붙인다 — 그래서
   * 여기서 dt로 센다.
   */
  delayMs?: number;
  /**
   * 뜨는 **그 순간**의 자리를 여기서 다시 읽는다. `delayMs`가 있는 요청만 쓴다.
   *
   * `x`/`y`는 요청 시점의 좌표다. 시전 층은 최대 200ms 뒤에 뜨는데 그 사이에
   * 캐릭터는 적 앞까지 달려간다(`beginDash`) — 그러면 이펙트가 **달리기 전
   * 자리**에 남아서, 눌렀다는 증거가 캐릭터에서 떨어져 나온다. 지연이 0이면
   * 요청 좌표가 곧 지금 좌표이므로 부르지 않는다.
   *
   * 돌려주는 값은 `x`/`y`와 같은 좌표계(화면 절대)여야 한다. 호출자가 `absX`를
   * 지난 값을 주므로 여기서는 변환하지 않는다.
   */
  anchor?: FxAnchor;
}

export interface EffectPlayer {
  view: Container;
  spawn(req: FxRequest): void;
  /** 방해 이벤트를 해당 팀 영역에 즉시 연출한다 (체감 실시간의 핵심) */
  playInterference(ev: { kind: InterferenceKind }, area: SplitRect): void;
  update(dtMs: number): void;
  readonly activeCount: number;
  /**
   * 씬을 나갈 때 부른다. 살아 있는 스프라이트까지 정리한다 —
   * 재대전을 리로드 없이 하므로(§08-5) 여기서 안 치우면 판마다 누적된다.
   */
  destroy(): void;
}

interface LiveFx {
  sprite: Sprite;
  frames: Texture[];
  frameMs: number;
  elapsedMs: number;
  /** 아직 안 뜬 대기 시간(ms). 0 이하면 재생 중이다 */
  waitMs: number;
  /** 뜨는 순간 자리를 다시 읽는다. null이면 요청 좌표에 그대로 뜬다 */
  anchor: FxAnchor | null;
  /** 요청 시점 좌표 — 앵커가 망가진 값을 주면 여기로 되돌린다 */
  requested: { x: number; y: number };
}

/** 시트 텍스처를 프레임 단위로 잘라 캐시한다. */
function sliceFrames(base: Texture, sheet: FxSheet): Texture[] {
  const out: Texture[] = [];
  for (let i = 0; i < sheet.frames; i++) {
    out.push(
      new Texture({
        source: base.source,
        frame: new Rectangle(i * sheet.frameW, 0, sheet.frameW, sheet.frameH),
      }),
    );
  }
  return out;
}

export async function createEffectPlayer(): Promise<EffectPlayer> {
  const view = new Container();
  const frameCache = new Map<string, Texture[]>();

  for (const sheet of Object.values(FX_SHEETS)) {
    try {
      // 이펙트도 하드 픽셀이다(`gen_effects.py`) — 보간하면 아웃라인이 번진다
      const base = await loadPixelTexture(sheet.url);
      frameCache.set(sheet.key, sliceFrames(base, sheet));
    } catch (err) {
      console.warn(`[pvp] fx sheet "${sheet.key}" failed to load`, err);
    }
  }

  const live: LiveFx[] = [];

  const spawn = (req: FxRequest): void => {
    const sheet = FX_SHEETS[req.sheet];
    const frames = frameCache.get(sheet.key);
    if (!frames || frames.length === 0) return; // 로드 실패 시 조용히 생략

    const sprite = new Sprite(frames[0]!);
    sprite.anchor.set(0.5);
    sprite.position.set(req.x, req.y);
    sprite.scale.set(req.scale ?? 1);
    sprite.rotation = req.rotation ?? 0;
    if (req.tintHex !== undefined) sprite.tint = req.tintHex;
    const waitMs =
      req.delayMs !== undefined && req.delayMs > 0 ? req.delayMs : 0;
    // 대기 중에는 숨긴다 — 첫 프레임이 미리 떠 있으면 지연이 "멈춘 그림"이 된다
    sprite.visible = waitMs === 0;
    view.addChild(sprite);
    live.push({
      sprite,
      frames,
      frameMs: 1000 / sheet.fps,
      elapsedMs: 0,
      waitMs,
      /**
       * **지연이 0이어도 앵커를 든다.**
       *
       * 예전에는 `waitMs > 0`일 때만 들었다. "요청 좌표가 이미 지금이라 다시
       * 물어봐도 같다"는 것이 근거였는데, 그것은 **뜨는 순간**에만 맞는 말이다.
       * 이펙트는 뜬 뒤로 208~667ms를 더 사는데 그 사이 캐릭터는 적 앞까지
       * 95px 달려간다(실측) — 모든 스킬의 첫 시전 층이 `delayMs: 0`이라,
       * 눌렀다는 증거가 대기 자리에 남고 캐릭터만 떠났다.
       */
      anchor: req.anchor ?? null,
      requested: { x: req.x, y: req.y },
    });
  };

  return {
    view,
    spawn,
    playInterference(ev, area): void {
      const fx = interferenceFx(ev.kind);
      // 영역 중앙에 크게 터뜨린다 — "상대가 나에게 뭔가 했다"가 즉시 읽혀야 한다
      spawn({
        sheet: fx.sheet,
        x: area.x + area.w / 2,
        y: area.y + area.h / 2,
        scale: 2.2,
        tintHex: fx.tintHex,
      });
    },
    update(dtMs: number): void {
      for (let i = live.length - 1; i >= 0; i--) {
        const fx = live[i]!;
        if (fx.waitMs > 0) {
          fx.waitMs -= dtMs;
          if (fx.waitMs > 0) continue;
          // 남은 음수분은 첫 프레임 경과로 넘긴다 — 버리면 dt가 클 때 층 사이
          // 간격이 프레임 격자로 뭉쳐서 어긋나게 깐 의미가 사라진다
          fx.elapsedMs = -fx.waitMs;
          // **뜨는 순간의 자리로 옮긴다.** 요청 좌표는 지연 시작 시점이라
          // 그 사이에 캐릭터가 달려가면 이펙트만 뒤에 남는다.
          // 고르는 규칙은 `fxRevealAt`이다 (node에서 테스트하려고 분리했다)
          if (fx.anchor) {
            const at = fxRevealAt(fx.requested, fx.anchor());
            fx.sprite.position.set(at.x, at.y);
          }
          fx.sprite.visible = true;
        } else {
          fx.elapsedMs += dtMs;
          // **재생 중에도 따라간다.** 뜨는 순간에 한 번 앉히는 것으로는
          // 부족하다 — 이 스프라이트는 앞으로 몇백 ms를 더 사는데 캐릭터는
          // 그 사이에 적 앞까지 달려간다 (`fxFollowAt`)
          if (fx.anchor) {
            const at = fxFollowAt(fx.sprite.position, fx.anchor());
            fx.sprite.position.set(at.x, at.y);
          }
        }
        const frame = Math.floor(fx.elapsedMs / fx.frameMs);
        if (frame >= fx.frames.length) {
          fx.sprite.destroy();
          live.splice(i, 1);
          continue;
        }
        fx.sprite.texture = fx.frames[frame]!;
      }
    },
    get activeCount(): number {
      return live.length;
    },
    destroy(): void {
      live.length = 0;
      // 프레임 텍스처는 파괴하지 않는다 — 아틀라스 원본을 공유하므로
      // 다음 판의 EffectPlayer가 같은 소스를 다시 쓴다
      view.destroy({ children: true });
    },
  };
}
