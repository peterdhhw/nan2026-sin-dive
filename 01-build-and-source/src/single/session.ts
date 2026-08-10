/**
 * 싱글(하강) 세션 — 층 진행·딜·강화·타락도·저장을 묶는 오케스트레이터.
 *
 * 원형은 `pvp/session.ts`다: 거기서 게이지·상대 필드·방해를 빼고,
 * 하강(웨이브 창 갈아타기)·골드/강화·타락도·심연의 선택·방치 보상 반영을
 * 더했다. 수치·판정은 전부 `single/*Rules.ts`와 `core/`에 있다.
 *
 * 생명주기 소유권: `diveScene`이 세션을 만들고 파괴한다 (PvP는 main이
 * 소유하지만 그건 결과 씬 뒤에 전장이 살아 있어야 해서다 — 싱글은 씬과
 * 세션의 수명이 같다).
 */

import { createCastQueue } from "../core/castQueue";
import { createCooldownTracker } from "../core/cooldown";
import { sumTeamRawDamage, type MemberDamage } from "../core/team";
import { createWaveRunner, type WaveRunner } from "../core/waveRunner";
import type { SkillDef, WaveDef } from "../core/types";
import { clampFloor, phaseInfoOf, FINAL_FLOOR } from "../core/phase/floors";
import {
  floorKindOf,
  floorOfWaveIndex,
  generatePhaseWaves,
} from "../core/phase/phaseWaves";
import {
  DRAW_COST,
  abyssForFloorClear,
  canDraw,
  cardsForFloorClear,
} from "../core/deck/deck";
import { rewardCaption, type CardReward } from "../shared/scenes/cardRules";
import {
  createShowcaseOverlay,
  type ShowcaseOverlay,
} from "../shared/scenes/showcaseOverlay";
import { V_ART_VARIANT } from "../shared/scenes/showcaseRules";
import { loadPortraits, type PortraitSet } from "../shared/portraits";
import { findCard, loadCardArt, loadCardManifest } from "../shared/cards";
import { corruptionOf } from "../core/corruption/corruption";
import type { Loadout } from "../loadout/types";
import { Container, Graphics } from "pixi.js";
import { DIVE_FX_STACK, type DiveFxLayerName } from "./diveLayerRules";
import { advanceCrossed } from "../shared/advanceRules";
import { playSfx, resetSfxThrottle, startBgm } from "../shared/audio";
import { volumeNotice } from "../shared/audioSettingsRules";
import { createBattleField } from "../shared/battleField";
import {
  createCastGate,
  skillImpactMs,
  type CastGate,
} from "../shared/castGateRules";
import { buildSkillImpactTable } from "../shared/skillMeleeRules";
import { charDef } from "../shared/spriteChar";
import { NO_DEBUG, type DebugEntry } from "../shared/debugEntry";
import { createEffectPlayer } from "../shared/effects";
import {
  accumulateHit,
  createHitAccumulator,
  resetHitAccumulator,
} from "../shared/hitAccumulator";
import { createLoop } from "../shared/loop";
import { autoBadgeD, autoScopeNotice, createSkillBar } from "../shared/skillBar";
import { createBanner } from "../shared/ui/banner";
import { createHintFinger, createToast, fingerAnchor } from "../shared/ui/hint";
import { TOAST_BOTTOM_RATIO } from "../shared/ui/hintRules";
import { createVolumeBadge } from "../shared/ui/volumeBadge";
import { DESIGN_H, DESIGN_W, HUD_RATIO, SKILLBAR_RATIO, type SplitRect } from "../shared/viewport";
import type { GameApp } from "../shared/app";
import {
  atkMulOf,
  attackIntervalMulOf,
  canBuy,
  clampLevels,
  goldForKill,
  skillMulOf,
  upgradeCost,
  type UpgradeId,
} from "./economyRules";
import { computeIdleReward, type IdleReward } from "./idleRules";
import {
  readSingleSave,
  writeChoices,
  writeCurrency,
  writeFloor,
  writeGrown,
  writeLastTickMs,
  writeStorySeen,
  writeUpgrades,
  type SingleSave,
  type SingleStore,
} from "./saveRules";
import {
  DIVE_SLIDE_OUT_MS,
  DIVE_SLIDE_TOTAL_MS,
  RUSH_MS,
  SAVE_EVERY_MS,
  SINGLE_SKILL_CASTERS,
  SINGLE_TEAM_SIZE,
  WINDOW_FLOORS,
  autoTeamDamage,
  comboGoldMul,
  depthForFloor,
  diveSlideOffset,
  endingReached,
  floorClearLabel,
  isChoiceFloor,
  isShowcaseFloor,
  needsWindowRebuild,
  nextCombo,
  rushActive,
  sameFloorStamp,
  showcaseSub,
  showcaseWord,
  totalDamageMult,
  type FloorStamp,
} from "./sessionRules";
import {
  CHOICE_ACCEPT_LABEL,
  CHOICE_ACCEPT_TOAST,
  CHOICE_BODY,
  CHOICE_REFUSE_LABEL,
  CHOICE_REFUSE_TOAST,
  CHOICE_TITLE,
  CHOICE_TUTORIAL_HINT,
  PROLOGUE_LINES,
  STORY_ENDING_ID,
  STORY_PROLOGUE_ID,
  bossIntroLine,
  endingBody,
  endingOf,
  endingTitle,
  idleRewardToast,
  minibossIntroLine,
} from "./storyRules";
import { createDiveHud, type DiveHud } from "./diveHud";
import { BANNER_TOP_Y, autoBadgePos, volumeBadgePos } from "./diveHudRules";
import { createGapBackdrop } from "./gapBackdrop";
import { createStoryOverlay, type StoryOverlay } from "./storyOverlay";
import { createUpgradePanel, type UpgradePanel } from "./upgradePanel";
import { SINGLE_FIELD_H } from "./upgradePanelRules";

// 순수 규칙 re-export (PvP session.ts와 같은 관례)
export {
  SINGLE_SKILL_CASTERS,
  SINGLE_TEAM_SIZE,
  WINDOW_FLOORS,
  comboGoldMul,
  depthForFloor,
  endingReached,
  isChoiceFloor,
  isShowcaseFloor,
  needsWindowRebuild,
  nextCombo,
  rushActive,
  showcaseSub,
  showcaseWord,
  totalDamageMult,
} from "./sessionRules";

export interface DiveSessionOpts {
  app: GameApp;
  loadout: Loadout;
  save: SingleSave;
  /** main이 계산해 넘기는 방치 보상 — 세션이 적용하고 토스트를 띄운다 */
  idle: IdleReward | null;
  store: SingleStore;
  seed: number;
  /**
   * 보유 카드 장수 → 팀 딜 배율(`core/deck.cardAtkMul`). 3단계.
   *
   * **세션이 직접 읽지 않고 받는다.** 카드함은 `abyss.cards.owned`(공용 저장)에
   * 있고 이 세션이 든 `store`는 `sin.single.*`이다 — 세션이 카드함을 읽으려면
   * 저장 키를 두 벌 알아야 하고, 그러면 "싱글 저장은 saveRules가 정본"이 깨진다.
   * 배선층(`main.ts`)이 두 저장을 다 보는 유일한 자리라 거기서 스냅샷한다.
   *
   * **판 도중에 늘어난다** — 하강에 카드 입구가 둘 있다: 심연석 뽑기
   * (`drawOneCard`, 유저가 누른다)와 보스 층 클리어 지급(`grantFloorCards`,
   * 저절로 들어온다). 그래서 이 값은 진입 시점의 **스냅샷**이고 세션이 자기
   * 사본을 올린다(§10-2의 "대전 승리로만 늘어난다"는 3단계에 무효가 됐다).
   */
  cardCount: number;
  /**
   * 카드 한 장 뽑기 — **카드함을 아는 쪽(main)이 뽑고 저장한다.**
   *
   * 세션이 하는 일은 값(심연석)을 내는 것뿐이다: 뽑기 자체는 저장 키
   * `abyss.cards.owned`와 시드(`runtime.nextSeed`)를 둘 다 봐야 하고, 그 둘은
   * 배선층에 있다 — PvP 승리 보상이 `main.gotoResult`에서 뽑히는 것과 같은
   * 근거다(뽑는 곳과 저장하는 곳이 갈리면 화면의 카드와 카드함이 어긋난다).
   *
   * `"complete"`(더 뽑을 카드가 없음)를 돌려줄 수 있다 — 그때는 **값을 받지
   * 않는다**(`drawCard` 호출부 주석).
   */
  drawCard(): CardReward;
  /**
   * 세션 생성 시각(epoch ms). `lastTickMs = baseEpochMs + elapsedMs`로
   * 저장한다 — 세션 안에서 `Date.now()`를 읽지 않기 위한 기준점이다.
   */
  baseEpochMs: number;
  /** 타이틀 버튼 — 배선은 main.ts가 한다 */
  onExit(): void;
  debug?: DebugEntry;
}

export interface DiveSessionState {
  floor: number;
  maxFloor: number;
  gold: number | null;
  corruption: number;
  combo: number;
  kills: number;
  elapsedMs: number;
}

export interface DiveSession {
  prime(): void;
  start(): void;
  stop(): void;
  /** 하강 스와이프 — 층 전환 연출 스킵 + 러시 버프 (씬이 제스처를 판정해 부른다) */
  swipe(): void;
  /** 강화 시트 열기 (씬의 아래 밴드 위 드래그) */
  openUpgradeSheet(): void;
  /** 모달(스토리·시트)이 떠 있는가 — 씬이 하강 제스처를 눌러야 할 때 */
  readonly modalOpen: boolean;
  readonly state: DiveSessionState;
  destroy(): void;
}

export async function createDiveSession(opts: DiveSessionOpts): Promise<DiveSession> {
  const { app, loadout, store, seed } = opts;
  /**
   * 진입 시점의 카드 장수. **뽑기로 이 판 중에 늘어난다** — 그래서 const가
   * 아니다: 뽑은 카드가 다음 진입까지 배율에 안 실리면 "뽑아도 안 세진다"가 된다.
   */
  let cardCount = opts.cardCount;
  const debug = opts.debug ?? NO_DEBUG;

  // ── 진행 상태 (저장의 정본은 saveRules 키들이고, 여기는 런타임 사본) ──
  const storySeen = new Set(opts.save.storySeen);
  let choices = opts.save.choices;
  let gold: number | null = opts.save.gold;
  let abyss: number | null = opts.save.abyss;
  let upgrades = clampLevels(opts.save.upgrades);
  let maxFloor = clampFloor(Math.max(opts.save.floor, opts.idle?.toFloor ?? 1));
  if (debug.wave !== null) maxFloor = clampFloor(debug.wave);
  if (opts.idle && gold !== null) gold += opts.idle.gold;

  let corruption = corruptionOf(maxFloor, choices);
  let combo = 0;
  let lastClearMs = Number.NEGATIVE_INFINITY;
  let rushUntilMs = Number.NEGATIVE_INFINITY;
  let buffUntilMs = 0;
  let buffMult = 1;
  let elapsedMs = 0;
  /**
   * 화면을 실제로 본 시간(프레임 델타 누적). `lastTickMs` 저장의 기준이다 —
   * `elapsedMs`는 모달(paused) 동안 멈추므로 그걸 쓰면 모달 앞에 머문 실시간이
   * 다음 진입에서 "부재"로 오인되어 방치 보상이 과지급된다 (2026-08-03 리뷰).
   * 백그라운드 탭 시간은 여기서도 빠진다(Ticker가 프레임 델타를 클램프한다)
   * — 그 시간만 방치로 인정되는 것이 맞다.
   */
  let viewedMs = 0;
  let paused = false;
  let destroyed = false;
  let sinceSaveMs = 0;
  /** 이번 세션에서 심연의 선택을 이미 제안한 보스 층 (재진입 반복 제안 방지) */
  const choiceOffered = new Set<number>();

  // ── 웨이브 창 ────────────────────────────────────────────────────────
  let windowStart = maxFloor;
  let waves: WaveDef[] = generatePhaseWaves(seed, windowStart, WINDOW_FLOORS);
  let runner: WaveRunner = createWaveRunner(waves, 0);
  const currentFloor = (): number =>
    floorOfWaveIndex(windowStart, runner.state.waveIndex);

  // ── 전투 조각 ────────────────────────────────────────────────────────
  /**
   * 싱글의 스킬 구성 = **공격 4칸.** 방해 둘만 뺀다.
   *
   * 방해는 상대 필드에 작용하는 것이고 싱글에는 상대가 없다 — 누르면 광선이
   * 빈 곳으로 날아간다. 종류를 명시적으로 고르는 이유는 `!== "interference"`로
   * 두면 다음에 추가되는 종류가 아무 판단 없이 통과하기 때문이다.
   *
   * `"buff"`를 남겨 둔다 — 지금 프리셋에는 버프가 없다(타락 칸을 지웠다:
   * `presetSkillsFor`의 결정 기록). 종류를 지우지 않는 이유는 `castSkill`이
   * 아직 버프 경로를 갖고 있어서, 다시 붙는 날 필터가 조용히 지우지 않게
   * 하려는 것이다.
   */
  const skills: SkillDef[] = loadout.skills.filter(
    (s) => s.kind === "attack" || s.kind === "buff",
  );
  const cooldowns = createCooldownTracker(skills);
  /**
   * 모션 게이트가 쓰는 표 — `스킬 id → 임팩트까지 시간(ms)`.
   *
   * 한 번만 만든다. 매 시전에 만들면 프레임마다 매니페스트를 스물여덟 번
   * 뒤진다. 강화(`upgrades`)가 이 값을 바꾸지 않는 것이 이유이기도 하다 —
   * 공격 속도 강화는 평타 간격(`attackIntervalMs`)에 걸리고 스킬 접근 시간은
   * 로드아웃의 `melee.approachMs`라서, 판 중에 임팩트 시각이 움직이지 않는다.
   *
   * 매니페스트가 아직 없으면(부팅 실패) 빈 표가 되고 게이트는 열려 있다 —
   * 그림도 못 받은 판에서 입력까지 막으면 화면이 죽은 것으로 보인다.
   */
  const impactTable = buildSkillImpactTable(loadout.characters, (slug, clip) => {
    const a = charDef(slug)?.actions[clip];
    return a === undefined ? null : { impactFrame: a.impact ?? 0, fps: a.fps };
  });
  const casts = createCastQueue();
  const myChars = loadout.characters.slice(0, SINGLE_TEAM_SIZE);
  /** 강화가 반영된 스탯 사본 — 구매 때마다 다시 만든다 */
  let dmgChars = buildDmgChars();
  function buildDmgChars(): { memberId: string; stats: { attack: number; attackIntervalMs: number } }[] {
    const atkMul = atkMulOf(upgrades);
    const intervalMul = attackIntervalMulOf(upgrades);
    return myChars.map((c) => ({
      memberId: c.memberId,
      stats: {
        attack: c.stats.attack * atkMul,
        attackIntervalMs: c.stats.attackIntervalMs * intervalMul,
      },
    }));
  }

  // ── 레이아웃 ─────────────────────────────────────────────────────────
  const hudRect: SplitRect = { x: 0, y: 0, w: DESIGN_W, h: DESIGN_H * HUD_RATIO };
  const skillRect: SplitRect = {
    x: 0,
    y: DESIGN_H * (1 - SKILLBAR_RATIO),
    w: DESIGN_W,
    h: DESIGN_H * SKILLBAR_RATIO,
  };
  // 전장 = HUD 아래 ~ 강화 줄 위. 높이는 규칙이 정본이다 — 이펙트 크기가 이
  // 값에서 나오므로(`meleeFx`의 `fieldH`) 검사가 물을 수 있어야 한다
  const fieldRect: SplitRect = {
    x: 0,
    y: hudRect.h,
    w: DESIGN_W,
    h: SINGLE_FIELD_H,
  };

  // ── 위젯 조립 (PvP 조립 순서를 따른다) ───────────────────────────────
  const fx = await createEffectPlayer();
  const hud: DiveHud = createDiveHud({
    onTitle: () => {
      persist();
      opts.onExit();
    },
  });
  const banner = createBanner({ w: DESIGN_W });
  const toast = createToast({
    cx: DESIGN_W / 2,
    cy: DESIGN_H * (1 - TOAST_BOTTOM_RATIO),
  });
  const hintFinger = createHintFinger();
  const field = await createBattleField({
    characters: myChars,
    rect: fieldRect,
    fx,
    rngSeed: seed + 101,
  });
  /** 층 사이 지층 배경 — 슬라이드 때 드러나는 틈을 메운다 */
  const gapBackdrop = createGapBackdrop(fieldRect, seed + 303);
  const upgradePanel: UpgradePanel = createUpgradePanel({
    getGold: () => gold,
    getLevels: () => upgrades,
    getAbyss: () => abyss,
    onBuy: (id) => buyUpgrade(id),
    onDraw: () => drawOneCard(),
    dimTarget: field.view,
  });
  const story: StoryOverlay = createStoryOverlay();
  const myHits = createHitAccumulator();
  let prevReadyIds = new Set<string>();

  /**
   * 시전자별 **모션 게이트** — 방금 지른 타격이 다음 입력에 지워지지 않게 막는다.
   *
   * 쿨다운이 이 자리를 못 막는 이유는 `castGateRules` 머리에 있다: 쿨은 칸마다
   * 따로 돌므로 1번 직후 2번은 값과 무관하게 통과하고, `onAllyAttack`이 진행 중인
   * 클립을 끊는다. 시전자마다 하나씩 갖는 이유는 팀원이 같이 지를 때
   * (`SINGLE_SKILL_CASTERS`) 한 명의 게이트가 다른 명을 막으면 안 되기 때문이다.
   */
  const castGates = new Map<string, CastGate>();
  const gateOf = (memberId: string): CastGate => {
    let g = castGates.get(memberId);
    if (!g) {
      g = createCastGate();
      castGates.set(memberId, g);
    }
    return g;
  };

  /**
   * 시전 한 번. **받아들였는지 돌려준다** — 스킬바가 거부된 탭에 반응하기
   * 위해서다(`SkillBarOpts.onCast` 주석). 거부는 쿨다운을 소모하지 않는다.
   */
  const castSkill = (memberId: string, skill: SkillDef, nowMs: number): boolean => {
    if (!cooldowns.isReady(skill.id, nowMs)) return false;
    /**
     * **쿨다운 소모보다 앞에서 막는다.** 뒤에 두면 게이트에 걸린 입력이 쿨은
     * 태우고 딜은 못 내서, 빠르게 두 번 누른 유저에게 "눌렀는데 아무 일도
     * 없고 쿨만 돈다"가 된다 — 그건 고치려던 것보다 나쁘다.
     */
    const gate = gateOf(memberId);
    if (!gate.canCast(nowMs)) return false;
    gate.mark(nowMs, skillImpactMs(impactTable, skill.id));
    cooldowns.trigger(skill.id, nowMs);
    playSfx("skill_cast");
    if (skill.kind === "attack") {
      // 공격은 몸이 돌진한다 (PvP와 같은 인과) — 스킬 위력 강화가 여기 곱해진다
      field.onAllyAttack(memberId, skill.id);
      casts.push(memberId, skill.power * skillMulOf(upgrades));
      return true;
    }
    if (skill.kind === "buff") {
      buffUntilMs = Math.max(buffUntilMs, nowMs + (skill.durationMs ?? 0));
      buffMult = skill.power;
      fx.spawn({
        sheet: "aura",
        x: fieldRect.x + fieldRect.w * 0.2,
        y: fieldRect.y + fieldRect.h * 0.8,
        scale: 1.6,
      });
      banner.show("buff", `${skill.name}!`);
    }
    return true;
  };

  const skillBar = createSkillBar({
    skills,
    rect: skillRect,
    cooldowns,
    /**
     * 배지는 스킬바 밖 — 배너 띠 아래 오른쪽이다 (`diveHudRules.autoBadgePos`의
     * 결정 기록). 좌표를 여기 적지 않는 이유: 이웃 위젯과 겹치는지를 node
     * 테스트가 물어야 하고, 겹침은 화면이 안 죽으므로 조용하다.
     */
    autoBadgeAt: autoBadgePos(autoBadgeD(skillRect.h)),
    onCast: (skill, nowMs) => {
      hintFinger.dismiss();
      /**
       * **상수를 실제로 쓴다.** 하드코딩된 `characters[0]`이면 `SINGLE_SKILL_CASTERS`를
       * 늘린 날 검사는 통과하는데 시전은 한 명만 한다.
       */
      /**
       * **한 명이라도 시전했으면 받아들인 것이다.** 시전자가 여럿이므로
       * (`SINGLE_SKILL_CASTERS`) 전원이 게이트에 걸린 경우에만 거부로 돌려준다 —
       * 한 명이 아직 못 지른다고 탭을 거부하면 화면에서는 다른 아군이 뛰어나가는
       * 중에 슬롯이 흔들린다. `some`이 아니라 루프인 이유는 단축 평가를 피해
       * **전원에게 시도**해야 하기 때문이다.
       */
      let cast = false;
      for (const c of loadout.characters.slice(0, SINGLE_SKILL_CASTERS)) {
        if (castSkill(c.memberId, skill, nowMs)) cast = true;
      }
      return cast;
    },
    /**
     * **싱글에서 `OFF`는 전투를 멈춘다.** 모션(`field.setAuto`)과 코어 딜
     * (`step`의 게이트)이 **같은 값**을 보므로 둘이 갈릴 수 없다 — 한쪽만 끄면
     * 아무도 안 싸우는데 적 HP가 줄어드는 화면이 되고 그건 실제 결함이었다
     * (팀 딜의 45.3%, `battleField.stepAlly`의 결정 기록).
     *
     * 앞선 회차는 배지 범위를 "스킬 자동 시전"으로 좁혀 뒀다. 유저 신고로
     * 뒤집혔다: "Auto를 안 키면 캐릭터가 움직이면 안 된다고 생각하거든?"
     * 방치형에서 이 배지는 "손을 놓아도 되는가"를 묻는 스위치다.
     */
    /**
     * 범위를 **바에게 준다**. 바가 이 값으로 배지의 처음 상태를 정한다
     * (`initialAutoFor`) — 그게 없던 동안 배지는 OFF로 출발하는데 전장은 ON이라
     * 진입 직후 화면이 거짓말을 했다(유저 신고 2번).
     */
    autoScope: "battle",
    onAutoToggle: (on, scope) => {
      field.setAuto(on);
      // 문구의 범위는 바가 되돌려 준 값이다 — 여기 다시 적으면 배지의 처음
      // 상태와 문구가 서로 다른 범위를 말할 수 있다
      toast.show(autoScopeNotice(on, scope));
    },
  });

  /**
   * 소리 배지 — AUTO 바로 아래, 같은 지름(`autoBadgeD`)·같은 위젯이다.
   * 자리 유래는 `diveHudRules.volumeBadgePos` 주석에 있다.
   *
   * 토스트로 알린다: 무음으로 갔을 때는 **탭 소리가 안 나므로**(그게 맞다)
   * 화면에 아무 반응이 없으면 배지가 고장난 것으로 읽힌다.
   */
  const volumeBadge = createVolumeBadge({
    diameter: autoBadgeD(skillRect.h),
    at: volumeBadgePos(autoBadgeD(skillRect.h)),
    onChange: (v) => {
      toast.show(volumeNotice(v));
    },
  });

  // z순서: 전장(top) → 강화 줄(gauge) → HUD(hud) → 스킬바(skillBar) → fx(아래 참조)
  // fx 안의 순서는 `diveLayerRules.DIVE_FX_STACK`이 정본이다 — 시트도 거기 있다
  // 전장 밴드 루트: [지층 배경 ← 전장] 순서로 겹치고, 밴드 사각형으로 클립한다 —
  // 슬라이드 중 전장이 HUD·강화 줄을 침범하지 않고, 틈으로는 지층이 보인다
  const bandRoot = new Container();
  bandRoot.addChild(gapBackdrop.view, field.view);
  app.layers.top.addChild(bandRoot);
  const fieldMask = new Graphics().rect(0, fieldRect.y, DESIGN_W, fieldRect.h).fill(0xffffff);
  app.layers.top.addChild(fieldMask);
  bandRoot.mask = fieldMask;
  app.layers.gauge.addChild(upgradePanel.rowView);
  app.layers.hud.addChild(hud.view);
  app.layers.skillBar.addChild(skillBar.view);
  /**
   * 최상단 레이어의 쌓임은 **`diveLayerRules.DIVE_FX_STACK`이 정본이다.**
   *
   * 시트가 여기 있는 이유(예전에는 `skillBar`였다): 전투 이펙트가 `fx`에 있어서
   * **시트를 열어도 이펙트가 시트 위에 그려졌다** — 42층 캡처에서 `스킬 위력
   * Lv.30`의 숫자가 별 파편에 묻혀 읽히지 않았다. 시트는 하강을 멈추지 않으므로
   * (`paused`가 아니다) 뒤에서 전투가 계속 도는 것이 정상이고, 그래서 이펙트를
   * 끄는 것이 아니라 **시트를 이펙트 위로** 올린다. 이펙트는 시트의 딤 아래로
   * 들어가 같이 어두워진다.
   *
   * 배열을 돌면서 붙인다 — 손으로 붙이면 규칙 파일이 다시 주석이 된다.
   */
  /**
   * 층 돌파 쇼케이스가 들어갈 **빈 자리.**
   *
   * 오버레이 자체는 10층마다 만들고 걷히면 버린다(2.6초 사는 것을 판 내내
   * 들고 있을 이유가 없다). 그런데 붙이는 자리를 그때 정하면
   * `app.layers.fx.addChild`가 되어 **맨 위**로 가고, 그러면 이 파일의 쌓임
   * 규칙(`DIVE_FX_STACK`)이 그 순간에만 거짓이 된다. 자리를 미리 잡아 두면
   * z는 컨테이너가 소유하고 오버레이는 자식으로만 들어온다
   * (`spec-decisions-are-hypotheses`: 반전·순서는 컨테이너 하나가 쥔다).
   */
  const showcaseHost = new Container();
  const fxViews: Record<DiveFxLayerName, Container> = {
    effects: fx.view,
    upgradeSheet: upgradePanel.sheetView,
    banner: banner.view,
    toast: toast.view,
    hintFinger: hintFinger.view,
    story: story.view,
    showcase: showcaseHost,
  };
  for (const name of DIVE_FX_STACK) app.layers.fx.addChild(fxViews[name]);
  // AUTO 배지는 바 밴드 밖(전장 위 하늘)이므로 바 뷰의 자식이 아니다
  app.layers.hud.addChild(skillBar.autoView);
  // 소리 배지도 같은 레이어·같은 열이다 (AUTO 아래)
  app.layers.hud.addChild(volumeBadge.view);
  // 배너 y는 규칙이 정본이다 — AUTO 배지가 이 띠 아래에 앉는다(`autoBadgePos`)
  banner.view.y = BANNER_TOP_Y;

  // ── 저장 ────────────────────────────────────────────────────────────
  const persist = (): void => {
    writeFloor(store, maxFloor);
    writeChoices(store, choices);
    // 두 잔고는 한 키에 산다 — 골드만 쓰면 심연석이 지워진다(`writeCurrency`).
    // 하나라도 읽기 실패면 **줄 전체를 안 쓴다**: 실패한 쪽을 0으로 굳히지
    // 않기 위해서다(§4-3). 모르는 재화 조각은 읽은 그대로 되돌려 붙인다
    if (gold !== null && abyss !== null) {
      writeCurrency(store, gold, abyss, opts.save.currencyUnknown);
    }
    writeUpgrades(store, upgrades);
    writeLastTickMs(store, opts.baseEpochMs + viewedMs);
    writeStorySeen(store, storySeen);
    /**
     * **이 캐릭터를 키웠다고 기록한다** (요구사항 3). PvP 선택지가 이 집합으로
     * 제한되므로, 싱글에 들어와 저장이 한 번이라도 돌면 그 캐릭터는 대전에
     * 나갈 자격이 생긴다.
     *
     * **덮어쓰지 않고 더한다.** 읽은 집합에 지금 캐릭터를 넣어서 쓴다 — 실비아로
     * 100층을 키운 뒤 클로에로 새로 하강했다고 실비아가 대전 선택지에서
     * 사라지면 안 된다. 재화를 조용히 잃지 않는 것과 같은 근거다(§4-3).
     *
     * 기준을 "저장이 돌았다"로 잡은 이유: 층·강화에 문턱을 두면 그 숫자가 두
     * 번째 잠금이 되고, 대전 자체가 이미 100층으로 잠겨 있다(`PVP_UNLOCK_FLOOR`).
     * 여기서 또 재면 "100층인데 왜 못 고르지"가 생긴다.
     */
    const lead = loadout.characters[0];
    if (lead) {
      const grown = readSingleSave(store).grown;
      grown.add(lead.charSlug);
      writeGrown(store, grown);
    }
  };

  // ── 경제 ────────────────────────────────────────────────────────────
  /**
   * 심연석 획득. **읽기 실패(null)면 아무 것도 하지 않는다** — 모르는 잔고에
   * 더하면 실패가 "그때까지 번 것을 잃음"으로 굳는다(§4-3의 소비 금지와 같은 짝).
   */
  const earnAbyss = (amount: number): void => {
    if (amount <= 0 || abyss === null) return;
    abyss += amount;
    hud.setAbyss(abyss);
  };

  /**
   * 보스 층 클리어 카드 — **심연석을 안 쓴다.**
   *
   * `drawOneCard`와 갈라 놓은 이유가 그것이다: 저 함수는 잔고를 판정하고
   * 차감하는데(`canDraw` → `drawCard` → `-DRAW_COST`), 층 보상이 그 경로를
   * 타면 심연석 10개가 없는 사람은 층을 깨도 카드를 못 받는다. 유저가 신고한
   * "내려가는데 카드가 안 생겨"가 다시 그대로 재현되는 형태다.
   *
   * **`"complete"`(다 모았음)에도 토스트를 띄우지 않는다.** 이 지급은 유저가
   * 누른 것이 아니라 층을 깨서 저절로 들어오는 것이므로, 만재 뒤 10층마다
   * "수집 완료" 토스트가 뜨면 그건 알림이 아니라 소음이다. 뽑기(`drawOneCard`)
   * 쪽은 유저가 값을 내려는 행동이라 실패도 말해 줘야 한다 — 그래서 문구
   * 처리가 다르다.
   *
   * **뽑은 결과를 돌려준다** — 쇼케이스가 그 값을 받아 그린다(`openShowcase`).
   * 화면 쪽이 자기 몫을 다시 뽑으면 10층마다 두 장이 나가고, 그때는 카드함이
   * 축하 화면보다 앞서 간다. `null`은 이 층에 지급이 없다는 뜻이다(잡몹 층).
   *
   * **토스트는 여기서 띄우지 않는다** — 지급 뒤에 쇼케이스가 그 줄을 크게
   * 그리므로(`openShowcase`), 여기서도 띄우면 같은 문장이 한 프레임에 두 번
   * 찍힌다(캡처 확인: 오버레이의 `희귀 카드 획득!` 아래 토스트가 같은 글자로
   * 겹쳤다). 대신 쇼케이스가 **못 뜬 경우**에만 호출부가 토스트를 띄운다 —
   * 그 갈래는 실제로 있다(한 틱에 두 보스 층을 넘으면 두 번째 축하가 삼켜진다).
   */
  const grantFloorCards = (count: number): CardReward | null => {
    let last: CardReward | null = null;
    for (let i = 0; i < count; i++) {
      const reward = opts.drawCard();
      last = reward;
      /**
       * 지급을 **로그로도 남긴다**(DEV). 화면에 남는 증거는 토스트 하나이고
       * 그건 1.8초 뒤 사라진다(`TOAST_HOLD_MS`) — 10층을 언제 깰지 모르는
       * 캡처 한 장으로 "카드가 생겼다"를 판정할 수 없다. 헤드리스 하네스가
       * 이 줄을 읽는다(`[dive] swipe`·`[dash]`와 같은 근거).
       */
      if (import.meta.env.DEV) {
        console.log(
          `[dive] floor-card kind=${reward.kind} cards=${cardCount + (reward.kind === "card" ? 1 : 0)}`,
        );
      }
      // 만재 — 남은 장수도 줄 것이 없다. **그래도 결과는 돌려준다**:
      // 쇼케이스가 "수집 완료" 줄을 그릴 근거가 이 값이다
      if (reward.kind !== "card") return last;
      cardCount += 1;
    }
    if (count > 0) {
      upgradePanel.refresh();
      persist();
    }
    return last;
  };

  /**
   * 카드 뽑기. 판정 → 뽑기 → 차감 순서다.
   *
   * **다 모았으면 심연석을 안 쓴다** — `drawCard`가 `"complete"`를 돌려준 뒤에
   * 차감하면 아무것도 안 받고 10을 잃는다. 그래서 차감이 뽑기 **뒤**에 있다
   * (`canDraw`로 먼저 막는 것과 순서를 헷갈리면 안 된다: 잔고 판정은 앞,
   * 차감은 뒤다).
   */
  const drawOneCard = (): void => {
    if (!canDraw(abyss)) return;
    const reward = opts.drawCard();
    if (reward.kind === "card") {
      abyss = (abyss as number) - DRAW_COST;
      // 뽑은 장수가 곧 팀 딜이다 — 다음 스텝의 `totalDamageMult`가 이걸 본다
      cardCount += 1;
      hud.setAbyss(abyss);
      persist();
    }
    // 문구는 대전 승리 보상과 같은 함수를 쓴다 — 등급 표기가 두 곳에서 갈리지 않게
    toast.show(rewardCaption(reward));
    upgradePanel.refresh();
  };

  const buyUpgrade = (id: UpgradeId): void => {
    const cost = upgradeCost(id, upgrades[id]);
    if (cost === null || !canBuy(gold, id, upgrades[id])) return;
    gold = (gold as number) - cost;
    upgrades = { ...upgrades, [id]: upgrades[id] + 1 };
    dmgChars = buildDmgChars();
    hud.setGold(gold);
    upgradePanel.refresh();
    persist();
  };

  // ── 하강 연출 (PvP의 placeWave/startAdvance/tickAdvance/endAdvance 대응) ──
  let shownStamp: FloorStamp = { floor: -1, loops: -1 };
  let advanceMs: number | null = null;

  const hpRatios = (): number[] =>
    runner.currentWave.enemies.map((e, i) =>
      e.hp > 0 ? Math.max(0, runner.state.enemyHp[i] ?? 0) / e.hp : 0,
    );

  const placeFloor = (stamp: FloorStamp): void => {
    shownStamp = stamp;
    field.setWave(runner.currentWave, hpRatios());
    hud.setFloor(stamp.floor);
    hud.setPhaseName(phaseInfoOf(stamp.floor).name);
    const kind = floorKindOf(stamp.floor);
    if (kind === "boss") banner.show("interference", bossIntroLine(stamp.floor));
    else if (kind === "miniboss") banner.show("system", minibossIntroLine(stamp.floor));
    resetHitAccumulator(myHits);
  };

  const startAdvance = (clearedFloor: number): void => {
    /**
     * **하강을 시작하기 전에 결정타를 화면에 낸다.**
     *
     * 타격 연출은 아군의 임팩트 프레임까지 밀려 있다(`field.onEnemyHit` →
     * `slot.pending`). 그런데 코어는 무리를 다 쓴 **그 틱에** 다음 층으로
     * 넘어가므로(`waveRunner.applyDamage`), 여기 오는 시점에는 마지막 적을
     * 죽인 타격이 아직 안 나왔다 — 플러시하지 않으면 **적이 HP바를 달고 서
     * 있는 채로 층이 내려간다.** 실측: 처치와 화면 사이가 400~1400ms 벌어져
     * 620ms 슬라이드보다 길었고, 절반 이상이 다음 층에 얹히거나 사라졌다
     * (`PENDING_HARD_MS` 밸브가 `why=hard`로 늘 열려 있던 것이 그 증거다).
     *
     * `setAdvancing(true)`를 쓰지 않는 이유는 `flushHits`의 주석에 있다 —
     * 그쪽은 아군을 `run`으로 바꾸는 가로 스크롤용 처리를 같이 끌고 온다.
     *
     * 사망 연출(`DEATH_MS` 260ms)은 스왑(`DIVE_SLIDE_OUT_MS` 280ms) 전에
     * 끝난다 — 그래서 "쓸어버리고 내려간다"로 읽힌다. 이 순서가 뒤집히면
     * (스왑이 260ms보다 빨라지면) 쓰러지는 중에 층이 갈린다.
     */
    field.flushHits();
    advanceMs = 0;
    banner.show("wave", floorClearLabel(clearedFloor));
  };

  const endAdvance = (): null => {
    // 끝값을 못 박는다 — 마지막 스텝이 정확히 TOTAL에 안 떨어져도 제자리.
    // `view.y`가 아니라 `setSlideY`다 — 직접 넣으면 `rect.y`가 지워진다
    // (전장이 화면 위로 붙고 아래 153.6px이 검은 띠로 남았다)
    field.setSlideY(0);
    gapBackdrop.setOffset(0);
    return null;
  };

  const coreStamp = (): FloorStamp => ({
    floor: currentFloor(),
    loops: runner.state.loops,
  });

  /** 경제·진행이 마지막으로 계상한 코어 도장 — 연출(shownStamp)과 별개로 센다 */
  let countedStamp: FloorStamp = coreStamp();

  /**
   * 층 전환 = 세로 하강 슬라이드 (sessionRules.diveSlideOffset).
   * 현재 층이 위로 빠지고(카메라 하강) 스왑 시점(OUT_MS)에 placeFloor,
   * 다음 층이 아래에서 올라온다 — 숏츠를 넘기는 그림 그대로.
   */
  const tickAdvance = (prevMs: number, stepMs: number): number | null => {
    const nextMs = prevMs + stepMs;
    // 연출 중 코어가 두 층 이상 앞서면 접고 따라잡는다 (초반 층은 스킬 한 방이다)
    if (currentFloor() - shownStamp.floor >= 2) {
      placeFloor(coreStamp());
      return endAdvance();
    }
    if (advanceCrossed(prevMs, nextMs, DIVE_SLIDE_OUT_MS)) {
      placeFloor(coreStamp());
    }
    const offset = diveSlideOffset(nextMs, fieldRect.h);
    field.setSlideY(offset);
    gapBackdrop.setOffset(offset);
    if (nextMs < DIVE_SLIDE_TOTAL_MS) return nextMs;
    return endAdvance();
  };

  // ── 층 돌파 쇼케이스 (유저 신고 2026-08-09) ──────────────────────────
  /**
   * 지금 떠 있는 쇼케이스. 걷히면 `null`로 돌아간다 — 판 내내 들고 있으면
   * 딤·빛 12장·삽화 텍스처가 계속 메모리에 남는다.
   */
  let showcase: ShowcaseOverlay | null = null;
  /**
   * 리드의 `win` 삽화. **한 번만 받아 다시 쓴다** — 10층마다 새로 받으면 같은
   * 209KB PNG를 백 층에서 열 번 요청한다. `null`이면 아직 안 왔거나 실패한
   * 것이고, 그때는 오버레이가 워드마크만 띄운다(삽화가 없으면 축하가 없는
   * 것보다 낫다 — PvP 결과 화면이 같은 계약이다).
   */
  let winPortraits: PortraitSet | null = null;
  let portraitsAsked = false;

  /**
   * 층 돌파 쇼케이스를 띄운다 — 미니보스·네임드 보스 층을 깼을 때.
   *
   * **카드를 여기서 뽑지 않는다.** 지급은 `grantFloorCards`가 이미 했고 그
   * 결과(`CardReward`)를 인자로 받는다. 여기서 `opts.drawCard()`를 다시 부르면
   * 10층마다 두 장이 나간다 — 신고("카드 얻어달라고 했는데 반영 안 된 것
   * 같아")보다 나쁜 결함이다.
   *
   * **`paused`를 걸지 않는다.** 심연의 선택(`maybeOfferChoice`)은 유저의 입력을
   * 기다리므로 판을 멈춰야 하지만, 이쪽은 2.6초 뒤 스스로 걷힌다. 멈추면
   * 10층마다 하강이 2.6초씩 서고, 100층까지 열 번이면 26초다 — 방치형이
   * "보고 있어야 진행되는 게임"이 된다. 대신 `modalOpen`에 포함시켜
   * **하강 스와이프만** 삼킨다(그 뒤에 있는 전장을 향한 제스처다).
   */
  const openShowcase = (floor: number, reward: CardReward | null): boolean => {
    if (!isShowcaseFloor(floor)) return false;
    // 이미 떠 있으면 갈아치우지 않는다 — 블리츠 구간에서 한 틱에 두 보스 층을
    // 넘으면(초반 10·20층은 스킬 한 방이다) 첫 축하가 두 번째에 잘린다.
    // 심연의 선택 모달이 하나뿐인 것과 같은 처방이다
    if (showcase) return false;
    const lead = loadout.characters[0];
    if (!lead) return false;

    const view = createShowcaseOverlay({
      word: showcaseWord(floor),
      sub: showcaseSub(floor),
      variant: V_ART_VARIANT,
      // 이미 받아 둔 것이 있으면 첫 프레임부터 세운다. 없으면 아래에서
      // `setPortraits`로 늦게 붙인다
      portraits: winPortraits,
      slug: lead.charSlug,
      ...(reward
        ? {
            card:
              reward.kind === "card"
                ? // 이름은 `cards.json`이 정한다 — 아직 안 왔다(`setCard`).
                  // 등급 문구는 지금 있다(`rewardCaption`)
                  { title: "", caption: rewardCaption(reward) }
                : { title: "카드를 다 모았다", caption: "수집 완료" },
          }
        : {}),
      onDone: () => {
        // `live`가 정본이다(아래 `render`) — 이 콜백이 안 와도 걷힘이 풀린다.
        // 여기서만 치우면 오버레이가 예외로 죽는 날 하강 제스처가 영구히 잠긴다
      },
    });
    showcase = view;
    showcaseHost.addChild(view.view);

    /**
     * 삽화를 받는다 — **판을 막지 않는다**(`await` 없음). 첫 쇼케이스(10층)는
     * 삽화 없이 뜰 수 있고, 도착하면 그 자리에서 붙는다. 20층부터는 이미
     * 받아 둔 것을 쓴다.
     *
     * **variant 하나·슬러그 하나만 받는다** — 셋 다 7명이면 3.8MB인데 여기서
     * 쓰는 것은 리드의 `win` 한 장이다(`V_ART_VARIANT` 주석의 근거).
     */
    if (!portraitsAsked) {
      portraitsAsked = true;
      void loadPortraits([V_ART_VARIANT], [lead.charSlug]).then((set) => {
        winPortraits = set;
        if (destroyed) return;
        showcase?.setPortraits(set);
      });
    }

    if (reward?.kind !== "card") return true;
    void loadCardManifest().then(async (manifest) => {
      const row = findCard(manifest, reward.id);
      if (!row) {
        // 저장은 이미 됐다 — 카드함에서는 보인다. 여기서만 그림이 빠진다
        console.warn(`[dive] 획득 카드 ${reward.id}가 cards.json에 없다`);
        return;
      }
      const arts = await loadCardArt([{ row, kind: "thumb" }]);
      if (destroyed) return;
      // 걷힌 뒤에 도착하면 오버레이가 스스로 무시한다(`setCard`의 `done` 가드)
      showcase?.setCard(arts.get(row.id) ?? null, row.title);
    });
    return true;
  };

  // ── 스토리 훅 ────────────────────────────────────────────────────────
  const maybeOfferChoice = (clearedFloor: number): void => {
    if (!isChoiceFloor(clearedFloor) || choiceOffered.has(clearedFloor)) return;
    choiceOffered.add(clearedFloor);
    paused = true;
    const firstTime = choices === 0;
    story.showChoice({
      title: CHOICE_TITLE,
      body: CHOICE_BODY,
      ...(firstTime ? { hint: CHOICE_TUTORIAL_HINT } : {}),
      acceptLabel: CHOICE_ACCEPT_LABEL,
      refuseLabel: CHOICE_REFUSE_LABEL,
      onAccept: () => {
        choices += 1;
        corruption = corruptionOf(maxFloor, choices);
        hud.setCorruption(corruption);
        toast.show(CHOICE_ACCEPT_TOAST);
        persist();
        paused = false;
      },
      onRefuse: () => {
        toast.show(CHOICE_REFUSE_TOAST);
        paused = false;
      },
    });
  };

  const maybeEnding = (): void => {
    if (storySeen.has(STORY_ENDING_ID)) return;
    if (!endingReached(currentFloor(), runner.state.loops)) return;
    storySeen.add(STORY_ENDING_ID);
    paused = true;
    const ending = endingOf(corruption);
    story.showEnding(endingTitle(ending), endingBody(ending), () => {
      paused = false;
    });
    persist();
  };

  // ── 스텝 (고정 dt, 결정론) ───────────────────────────────────────────
  const step = (stepMs: number): void => {
    if (paused || destroyed) return;
    elapsedMs += stepMs;
    const nowMs = elapsedMs;

    // 1) 팀 딜 = 자동 공격(강화 반영) + 시전 분산분, 배율(버프×타락×러시×덱)
    /**
     * **AUTO가 꺼져 있으면 자동 공격 딜이 0이다** (`field.auto`).
     *
     * 유저가 고른 범위가 "동작도 딜도 함께 멈춘다"다. 동작만 세우면 아무도
     * 안 싸우는데 적 HP가 줄어드는 화면이 되고, 그건 실측된 결함이었다 —
     * 돌진 0회·타격 0회인데 내 캐릭터가 팀 딜의 45.3%(44.4 raw dps)를 냈다.
     * 그때는 반대로 풀었다(딜을 살리고 동작을 붙였다). 신고가 그 선택을
     * 뒤집었다: "Auto를 안 키면 캐릭터가 움직이면 안 된다고 생각하거든?"
     *
     * **게이트가 `field.auto`를 읽는 것이 핵심이다.** 배지 상태를 세션이 따로
     * 들고 있으면 두 값이 갈릴 수 있고, 갈리는 순간이 정확히 위 결함이다.
     * 모션과 딜이 **한 값**을 보면 구조적으로 갈릴 수 없다.
     *
     * **시전 분산분(`casts.drain`)은 안 끈다.** 유저 요구는 "혼자 진행되지
     * 않는 것"이고, 직접 누른 스킬은 혼자 난 일이 아니다. 여기서 같이 끄면
     * 배지를 끈 뒤 스킬을 눌러도 아무 일이 안 일어나는데, 그건 배지 라벨
     * (`AUTO`)이 약속하지 않은 범위다(`autoScopeNotice`의 `"battle"` 문구가
     * "스킬은 직접 누른다"로 그 경계를 말한다).
     *
     * `drain`은 게이트 밖에서 부른다 — 안에 넣으면 OFF인 동안 이미 쌓인
     * 시전분이 큐에 고이고 켜는 순간 한꺼번에 터진다.
     *
     * 게이트 자체는 `autoTeamDamage`에 있다 — 이 파일은 Pixi를 끌어오므로
     * 여기 삼항으로 두면 node가 그 갈래를 못 밟는다.
     */
    const autoDmg = autoTeamDamage(dmgChars, stepMs, field.auto);
    const members = [...autoDmg, ...casts.drain(stepMs)];
    const mult = totalDamageMult(
      nowMs < buffUntilMs ? buffMult : 1,
      corruption,
      rushActive(nowMs, rushUntilMs),
      cardCount,
    );
    const scaled: MemberDamage[] = members.map((m) => ({
      memberId: m.memberId,
      rawDamage: m.rawDamage * mult,
    }));
    const teamDamage = sumTeamRawDamage(scaled);

    // 2) 층 진행 — 처치 골드는 웨이브 정의 HP 기준 (킬 시점의 웨이브를 먼저 잡는다)
    const waveBefore = runner.currentWave;
    let killedThisTick = false;
    for (const hit of runner.applyDamage(teamDamage)) {
      const shown = accumulateHit(myHits, hit.enemyIndex, hit.dealt, hit.killed, nowMs);
      field.onEnemyHit({ ...hit, dealt: shown });
      playSfx(hit.killed ? "enemy_death" : "hit");
      if (hit.killed && gold !== null) {
        const enemy = waveBefore.enemies[hit.enemyIndex];
        if (enemy) {
          // **배율 전 HP로 준다.** `enemy.hp`를 보면 SOLO_HP_SCALE이 수입까지
          // 깎아 강화가 늦어지고, 그 상쇄가 페이싱 손잡이를 먹는다(`EnemyDef.goldHp`)
          gold += Math.round(
            goldForKill(enemy.goldHp, upgrades) * comboGoldMul(combo),
          );
          hud.setGold(gold);
          killedThisTick = true;
        }
      }
    }
    // 골드가 늘어난 틱에만 강화 버튼 상태를 다시 판정한다 — 층 전이에만 묶으면
    // 같은 층에서 파밍하는 동안 HUD는 충분한 골드를 보여주는데 버튼이 회색으로
    // 남는다 (2026-08-03 리뷰에서 확정된 실결함)
    if (killedThisTick) upgradePanel.refresh();

    // 3) 코어 층 전이 — 콤보·타락도·창 갈아타기·선택 제안은 **코어**를 따른다.
    //    연출 상태(advanceMs)에 묶으면 블리츠 구간(연출 1.4초 동안 여러 층이
    //    무너지는 초반)에서 클리어 층 수만큼 세지 않는다 (2026-08-03 리뷰)
    let core = coreStamp();
    const cleared = core.floor - countedStamp.floor + (core.loops - countedStamp.loops);
    if (cleared > 0) {
      for (let i = 0; i < cleared; i++) {
        combo = nextCombo(combo, nowMs - lastClearMs);
        lastClearMs = nowMs;
      }
      hud.setCombo(combo);
      if (core.floor > maxFloor) {
        maxFloor = core.floor;
        corruption = corruptionOf(maxFloor, choices);
        hud.setCorruption(corruption);
      }
      // 이번 틱에 클리어된 층들({counted..core-1}) 가운데 보스 층이 있으면 제안.
      // 한 틱에 두 보스 층을 넘는 일은 사실상 없지만, 모달은 하나뿐이므로
      // 이미 일시정지됐으면 더 제안하지 않는다
      for (let f = countedStamp.floor; f < core.floor; f++) {
        if (!paused) maybeOfferChoice(f);
        /**
         * 심연석 — 보스 층을 깬 값. **모달과 같은 루프를 돈다**: 여기가
         * 아니라 층 표시(`placeFloor`)에 걸면 연출이 건너뛴 층
         * (블리츠 구간에서 한 틱에 여러 층이 무너진다)의 몫이 사라진다.
         * `paused`를 안 보는 것도 그 이유다 — 선택 모달이 떠도 깬 층은 깬 것이다.
         */
        earnAbyss(abyssForFloorClear(floorKindOf(f)));
        /**
         * 보스 층 카드 — 심연석과 **같은 루프에서 같은 층 종류를 본다.**
         * 다른 곳에 걸면 블리츠 구간(한 틱에 여러 층)에서 둘이 갈린다.
         */
        const reward = grantFloorCards(cardsForFloorClear(floorKindOf(f)));
        /**
         * 층 돌파 쇼케이스 — **지급과 같은 줄에서, 그 결과를 받아** 띄운다
         * (유저 신고: "10층 내려갈 때마다 … 카드 얻어달라고 했는데 반영 안
         * 된 것 같아"). 다른 곳에 걸면 카드가 나온 층과 축하가 뜬 층이 갈릴 수
         * 있고, 그 어긋남이 정확히 이 신고의 모양이다.
         */
        /**
         * 축하가 못 뜬 층은 **토스트가 대신 말한다.** 한 틱에 두 보스 층을
         * 넘으면 두 번째 축하는 삼켜지므로(위 `if (showcase) return false`),
         * 그때 아무 말도 없으면 카드가 조용히 들어온다 — 그것이 신고받은
         * 상태다. 지급 함수에서 토스트를 뗀 것은 **겹침** 때문이고
         * (`grantFloorCards` 주석), 겹치지 않는 이 갈래에서는 필요하다.
         */
        if (!openShowcase(f, reward) && reward?.kind === "card") {
          toast.show(rewardCaption(reward));
        }
      }
      // 창 끝이 가까우면 다음 창으로 — 층 경계 직후라 새 층은 아직 만피다
      if (needsWindowRebuild(runner.state.waveIndex, waves.length) && core.floor < FINAL_FLOOR) {
        windowStart = core.floor;
        waves = generatePhaseWaves(seed, windowStart, WINDOW_FLOORS);
        runner = createWaveRunner(waves, 0);
        core = coreStamp(); // 창이 갈리면 러너 loops가 리셋된다 — 도장도 새 창 기준으로
      }
      countedStamp = core;
    }

    // 화면 갈아끼우기(연출)는 여기서만 — 코어보다 최대 1.4초 늦게 따라간다
    if (!sameFloorStamp(core, shownStamp) && advanceMs === null) {
      if (shownStamp.floor < 0) placeFloor(core); // 첫 배치는 즉시 (prime이 이미 깔았다)
      else startAdvance(shownStamp.floor);
    }
    if (advanceMs !== null) advanceMs = tickAdvance(advanceMs, stepMs);

    maybeEnding();

    // 4) 주기 저장 — 매 틱 쓰면 localStorage가 갈린다
    sinceSaveMs += stepMs;
    if (sinceSaveMs >= SAVE_EVERY_MS) {
      sinceSaveMs = 0;
      persist();
    }
  };

  /**
   * 깊이를 화면의 **두 배경에 같이** 넘긴다 — 전장과 층 사이 지층이다.
   *
   * 한 곳만 부르면 안 되는 이유: 슬라이드 중에는 둘이 같은 화면에 있다(위는
   * 빠지는 층, 아래는 지층). 지층이 옛 테마에 남으면 표층에서 검은 띠가
   * 지나가고, 그게 고치기 전 결함이었다(`gapBackdropRules` 주석). 둘 다
   * "같은 테마면 아무것도 안 한다" 가드가 있어서 매 프레임 불러도 된다.
   */
  const applyDepth = (depth: number): void => {
    field.setDepth(depth);
    gapBackdrop.setDepth(depth);
  };

  const render = (dtMs: number): void => {
    if (destroyed) return;
    // 모달(paused) 중에도 흐른다 — lastTickMs("마지막으로 본 시각")의 기준
    viewedMs += dtMs;
    // 아군의 자동 사이클은 배지를 본다(`field.setAuto`) — OFF면 새 돌진이 없다
    applyDepth(depthForFloor(shownStamp.floor < 0 ? maxFloor : shownStamp.floor));
    field.update(dtMs);
    fx.update(dtMs);
    hud.update(dtMs);
    banner.update(dtMs);
    toast.update(dtMs);
    hintFinger.update(dtMs);
    upgradePanel.update(dtMs);
    story.update(dtMs);
    /**
     * 쇼케이스는 **render에서만** 돈다 — `step`(고정 dt)에 두면 심연의 선택
     * 모달이 뜬 층(50·100…)에서 `paused`가 스텝을 멈추므로 축하가 그 자리에
     * 얼어붙는다. 50층은 둘이 같은 프레임에 뜨는 실제 층이다.
     *
     * 걷히면 즉시 버린다 — 딤·빛 12장·삽화 텍스처를 판 내내 들고 있을 이유가
     * 없고, `live`가 false인 채 남아 있으면 다음 10층에서 `if (showcase) return`
     * 가드가 새 축하를 삼킨다.
     */
    if (showcase) {
      showcase.update(dtMs);
      if (!showcase.live) {
        showcase.destroy();
        showcase = null;
      }
    }
    skillBar.update(elapsedMs);
    skillBar.animate(dtMs);
    volumeBadge.update(dtMs);

    /**
     * 준비 완료음. 잠기는 칸이 없어졌으므로(타락 칸 삭제) 걸러낼 것이 없다 —
     * 모션 게이트는 여기 걸지 않는다: 그건 수백 ms짜리라 소리가 아니라 연타
     * 억제 장치이고, 걸면 빠르게 누르는 동안 준비음이 사라진다.
     */
    const ready = cooldowns.readySkills(elapsedMs);
    const readyIds = new Set(ready.map((s) => s.id));
    for (const id of readyIds) {
      if (!prevReadyIds.has(id)) playSfx("cooldown_ready");
    }
    prevReadyIds = readyIds;
  };

  const loop = createLoop({ step, render });

  const prime = (): void => {
    // 깊이를 적보다 먼저 — 테마가 환경광이라 순서가 바뀌면 첫 프레임 틴트가 어긋난다
    applyDepth(depthForFloor(maxFloor));
    placeFloor(coreStamp());
    hud.setGold(gold);
    hud.setAbyss(abyss);
    hud.setCorruption(corruption);
    hud.setCombo(combo);
    upgradePanel.refresh();
  };

  return {
    prime,
    start(): void {
      prime();
      // 방치 보상 토스트 — 세션이 적용까지 끝낸 값을 말한다
      if (opts.idle) {
        toast.show(idleRewardToast(opts.idle.fromFloor, opts.idle.toFloor, opts.idle.gold));
        persist();
      }
      const firstSlot = skillBar.slotCenter(skills[0]?.id ?? "");
      if (firstSlot) {
        // 슬롯 위가 아니라 슬롯 안쪽 모서리에 매단다 — 위쪽은 모드마다 이웃이
        // 다르다(싱글은 강화 줄이 44px 위에 있다). `fingerAnchor` 주석 참고
        const at = fingerAnchor(firstSlot.x, firstSlot.y, firstSlot.d);
        hintFinger.showAt(at.x, at.y);
      }
      prevReadyIds = new Set(cooldowns.readySkills(0).map((s) => s.id));
      resetSfxThrottle();
      // BGM은 화면마다 다른 곡이다 (`shared/bgmRules`의 트랙 표). 대전에는
      // 여전히 없다 (그 머리말: 120초 판에 163초 루프는 한 바퀴도 못 돈다).
      // await하지 않는다 — 다운로드가 하강 시작을 막으면 안 되고, 받아지면
      // 그때 소리가 붙는다.
      startBgm("dive");
      // 프롤로그는 첫 방문에만 — 닫히기 전까지 step이 멈춰 있다
      if (!storySeen.has(STORY_PROLOGUE_ID)) {
        paused = true;
        story.showPrologue(PROLOGUE_LINES, () => {
          storySeen.add(STORY_PROLOGUE_ID);
          persist();
          paused = false;
        });
      }
      loop.start();
    },
    stop(): void {
      loop.stop();
      persist();
      // 하강이 멈추면 타이틀 음악으로 돌아간다 — `destroy`에도 같은 줄이 있다.
      // 둘 중 하나만 넣으면 나가는 경로에 따라 타이틀에서 하강 음악이 계속
      // 흐른다(`stop`은 씬을 남기고 멈추는 경로다). 버퍼는 남으므로 왕복은 즉시다.
      startBgm("title");
      banner.clear();
    },
    swipe(): void {
      if (paused || destroyed) return;
      rushUntilMs = elapsedMs + RUSH_MS;
      playSfx("ui_tap");
      // 러시는 스크린샷 한 장으로 검증할 수 없다 — 헤드리스 하네스가 이 로그를 읽는다
      if (import.meta.env.DEV) {
        console.log(`[dive] swipe rush until=${rushUntilMs.toFixed(0)} floor=${shownStamp.floor}`);
      }
      // 층 전환 연출 중이면 즉시 접고 다음 층으로 — "스와이프 = 하강 가속"의 체감.
      // 전투 중의 스와이프는 러시(딜 배율)로만 작동한다 — 스크롤을 여기서 만지면
      // 연출 상태 기계(advance)와 두 주인이 생겨 복원 시점이 갈린다.
      if (advanceMs !== null) {
        placeFloor(coreStamp());
        advanceMs = endAdvance();
      }
    },
    openUpgradeSheet(): void {
      if (paused || destroyed) return;
      upgradePanel.openSheet();
    },
    get modalOpen(): boolean {
      /**
       * 쇼케이스도 모달로 센다 — **하강을 멈추지는 않지만**(그 근거는
       * `openShowcase` 주석) 화면을 덮고 있는 동안 위로 미는 제스처가 그 뒤의
       * 전장으로 가면 안 된다. 오버레이 자신도 딤으로 탭을 삼키는데
       * (`showcaseOverlay`의 `dim`), 스와이프 판정은 씬이 **스테이지에서**
       * 모으므로(`diveScene`의 stage 리스너) 딤이 못 막는다 — 두 곳이 각자
       * 자기 층을 막는 것이 맞다.
       */
      return (
        paused ||
        story.open ||
        upgradePanel.sheetOpen ||
        showcase?.live === true
      );
    },
    get state(): DiveSessionState {
      return {
        floor: shownStamp.floor < 0 ? maxFloor : shownStamp.floor,
        maxFloor,
        gold,
        corruption,
        combo,
        kills: runner.state.killCount,
        elapsedMs,
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      persist();
      // `stop`과 같은 이유로 타이틀 음악으로 돌린다 (그쪽 주석 참조)
      startBgm("title");
      banner.clear();
      hud.destroy();
      bandRoot.mask = null;
      fieldMask.destroy();
      gapBackdrop.destroy();
      field.destroy();
      bandRoot.destroy();
      skillBar.destroy();
      volumeBadge.destroy();
      upgradePanel.destroy();
      story.destroy();
      // 떠 있는 채로 씬을 나갈 수 있다(타이틀 버튼은 쇼케이스 중에도 눌린다 —
      // 딤이 삼키는 것은 전장 제스처고 HUD 버튼은 다른 레이어다)
      showcase?.destroy();
      showcase = null;
      showcaseHost.destroy({ children: true });
      fx.destroy();
      banner.destroy();
      toast.destroy();
      hintFinger.destroy();
    },
  };
}

/** main 배선 편의 재수출 — 방치 보상 계산과 저장 타입 */
export { computeIdleReward };
export type { IdleReward, SingleSave, SingleStore };
