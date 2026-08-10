import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import {
  CHAR_MANIFEST_URL,
  facingFlip,
  type CharAction,
  type CharDef,
  type CharManifest,
} from "./charManifest";
import { applyPixelScale, loadPixelTexture } from "./pixelTexture";

import { fillPixelRect } from "./ui/pixelShape";
// 순수 규칙·매니페스트 타입은 charManifest.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  BOSS_SLUGS,
  CHAR_MANIFEST_URL,
  HERO_SLUGS,
  MINION_SLUGS,
  hashString,
  minionPool,
  pickEnemySlug,
  pickHeroSlugs,
} from "./charManifest";
export type { CharAction, CharDef, CharManifest } from "./charManifest";

/**
 * 스프라이트시트 캐릭터 — Spine 리그를 대체한다.
 *
 * **왜 Spine을 버렸나**: 우리가 쓴 리그는 정면-ish 3/4 뷰 한 벌뿐이었다.
 * 횡스크롤 전투는 진짜 옆모습이어야 하고(에셋 조사 DECISION.md), 무엇보다
 * 종류가 하나면 999층을 내려가도 같은 적만 나온다. CC0 픽셀아트 22종을
 * 가져오면 종류·액션이 한 번에 늘고 용량은 오히려 줄었다(832KB → 629KB).
 *
 * 인터페이스는 `SpineChar`와 같게 유지한다 — `battleField`/`titleScene`이
 * 이미 그 모양으로 캐릭터를 다룬다.
 */
export interface SpriteChar {
  view: Container;
  play(anim: string, loop?: boolean): void;
  /** 1회 재생 후 지정 애니메이션으로 되돌아간다 (공격 → idle) */
  playOnce(anim: string, thenLoop: string): void;
  setFacing(dir: 1 | -1): void;
  /** 곱셈 톤. 히트 플래시(흰색)와 웨이브 테마 환경광이 같은 채널을 쓴다 */
  setTint(hex: number, alpha?: number): void;
  /** `view.position` 기준 시각 범위(px). 스케일·좌우 반전이 반영되어 있다 */
  visualExtent(): { left: number; right: number };
  /**
   * 이 이름으로 **실제 재생될** 액션의 메타. 없으면 null.
   *
   * 대체 사슬을 타서 다른 액션이 나올 수 있으므로(`special` → `attack2`)
   * 호출자가 `def.actions[name]`을 직접 보면 안 된다 — 그러면 재생 길이와
   * 임팩트 프레임이 실제 재생되는 클립과 어긋나 HP가 엉뚱한 때 깎인다.
   */
  actionMeta(name: string): CharAction | null;
  /** 우리 고정 타임스텝으로 프레임을 넘긴다 */
  update(dtMs: number): void;
  destroy(): void;
  /** 에셋 로드 실패로 사각형이 그려진 상태인지 */
  readonly isPlaceholder: boolean;
  /** 이 캐릭터의 정의 (표시 이름·라이선스·액션 목록) */
  readonly def: CharDef | null;
}

/** `SpineChar`와 이름을 맞춰 둔다 — 호출부가 둘을 구별하지 않아도 되게 */
export type { SpriteChar as SpineChar };

let manifest: CharManifest | null = null;

/**
 * 살아 있는 캐릭터 수.
 *
 * 재대전이 리로드가 아니므로(§08-5) `destroy()`를 한 번 빼먹으면 판마다
 * 4~8개가 쌓인다. 화면만 봐서는 절대 눈치챌 수 없어서 셈을 코드에 박는다.
 */
let liveChars = 0;

export function liveCharCount(): number {
  return liveChars;
}

/** 매니페스트 + 필요한 시트를 받는다. 같은 슬러그를 두 번 받지 않는다 (Assets 캐시) */
export async function loadCharManifest(): Promise<CharManifest> {
  if (manifest) return manifest;
  const raw = (await Assets.load(CHAR_MANIFEST_URL)) as unknown;
  const m = raw as CharManifest;
  if (!m || typeof m !== "object" || typeof m.chars !== "object") {
    throw new Error("[pvp] chars.json 형식이 아니다");
  }
  manifest = m;
  return m;
}

export function charDef(slug: string): CharDef | null {
  return manifest?.chars[slug] ?? null;
}

/** 시트 URL — `chars.json`과 같은 폴더 규칙이다 */
export function charSheetUrl(slug: string): string {
  return `assets/chars/${slug}.png`;
}

/**
 * 미리 받아 둘 시트 목록. boot에서 한꺼번에 받는다 — 전투 중에 받으면
 * 새 몹이 처음 등장하는 프레임에 한 번씩 멈춘다.
 */
export async function loadCharSheets(slugs: readonly string[]): Promise<void> {
  for (const s of slugs) {
    // 순차 로드 — 병렬로 22장을 던지면 모바일에서 첫 진입이 오히려 느리다
    await loadPixelTexture(charSheetUrl(s));
  }
}

/** 이미 받아 둔 시트 텍스처. 안 받았으면 null (동기 생성이 여기서 갈린다) */
function loadedSheet(slug: string): Texture | null {
  const t = Assets.get(charSheetUrl(slug)) as Texture | undefined;
  return t ?? null;
}

function placeholder(heightPx: number, tintHex: number): SpriteChar {
  const view = new Container();
  const w = heightPx * 0.45;
  const box = new Graphics();
  fillPixelRect(box, -w / 2, -heightPx, w, heightPx, 6, {
    color: tintHex,
    alpha: 0.85,
  });
  view.addChild(box);
  liveChars += 1;
  let alive = true;
  return {
    view,
    play(): void {},
    playOnce(): void {},
    setFacing(dir: 1 | -1): void {
      view.scale.x = Math.abs(view.scale.x) * dir;
    },
    setTint(hex: number, alpha = 1): void {
      box.tint = hex;
      box.alpha = alpha * 0.85;
    },
    visualExtent(): { left: number; right: number } {
      return { left: -w / 2, right: w / 2 };
    },
    // 플레이스홀더엔 액션이 없다. 호출자는 null이면 기본 길이로 돌린다 —
    // 에셋 로드 실패로 근접 타임라인이 멈추면 전투가 진행되지 않는다
    actionMeta(): CharAction | null {
      return null;
    },
    update(): void {},
    destroy(): void {
      // 두 번 파괴되면 셈이 음수가 된다 — 그러면 누수 검증이 거짓 통과한다
      if (!alive) return;
      alive = false;
      liveChars -= 1;
      view.destroy({ children: true });
    },
    isPlaceholder: true,
    def: null,
  };
}

/** 액션 프레임 i의 시트 내 사각형 */
export function frameRect(a: CharAction, i: number): Rectangle {
  const n = Math.max(1, a.frames);
  const fi = ((Math.floor(i) % n) + n) % n;
  return new Rectangle(
    (fi % a.cols) * a.cellW,
    a.y + Math.floor(fi / a.cols) * a.cellH,
    a.cellW,
    a.cellH,
  );
}

/**
 * 요청한 애니메이션 → 이 캐릭터가 실제로 가진 액션 이름.
 *
 * 에셋마다 있는 액션이 다르다 — `flying_eye`엔 `idle`이 없고 `walk`만 있으며,
 * 잡몹 절반은 `attack2`가 없다. 없는 이름을 그대로 넘기면 아무것도 재생되지
 * 않아 적이 얼어붙는다. 대체 순서를 한 곳에 모아 둔다.
 */
const FALLBACK: Record<string, readonly string[]> = {
  idle: ["idle", "walk", "run"],
  walk: ["walk", "run", "idle"],
  run: ["run", "walk", "idle"],
  attack: ["attack1", "attack2", "attack3", "idle", "walk"],
  attack1: ["attack1", "attack2", "attack3", "idle", "walk"],
  attack2: ["attack2", "attack3", "attack1", "idle"],
  attack3: ["attack3", "attack2", "attack1", "idle"],
  hit: ["hit", "idle", "walk"],
  death: ["death", "hit", "idle"],
  // 주인공 전용 액션. 잡몹에는 없으므로 일반 공격·달리기로 떨어진다 —
  // 근접 돌진은 주인공만 하지만 갤러리·디버그가 아무 슬러그로나 부른다
  special: ["special", "attack2", "attack1", "attack3", "idle"],
  roll: ["roll", "run", "walk", "idle"],
};

export function resolveAction(def: CharDef, want: string): string | null {
  const chain = FALLBACK[want] ?? [want, "idle", "walk", "run"];
  for (const c of chain) if (def.actions[c]) return c;
  const first = Object.keys(def.actions)[0];
  return first ?? null;
}

interface BuildOpts {
  slug: string;
  def: CharDef;
  heightPx: number;
  tintHex: number;
  idle: string;
  /** 액션마다 다른 재생 속도 배율 (빠른 캐릭터는 idle도 빠르다) */
  fpsMul?: number;
}

function build(opts: BuildOpts): SpriteChar {
  const { def } = opts;
  const base = Texture.from(charSheetUrl(opts.slug));
  /**
   * 동기 생성 경로(`createEnemyCharSync`)는 로더를 안 거치므로 여기서 한 번 더
   * 세운다. 멱등하고, 빼면 웨이브 교체로 등장한 적만 흐릿해진다 —
   * 같은 화면에 선명한 적과 흐린 적이 섞이는 것이 전부 흐린 것보다 나쁘다.
   */
  applyPixelScale(base);
  const view = new Container();
  const sprite = new Sprite();
  // 앵커는 코드로 잡지 않는다 — 액션마다 셀 크기가 달라서 매 전환에 다시 계산한다
  view.addChild(sprite);

  /**
   * 표시 배율. 셀이 아니라 **기준 액션 피사체 높이**로 정규화한다.
   * 셀은 288×128 안에 33px 캐릭터가 든 경우가 있어 셀로 맞추면 개미가 된다.
   */
  const scale = opts.heightPx / Math.max(1, def.refSubjH);
  const fpsMul = opts.fpsMul ?? 1;

  let act: CharAction | null = null;
  let actName = "";
  let frame = 0;
  let accMs = 0;
  let looping = true;
  let queuedLoop: string | null = null;
  let alive = true;
  let tintHex = opts.tintHex;
  let tintAlpha = 1;
  /** 지금 바라보는 **월드** 방향 (+1 = 오른쪽) */
  let facing: 1 | -1 = 1;
  /**
   * 시트에 그려진 원본 방향. 우리 4인은 왼쪽(-1), CC0 잡몹은 오른쪽(+1)이다.
   * 매니페스트에 없으면 오른쪽으로 본다 — 기존 에셋 전부가 그랬다.
   */
  const nativeFacing: 1 | -1 = def.faces ?? 1;
  /** 원하는 방향과 원본 방향이 다를 때만 뒤집는다 (규칙은 charManifest에) */
  const flipX = (): 1 | -1 => facingFlip(facing, nativeFacing);

  /** 현재 프레임 텍스처를 갈아끼운다. 프레임 텍스처를 캐시한다 — 매 프레임 new는 GC를 부른다 */
  const cache = new Map<string, Texture>();
  const texFor = (a: CharAction, name: string, i: number): Texture => {
    const key = `${name}#${i}`;
    let t = cache.get(key);
    if (!t) {
      t = new Texture({ source: base.source, frame: frameRect(a, i) });
      cache.set(key, t);
    }
    return t;
  };

  /** 좌우 반전만 다시 세운다. 프레임 갱신과 `setFacing` 둘 다 여기를 지난다 */
  const applyFacing = (): void => {
    sprite.scale.set(scale * flipX(), scale);
  };

  const applyFrame = (): void => {
    if (!act || !alive) return;
    sprite.texture = texFor(act, actName, frame);
    // 반전은 `flipX()`가 쥔다 — 현재 scale의 부호를 읽어 되쓰면(예전 방식)
    // 원본 방향 보정이 프레임마다 지워진다
    applyFacing();
    /**
     * 발을 원점에 붙인다. 셀 하단은 발밑이 아니다 — 에셋마다 최대 83px
     * 여백이 있어서(`baseGap`) 그냥 붙이면 캐릭터가 공중에 뜬다.
     * `dy`는 액션 간 발밑 편차 보정이다.
     */
    const footY = act.cellH - def.baseGap - act.dy;
    sprite.anchor.set(0.5, footY / act.cellH);
    // 앵커가 세로 비율이라 셀 높이가 바뀌면 위치도 바뀐다 — y는 여기서만 만진다
    sprite.position.set(0, 0);
  };

  const setAction = (name: string, loop: boolean): void => {
    const resolved = resolveAction(def, name);
    if (resolved === null) return;
    const a = def.actions[resolved];
    if (!a) return;
    if (resolved === actName && loop === looping) return;
    act = a;
    actName = resolved;
    frame = 0;
    accMs = 0;
    looping = loop;
    applyFrame();
  };

  const applyTint = (): void => {
    sprite.tint = tintHex;
    sprite.alpha = tintAlpha;
  };

  setAction(opts.idle, true);
  applyTint();
  liveChars += 1;

  return {
    view,
    play(anim: string, loop = true): void {
      queuedLoop = null;
      setAction(anim, loop);
    },
    playOnce(anim: string, thenLoop: string): void {
      const resolved = resolveAction(def, anim);
      // 없는 액션이면 대기 루프를 건드리지 않는다 — 없다고 얼어붙으면 안 된다
      if (resolved === null) return;
      setAction(anim, false);
      queuedLoop = thenLoop;
    },
    setFacing(dir: 1 | -1): void {
      /**
       * `dir`은 **월드 방향**이다(+1 = 오른쪽). 시트가 원래 어느 쪽을 보는지와
       * 나눠 생각해야 한다 — 왼쪽 보게 렌더한 시트에 `scale.x = +1`을 주면
       * 그대로 왼쪽을 본 채 오른쪽으로 이동해서, 등을 보이고 뒷걸음질하는
       * 그림이 된다. 원본 방향과 원하는 방향이 다를 때만 뒤집는다.
       */
      facing = dir;
      applyFacing();
    },
    setTint(hex: number, alpha = 1): void {
      tintHex = hex;
      tintAlpha = alpha;
      applyTint();
    },
    visualExtent(): { left: number; right: number } {
      if (!act) return { left: 0, right: 0 };
      const [bx, , bw] = act.box;
      const sx = scale * Math.sign(sprite.scale.x || 1);
      // 박스는 셀 좌표다. 앵커(가로 0.5)를 기준으로 옮긴 뒤 배율을 곱한다
      const l = (bx - act.cellW / 2) * sx;
      const r = (bx + bw - act.cellW / 2) * sx;
      return { left: Math.min(l, r), right: Math.max(l, r) };
    },
    actionMeta(name: string): CharAction | null {
      const resolved = resolveAction(def, name);
      return resolved === null ? null : (def.actions[resolved] ?? null);
    },
    update(dtMs: number): void {
      if (!act || !alive) return;
      const fps = Math.max(1, act.fps * fpsMul);
      accMs += dtMs;
      const stepMs = 1000 / fps;
      while (accMs >= stepMs) {
        accMs -= stepMs;
        frame += 1;
        if (frame >= act.frames) {
          if (looping) {
            frame = 0;
          } else {
            // 마지막 프레임에서 멈춘다 — 사망 연출이 첫 프레임으로 되돌아가면
            // 죽은 적이 다시 일어난 것처럼 보인다
            frame = act.frames - 1;
            accMs = 0;
            const next = queuedLoop;
            queuedLoop = null;
            if (next !== null) {
              setAction(next, true);
              return;
            }
            break;
          }
        }
      }
      applyFrame();
    },
    destroy(): void {
      if (!alive) return;
      alive = false;
      liveChars -= 1;
      // 프레임 텍스처는 소스를 공유하므로 소스는 파괴하지 않는다 —
      // 같은 시트를 다음 판이 다시 쓴다 (재대전은 리로드가 아니다)
      for (const t of cache.values()) t.destroy(false);
      cache.clear();
      view.destroy({ children: true });
    },
    isPlaceholder: false,
    def,
  };
}

async function create(
  slug: string,
  heightPx: number,
  tintHex: number,
  idle: string,
  fallbackTint: number,
  fpsMul?: number,
): Promise<SpriteChar> {
  try {
    await loadCharManifest();
    const def = charDef(slug);
    if (!def) throw new Error(`unknown char "${slug}"`);
    await loadPixelTexture(charSheetUrl(slug));
    return build({
      slug,
      def,
      heightPx,
      tintHex,
      idle,
      ...(fpsMul === undefined ? {} : { fpsMul }),
    });
  } catch (err) {
    console.warn(`[pvp] char "${slug}" failed, using placeholder`, err);
    return placeholder(heightPx, fallbackTint);
  }
}

/** 아군 하나. `heightPx`는 기준 액션 피사체 높이로 정규화된다 */
export function createHeroChar(
  slug: string,
  heightPx: number,
  tintHex = 0xffffff,
): Promise<SpriteChar> {
  return create(slug, heightPx, tintHex, "idle", tintHex);
}

/**
 * 적 하나. 종별 높이 배율(`hMul`)은 호출자가 아니라 여기서 곱한다 —
 * 쥐와 해골이 같은 키면 무엇이 위험한지 구별되지 않는다.
 */
export async function createEnemyChar(
  slug: string,
  slotHeightPx: number,
  tintHex = 0xffffff,
): Promise<SpriteChar> {
  await loadCharManifest().catch(() => null);
  return createEnemyCharSync(slug, slotHeightPx, tintHex);
}

/**
 * 적 하나 — **동기**. 웨이브가 바뀌는 순간 슬롯의 종족을 갈아끼우는 데 쓴다.
 *
 * 왜 동기가 필요한가: 스폰은 코어 이벤트에 붙어 있고, `await` 한 프레임이라도
 * 끼면 그 사이에 들어온 피격 이벤트가 아직 없는 스프라이트를 만진다. boot가
 * 시트를 전부 받아 두므로(§bootScene `chars` 단계) 여기서 기다릴 것이 없다.
 * 아직 안 받은 상태면 플레이스홀더로 떨어진다 — 얼어붙는 것보다 낫다.
 */
export function createEnemyCharSync(
  slug: string,
  slotHeightPx: number,
  tintHex = 0xffffff,
): SpriteChar {
  const def = charDef(slug);
  const height = slotHeightPx * (def?.hMul ?? 1);
  if (!def || !loadedSheet(slug)) {
    console.warn(`[pvp] char "${slug}" not preloaded, using placeholder`);
    return placeholder(height, 0x7ad86a);
  }
  return build({ slug, def, heightPx: height, tintHex, idle: "idle" });
}

/** 이 적을 지면에서 얼마나 띄울지 (공중 몹) */
export function charLift(slug: string): number {
  return charDef(slug)?.lift ?? 0;
}
