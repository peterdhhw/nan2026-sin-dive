import { ColorMatrixFilter, Container, Graphics } from "pixi.js";
import type { CharacterLoadout } from "../loadout/types";
import type { WaveDef } from "../core/types";
import { createRng, type Rng } from "../core/rng";
import {
  BOSS_SLUGS,
  MINION_SLUGS,
  charLift,
  createEnemyCharSync,
  createHeroChar,
  loadCharManifest,
  loadCharSheets,
  pickEnemySlug,
  type SpriteChar,
} from "./spriteChar";
import type { EffectPlayer } from "./effects";
import { dashDustFx, meleeFx } from "./meleeFx";
import {
  skillCastFx,
  skillHitFx,
  skillMelee,
  skillStyle,
  type SkillFxSpec,
  type SkillMelee,
} from "./skillMeleeRules";
import type { SplitRect } from "./viewport";
// 배지와 **같은 기본값**을 읽는다 — 두 곳에 적으면 표시와 실제가 갈린다
import { AUTO_DEFAULT_ON } from "./skillBarRules";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  TEAM_THEIRS,
  TEAM_THEIRS_HI,
  UI_OUTLINE,
  sameTheme,
  themeAtDepth,
  type WaveTheme,
} from "./theme";
import {
  ALLY_H_RATIO,
  BOSS_SCALE,
  DEATH_MS,
  ENEMY_H_RATIO,
  GOLD_POOL,
  GOLD_POP_MS,
  GOLD_POP_SIZE,
  GROUND_RATIO,
  HIT_FLASH_MS,
  KNOCKBACK_MS,
  MAX_VISIBLE_ENEMIES,
  SHADOW_ALPHA,
  SHADOW_H_RATIO,
  SHADOW_W_RATIO,
  allyBodyWPx,
  allyLaneX,
  allySlotRatio,
  clampToField,
  deathPose,
  depthPose,
  dimColor,
  enemySlotDepth,
  enemySlotRatio,
  fieldSlideY,
  goldPose,
  hitFlash,
  knockback,
  showsHpBar,
} from "./battleFieldRules";
import {
  ENEMY_WALK_IN_OFFSET,
  MELEE_STAGGER_MS,
  approachCurveInverse,
  PENDING_HARD_MS,
  clipDurationMs,
  impactDelayMs,
  cutToReturnMs,
  enemyAttackPeriodMs,
  meleePose,
  meleeSpan,
  mergePending,
  pendingIsStale,
  pickClip,
  releaseOrder,
  restAfterMs,
  walkInPose,
  type AttackClip,
  type MeleeStyle,
  type PendingHit,
} from "./meleeRules";
import { createBackgroundStage } from "./background";
import { saturateDelta } from "./color";
import {
  SLOW_MOTION_SCALE,
  chainAlpha,
  chainStrain,
  slowSaturate,
} from "./statusFx";
import { createDamageTextLayer } from "./ui/damageText";
import { createHpBar, type HpBar } from "./ui/hpBar";
import { drawPixelShadow, fillPixelCircle } from "./ui/pixelShape";
import { ART_PX, notchedRectPoints } from "./ui/shapeRules";

// 순수 규칙은 battleFieldRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  ALLY_H_RATIO,
  ENEMY_H_RATIO,
  GROUND_RATIO,
  MAX_VISIBLE_ENEMIES,
  fieldSlideY,
} from "./battleFieldRules";
// 방해 수신 연출의 순수 규칙 (§9) — 같은 이유로 pixi 없는 모듈에 있다
export {
  CHAIN_WRAP_MS,
  SLOW_MOTION_SCALE,
  SLOW_SATURATE_DROP,
  chainAlpha,
  chainStrain,
  interferenceEndNotice,
  slowSaturate,
} from "./statusFx";

export interface EnemyHitFx {
  enemyIndex: number;
  killed: boolean;
  /** 데미지 숫자에 찍을 값. 0이면 숫자를 띄우지 않는다 */
  dealt: number;
  /** 피격 후 남은 HP 비율 0..1 */
  hpRatio: number;
}

export interface BattleField {
  view: Container;
  /**
   * 세로 슬라이드 오프셋(px). **`view.y`를 직접 만지지 마라.**
   *
   * `view`는 `layout()`이 `rect.y`로 옮겨 둔 컨테이너다 — 밖에서 `view.y`에
   * 값을 넣으면 그 오프셋이 지워진다. 싱글의 하강 연출이 정확히 그랬다:
   * 슬라이드가 끝날 때 `field.view.y = 0`으로 못 박아서 전장이 화면 맨 위로
   * 올라가 붙고, 필드 아래쪽 153.6px(=`rect.y`)이 **배경 없는 검은 띠**로
   * 남았다(1:1 캡처에서 y 800~953). 하늘이 HUD 밑으로 파고든 것도 같은 원인이다.
   * 배경 에셋이나 하늘 비율 문제로 보였지만 좌표 문제였다.
   */
  setSlideY(offsetPx: number): void;
  /** 게이지 변화로 필드 높이가 바뀔 때마다 호출 */
  setRect(rect: SplitRect): void;
  /**
   * 웨이브 배경 + 적 스폰.
   *
   * @param hpRatios 슬롯별 남은 HP 비율 0..1. 생략하면 전부 만피다.
   *   전진 연출(§8)이 1.2초를 쓰는 동안 코어는 이미 새 무리를 때리고 있으므로,
   *   스폰 시점에 만피로 되돌리면 화면이 코어보다 뒤로 간다 — HP바가 찼다가
   *   즉시 깎이는 것으로 보인다.
   */
  setWave(wave: WaveDef, hpRatios?: readonly number[]): void;
  /**
   * 이 아군을 즉시 돌진시킨다.
   *
   * @param skillId 시전한 스킬. 공격 스킬이면 전용 클립·박자·이펙트로 간다
   *   (`skillMeleeRules`). 생략하면 자동 공격의 순환 클립을 쓴다 —
   *   결과 화면의 `celebrate()`가 그 경로다.
   */
  onAllyAttack(memberId: string, skillId?: string): void;
  onEnemyHit(hit: EnemyHitFx): void;
  /**
   * 배경 배치만 다음 웨이브로 바꾼다 (적 스폰 없음).
   *
   * §8의 전진 연출은 배경이 **빠르게 흐르는 동안**(200~1000ms) 그림이 갈려야
   * 하는데 적 스폰은 1200ms다. `setWave` 하나로 묶으면 배경이 멈춘 뒤에 바뀌어
   * "다른 곳에 도착했다"가 아니라 "색이 변했다"가 된다.
   */
  setWaveBackground(wave: WaveDef): void;
  /**
   * 하강 깊이 0..1 — 0이 지상, 1이 최심부다 (`descentDepth`).
   *
   * 세션이 매 프레임 부른다. 색은 연속으로 흐르고 삽화는 절반에서 한 번 갈린다
   * (§01-1-3). 같은 값이면 아무 일도 하지 않으므로 매 프레임 불러도 싸다.
   */
  setDepth(depth: number): void;
  /** 상대가 우리에게 준 방해량 표시 (아래로 떨어지는 붉은 숫자) */
  showInterference(amount: number): void;
  /**
   * 배경 스크롤 속도(px/s). 웨이브 클리어 전진 연출이 240까지 올린다 (§8).
   */
  setScrollSpeed(pxPerSec: number): void;
  /**
   * 아군을 제자리 달리기로 바꾼다 (§8: 200~1000ms).
   *
   * 공격 모션과 경쟁하지 않는다 — 전진 중에는 스킬 시전이 와도 `run`을 유지한다.
   * 달리다가 한 명이 갑자기 칼을 휘두르면 무엇을 하는 중인지 알 수 없다.
   */
  setAdvancing(on: boolean): void;
  /**
   * 자동 전투 온·오프 (AUTO 배지). `false`면 아군이 새 돌진을 시작하지 않는다.
   *
   * **부르지 않으면 켜진 상태다.** 끄는 것은 명시적으로 부른 쪽만이다 —
   * 배선하지 않은 호출자에게 정지를 물려주면 화면이 조용히 멈춘다.
   *
   * **화면만 끄는 것으로 끝나서는 안 된다.** 부르는 쪽은 코어 딜에도 같은 값을
   * 걸어야 한다. 한쪽만 끄면 아무도 안 싸우는데 적 HP가 줄어드는 화면이 되고,
   * 그건 실제로 있었던 결함이다(팀 딜의 45.3%).
   *
   * `onlyIds`를 주면 **그 아군만** 멈춘다. PvP가 쓴다 — 그쪽 배지 범위는 내 칸
   * 하나이고(`autoScopeNotice`의 `"skill"`: "팀은 계속 싸운다"), AI 팀원까지
   * 세우면 난사해도 못 이긴다(`myAutoDamage`의 12시드 표 셋째 줄). 안 주면
   * 전원이다(싱글: 상대가 없으므로 전투 전체가 멈춘다).
   */
  setAuto(on: boolean, onlyIds?: readonly string[]): void;
  /** 지금 자동 전투가 켜져 있는가 — 딜 게이트가 이 값을 읽는다 */
  readonly auto: boolean;
  /**
   * 코어가 확정한 처치를 **지금** 화면에 낸다 (플래시·사망 모션·골드·숫자).
   *
   * **층/웨이브가 바뀌는 화면 전환을 시작하기 전에 반드시 불러야 한다.**
   * 타격 연출은 아군의 임팩트 프레임까지 밀려 있으므로(`onEnemyHit`), 코어가
   * 무리를 다 쓸어 다음 층으로 넘어가는 그 틱에는 **결정타가 아직 화면에 없다**
   * — 적이 만피 HP바를 달고 서 있는 채로 전환이 시작된다.
   *
   * PvP는 `setAdvancing(true)`가 이걸 겸한다. 싱글(세로 하강)이 그걸 쓰지 않고
   * 이 메서드를 따로 부르는 이유: `setAdvancing`은 아군을 `run`으로 바꾸고
   * 돌진을 취소하는데, 그 둘은 **가로 스크롤**의 그림이다(뻗어 있는 아군만
   * 뒤로 끌려가는 것을 막는 처리다). 세로 슬라이드는 전장이 통째로 내려가므로
   * 끌려가는 아군이 없고, 낙하 중에 제자리 달리기를 시키면 무엇을 하는
   * 중인지가 어긋난다. **필요한 것은 플러시뿐이므로 그것만 뗀다.**
   */
  flushHits(): void;
  /**
   * 감속 상태 표현 (§9) — 붉은 사슬 + 채도 −20% + 모션 0.6배.
   * @param remainingMs 남은 지속시간. 끝나기 직전에 사슬이 떨린다
   */
  setSlowed(on: boolean, remainingMs: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 흰 플래시에 쓰는 색 */
const FLASH_COLOR = 0xffffff;

interface EnemySlot {
  char: SpriteChar;
  /** 현재 붙어 있는 종족. 같은 종족이면 스프라이트를 재사용한다 */
  slug: string;
  shadow: Graphics;
  hpBar: HpBar;
  /** 필드 로컬 x — 리그 원점 위치 (레이아웃이 채운다) */
  x: number;
  /**
   * 시각적 중심의 필드 로컬 x. 리그 원점이 치우쳐 있어서 `x`와 다르다.
   * 그림자·HP바·데미지 숫자·이펙트는 전부 이쪽에 붙여야 캐릭터와 맞는다.
   */
  centerX: number;
  /** 깊이 보정이 들어간 발 위치 y */
  baseY: number;
  /** 원경도 0..1 */
  depth: number;
  /** 사망 연출이 곱하는 y 스케일. 레이아웃이 덮어쓰지 않게 따로 들고 있는다 */
  deathScaleY: number;
  /** 이 슬롯에 적이 배치되어 있는지 (사망 연출 중에도 true) */
  occupied: boolean;
  isBoss: boolean;
  baseTint: number;
  flashMs: number;
  knockMs: number;
  deathMs: number;
  /** 사망 연출이 끝나 완전히 숨겨졌는지 */
  buried: boolean;
  /**
   * 걸어 들어오는 중의 경과(ms). `null`이면 이미 자리에 섰다.
   *
   * 적이 처음부터 슬롯에 놓여 있으면 "배치된 그림"이지 "다가온 적"이 아니다.
   */
  walkInMs: number | null;
  /**
   * 다음 제자리 공격 모션까지 남은 시간(ms).
   *
   * 적의 공격은 **연출 전용**이다 — 데미지를 만들지 않는다(`meleeRules`
   * §적 제자리 공격). 그래도 타이머를 슬롯이 들고 있어야 한다: 넷이 한 변수를
   * 공유하면 같은 프레임에 같이 휘둘러 네 마리가 한 덩어리로 읽힌다.
   */
  attackCooldownMs: number;
  /**
   * 임팩트를 기다리는 피격. 코어는 이미 확정했지만 화면에 아직 안 낸 양이다.
   * `null`이면 밀린 것이 없다.
   */
  pending: PendingHit | null;
}

/**
 * 아군 하나 + 근접 돌진 타임라인.
 *
 * 예전에는 `Map<memberId, SpriteChar>` 였다. 돌진이 들어오면서 캐릭터마다
 * **대기 자리·목표·사이클 시각**을 들고 있어야 해서 슬롯으로 묶었다 —
 * 맵 세 개를 나란히 두면 하나를 갱신하고 하나를 빼먹는다.
 */
interface AllySlot {
  id: string;
  /** 스프라이트 슬러그. 타격 이펙트를 캐릭터별로 갈라 쓴다 (`meleeFx`) */
  slug: string;
  char: SpriteChar;
  shadow: Graphics;
  /** 이 캐릭터의 접근·공격 스타일 (로드아웃이 준다) */
  style: MeleeStyle;
  /**
   * 다음 돌진에 쓸 스킬 연출. `null`이면 자동 공격이다.
   *
   * 시전(`onAllyAttack`)과 돌진 시작(`beginDash`)이 같은 프레임이 아닐 수 있다 —
   * 이미 돌진 중이면 그 사이클은 그대로 두고, 여기 넣은 것은 **버린다**.
   * 안 버리면 스킬 모션이 몇 초 뒤 엉뚱한 자동 공격 차례에 나온다.
   */
  pendingSkill: SkillMelee | null;
  /**
   * 이번 사이클에 실제로 적용된 스타일 — 스킬이 접근 박자를 덮은 결과다.
   * `style`을 제자리에서 고치면 스킬 한 번이 그 캐릭터를 영구히 바꾼다.
   */
  dashStyle: MeleeStyle;
  /** 이번 사이클의 스킬 연출. 임팩트 이펙트를 여기서 갈라 쓴다 */
  dashSkill: SkillMelee | null;
  /**
   * 지금 화면에서의 진행도 0..1 (0 = 대기 자리, 1 = 적 앞).
   *
   * 스킬이 진행 중인 사이클을 끊을 때 **이 자리에서 이어 붙어야** 한다 —
   * 0에서 시작하면 적 앞에 있던 아군이 대기 자리로 순간이동한다.
   */
  advance: number;
  /** 자동 공격 간격(ms). 사이클 사이의 대기 시간을 여기서 뽑는다 */
  attackIntervalMs: number;
  /** 대기 자리 x — 레이아웃이 채운다 */
  homeX: number;
  /** 돌진 사이클 경과(ms). `null`이면 대기 중 */
  elapsedMs: number | null;
  /** 지난 프레임 경과 — 임팩트를 "구간을 넘었는가"로 판정하므로 필요하다 */
  prevMs: number;
  /** 다음 사이클까지 남은 대기(ms) */
  restMs: number;
  /** 지금 노리는 적 슬롯 인덱스 */
  targetIndex: number;
  /** 이번 사이클의 공격 클립 */
  clip: AttackClip;
  strikeMs: number;
  /** 클립 시작부터 임팩트까지(ms) */
  impactMs: number;
  /** 몇 번째 공격인가 — 클립 순환에 쓴다 */
  attackCount: number;
}

interface GoldSlot {
  view: Container;
  active: boolean;
  elapsedMs: number;
  baseX: number;
  baseY: number;
  driftX: number;
}

/**
 * 골드 코인 하나. 스프라이트를 만들지 않고 코드로 그린다.
 *
 * 지름 18px 원은 도트 격자에서 계단 원으로 접는다 — 4배 도트 캐릭터 위로
 * 튀어오르는 물건이라 여기만 매끈하면 다른 게임에서 온 것으로 보인다.
 * 하이라이트는 원이 아니라 한 칸 사각이다(지름 4px 원은 전부 번짐이다).
 */
function makeCoin(): Container {
  const c = new Container();
  const g = new Graphics();
  fillPixelCircle(g, 0, 0, GOLD_POP_SIZE + ART_PX / 2, { color: UI_OUTLINE });
  fillPixelCircle(g, 0, 0, GOLD_POP_SIZE, { color: ACCENT_GOLD });
  fillPixelCircle(g, 0, 0, GOLD_POP_SIZE * 0.55, { color: ACCENT_GOLD_DEEP });
  // 왼쪽 위 하이라이트 — 3단 셰이딩 규칙 (§01-3)
  g.rect(
    -GOLD_POP_SIZE * 0.3 - ART_PX / 2,
    -GOLD_POP_SIZE * 0.35 - ART_PX / 2,
    ART_PX,
    ART_PX,
  ).fill({ color: 0xfff4c0 });
  c.addChild(g);
  c.visible = false;
  return c;
}

export async function createBattleField(opts: {
  characters: readonly CharacterLoadout[];
  rect: SplitRect;
  /**
   * 좌우 반전해서 그린다 (상대 팀 필드).
   *
   * **예전에는 상하(`mirrorY`) 반전이었다.** 게이지 선을 축으로 뒤집어 지면을
   * 게이지 바에 붙이고 캐릭터를 아래로 매달았는데(설계 문서 07-6-2), 화면에서는
   * 줄다리기가 아니라 **수면에 비친 거울상**으로 읽혔다 — 상대 팀이 거꾸로 서
   * 있으면 그것이 사람의 플레이라는 것부터 안 읽힌다.
   *
   * 그래서 축을 바꿨다: 두 팀 모두 땅에 똑바로 서고, 대신 상대 팀은 오른쪽에서
   * 왼쪽으로 나아간다(아군 우 / 적 좌). 게이지 선을 향해 서로 밀어낸다는
   * 의미는 x축에서도 성립하고, 캐릭터는 멀쩡하게 선다.
   *
   * 배치·이펙트는 이 플래그를 직접 안 본다 — `mirrorX`가 `world` 컨테이너를
   * 접고, 컨테이너 밖으로 나가는 것만 `absX()`를 지난다.
   */
  mirrorX?: boolean;
  fx: EffectPlayer;
  /**
   * 데미지 숫자 지터용. 결정론이어야 한다 (§C6 — Math.random 금지).
   * 지정하지 않으면 필드별 고정 시드를 쓴다.
   */
  rngSeed?: number;
}): Promise<BattleField> {
  const view = new Container();
  let rect = opts.rect;
  const mirrorX = opts.mirrorX === true;
  const rng: Rng = createRng(opts.rngSeed ?? (mirrorX ? 0x5eed2 : 0x5eed1));
  /**
   * 반전 **밖**에서 x 방향을 뒤집는 부호. 이펙트 레이어(`fx`)는 `world` 밖이라
   * 컨테이너 반전을 못 받으므로 오프셋·회전을 직접 뒤집어야 한다.
   *
   * 반전 **안**은 이 부호를 쓰지 않는다 — 로컬 좌표계에서는 두 필드가 완전히
   * 같은 배치(아군 좌 / 적 우)이고, 화면에서 뒤집히는 일은 컨테이너가 한다.
   */
  const dirX = mirrorX ? -1 : 1;

  /**
   * 배경 rect은 **필드 로컬 좌표**다 (x=0, y=0). `view` 자체가 이미
   * `rect.x/rect.y`로 옮겨져 있으므로 절대 좌표를 넘기면 오프셋이 두 번 걸린다.
   */
  const localRect = (): SplitRect => ({ x: 0, y: 0, w: rect.w, h: rect.h });

  /**
   * 배경은 반전 컨테이너 **밖**에 둔다 — 자체적으로 `mirrorX`를 처리하기 때문이다.
   * 안에 넣으면 반전이 두 번 걸린다.
   */
  const bg = await createBackgroundStage({
    rect: localRect(),
    ...(mirrorX ? { mirrorX: true } : {}),
    // 배치 시드를 필드별로 갈라 놓는다 — 같으면 상/하 배경이 완전히 같은
    // 그림이 되어 화면이 거울처럼 보인다
    seed: (opts.rngSeed ?? 1) + (mirrorX ? 77 : 0),
  });
  view.addChild(bg.view);

  // 반전은 이 컨테이너 하나가 담당한다 — 안쪽 배치 코드는 상/하 필드가 같다.
  // scale.x = -1 + position.x = rect.w 이므로 로컬 x가 rect.w - x로 뒤집힌다.
  const world = new Container();
  view.addChild(world);

  /** 그림자는 캐릭터보다 뒤, 지면보다 앞 */
  const shadowLayer = new Container();
  world.addChild(shadowLayer);
  const charLayer = new Container();
  world.addChild(charLayer);
  const goldLayer = new Container();
  world.addChild(goldLayer);
  /** 감속 사슬 — 아군을 감으므로 캐릭터보다 앞에 그린다 (§9) */
  const chainLayer = new Graphics();
  chainLayer.visible = false;
  world.addChild(chainLayer);

  /**
   * HP바와 데미지 숫자는 **반전 밖**에 둔다. 반전 안에 넣으면 숫자가 좌우로
   * 뒤집혀 읽을 수 없고(`123` → `321`의 거울상), 자식마다 scale.x = -1
   * 역보정을 걸어야 한다 (§C6). 대신 x를 `flipX()`로 변환해서 넣는다 —
   * 빼먹을 여지가 없다.
   */
  const overlay = new Container();
  view.addChild(overlay);

  const damage = createDamageTextLayer({
    rng,
    mine: !mirrorX,
    // 좌우 반전은 숫자의 **상승 방향**을 건드리지 않는다 — 두 필드 모두 지면이
    // 아래에 있으므로 "머리 위로 떠오른다"가 그대로 성립한다. 상하 반전이던
    // 시절에는 여기에 `flipMotion`이 필요했다(지면이 위였다)
  });
  overlay.addChild(damage.view);

  const allies: AllySlot[] = [];
  const allyById = new Map<string, AllySlot>();
  const enemies: EnemySlot[] = [];

  const golds: GoldSlot[] = [];
  for (let i = 0; i < GOLD_POOL; i++) {
    const c = makeCoin();
    goldLayer.addChild(c);
    golds.push({
      view: c,
      active: false,
      elapsedMs: 0,
      baseX: 0,
      baseY: 0,
      driftX: 0,
    });
  }

  const makeShadow = (): Graphics => {
    const g = new Graphics();
    shadowLayer.addChild(g);
    return g;
  };

  /**
   * 그림자를 캐릭터 키에 맞춰 다시 그린다.
   *
   * 타원이 아니라 계단 블록 3단이다 — 4배로 띄운 도트 캐릭터 발밑에서
   * 매끈한 타원만 다른 해상도의 그림처럼 보인다 (`drawPixelShadow` 참고).
   */
  const paintShadow = (g: Graphics, heightPx: number, scale: number): void => {
    const w = heightPx * SHADOW_W_RATIO * scale;
    g.clear();
    drawPixelShadow(g, w, w * SHADOW_H_RATIO, 0x000000, SHADOW_ALPHA);
  };

  /**
   * 적 시트를 여기서 미리 받는다.
   *
   * `swapEnemy`는 **동기**여야 한다 — 스폰이 코어 이벤트에 붙어 있어서 `await`
   * 한 프레임이 끼면 그 사이 피격 이벤트가 아직 없는 스프라이트를 만진다.
   * 보통은 boot(§`chars` 단계)가 다 받아 두지만, 디버그 진입(`?scene=`)은
   * boot를 건너뛰므로 여기서 한 번 더 보장한다 (Assets 캐시라 두 번 안 받는다).
   */
  try {
    await loadCharManifest();
    await loadCharSheets([...MINION_SLUGS, ...BOSS_SLUGS]);
  } catch (err) {
    console.warn("[pvp] 적 시트 프리로드 실패 — 플레이스홀더로 진행한다", err);
  }

  for (const c of opts.characters) {
    const sc = await createHeroChar(c.charSlug, rect.h * ALLY_H_RATIO);
    // 로컬 좌표계에서는 **두 필드가 같다** — 아군은 오른쪽, 적은 왼쪽을 본다.
    // 화면에서 뒤집는 일은 `world` 컨테이너(`mirrorX`)가 한다
    sc.setFacing(1);
    charLayer.addChild(sc.view);
    const slot: AllySlot = {
      id: c.memberId,
      slug: c.charSlug,
      char: sc,
      shadow: makeShadow(),
      style: c.melee,
      pendingSkill: null,
      dashStyle: c.melee,
      dashSkill: null,
      advance: 0,
      attackIntervalMs: c.stats.attackIntervalMs,
      homeX: 0,
      elapsedMs: null,
      prevMs: 0,
      // 첫 사이클을 순서대로 늦춘다 — 둘이 동시에 뛰어나가면 한 덩어리다
      restMs: allies.length * MELEE_STAGGER_MS,
      targetIndex: 0,
      clip: "attack1",
      strikeMs: 0,
      impactMs: 0,
      attackCount: 0,
    };
    allies.push(slot);
    allyById.set(c.memberId, slot);
  }
  /** 슬롯에 이 종족의 스프라이트를 붙인다. 방향·깊이 정렬을 한곳에서 처리한다 */
  const attachEnemy = (slot: EnemySlot, slug: string): SpriteChar => {
    const sc = createEnemyCharSync(slug, rect.h * ENEMY_H_RATIO);
    // 적은 아군을 향한다 = 로컬 좌표계에서 왼쪽 (아군 좌 / 적 우 배치)
    sc.setFacing(-1);
    // 앞쪽이 뒤쪽을 가린다. 깊이가 클수록 먼저(뒤에) 그려진다
    sc.view.zIndex = Math.round((1 - slot.depth) * 10);
    charLayer.addChild(sc.view);
    slot.char = sc;
    slot.slug = slug;
    return sc;
  };

  /**
   * 슬롯의 적을 이 종족으로 교체한다.
   *
   * **22종을 미리 다 만들어 두지 않는다.** 종당 4슬롯이면 스프라이트 88개가
   * 상시 갱신 대상이 된다. 슬롯당 하나만 살려 두고 종족이 바뀔 때만 갈아끼운다.
   * 같은 종족이 다시 나오면(웨이브가 같은 풀을 쓰면) 그냥 재사용한다.
   */
  const swapEnemy = (slot: EnemySlot, slug: string): void => {
    if (slot.slug === slug) return;
    slot.char.destroy();
    attachEnemy(slot, slug);
    // 스케일·위치는 레이아웃이 잡는다. 새 스프라이트는 아직 아무 좌표도 없다
    slot.char.setTint(slot.baseTint);
  };

  for (let i = 0; i < MAX_VISIBLE_ENEMIES; i++) {
    const shadow = makeShadow();
    shadow.visible = false;
    const hpBar = createHpBar({ width: rect.h * ENEMY_H_RATIO * 0.52 });
    hpBar.view.visible = false;
    overlay.addChild(hpBar.view);
    const depth = enemySlotDepth(i);
    const slot: EnemySlot = {
      // 첫 웨이브가 오기 전까지의 임시 종족. 어차피 `spawnWave`가 갈아끼운다
      char: null as unknown as SpriteChar,
      slug: "",
      shadow,
      hpBar,
      x: 0,
      centerX: 0,
      baseY: 0,
      depth,
      deathScaleY: 1,
      occupied: false,
      isBoss: false,
      baseTint: dimColor(0xffffff, depthPose(depth, 1).dim),
      flashMs: -1,
      knockMs: -1,
      deathMs: -1,
      buried: true,
      walkInMs: null,
      attackCooldownMs: 0,
      pending: null,
    };
    const sc = attachEnemy(slot, MINION_SLUGS[0]);
    sc.view.visible = false;
    enemies.push(slot);
  }

  /**
   * 현재 배경 테마. `null`이면 아직 첫 `setWave()`가 안 왔다는 뜻이다 —
   * 그때만 크로스페이드 없이 즉시 적용한다.
   */
  let theme: WaveTheme | null = null;

  /**
   * 테마 환경광을 캐릭터에 곱한다 (§01-3). 어두운 배경에서 캐릭터가 배경에
   * 묻히면 무엇을 때리는지 안 보인다. 적은 깊이 감광이 이미 들어 있으므로
   * 환경광을 그 위에 곱한다.
   */
  const applyAmbient = (): void => {
    const amb = theme?.ambient ?? 0xffffff;
    for (const a of allies) a.char.setTint(amb);
    for (const slot of enemies) {
      slot.baseTint = dimColor(amb, depthPose(slot.depth, 1).dim);
      // 플래시·사망 연출 중이면 건드리지 않는다 — 그쪽이 색을 쥐고 있다
      if (slot.flashMs < 0 && slot.deathMs < 0) {
        slot.char.setTint(slot.baseTint, slot.char.view.alpha);
      }
    }
  };

  /**
   * 전진 연출 중인가 (§8). 아군을 `run`으로 묶어 둔다 — 이 동안 들어온
   * 공격 모션은 무시한다. 달리다가 갑자기 칼을 휘두르면 무엇을 하는 중인지
   * 알 수 없다.
   */
  let advancing = false;

  /**
   * 자동 전투가 켜져 있는가 (AUTO 배지). `false`면 아군이 **새 사이클을 시작하지
   * 않는다** — 진행 중인 사이클은 끝까지 재생한다(중간에 끊으면 칼을 뽑은 채
   * 순간이동한다).
   *
   * **기본이 `true`인 이유**: 이 필드는 PvP와 싱글이 같이 쓰고, PvP는 배지를
   * 딜에 걸지 않는다(양쪽 AI가 같은 식을 쓴다). 배선하지 않은 호출자에게
   * 정지를 물려주면 화면이 조용히 멈추므로, 끄는 것은 **명시적으로 부른
   * 쪽**만이다.
   *
   * **그 `true`를 여기 적지 않는다** — 배지도 이 상수를 봐야 한다
   * (`skillBarRules.initialAutoFor`). 두 곳에 리터럴로 적혀 있던 동안 배지는
   * `false`, 전장은 `true`로 출발했고, 싱글 진입 직후 `AUTO OFF`가 적힌 채
   * 캐릭터가 돌진하고 적을 죽였다(유저 신고 2번).
   */
  let autoOn = AUTO_DEFAULT_ON;
  /**
   * `autoOn=false`가 걸리는 아군 id. `null`이면 전원이다.
   *
   * PvP는 내 칸 하나만 넘긴다(`setAuto`의 `onlyIds`) — 그쪽 배지가 말하는 범위가
   * 그것이고, AI 팀원까지 세우면 난사해도 이길 수 없다(`myAutoDamage`의 표).
   * 세션이 같은 목록으로 코어 딜도 거른다 — 두 게이트가 **한 목록**을 봐야
   * 몸과 수치가 갈리지 않는다.
   */
  let autoOnlyIds: Set<string> | null = null;
  /** 이 아군이 지금 새 사이클을 시작해도 되는가 */
  const autoFor = (a: AllySlot): boolean =>
    autoOn || (autoOnlyIds !== null && !autoOnlyIds.has(a.id));

  /** 감속 상태 (§9) */
  let slowed = false;
  let slowMs = 0;
  let slowRemainingMs = 0;
  /** 채도 필터. 감속이 아닐 때는 아예 떼 둔다 — 상시 필터는 패스 하나가 그냥 낭비다 */
  const desat = new ColorMatrixFilter();
  let desatOn = false;
  const applyDesat = (on: boolean): void => {
    if (on === desatOn) return;
    desatOn = on;
    view.filters = on ? [desat] : [];
    // 필터가 붙었는지는 −20%라 화면만 봐서는 확신할 수 없다. 헤드리스 검증이
    // 이 로그로 읽는다 (붙이기 실패는 조용히 지나가는 종류의 버그다)
    if (import.meta.env.DEV) {
      console.log(`[intf] desat ${on ? "on" : "off"} mirror=${mirrorX}`);
    }
  };

  /** 필드 로컬 x → 필드 좌표계 x (반전 흡수). overlay가 이 좌표계에 있다 */
  const flipX = (localX: number): number =>
    mirrorX ? rect.w - localX : localX;

  /** 필드 로컬 x → 화면 절대 x. 이펙트는 world 밖(fx 레이어)에 뜨므로 직접 변환한다. */
  const absX = (localX: number): number => rect.x + flipX(localX);

  /** 필드 로컬 y → 화면 절대 y. 좌우 반전은 y를 건드리지 않는다 */
  const absY = (localY: number): number => rect.y + localY;

  /**
   * 실제 렌더 키 — 종별 배율(`hMul`)·보스 배율·깊이 축소가 모두 반영된 값.
   *
   * `hMul`은 스프라이트를 만들 때 이미 먹었으므로 `view.scale`에 없다. 빼먹으면
   * 쥐(0.5배)의 HP바가 머리 두 개 위에 뜬다.
   */
  const slotHMul = (slot: EnemySlot): number => slot.char.def?.hMul ?? 1;
  const enemyHeight = (slot: EnemySlot): number =>
    rect.h *
    ENEMY_H_RATIO *
    slotHMul(slot) *
    Math.abs(slot.char.view.scale.x || 1);

  /**
   * 이 적이 실제로 재생할 공격 클립의 길이(ms). 클립이 없으면 0.
   *
   * `def.actions["attack1"]`을 직접 보지 않는다 — 대체 사슬(`resolveAction`)이
   * 다른 액션을 내줄 수 있고, 그러면 주기가 실제 재생 길이와 어긋나 되감기
   * 딸꾹질이 난다. `actionMeta`가 **재생될 것**을 알려준다.
   */
  const enemyAttackClipMs = (slot: EnemySlot): number => {
    const a = slot.char.actionMeta("attack1");
    return a ? clipDurationMs(a.frames, a.fps) : 0;
  };

  /**
   * 등장 이동으로 인한 x 편차(px). 다 들어왔으면 0.
   *
   * 오른쪽 화면 밖에서 출발한다 — 필드는 화면 폭을 다 쓰므로 오른쪽 바깥은
   * 화면 밖이고, 상대 필드를 침범하지 않는다.
   */
  const walkInDx = (slot: EnemySlot): number => {
    if (slot.walkInMs === null) return 0;
    const p = walkInPose(slot.walkInMs, enemies.indexOf(slot));
    return rect.w * ENEMY_WALK_IN_OFFSET * (1 - p.arrive);
  };

  /**
   * 적의 **아군 쪽 앞면** x(px). 돌진이 여기까지만 간다.
   *
   * 중심으로 근사하면 보스(1.6배)나 큰 잡몹의 몸 안으로 걸어 들어간다.
   *
   * 로컬 좌표계는 두 필드가 같으므로 **항상 왼쪽 끝**이 앞면이다 — 아군이
   * 왼쪽에 있다. (예전에는 `opts.facing`으로 갈랐는데, 좌우 반전을 컨테이너가
   * 맡은 뒤로는 갈릴 이유가 없다.)
   */
  const enemyFrontX = (slot: EnemySlot): number => {
    const ex = slot.char.visualExtent();
    const s = Math.abs(slot.char.view.scale.x || 1);
    return slot.x + ex.left * s;
  };

  /**
   * 이 아군의 표시 몸폭(px) — 매니페스트의 **대기 자세** `bodyW`에서 온다.
   *
   * **`visualExtent()`로 재면 안 된다.** 그건 *지금 재생 중인* 클립의 알파
   * bbox라서 공격 프레임에서는 무기 궤적까지 포함한다. 처음 그렇게 쟀더니
   * 뒤 아군이 x −22(화면 밖)로 물러났다 — 줄을 세우는 코드는 멀쩡했고
   * 폭 하나가 틀렸다. `bodyW`는 행 폭의 중앙값이라 클립과 무관하게 고정이다.
   */
  const allyBodyW = (a: AllySlot): number => {
    const def = a.char.def;
    return allyBodyWPx(def?.actions.idle?.bodyW, def?.refSubjH ?? 0, rect.h);
  };

  /**
   * 사거리만 반영한 멈춤 지점 — 줄을 세우기 전의 값.
   *
   * 대기 자리 → **적의 앞면**을 `1 - reach`만큼 간 곳이다. 필드 폭 비율이
   * 아니라 아군↔적 거리 비율인 이유, 중심이 아니라 앞면인 이유는 `laneX`에
   * 이어서 적어 뒀다.
   */
  const rawReachX = (a: AllySlot): number => {
    const target = enemies[a.targetIndex];
    if (!target) return a.homeX;
    return a.homeX + (enemyFrontX(target) - a.homeX) * (1 - a.style.reach);
  };

  /**
   * 줄을 세운 멈춤 지점 — `stepAlly`와 `[dash]` 로그가 같은 값을 봐야 한다.
   *
   * **앞줄은 슬롯 순서가 아니라 사거리다.** 처음에는 슬롯 순서(왼쪽이 앞줄)로
   * 세웠는데, 뒤 슬롯(m1, home 266)이 원래 더 앞까지 간다(338 vs 301) —
   * 슬롯 순서로 세우면 이미 앞서 있는 아군을 133px 뒤로 끌어당기게 되고,
   * 그건 협공이 아니라 후퇴로 보인다. **자연히 적에 가까운 쪽이 앞줄이다.**
   *
   * **목표가 같은지는 묻지 않는다.** 처음에는 `targetIndex`가 같은 아군만
   * 한 줄로 묶었다 — 겹침의 원인이 "같은 적으로 수렴"이라고 봤기 때문이다.
   * 그런데 3층(잡몹 여러 마리)에서 m0이 269, m1이 287에 섰다: **다른 적을
   * 노렸는데 18px 차이**다(로그 실측, 캡처에서 두 아군이 뭉쳤다). 겹침은
   * 목표가 아니라 **x의 문제**라서, 목표로 묶으면 검사 자체가 못 본다.
   *
   * 순서 기준이 `rawReachX`인데도 프레임마다 흔들리지 않는다: 대기 자리와
   * `style.reach`가 둘 다 아군마다 고정이고, 적 앞면은 목표가 정해지면
   * 고정이라 대소가 뒤집히지 않는다. 그래도 동률이면 슬롯 순서로 갈라
   * 결정론을 지킨다 — 순서가 뒤집히면 두 아군이 동시에 순간이동한다.
   */
  const laneX = (a: AllySlot): number => {
    const target = enemies[a.targetIndex];
    if (!target) return a.homeX;
    // 돌진 중이 아닌 아군은 줄에 없다 — 대기 자리에 있는 아군까지 세면
    // 혼자 때리는 판에서도 뒤로 물러선다
    const lane = allies
      .filter((o) => o === a || o.elapsedMs !== null)
      .map((o) => ({ o, raw: rawReachX(o), i: allies.indexOf(o) }))
      .sort((p, q) => q.raw - p.raw || p.i - q.i);
    let ahead: number | null = null;
    for (const e of lane) {
      const x = allyLaneX(e.raw, ahead, allyBodyW(e.o), e.o.homeX);
      if (e.o === a) return x;
      ahead = x;
    }
    // 여기 오면 `a`가 자기 줄에 없다 — 위 filter가 `a`를 항상 넣으므로 불가능하다
    return rawReachX(a);
  };

  /**
   * 아군 그림자를 실측 중심에 놓는다.
   *
   * 히어로 리그도 원점이 왼쪽으로 치우쳐 있다. 돌진 중에는 캐릭터가 움직이므로
   * **매 프레임** 따라가야 한다 — 안 따라가면 그림자만 대기 자리에 남아서
   * 캐릭터가 지면에서 떨어져 나간 것처럼 보인다.
   */
  const placeAllyShadow = (a: AllySlot, baseline: number): void => {
    const ex = a.char.visualExtent();
    a.shadow.position.set(a.char.view.x + (ex.left + ex.right) / 2, baseline);
  };

  const layout = (): void => {
    view.position.set(rect.x, rect.y);
    world.position.set(mirrorX ? rect.w : 0, 0);
    world.scale.set(mirrorX ? -1 : 1, 1);
    // 지면은 배경(BackgroundStage)이 그린다 — 같은 `GROUND_RATIO`를 쓴다
    const baseline = rect.h * GROUND_RATIO;

    // 아군은 좌측 정렬, 적은 우측에서 등장 (레전드 오브 슬라임 배치)
    // 간격 근거는 `allySlotRatio` 주석에 있다 — 실측 스프라이트 폭이 기준이다
    allies.forEach((a, i) => {
      const ax = rect.w * allySlotRatio(i);
      a.homeX = ax;
      // 돌진 중이면 x는 타임라인이 쥐고 있다 — 레이아웃이 덮으면 게이지가
      // 움직일 때마다(=매 프레임) 아군이 대기 자리로 순간이동한다
      a.char.view.position.set(
        a.elapsedMs === null ? ax : a.char.view.x,
        baseline,
      );
      paintShadow(a.shadow, rect.h * ALLY_H_RATIO, 1);
      placeAllyShadow(a, baseline);
    });
    enemies.forEach((slot, i) => {
      // 깊이는 겹침을 거리로 읽히게 만든다 — 4마리가 폭에 안 들어간다
      const pose = depthPose(slot.depth, rect.h * ENEMY_H_RATIO);
      const bossMul = slot.isBoss ? BOSS_SCALE : 1;
      // 보스는 깊이를 쓰지 않는다 (웨이브에 하나뿐)
      const total = slot.isBoss ? bossMul : pose.scale;
      slot.char.view.scale.set(total, total * slot.deathScaleY);
      const h = rect.h * ENEMY_H_RATIO * slotHMul(slot) * total;
      /**
       * 공중 몹(`lift`)은 지면에서 자기 키의 비율만큼 뜬다. 박쥐·눈알을
       * 발밑 기준으로 세우면 날개가 땅에 박힌 채 퍼덕인다.
       */
      const airborne = h * charLift(slot.slug);
      slot.baseY = baseline - (slot.isBoss ? 0 : pose.lift) - airborne;

      // 실측 범위로 클램프한다. 에일리언 리그는 원점이 치우쳐 있어서
      // 키 기반 추정으로는 보스 머리가 화면 밖으로 나갔다 (스크린샷으로 확인)
      const ex = slot.char.visualExtent();
      slot.x = clampToField(
        rect.w * enemySlotRatio(i, slot.isBoss),
        { left: ex.left * total, right: ex.right * total },
        rect.w,
      );
      // 리그 원점이 치우쳐 있으므로 부착물은 실측 중심에 놓아야 어긋나지 않는다
      slot.centerX = slot.x + ((ex.left + ex.right) / 2) * total;
      // 걸어 들어오는 중이면 x는 등장 타임라인이 쥐고 있다. HP바·그림자는
      // 슬롯 좌표에 그대로 둔다 — 화면 밖에서부터 따라오면 UI가 난입한다
      slot.char.view.position.set(slot.x + walkInDx(slot), slot.baseY);
      // 그림자는 **지면에 남는다**. 공중 몹의 그림자가 같이 떠오르면 뜬 것이
      // 아니라 그냥 위쪽에 서 있는 것으로 보인다
      // 그림자는 발에 붙어 있으므로 등장 이동을 같이 따라간다
      slot.shadow.position.set(
        slot.centerX + walkInDx(slot),
        slot.baseY + airborne,
      );
      paintShadow(slot.shadow, rect.h * ENEMY_H_RATIO * slotHMul(slot), total);
      // HP바는 머리 위 −(키 × 1.05) (§C5)
      slot.hpBar.resize(h * (slot.isBoss ? 0.8 : 0.52), slot.isBoss);
      slot.hpBar.view.position.set(flipX(slot.centerX), slot.baseY - h * 1.05);
    });
    // 앞쪽(depth 0)이 뒤쪽을 가려야 한다. zIndex로 그리기 순서를 강제한다
    charLayer.sortableChildren = true;
  };

  layout();

  /**
   * 붉은 사슬 (§9). 아군 몸통을 세 겹으로 감는다.
   *
   * 스프라이트를 만들지 않는다 — 사슬은 화면에서 폭 3px의 선이고, 지속 상태를
   * 말하는 것이 목적이라 고리 하나하나의 모양은 아무도 보지 않는다.
   *
   * @param a 0..1 감기는 정도
   * @param strain 0..1 해제 임박 떨림 (끝나기 직전에 커진다)
   */
  const paintChains = (a: number, strain: number): void => {
    chainLayer.clear();
    chainLayer.visible = a > 0.01;
    if (!chainLayer.visible) return;
    chainLayer.alpha = a;
    const h = rect.h * ALLY_H_RATIO;
    for (const { id, char: sc } of allies) {
      /**
       * **`visualExtent()`로 몸통을 찾으면 안 된다.** 히어로 리그의 실측 범위는
       * 오른쪽으로 뻗은 철퇴까지 포함해서 폭이 몸통의 3배가 넘는다 — 그 폭으로
       * 그리면 옆 사람까지 가로지르는 붉은 광선이 되고, 왼쪽 끝에 붙이면 사슬이
       * 망토 밖 허공에 떠서 옆 사람 몸에 걸린다 (둘 다 스크린샷에서 확인).
       *
       * 리그 원점(`view.x`)이 발 사이 = 몸통 중심이다. 폭은 키에 비례로 잡는다.
       */
      const halfW = h * 0.15;
      const cx = sc.view.x;
      // 떨림은 개인별로 위상을 갈라 놓는다 — 같이 떨면 화면 전체가 흔들린 것처럼 보인다
      const phase = slowMs / 26 + id.length;
      const jitter = strain * 3 * Math.sin(phase);
      for (let k = 0; k < 3; k++) {
        /**
         * 세 겹을 발 기준 0.44h~0.16h에 둔다. 0.7h로 잡으면 얼굴을 가로지른다 —
         * 이 리그는 머리가 커서 키의 위쪽 1/3이 전부 머리다 (스크린샷에서 확인).
         * 얼굴을 덮으면 감속이 아니라 캐릭터가 망가진 것으로 보인다.
         */
        const y = sc.view.y - h * (0.44 - k * 0.14);
        // 감기는 정도만큼 좌우로 자란다 — 순간에 꽉 감기면 무엇이 나타났는지 못 본다
        const grow = halfW * (1 - k * 0.1) * a;
        const x0 = cx - grow;
        const x1 = cx + grow;
        const yAt = (t: number): number => y + jitter - jitter * 2 * t;
        /**
         * **선 + 점으로 그리면 분홍 점선으로 읽힌다** (스크린샷에서 확인).
         * 사슬은 "속이 빈 고리가 서로 물려 있다"가 유일한 단서라, 채운 원이
         * 아니라 **링(테두리만)** 을 겹쳐 그린다. 가로/세로로 번갈아 눕히면
         * 꼬임까지 보인다 — 실제 사슬이 그렇게 생겼다.
         *
         * 고리는 타원이 아니라 **모서리 깎은 사각 링**이다. 이 크기(지름 6~12px)의
         * 타원은 테두리가 전부 안티에일리어싱된 회색 번짐이 되어, 도트 캐릭터
         * 위에서 사슬이 아니라 흐린 얼룩으로 보인다. 두께도 정수로 고정한다 —
         * 3.2px 선은 격자에서 1칸과 2칸 사이를 오간다.
         */
        const span = x1 - x0;
        const ring = Math.max(3, Math.min(6, halfW * 0.16));
        const links = Math.max(2, Math.round(span / (ring * 1.35)));
        for (let i = 0; i <= links; i++) {
          const t = i / links;
          const lx = x0 + span * t;
          // 홀수 고리는 눕는다 — 폭이 좁아 보이는 것이 꼬임의 단서다
          const flat = i % 2 === 1;
          const rx = flat ? ring * 0.55 : ring;
          const ry = flat ? ring : ring * 0.62;
          const ly = yAt(t);
          const link = notchedRectPoints(
            lx - rx,
            ly - ry,
            rx * 2,
            ry * 2,
            ART_PX,
          );
          chainLayer
            .poly(link)
            .stroke({
              color: UI_OUTLINE,
              width: 3,
              alpha: 0.85,
              join: "miter",
              miterLimit: 1,
            })
            .poly(link)
            .stroke({
              color: flat ? TEAM_THEIRS_HI : TEAM_THEIRS,
              width: 1,
              alpha: 0.95,
              join: "miter",
              miterLimit: 1,
            });
        }
      }
    }
  };

  /**
   * 배경 배치를 웨이브에 맞춘다. 적도, **테마도** 건드리지 않는다.
   *
   * 테마는 `setDepth`가 시간축으로 옮긴다 (§01-1-3 결정 기록: 웨이브 1~5가
   * 0.3초에 다 녹아서 웨이브 번호로는 하강을 못 그린다). 여기는 프롭·천체
   * 배치 시드만 갈아서 층마다 그림이 조금 달라지게 한다.
   */
  const applyWaveBackground = (wave: WaveDef): void => {
    bg.setSeed((opts.rngSeed ?? 1) + wave.index * 17 + (mirrorX ? 77 : 0));
  };

  /**
   * 하강 깊이(0..1)를 배경·환경광에 반영한다. 세션이 매 프레임 부른다.
   *
   * 같은 색이면 아무 일도 하지 않는다 — 깊이는 매 프레임 조금씩 오르는데
   * 하늘을 매 프레임 다시 칠하면 `Graphics`를 초당 60번 재빌드한다.
   *
   * 삽화가 갈리는 경계에서만 600ms 크로스페이드가 돈다 (`background.setTheme`이
   * `id`가 같으면 색만 갈아 끼운다). 첫 배치는 즉시 — 크로스페이드를 걸면
   * `?wave=3` 진입 시 첫 600ms가 지상으로 보여 스크린샷 타이밍이 흔들린다.
   */
  const setDepth = (depth: number): void => {
    const next = themeAtDepth(depth);
    if (theme !== null && sameTheme(theme, next)) return;
    const first = theme === null;
    theme = next;
    bg.setTheme(next, first ? { immediate: true } : undefined);
    applyAmbient();
  };

  /** 적 슬롯을 이 웨이브의 정의로 다시 채운다 (§4-2 스폰) */
  const spawnWave = (wave: WaveDef, hpRatios?: readonly number[]): void => {
    enemies.forEach((slot, i) => {
      const def = wave.enemies[i];
      // 이미 죽어 있는 슬롯은 비운다 — 전진 1.2초 동안 코어가 앞선 경우다
      const ratio = hpRatios === undefined ? 1 : (hpRatios[i] ?? 1);
      const alive = def !== undefined && ratio > 0;
      /**
       * 종족 교체가 나머지 초기화보다 **먼저** 와야 한다. 아래에서 틴트·알파·
       * 스케일을 새로 잡는데, 그 뒤에 스프라이트를 갈아끼우면 갓 만든 개체가
       * 이전 판의 사망 알파를 물려받은 채로 등장한다.
       */
      if (def) swapEnemy(slot, pickEnemySlug(def.id, wave.index, def.isBoss));
      slot.occupied = alive;
      slot.flashMs = -1;
      slot.knockMs = -1;
      slot.deathMs = -1;
      slot.buried = !alive;
      // 밀린 피격은 웨이브가 바뀌면 버린다 — 다음 무리에게 지난 무리의 딜을
      // 내면 HP바가 스폰 직후 이유 없이 깎인다
      slot.pending = null;
      /**
       * 이미 깎여 있는 슬롯은 걸어 들어오지 않는다. 전진 연출 1.2초 동안 코어가
       * 앞서 있으면 `hpRatios`가 만피가 아니고, 그 적이 화면 밖에서 걸어 들어오면
       * "이미 때린 적이 지금 도착한다"가 된다.
       */
      slot.walkInMs = alive && ratio >= 1 ? 0 : null;
      /**
       * 첫 스윙까지 한 주기를 기다린다 — 0으로 두면 스폰 프레임에 넷이 동시에
       * 휘두르고, 걸어 들어오는 중이라 공격 모션이 이동에 섞여 무엇인지 안 보인다.
       */
      slot.attackCooldownMs = enemyAttackPeriodMs(enemyAttackClipMs(slot), i);
      slot.char.view.visible = alive;
      slot.shadow.visible = alive;
      // 바를 켜고 끄는 조건은 **한 곳**이다 (`showsHpBar`) — 여기서 다시 쓰면
      // 다음에 상태가 하나 늘 때 네 자리 중 하나가 빠진다(유저 신고 1번의 형태)
      slot.hpBar.view.visible = showsHpBar(slot);
      slot.char.view.alpha = 1;
      slot.char.view.rotation = 0;
      slot.deathScaleY = 1;
      slot.char.setTint(slot.baseTint);
      if (!def || !alive) return;
      // 보스는 크게 — 같은 리그를 스케일로 재활용한다. 실제 배율은 layout()이 건다
      slot.isBoss = def.isBoss;
      slot.hpBar.snapTo(ratio);
      // 걸어 들어오는 중은 `walk`. 다 들어온 뒤에 `run`(제자리 대기)으로 바뀐다.
      // 도착한 상태로 스폰한 슬롯은 바로 대기 모션이다
      slot.char.play(slot.walkInMs === null ? "run" : "walk");
    });
    // 보스 스케일·깊이가 바뀌면 그림자·HP바 치수도 따라가야 한다
    layout();
  };

  /** 살아 있는 적 슬롯 인덱스 — 앞(왼쪽)부터 */
  const livingTargets = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < enemies.length; i++) {
      const s = enemies[i]!;
      if (s.occupied && !s.buried && s.deathMs < 0) out.push(i);
    }
    return out;
  };

  /**
   * 이 아군이 지금 때릴 적 슬롯. `-1`이면 때릴 것이 없다.
   *
   * **둘이 같은 적만 때리면 안 된다.** 코어는 슬롯 0부터 차례로 깎지만 4마리를
   * 2초면 다 죽인다 — 아군 한 명의 한 사이클이 1.3초라, 앞 적만 노리면 뒤쪽
   * 슬롯 셋은 임팩트를 한 번도 못 받고 강제 방출(`why=hard`)로 넘어간다.
   * 그러면 게이팅이 대부분의 타격에서 무의미해진다(헤드리스 로그로 확인).
   *
   * 그래서 아군마다 다른 적을 맡는다. 앞부터 배분하므로 코어의 깎는 순서
   * (슬롯 0 우선)와 여전히 같은 방향이다 — 뒤쪽 적만 때리는 일은 없다.
   */
  const targetFor = (a: AllySlot): number => {
    const living = livingTargets();
    if (living.length === 0) return -1;
    // 밀린 피격이 있는 적을 먼저 노린다 — 그 슬롯이 임팩트를 기다리는 중이다
    const waiting = living.filter((i) => enemies[i]!.pending !== null);
    const pool = waiting.length > 0 ? waiting : living;
    return pool[allies.indexOf(a) % pool.length] as number;
  };

  /**
   * 이 아군의 다음 돌진을 준비한다. 목표가 없으면 시작하지 않는다.
   *
   * 스킬 시전이 예약해 둔 연출(`pendingSkill`)을 **여기서 소비하고 비운다** —
   * 목표가 없어 돌진이 안 서면 예약도 같이 버린다(아래 `onAllyAttack` 참고).
   *
   * @param fromAdvance 지금 서 있는 진행도(0..1). 진행 중인 사이클을 끊고
   *   갈아탈 때 준다 — 0으로 시작하면 적 앞에 있던 아군이 대기 자리로
   *   순간이동한다. 기본값 0은 대기 자리에서 새로 뛰어나가는 경우다.
   */
  const beginDash = (a: AllySlot, fromAdvance = 0): void => {
    const target = targetFor(a);
    /**
     * 목표가 없으면 예약도 **버린다**. 남겨 두면 웨이브가 바뀐 뒤 첫 자동 공격이
     * 스킬 모션·이펙트로 나가서, 아무 것도 누르지 않았는데 마무리기가 터진다.
     */
    const skill = a.pendingSkill;
    a.pendingSkill = null;
    if (target < 0) return;
    a.targetIndex = target;
    a.dashSkill = skill;
    a.dashStyle = skillStyle(a.style, skill);
    /**
     * 스킬은 클립을 **지정**한다. 순환에 맡기면 심연 베기를 눌러도 그 차례에
     * 걸린 것(예: `special`)이 나와서 두 스킬이 같은 동작으로 보인다.
     * 자동 공격 차례는 그대로 순환한다 — 모든 클립이 반드시 한 번은 보인다.
     */
    a.clip = skill ? skill.clip : pickClip(a.style, a.attackCount);
    a.attackCount += 1;
    /**
     * 클립 길이·임팩트는 **실제 재생될 액션**에서 읽는다. 대체 사슬을 타면
     * (`special`이 없어 `attack2`가 나오면) 상수로 박은 길이와 어긋나 임팩트가
     * 클립 밖에서 터진다 = 칼이 멈춘 뒤에 HP가 깎인다.
     */
    const meta = a.char.actionMeta(a.clip);
    // 플레이스홀더는 액션이 없다 — 그래도 사이클은 돌아야 한다(전투가 멈춘다)
    const frames = meta?.frames ?? 12;
    const fps = meta?.fps ?? 14;
    a.strikeMs = clipDurationMs(frames, fps);
    a.impactMs = impactDelayMs(
      meta?.impact ?? Math.floor(frames / 2),
      frames,
      fps,
    );
    /**
     * 이미 나가 있던 만큼 접근을 건너뛴다. 곡선의 역함수로 시각을 되찾으므로
     * 다음 프레임의 진행도가 지금 위치와 정확히 이어진다 — 비율을 그대로
     * 시각으로 쓰면(선형 가정) 화면이 한 번 튄다.
     */
    const skip =
      fromAdvance > 0
        ? approachCurveInverse(fromAdvance, a.dashStyle.approach) *
          a.dashStyle.approachMs
        : 0;
    a.elapsedMs = skip;
    /**
     * **`prevMs`는 0이다** (건너뛴 만큼이 아니다). `stepAlly`는 클립 재생을
     * "지난 프레임엔 이 국면이 아니었다"로 판정하는데, 여기에 `skip`을 넣으면
     * 이미 접근이 끝난 자리에서 갈아탈 때 그 경계를 **넘은 적이 없는** 상태가
     * 되어 공격 클립이 재생되지 않는다 — 아군이 달리기 루프를 돌면서 HP만
     * 깎는 그림이 된다. 0이면 어느 국면에서 시작해도 그 클립이 한 번 걸린다.
     * (임팩트는 가장 이른 것도 143ms 뒤라 이 프레임에 앞당겨 터지지 않는다.)
     */
    a.prevMs = 0;
    /**
     * **"제자리에서 쓰지 않고 적까지 달려간다"는 스크린샷으로 검증할 수 없다.**
     * 한 장에는 어느 한 순간의 위치만 있어서, 거기 서 있는 것이 달려간 결과인지
     * 원래 자리인지 구별되지 않는다. 헤드리스 하네스가 이 로그로 이동 거리를
     * 읽는다 — `travel`이 0에 가까우면 제자리에서 휘두른 것이다.
     *
     * `from`은 갈아탈 때의 시작 진행도다. 이미 붙어 있었다면(1에 가깝다) 남은
     * 이동이 적은 게 정상이라, 거리만 보면 오진한다.
     */
    if (import.meta.env.DEV) {
      const reachX = laneX(a);
      const startX = a.homeX + (reachX - a.homeX) * fromAdvance;
      console.log(
        `[dash] ally=${a.id} skill=${skill?.id ?? "auto"} clip=${a.clip}` +
          ` from=${fromAdvance.toFixed(2)} travel=${Math.abs(reachX - startX).toFixed(1)}` +
          ` home=${a.homeX.toFixed(0)} reach=${reachX.toFixed(0)}` +
          ` approachMs=${a.dashStyle.approachMs.toFixed(0)} mirror=${mirrorX}`,
      );
    }
    /**
     * 출발하는 발밑에 먼지를 깐다. 접근이 190ms(리제)면 그 사이에 프레임이
     * 11장뿐이라 눈에는 순간이동으로 남는다 — 지면을 밀었다는 증거가 화면에
     * 있어야 "달려갔다"로 읽힌다.
     *
     * 이어서 파고드는 경우는 발이 이미 떠 있으므로 먼지를 다시 깔지 않는다 —
     * 대기 자리(`homeX`)에 먼지가 피면 거기 있지도 않은 발을 가리킨다.
     */
    if (fromAdvance <= 0) {
      const dust = dashDustFx(a.style.approach, rect.h);
      opts.fx.spawn({
        sheet: dust.sheet,
        x: absX(a.homeX),
        // 먼지는 발밑이다. 시트 자체가 아래쪽에 그려져 있으므로 y는 지면에 둔다
        y: absY(rect.h * GROUND_RATIO),
        scale: dust.scale,
      });
    }
  };

  const popGold = (x: number, y: number): void => {
    const s = golds.find((g) => !g.active) ?? golds[0]!;
    s.active = true;
    s.elapsedMs = 0;
    s.baseX = x;
    s.baseY = y;
    // 좌우로 살짝 흩어진다. 같은 자리에서 여러 개가 겹치면 하나로 보인다
    s.driftX = (rng.next() * 2 - 1) * 22;
    s.view.visible = true;
    s.view.position.set(x, y);
    s.view.alpha = 1;
    // 반전 필드에서는 코인이 좌우로 뒤집힌다 — 원형이라 형태는 같지만
    // 왼쪽 위 하이라이트(§01-3)가 오른쪽으로 가므로 역보정한다.
    // 광원 방향은 화면 전체에서 하나여야 한다
    s.view.scale.set(mirrorX ? -1 : 1, 1);
  };

  /**
   * 밀린 피격을 **지금** 화면에 낸다 — 플래시·넉백·HP바·숫자·이펙트.
   *
   * 호출 시점이 곧 "맞은 순간"이다. 이 함수는 임팩트 프레임에서만 불려야 한다
   * (`PENDING_HARD_MS` 안전장치 제외).
   */
  const releaseHit = (index: number, why: string): void => {
    const slot = enemies[index];
    if (!slot) return;
    const p = slot.pending;
    slot.pending = null;
    if (!p || !slot.occupied || slot.buried) return;
    /**
     * "HP는 임팩트에서만 깎인다"는 스크린샷 한 장으로 검증할 수 없다 —
     * 헤드리스 하네스가 이 로그로 순서(dash → impact → hp)를 읽는다.
     * `why=hard`가 많이 찍히면 임팩트가 안 오고 있다는 뜻이다(= 게이팅 실패).
     */
    if (import.meta.env.DEV) {
      console.log(
        `[melee] hit slot=${index} why=${why} hp=${p.hpRatio.toFixed(2)}` +
          ` dealt=${p.dealt.toFixed(1)} held=${p.heldMs.toFixed(0)}` +
          ` killed=${p.killed} mirror=${mirrorX}`,
      );
    }
    const h = enemyHeight(slot);
    // 깊이로 올라간 만큼 부착물도 같이 올라간다.
    // 0.55(가슴)에서 0.42로 내렸다 — 숫자가 위로 떠오르면서 머리 위 HP바를
    // 가렸다 (스크린샷에서 확인). 몸통 중앙에서 시작하면 상승분이 HP바 아래에서 끝난다
    const chestY = slot.baseY - h * 0.42;

    slot.hpBar.setRatio(p.hpRatio);
    // 이미 죽는 중이면 히트 연출을 덮어쓰지 않는다 — 사망 포즈가 리셋된다
    if (slot.deathMs < 0) {
      slot.flashMs = 0;
      slot.knockMs = 0;
      slot.char.playOnce(p.killed ? "death" : "hit", "run");
      /**
       * 피격 클립이 방금 시작했으므로 공격 타이머를 한 주기 뒤로 민다.
       * 밀지 않으면 `hit`이 재생되는 중에 공격이 끼어들어 **맞는 동작이 끊긴다** —
       * 피격 반응이 사라지는 것이 공격 모션이 늦는 것보다 나쁘다.
       */
      slot.attackCooldownMs = enemyAttackPeriodMs(
        enemyAttackClipMs(slot),
        index,
      );
    }

    // 데미지 숫자는 가슴 높이에서. 발밑에서 뜨면 그림자와 겹친다
    if (p.dealt >= 1) {
      damage.spawn({
        x: flipX(slot.centerX),
        y: chestY,
        amount: p.dealt,
        // 처치타는 금색으로 강조한다 — 코어에 크리티컬 개념이 없으므로
        // "결정타"를 크리티컬 연출로 재활용한다 (§C6)
        kind: p.killed ? "crit" : "normal",
      });
    }

    opts.fx.spawn({
      sheet: "impact",
      x: absX(slot.centerX),
      y: absY(chestY),
      scale: 0.8,
    });

    if (p.killed && slot.deathMs < 0) {
      slot.deathMs = 0;
      slot.hpBar.view.visible = showsHpBar(slot);
      // 골드가 튀는 연출은 재화 시스템이 없어도 넣는다 (§4-2) —
      // 레퍼런스의 타격감 핵심이고, 후에 재화를 붙일 때 재작성이 없다
      popGold(slot.centerX, slot.baseY - h * 0.4);
    }
  };

  /**
   * 밀린 피격을 전부 지금 낸다.
   *
   * **웨이브가 끝나는 순간 반드시 불러야 한다.** 마지막 적을 죽인 타격은
   * 임팩트를 기다리는 중인데, 코어는 그 틱에 이미 다음 웨이브로 넘어가고
   * 전진 연출이 아군 돌진을 취소한다 — 임팩트가 영원히 오지 않는다. 그대로
   * 두면 **결정타만 화면에 없다**(사망 모션도, 골드도 안 나온다). 헤드리스
   * 로그에서 `killed=true`가 한 번도 안 찍혀서 잡았다.
   */
  const flushPending = (why: string): void => {
    // 앞 슬롯부터 — 뒤가 먼저 쓰러지면 딜이 뒤에서 들어온 것처럼 보인다
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i]!.pending) releaseHit(i, why);
    }
  };

  /** 아군 하나의 돌진 타임라인을 한 스텝 굴린다 */
  const stepAlly = (a: AllySlot, dtMs: number, baseline: number): void => {
    if (a.elapsedMs === null) {
      // 전진 연출 중에는 새 사이클을 시작하지 않는다 (§8) — 달리다가 한 명이
      // 갑자기 뛰쳐나가면 무엇을 하는 중인지 알 수 없다
      a.restMs -= dtMs;
      /**
       * **AUTO가 꺼져 있으면 새 사이클을 시작하지 않는다** (`autoOn`).
       *
       * ## 앞선 결정과 그것이 뒤집힌 이유
       *
       * 예전에도 여기서 막았고(`autoDash`), 그 뒤 **막는 것을 뗐다**. 근거는
       * 실측이었다: 딜을 내는 쪽(`core/team.autoAttackDamage`)은 배지를 받지도
       * 않으므로, 동작만 끄면 AUTO OFF에서 내 캐릭터가 돌진 0회·타격 0회인데
       * 팀 딜의 **45.3%**(44.4 raw dps)를 냈다 — 화면이 코어를 배신했다.
       * 그래서 "딜을 끄는 대신 동작을 붙인다"로 갔다.
       *
       * 그 관찰은 맞았지만 **고른 해법이 유저 기대와 반대였다.** 유저 신고:
       * "Auto를 안 키면 캐릭터가 움직이면 안 된다고 생각하거든? 근데 계속
       * 움직여." 방치형에서 AUTO 배지는 "네가 손을 놓아도 되는가"를 묻는
       * 스위치이므로, 껐을 때 아무 일도 안 일어나는 것이 이 게임의 계약이다.
       *
       * **그래서 이번에는 딜도 같이 끈다.** 45.3%가 돌아오지 않는 것은 세션이
       * 같은 값을 딜 계산에서도 보기 때문이다(`single/session.ts`의
       * `field.auto` 게이트) — 동작과 딜이 **한 값**을 보므로 둘이 갈릴 수 없다.
       * 배지 하나가 승패를 정하는 문제는 싱글에 없다: 상대가 없다.
       *
       * ## PvP도 이 게이트를 쓴다 (2026-08-10)
       *
       * 여기에는 "**PvP는 이 게이트를 안 쓴다**"고 적혀 있었다. 근거는 양 팀이
       * 같은 코어 식을 쓰므로 한쪽만 끄면 승패가 배지로 결정된다는 것이었다.
       * 유저가 같은 신고를 PvP에서 다시 했고("auto off여도 내 캐릭터가 공격하는
       * 이슈 있어"), 그 근거를 12시드로 재 보니 틀렸다: **내 칸만 끄면 손을 쓰는
       * 판은 여전히 12/12로 이긴다**(표는 `pvp/sessionRules.myAutoDamage`).
       * 배지가 바꾸는 것은 이기는 데 걸리는 시간이고, 지는 것은 손을 놓은 판뿐이다.
       *
       * 다만 PvP는 **내 칸에만** 건다(`autoFor` / `setAuto`의 `onlyIds`) —
       * 팀 전원을 세우면 같은 측정에서 난사해도 0/12였다.
       *
       * 진행 중인 사이클(`elapsedMs !== null`)은 여기 오지 않는다 — 끝까지
       * 재생된다. 중간에 끊으면 칼을 뽑은 아군이 대기 자리로 순간이동한다.
       */
      if (!advancing && autoFor(a) && a.restMs <= 0) beginDash(a);
      return;
    }
    a.prevMs = a.elapsedMs;
    a.elapsedMs += dtMs;
    const o = {
      // 스킬이 접근 박자를 덮은 스타일이다. `a.style`을 쓰면 스킬 모션이
      // 자동 공격과 같은 속도로 붙어서 "무거운 마무리기"가 안 읽힌다
      style: a.dashStyle,
      strikeMs: a.strikeMs,
      impactAtMs: a.impactMs,
      clip: a.clip,
    };
    // 목표가 죽어 있으면(다른 아군이 먼저 죽였다) 자리로 돌아온다 —
    // 시체를 계속 때리면 딜이 어디로 가는지 화면에 없다
    const target = enemies[a.targetIndex];
    const dead =
      !target || !target.occupied || target.buried || target.deathMs >= 0;
    /**
     * **복귀로 갈아타는 것은 좌표가 아니라 시각이다.**
     *
     * 예전에는 여기서 진행분을 0으로 눌렀다(`adv = dead ? 0 : pose.advance`).
     * 그러면 `phase`는 여전히 `strike`인데 위치만 대기 자리로 순간이동해서,
     * 적 앞까지 달려간 아군이 **한 프레임에 뒤로 사라지고 거기서 공격 클립을
     * 끝까지 재생한다** — 실측 530ms(`water_priestess_burst`). 화면에는
     * "공격액션이 먼저 되고 나중에 앞으로 간다"로 보였다.
     *
     * 경과 시각을 복귀 구간의 **지금 진행도에 해당하는 지점**으로 옮기면
     * 그 자리에서 물러나기가 시작된다(`cutToReturnMs`). 갈아탄 프레임의
     * 진행도가 직전 프레임과 같아서 좌표가 튀지 않는다.
     */
    // `prevMs`는 그대로 둔다 — 아직 `strikeEndMs` 앞이라 `restart`가 서고,
    // 그 덕에 공격 클립이 이동 클립으로 바뀐다. 이 프레임에 `impact`가 같이
    // 설 수 있지만 아래 `!dead` 게이트가 막는다(죽은 적에게 딜은 안 들어간다)
    if (dead && a.elapsedMs < meleeSpan(o).strikeEndMs) {
      a.elapsedMs = cutToReturnMs(a.advance, o);
    }
    const pose = meleePose(a.elapsedMs, a.prevMs, o);
    if (pose.restart) {
      // 접근·복귀는 이동 루프(`run`/`roll`)라 반복해야 한다. 공격 클립은 1회 —
      // 반복하면 임팩트가 지난 뒤에도 칼이 계속 돌아 어느 것이 타격인지 없어진다
      const loop = pose.phase !== "strike";
      a.char.play(pose.clip, loop);
    }

    /**
     * 멈추는 지점 = 대기 자리 → **적의 앞면**을 `1 - reach`만큼 간 곳.
     *
     * **필드 폭 비율이 아니라 아군↔적 거리 비율이다.** 폭으로 잡으면 사거리가
     * 긴 캐릭터(0.36)는 대기 자리에서 몇 px 못 벗어나 돌진이 안 보이고, 뒤쪽
     * 슬롯의 아군은 적을 지나쳐 뒤로 나간다.
     *
     * **중심이 아니라 앞면까지다.** 중심으로 잡으면 몸이 큰 적(보스는 1.6배)
     * 안으로 걸어 들어가 아군이 적의 몸 속에 서 있는 그림이 된다 — 스크린샷에서
     * 확인했다. 앞면은 실측 범위(`visualExtent`)의 아군 쪽 끝이다.
     *
     * **줄을 세운다(`laneX` → `allyLaneX`).** 적이 하나뿐인 판에서는 두 아군의
     * 목표와 앞면이 같아서 둘이 거의 같은 x에 선다 — 10층 보스에서 37px
     * 차이였고 몸폭이 179px이라 한 덩어리로 뭉쳤다(1:1 캡처).
     */
    const reachX = laneX(a);
    // 사거리를 뺀 지점까지 간다. 목표가 죽은 경우는 위에서 복귀로 갈아탔으므로
    // 여기서 좌표를 만질 일이 없다 — 진행도를 그대로 쓴다
    a.advance = pose.advance;
    a.char.view.x = a.homeX + (reachX - a.homeX) * pose.advance;
    placeAllyShadow(a, baseline);

    if (pose.impact && !dead) {
      /**
       * **때리는 순간 어디에 서 있었나.** `[dash]`는 출발 시점의 예정 거리라
       * 도중에 무슨 일이 있어도 travel을 남긴 상태다. 이건 렌더된 x를 그대로
       * 읽으므로 예정이 아니라 결과다 — `atRatio`가 1에 가까워야 적 앞에서
       * 때린 것이다. 이 값이 0에 붙어 있으면 대기 자리에서 허공을 휘두른다.
       */
      if (import.meta.env.DEV) {
        const span = reachX - a.homeX;
        const atRatio = Math.abs(span) < 1 ? 1 : (a.char.view.x - a.homeX) / span;
        console.log(
          `[strike] ally=${a.id} skill=${a.dashSkill?.id ?? "auto"}` +
            ` x=${a.char.view.x.toFixed(0)} home=${a.homeX.toFixed(0)}` +
            ` reach=${reachX.toFixed(0)} atRatio=${atRatio.toFixed(2)} mirror=${mirrorX}`,
        );
      }
      // 이 프레임이 "맞았다"다. 묵은 슬롯도 같이 터뜨린다 — 앞 적이 죽어서
      // 넘친 딜을 받은 뒤쪽 슬롯이 영원히 기다리는 것을 막는다
      const held = new Map<number, number>();
      enemies.forEach((s, i) => {
        if (s.pending) held.set(i, s.pending.heldMs);
      });
      for (const i of releaseOrder(a.targetIndex, held)) {
        releaseHit(
          i,
          i === a.targetIndex
            ? // 스킬 id를 같이 남긴다 — `attack1`만 보면 그것이 심연 베기인지
              // 자동 공격 순환의 한 차례인지 로그에서 구별할 수 없다
              `impact:${a.id}:${a.clip}:${a.dashSkill?.id ?? "auto"}`
            : "spill",
        );
      }
      /**
       * 타격 연출은 캐릭터별로 다르다 (`meleeFx`) — 검은 궤적, 둔기는 스파크.
       *
       * 위치는 **아군의 무기 끝**이지 적의 몸 중심이 아니다. 적 중심에 두면
       * 사거리가 긴 캐릭터(클로에 0.36)의 이펙트가 몸에서 떨어져 터진다.
       */
      const skillLayers = skillHitFx(a.dashSkill, a.style.approach, rect.h);
      const layers: readonly SkillFxSpec[] =
        skillLayers.length > 0
          ? // 스킬 타격은 자기 층을 시각차를 두고 겹쳐 깐다 — 자동 공격과 같은
            // 궤적 하나면 눌렀을 때 나오는 것이 그냥 자동 공격이다
            skillLayers
          : [
              // 자동 공격은 한 장이다. 지연·높이는 예전 값을 그대로 쓴다
              {
                ...meleeFx(a.slug, a.clip, a.style.approach, rect.h),
                delayMs: 0,
                liftRatio: 0.45,
              },
            ];
      for (const spec of layers) {
        opts.fx.spawn({
          sheet: spec.sheet,
          // 오프셋은 **로컬 좌표계에서** 앞(오른쪽)으로 미는 값이다. `absX`가
          // 반전 필드에서 그것까지 같이 접으므로 여기서 부호를 만지지 않는다
          x: absX(a.char.view.x + rect.w * spec.offsetRatio),
          // 층마다 높이가 다르다 — 다 같은 y면 가로줄 하나로 뭉친다
          y: absY(a.char.view.y - rect.h * ALLY_H_RATIO * spec.liftRatio),
          scale: spec.scale,
          // 아래 필드는 좌우가 뒤집혀 있다 — 궤적도 뒤집어야 캐릭터가 휘두르는
          // 방향과 같아진다. `fx` 레이어는 반전 컨테이너 밖이라 직접 뒤집는다
          rotation: spec.rotation * dirX,
          delayMs: spec.delayMs,
        });
      }
    }

    if (pose.done) {
      a.elapsedMs = null;
      a.prevMs = 0;
      a.advance = 0;
      a.restMs = restAfterMs(meleeSpan(o).totalMs, a.attackIntervalMs);
      a.char.view.x = a.homeX;
      a.char.play(advancing ? "run" : "idle");
      placeAllyShadow(a, baseline);
    }
  };

  return {
    view,
    setSlideY(offsetPx: number): void {
      // 기준은 `rect.y`다 — 0을 넣으면 제자리로 돌아간다. 산수는 규칙이
      // 정본이다(`fieldSlideY`): 여기 인라인으로 두면 검사가 못 묻는다
      view.y = fieldSlideY(rect.y, offsetPx);
    },
    setRect(next: SplitRect): void {
      rect = next;
      bg.setRect(localRect());
      layout();
    },
    setWave(wave: WaveDef, hpRatios?: readonly number[]): void {
      // 지난 무리의 결정타를 먼저 낸다 — `spawnWave`가 버퍼를 비우므로
      // 여기서 안 내면 마지막 적이 소리 없이 사라진다
      flushPending("wave");
      applyWaveBackground(wave);
      spawnWave(wave, hpRatios);
    },
    setWaveBackground(wave: WaveDef): void {
      applyWaveBackground(wave);
    },
    setDepth,
    setScrollSpeed(pxPerSec: number): void {
      bg.setScrollSpeed(pxPerSec);
    },
    flushHits(): void {
      flushPending("flush");
    },
    setAuto(on: boolean, onlyIds?: readonly string[]): void {
      autoOn = on;
      /**
       * 범위를 바꿀 때 **매번 다시 쓴다**(`null`로 지우는 것 포함). 남겨 두면
       * 재대전에서 앞 판의 범위가 그대로 걸린다.
       */
      autoOnlyIds = onlyIds ? new Set(onlyIds) : null;
    },
    get auto(): boolean {
      return autoOn;
    },
    setAdvancing(on: boolean): void {
      if (on === advancing) return;
      advancing = on;
      /**
       * 전진이 시작되면 남은 피격을 지금 낸다 — 아래에서 아군 돌진을 취소하므로
       * 이 줄 뒤에는 임팩트가 올 곳이 없다. 사망 연출(260ms)이 전진 스크롤
       * (200~1000ms) 안에서 재생되어 "무리를 쓸고 나아간다"로 읽힌다.
       */
      if (on) flushPending("advance");
      for (const a of allies) {
        // 돌진 중인 아군은 자리로 되돌린다 — 전진 연출은 배경이 흐르는 그림이라
        // 한 명이 오른쪽에 뻗어 있으면 그 캐릭터만 뒤로 끌려가는 것으로 보인다
        a.elapsedMs = null;
        a.prevMs = 0;
        a.char.view.x = a.homeX;
        a.char.play(on ? "run" : "idle");
        placeAllyShadow(a, rect.h * GROUND_RATIO);
        // 전진이 끝나면 순서대로 다시 뛰어나간다
        if (!on) a.restMs = allies.indexOf(a) * MELEE_STAGGER_MS;
      }
    },
    setSlowed(on: boolean, remainingMs: number): void {
      slowRemainingMs = on ? Math.max(0, remainingMs) : 0;
      if (on === slowed) return;
      slowed = on;
      slowMs = 0;
      if (!on) {
        // 채도·사슬을 즉시 되돌린다. 해제는 지연 없이 보여야 "이제 풀렸다"가 된다
        applyDesat(false);
        paintChains(0, 0);
      }
    },
    onAllyAttack(memberId: string, skillId?: string): void {
      const a = allyById.get(memberId);
      if (!a) return;
      /**
       * 어느 스킬을 눌렀는지가 곧 어떤 모션이 나오는지다 (`skillMeleeRules`).
       * `skillId`가 없거나 돌진하지 않는 스킬(방해·버프)이면 `null`이 되어
       * 자동 공격의 순환 클립을 그대로 쓴다 — 사슬을 걸었는데 칼을 휘두르지 않는다.
       */
      const skill = skillId === undefined ? null : skillMelee(skillId);
      /**
       * 스킬 시전은 **진행 중인 사이클을 끊고 갈아탄다**.
       *
       * 예전에는 대기 중일 때만 돌진시켰다. 자동 공격 사이클이 1.3초인데 스킬
       * 쿨다운은 2.5초라, 누른 순간 아군이 이미 뛰고 있을 확률이 절반을 넘는다 —
       * 그러면 광선만 날아가고 모션은 자동 공격 그대로였다. 헤드리스에서 스킬을
       * 다섯 번 눌러 **스킬 돌진이 한 번도 안 선** 것으로 확인했다.
       *
       * 끊을 때는 지금 서 있는 진행도(`a.advance`)에서 이어 붙는다 — 0으로
       * 되돌리면 적 앞에 있던 아군이 대기 자리로 순간이동한다. 이미 붙어 있으면
       * 접근을 건너뛰고 그 자리에서 바로 스킬을 휘두른다.
       *
       * 전진 연출(§8) 중에는 끊지 않는다 — 달리는 무리에서 한 명만 뛰쳐나가면
       * 무엇을 하는 중인지 알 수 없다.
       */
      if (!advancing) {
        const from = a.elapsedMs === null ? 0 : a.advance;
        a.restMs = 0;
        /**
         * 예약은 `beginDash` **직전에만** 세운다. 돌진이 서지 않으면(목표 없음)
         * 여기 남겨 두면 안 된다 — 몇 초 뒤 자동 공격 차례에 스킬 모션이
         * 튀어나와서 누른 것과 화면이 어긋난다.
         */
        a.pendingSkill = skill;
        const wasIdle = a.elapsedMs === null;
        beginDash(a, from);
        // 목표가 없으면(웨이브 사이) 제자리에서라도 휘두른다 — 결과 화면의
        // `celebrate()`가 이 경로로 온다
        if (wasIdle && a.elapsedMs === null) {
          a.pendingSkill = null;
          a.char.playOnce(skill?.clip ?? "attack", "idle");
        }
      }
      /**
       * 시전 순간 몸에 뜨는 층들. 스킬마다 다르다 — 심연 베기는 앞으로 쏘는
       * 궤적, 공허 폭발은 차오르는 기운이라 늦은 임팩트까지의 뜸을 채운다.
       *
       * **광선을 지운 자리를 이것이 메운다.** 공격 스킬에서 슬롯 → 적 광선을
       * 뺐으므로(`castBeamShown`), 눌렀다는 증거는 전부 캐릭터 몸에서 나와야
       * 한다 — 한 장으로는 약해서 층을 어긋나게 깐다.
       */
      for (const spec of skillCastFx(skill, a.style.approach, rect.h)) {
        /**
         * 자리를 **뜨는 순간에** 다시 읽는다.
         *
         * 시전 층은 최대 200ms 뒤에 뜨는데(`skillMeleeRules`의 버스트 cast
         * 200ms), 바로 위에서 `beginDash`를 걸었으므로 그 사이에 캐릭터는 적
         * 앞까지 달려간다. 요청 시점 좌표로 고정하면 **달리기 전 대기 자리에**
         * 기운이 차오르는 그림이 남는다 — 눌렀다는 증거가 캐릭터에서 떨어진다.
         */
        const at = (): { x: number; y: number } => ({
          x: absX(a.char.view.x + rect.w * (0.06 + spec.offsetRatio)),
          y: absY(a.char.view.y - rect.h * ALLY_H_RATIO * spec.liftRatio),
        });
        opts.fx.spawn({
          ...at(),
          sheet: spec.sheet,
          scale: spec.scale,
          rotation: spec.rotation * dirX,
          delayMs: spec.delayMs,
          anchor: at,
        });
      }
    },
    /**
     * 코어가 확정한 피격을 **버퍼에만** 넣는다.
     *
     * 화면에 내는 것은 `releaseHit`이 임팩트 프레임에서 한다. 여기서 바로
     * 반영하면 아군이 칼을 뽑기도 전에 HP가 줄어 있어서, 무엇이 적을 깎는지
     * 그림에 없다 — 이 필드 전체가 그 문제를 고치기 위한 것이다.
     *
     * **코어 수치는 여기서 손대지 않는다.** 딜·게이지·승패는 이미 결정났고
     * 화면만 늦게 따라간다 (AC-4 결정론 유지).
     */
    onEnemyHit(hit: EnemyHitFx): void {
      const slot = enemies[hit.enemyIndex];
      if (!slot || !slot.occupied || slot.buried) return;
      /**
       * 이미 결정타가 밀려 있으면 이 피격은 **다음 무리**의 것이다 (코어가
       * 전진 연출보다 앞서 있다). 합치면 죽은 적의 `killed`와 새 적의
       * `hpRatio`가 섞여 만피인 적이 쓰러진다. 묵은 결정타를 먼저 내보내고
       * 새 피격은 버린다 — 새 적의 HP는 `spawnWave`가 코어 값으로 스냅한다.
       */
      if (pendingIsStale(slot.pending ?? undefined)) {
        releaseHit(hit.enemyIndex, "stale");
        return;
      }
      slot.pending = mergePending(slot.pending ?? undefined, hit);
    },
    showInterference(amount: number): void {
      // 우리 필드 중앙 상단. 아래로 떨어지는 붉은 숫자 = 상대가 준 것 (§C6)
      damage.spawn({
        // 정중앙이라 반전과 무관하지만 `flipX`를 지난다 — 안 지나는 좌표를
        // 하나라도 두면 다음 사람이 그걸 본보기로 삼는다
        x: flipX(rect.w * 0.5),
        y: rect.h * 0.3,
        amount,
        kind: "interference",
      });
    },
    update(dtMs: number): void {
      bg.update(dtMs);
      // 감속은 아군 모션을 0.6배로 늦춘다 (§9). 딜 배율과 같은 값이므로
      // "느려 보이는 만큼 딜이 준다"가 화면과 수치에서 같은 이야기가 된다
      const allyDt = slowed ? dtMs * SLOW_MOTION_SCALE : dtMs;
      const baseline = rect.h * GROUND_RATIO;
      for (const a of allies) {
        a.char.update(allyDt);
        // 돌진도 같은 배율로 늦춘다 — 모션만 늦고 이동이 그대로면 발이 미끄러진다
        stepAlly(a, allyDt, baseline);
      }

      if (slowed) {
        // 남은 시간은 여기서 줄이지 않는다 — 코어의 `slowUntilMs`가 진실이고
        // 세션이 매 프레임 `setSlowed`로 넘겨준다. 두 곳에서 세면 어긋난다
        slowMs += dtMs;
        applyDesat(true);
        desat.saturate(saturateDelta(slowSaturate(true)), false);
        paintChains(chainAlpha(slowMs, true), chainStrain(slowRemainingMs));
      }

      for (const slot of enemies) {
        slot.char.update(dtMs);
        slot.hpBar.update(dtMs);
        if (!slot.occupied) continue;

        // 걸어 들어오는 중 — 다 들어오면 제자리 대기(`run`)로 바뀐다
        if (slot.walkInMs !== null) {
          slot.walkInMs += dtMs;
          const p = walkInPose(slot.walkInMs, enemies.indexOf(slot));
          const dx = rect.w * ENEMY_WALK_IN_OFFSET * (1 - p.arrive);
          if (slot.knockMs < 0) slot.char.view.x = slot.x + dx;
          slot.shadow.x = slot.centerX + dx;
          if (!p.walking) {
            slot.walkInMs = null;
            slot.char.play("run");
            /**
             * 자리를 잡은 뒤에 바가 뜬다 — 이제 바 밑에 적이 있다.
             *
             * **여기가 유저 신고 1번의 자리다.** 예전에는 `deathMs < 0`만 봤는데
             * 사망 연출이 끝나면 그 값이 -1로 돌아오므로, 등장 중에 죽은 적
             * (강제 방출 `why=hard`, 등장 620ms와 `PENDING_HARD_MS`가 겹친다)의
             * 바가 도착 시점에 **되살아났다** — 스프라이트는 안 보이고 바만 남아
             * 다음 층 슬라이드에 실려 아래로 흘러내렸다. `showsHpBar`가 `buried`도
             * 같이 묻는다.
             */
            slot.hpBar.view.visible = showsHpBar(slot);
          }
        }

        /**
         * 제자리 공격 모션 (유저 신고: "몬스터들이 공격 모션을 안 해").
         *
         * **딜은 만들지 않는다** — 적의 피해량은 이 게임에 없다. 이건 순수하게
         * "적이 나를 때리려 한다"를 화면에 내는 일이다. 그래서 코어와 대화하지
         * 않고 필드 안에서 끝난다.
         *
         * 게이트가 여럿인 이유: 등장 중(`walkInMs`)이면 이동에 섞여 무엇인지
         * 안 보이고, 죽는 중(`deathMs`)·묻힌 뒤(`buried`)에 휘두르면 시체가
         * 일어난다. 밀린 피격(`pending`)이 있으면 곧 `hit`이 올 차례다 —
         * 공격을 먼저 걸면 그 `hit`이 공격을 덮어 둘 다 반토막 난다.
         */
        if (
          slot.walkInMs === null &&
          slot.deathMs < 0 &&
          !slot.buried &&
          slot.pending === null
        ) {
          slot.attackCooldownMs -= dtMs;
          if (slot.attackCooldownMs <= 0) {
            slot.char.playOnce("attack1", "run");
            slot.attackCooldownMs = enemyAttackPeriodMs(
              enemyAttackClipMs(slot),
              enemies.indexOf(slot),
            );
          }
        }

        /**
         * 밀린 피격을 나이 먹인다. 임팩트가 오지 않아도 한계까지 묵으면
         * 강제로 낸다 — 코어가 죽인 적이 화면에 서 있으면 다음 스폰과 어긋난다.
         * 연출을 위해 상태를 잃는 것은 연출보다 나쁘다.
         */
        if (slot.pending) {
          slot.pending.heldMs += dtMs;
          if (slot.pending.heldMs >= PENDING_HARD_MS) {
            releaseHit(enemies.indexOf(slot), "hard");
          }
        }

        // 히트 플래시 — skeleton.color를 흰색 쪽으로 당긴다
        if (slot.flashMs >= 0) {
          slot.flashMs += dtMs;
          const k = hitFlash(slot.flashMs);
          if (k <= 0) {
            slot.flashMs = -1;
            slot.char.setTint(slot.baseTint, slot.char.view.alpha);
          } else {
            slot.char.setTint(FLASH_COLOR, slot.char.view.alpha);
          }
          if (slot.flashMs >= HIT_FLASH_MS) slot.flashMs = -1;
        }

        // 넉백 — 바라보는 반대 방향(적은 왼쪽을 보므로 오른쪽 뒤로) 으로 밀린다.
        // 로컬 좌표계라 양 필드가 같다(화면 반전은 `world`가 한다)
        if (slot.knockMs >= 0) {
          slot.knockMs += dtMs;
          const back = knockback(slot.knockMs);
          // 등장 중에 맞을 수도 있다(강제 방출) — 등장 편차 위에 넉백을 더한다.
          // 슬롯 좌표로 되돌리면 아직 안 들어온 적이 자리로 순간이동한다
          slot.char.view.x = slot.x + walkInDx(slot) + back;
          if (slot.knockMs >= KNOCKBACK_MS) {
            slot.knockMs = -1;
            slot.char.view.x = slot.x + walkInDx(slot);
          }
        }

        if (slot.deathMs >= 0) {
          slot.deathMs += dtMs;
          const p = deathPose(slot.deathMs);
          // 깊이 축소가 이미 scale.x에 들어 있다 — 거기에 찌부러짐만 곱한다
          const base = Math.abs(slot.char.view.scale.x || 1);
          slot.deathScaleY = p.scaleY;
          slot.char.view.scale.set(base, base * p.scaleY);
          slot.char.view.rotation = (p.rotationDeg * Math.PI) / 180;
          slot.char.view.alpha = p.alpha;
          slot.shadow.alpha = p.alpha;
          if (p.done || slot.deathMs >= DEATH_MS) {
            slot.deathMs = -1;
            slot.buried = true;
            slot.char.view.visible = false;
            slot.shadow.visible = false;
            slot.shadow.alpha = 1;
            /**
             * **바를 여기서도 끈다.** 예전에는 켜는 곳이 셋인데(`spawnWave`·
             * 등장 도착·`releaseHit` 킬) 끄는 곳은 킬 하나뿐이었다 — 스프라이트를
             * 감추는 줄 옆에 바를 감추는 줄이 없으면 그 비대칭이 화면에만 드러난다.
             * 지금은 네 자리가 같은 함수를 부르므로 조건이 갈릴 수 없다.
             */
            slot.hpBar.view.visible = showsHpBar(slot);
          }
        }
      }

      for (const g of golds) {
        if (!g.active) continue;
        g.elapsedMs += dtMs;
        const p = goldPose(g.elapsedMs, g.driftX);
        g.view.position.set(g.baseX + p.dx, g.baseY + p.dy);
        g.view.alpha = p.alpha;
        if (p.done || g.elapsedMs >= GOLD_POP_MS) {
          g.active = false;
          g.view.visible = false;
        }
      }

      damage.update(dtMs);
    },
    destroy(): void {
      bg.destroy();
      for (const a of allies) a.char.destroy();
      for (const slot of enemies) {
        slot.char.destroy();
        slot.hpBar.destroy();
      }
      damage.destroy();
      view.destroy({ children: true });
    },
  };
}
