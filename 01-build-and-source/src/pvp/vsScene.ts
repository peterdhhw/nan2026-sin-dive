import { Container, Graphics, Text } from "pixi.js";
import type { Scene, SceneCtx } from "../shared/sceneManager";
import { DESIGN_H, DESIGN_W } from "../shared/viewport";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FONT_FAMILY,
  TEAM_OURS,
  TEAM_THEIRS,
  THEME_SURFACE,
  T_HEADLINE,
  T_LABEL,
  UI_OUTLINE,
  UI_TEXT,
} from "../shared/theme";
import { darken, mixColor } from "../shared/color";
import { createPill, type Pill } from "../shared/ui/pill";
import { playSfx } from "../shared/audio";
import { floorLabel } from "../shared/screenText";
import { matchSlotLabel } from "./matchText";
import type { MatchResult, MatchSlot } from "../net/matchmaking";
import type { CharacterLoadout, Loadout } from "../loadout/types";
import { theirRoster } from "./rosterRules";
import { caption } from "../shared/scenes/common";
import {
  drawPixelShadow,
  fillPixelCircle,
  fillPixelRect,
  strokePixelArc,
  strokePixelCircle,
  strokePixelRect,
} from "../shared/ui/pixelShape";
import { ART_PX } from "../shared/ui/shapeRules";
import {
  THEIRS_TINT_MIX,
  VS_CELL_GAP,
  VS_KIND_DY,
  VS_OURS_FEET_Y,
  VS_PANEL_ALPHA,
  VS_PILL_DY,
  VS_PILL_W,
  VS_STRIPE_ALPHA,
  VS_STRIPE_DEG,
  VS_STRIPE_GAP,
  VS_STRIPE_W,
  VS_THEIRS_FEET_Y,
  floorAlpha,
  namesAlpha,
  posesNow,
  screenShake,
  showsWaitRing,
  slideOffset,
  stampFlash,
  stampScale,
  vsHolds,
  wipeGate,
  wipeProgress,
} from "./vsRules";
import { createHeroChar, type SpriteChar } from "../shared/spriteChar";

// 순수 규칙은 vsRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  VS_CELL_GAP,
  VS_PANEL_ALPHA,
  VS_PILL_W,
  VS_POSE_AT_MS,
  VS_STRIPE_ALPHA,
  VS_TOTAL_MS,
  floorAlpha,
  namesAlpha,
  posesNow,
  slideOffset,
  stampScale,
  vsHolds,
  wipeGate,
  wipeProgress,
} from "./vsRules";

/**
 * S3. VS 인트로 — 1.6초. **스킵 버튼 없다.**
 *
 * 설계 문서: specs/2026-07-27-ux/06-scene-vs-intro.md
 *
 * 짧고, 정보 전달이 목적이며, **이 사이에 세션이 초기화된다**(§06-5).
 * 세션 준비가 1.6초보다 늦으면 사선 배경을 유지한 채 기다린다.
 */

export interface VsSceneOpts {
  ctx: SceneCtx;
  match: MatchResult;
  loadout: Loadout;
  /**
   * 전투 씬 준비. VS가 화면을 가리고 있는 동안 병렬로 돈다 —
   * 여기서 `createSession()`의 Spine 300~600ms를 치른다 (§06-5).
   */
  prepare(): Promise<void>;
  /** 1.6초 + 준비 완료 → S4 전투 */
  onDone(): void;
}

/**
 * 캐릭터 대역 실루엣 — 스프라이트 시트가 아직/영영 없을 때만 보인다.
 *
 * 지우지 않는 이유: 이 씬은 세션 준비를 가리는 게 일이라 **에셋 로드를 기다리면
 * 안 된다**(§06-5). 로드가 1.6초 안에 안 끝나면 이 도형이 그 자리를 지킨다 —
 * 빈 자리가 되면 "좌 2인 대 우 2인"이라는 이 씬의 유일한 정보가 사라진다.
 */
function figure(tint: number, h: number, facing: 1 | -1): Container {
  const view = new Container();
  const g = new Graphics();
  const w = h * 0.44;
  // 발밑 그림자 — 없으면 캐릭터가 공중에 뜬다. 계단 블록 3단이다(타원 금지)
  drawPixelShadow(g, w * 1.2, w * 0.32, 0x000000, 0.3);
  // 몸통 (아래로 살짝 넓어지는 사다리꼴)
  g.poly([
    { x: -w * 0.36, y: 0 },
    { x: w * 0.36, y: 0 },
    { x: w * 0.28, y: -h * 0.62 },
    { x: -w * 0.28, y: -h * 0.62 },
  ]).fill({ color: tint });
  g.poly([
    { x: -w * 0.36, y: 0 },
    { x: w * 0.36, y: 0 },
    { x: w * 0.28, y: -h * 0.62 },
    { x: -w * 0.28, y: -h * 0.62 },
  ]).stroke({ color: UI_OUTLINE, width: 4 });
  // 머리 — 계단 원. 매끈한 원은 도트 실루엣 위에서 혼자 흐리다
  fillPixelCircle(g, 0, -h * 0.75, h * 0.14, { color: tint });
  strokePixelCircle(g, 0, -h * 0.75, h * 0.14, {
    color: UI_OUTLINE,
    width: ART_PX,
  });
  // 무기 — 바라보는 쪽으로 뻗는다. 이것만으로 방향이 읽힌다
  fillPixelRect(g, w * 0.34, -h * 0.66, 8, h * 0.5, 4, {
    color: darken(tint, 0.35),
  });
  strokePixelRect(g, w * 0.34, -h * 0.66, 8, h * 0.5, 4, {
    color: UI_OUTLINE,
    width: 3,
  });
  view.addChild(g);
  view.scale.x = facing;
  return view;
}

export function createVsScene(opts: VsSceneOpts): Scene {
  const { ctx, match, loadout } = opts;
  const view = new Container();
  view.label = "vs";

  // 전장은 이 씬 뒤에서 준비된다 — 배경 테마를 미리 맞춰 둔다 (§06-5)
  ctx.manager.setTheme(THEME_SURFACE, { immediate: true });
  ctx.manager.showBackground(true);

  /** 사선 배경. 1.2초에 위·아래로 갈라진다 (§06-1) */
  const wipeTop = new Container();
  const wipeBottom = new Container();
  const stripes = (tint: number, h: number, flip: boolean): Graphics => {
    const g = new Graphics();
    // 반투명이다. 꽉 채우면 위에서 켜 둔 배경이 와이프 전까지 한 픽셀도 안 보인다
    g.rect(0, 0, DESIGN_W, h).fill({
      color: darken(tint, 0.62),
      alpha: VS_PANEL_ALPHA,
    });
    // 사선은 −18°. 화면 밖까지 넉넉히 그려야 모서리에 빈틈이 안 생긴다
    const slant = Math.tan((VS_STRIPE_DEG * Math.PI) / 180) * h;
    for (
      let x = -Math.abs(slant) - h;
      x < DESIGN_W + Math.abs(slant) + h;
      x += VS_STRIPE_W + VS_STRIPE_GAP
    ) {
      const dx = flip ? -slant : slant;
      g.poly([
        { x, y: 0 },
        { x: x + VS_STRIPE_W, y: 0 },
        { x: x + VS_STRIPE_W + dx, y: h },
        { x: x + dx, y: h },
      ]).fill({ color: tint, alpha: VS_STRIPE_ALPHA });
    }
    return g;
  };
  const halfH = DESIGN_H / 2;
  wipeTop.addChild(stripes(TEAM_OURS, halfH, false));
  wipeBottom.addChild(stripes(TEAM_THEIRS, halfH, true));
  wipeBottom.y = halfH;
  view.addChild(wipeTop, wipeBottom);

  /** 흔들림·와이프가 같이 먹는 컨테이너 (배경 제외 — 배경은 갈라진다) */
  const content = new Container();
  view.addChild(content);

  const theirSlots: MatchSlot[] = match.slots.filter((s) => s.team === 1);
  const mySlots: MatchSlot[] = match.slots.filter((s) => s.team === 0);
  const humanCount = match.slots.filter((s) => s.kind === "human").length;
  /**
   * 양 팀 캐릭터. **상대는 전장과 같은 유도식으로 뽑는다**
   * (`rosterRules.theirRoster` — `session.ts`도 그것을 부른다).
   *
   * 예전에는 아래 `buildSide`가 팀 번호와 무관하게 `loadout.characters`를 읽어서
   * 상대 칸에 **내 캐릭터가 붉은 틴트만 입고** 섰다. 그래서 (1) 매판 같은 상대로
   * 보였고 (2) 와이프가 열리면 아래 필드의 캐릭터가 VS에서 본 것과 다른 사람으로
   * 바뀌었다 — 이 씬이 전하려는 "누구와 싸우는가"가 거짓이었다.
   */
  const myChars = loadout.characters.slice(0, mySlots.length);
  const theirChars = theirRoster(match.seed, myChars);

  // ── 팀 진영. 우리 팀은 왼쪽 밖에서, 상대는 오른쪽 밖에서 들어온다
  const FIG_H = 190;
  /**
   * 씬이 이미 파괴됐는가. 캐릭터 로드가 **1.6초보다 늦게** 끝날 수 있으므로
   * 필요하다 — 늦게 도착한 스프라이트를 파괴된 컨테이너에 붙이면 `liveCharCount`가
   * 새는 채로 전투 씬으로 넘어간다.
   */
  let disposed = false;
  /** 이 씬이 만든 스프라이트. `update`/`destroy`가 전부 돌려야 한다 */
  const chars: SpriteChar[] = [];
  const buildSide = (
    slots: MatchSlot[],
    characters: readonly CharacterLoadout[],
    team: 0 | 1,
    y: number,
    facing: 1 | -1,
  ): { group: Container; pills: Pill[] } => {
    const group = new Container();
    const pills: Pill[] = [];
    slots.forEach((slot, i) => {
      const cell = new Container();
      const character = characters[i % characters.length]!;
      // `tintHex: 0xffffff`는 "틴트 없음"이라는 뜻이다 (Spine에서는 원본 색).
      // 대역 도형에 그대로 쓰면 흰 유령이 되므로 팀색으로 대신한다
      const base =
        character.tintHex === 0xffffff ? TEAM_OURS : character.tintHex;
      // 상대 팀은 TEAM_THEIRS를 40% 섞는다 — 캐릭터가 이미 다르지만 **팀**은
      // 색으로 읽혀야 한다 (§06-4). 전장의 baseTint와 같은 규칙이다
      const tint =
        team === 0 ? base : mixColor(base, TEAM_THEIRS, THEIRS_TINT_MIX);
      // 시트가 늦거나 없으면 이 도형이 자리를 지킨다. 로드되면 그 위에 덮인다
      const stand = figure(tint, FIG_H, facing);
      cell.addChild(stand);
      // **기다리지 않는다.** 1.6초는 세션 몫이다 (§06-5) — 늦게 오면 늦게 선다
      void createHeroChar(character.charSlug, FIG_H).then(
        (sc) => {
          if (disposed) {
            sc.destroy();
            return;
          }
          // 우리 팀은 원본 색, 상대 팀만 붉게 물들인다 (전투 씬의 baseTint와 같은 규칙)
          if (team === 1)
            sc.setTint(mixColor(0xffffff, TEAM_THEIRS, THEIRS_TINT_MIX));
          sc.setFacing(facing);
          cell.addChildAt(sc.view, 0);
          // 도형 대역은 여기서 물러난다. 남기면 캐릭터 뒤에 색 사다리꼴이 겹친다
          stand.visible = false;
          chars.push(sc);
        },
        (err: unknown) => {
          // 로드 실패는 게임을 멈추지 않는다 — 대역이 그대로 서 있는다
          console.warn("[vs] 캐릭터 시트 실패, 대역 유지", err);
        },
      );
      const isMe = slot.slotId === match.mySlotId;
      // 라벨은 캐릭터 이름이 아니라 **누가 조작하는가**다 (§06-4)
      const label =
        team === 0
          ? isMe
            ? `${character.displayName} (나)`
            : character.displayName
          : matchSlotLabel(slot, false);
      const pill = createPill({
        w: VS_PILL_W,
        h: 44,
        text: label,
        textColor: isMe ? ACCENT_GOLD : UI_TEXT,
      });
      pill.view.position.set(-VS_PILL_W / 2, VS_PILL_DY);
      cell.addChild(pill.view);
      pills.push(pill);
      cell.x = (i - (slots.length - 1) / 2) * VS_CELL_GAP;
      group.addChild(cell);
    });
    group.y = y;
    return { group, pills };
  };

  const ours = buildSide(mySlots, myChars, 0, DESIGN_H * VS_OURS_FEET_Y, 1);
  const theirs = buildSide(
    theirSlots,
    theirChars,
    1,
    DESIGN_H * VS_THEIRS_FEET_Y,
    -1,
  );
  // 우리 팀은 좌측 3할, 상대는 우측 7할 — 대각으로 마주 본다
  ours.group.x = DESIGN_W * 0.38;
  theirs.group.x = DESIGN_W * 0.62;
  content.addChild(ours.group, theirs.group);
  const namePills = [...ours.pills, ...theirs.pills];
  for (const p of namePills) p.view.alpha = 0;

  // ── VS 스탬프
  const stamp = new Container();
  const rays = new Graphics();
  // 좌우로 뻗는 금색 라인 — 스탬프가 화면을 가로지르는 사건이 된다
  rays
    .rect(-DESIGN_W / 2, -5, DESIGN_W, 10)
    .fill({ color: ACCENT_GOLD_DEEP, alpha: 0.9 });
  const plate = new Graphics();
  strokePixelRect(
    fillPixelRect(plate, -86, -52, 172, 104, 12, {
      color: darken(TEAM_THEIRS, 0.5),
    }),
    -86,
    -52,
    172,
    104,
    12,
    { color: UI_OUTLINE, width: 8, alignment: 1 },
  );
  /** 사람 대전이면 금색 발광 링을 더한다 (§06-3) */
  const glow = new Graphics();
  if (humanCount >= 4) {
    strokePixelCircle(glow, 0, 0, 108, {
      color: ACCENT_GOLD,
      width: ART_PX * 2,
      alpha: 0.8,
    });
    strokePixelCircle(glow, 0, 0, 124, {
      color: ACCENT_GOLD,
      width: ART_PX,
      alpha: 0.35,
    });
  }
  const vsText = new Text({
    text: "VS",
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      fontSize: T_HEADLINE.size + 20,
      fontWeight: "700",
      letterSpacing: 4,
      // 이음새는 각지게 — 둥근 이음새는 도트 글리프의 직각 모서리를 굴려서
      // 아웃라인이 글자보다 매끄러워진다 (theme.ts의 FIELD_TEXT_STROKE와 같은 이유)
      stroke: { color: UI_OUTLINE, width: 8, join: "miter", miterLimit: 1 },
      wordWrap: true,
      wordWrapWidth: 200,
    },
  });
  vsText.anchor.set(0.5);
  stamp.addChild(rays, glow, plate, vsText);
  stamp.position.set(DESIGN_W / 2, DESIGN_H * 0.5);
  stamp.scale.set(0);
  content.addChild(stamp);

  /** 세션 준비가 늦을 때만 도는 링 (§06-5) */
  const waitRing = new Graphics();
  waitRing.visible = false;
  stamp.addChild(waitRing);

  const kindLabel = caption(humanCount >= 4 ? "사람 대전" : "AI 대전");
  kindLabel.position.set(DESIGN_W / 2, DESIGN_H * 0.5 + VS_KIND_DY);
  kindLabel.alpha = 0;
  content.addChild(kindLabel);

  // ── 층/테마 라벨 (§06-1: 900ms)
  const floor: Pill = createPill({
    w: DESIGN_W * 0.62,
    iconColor: ACCENT_GOLD,
    // 웨이브 1은 지상 숲이다 (§01-1-3)
    text: floorLabel(1, ctx.manager.theme.id),
  });
  floor.view.position.set(DESIGN_W * 0.19, DESIGN_H * 0.88);
  floor.view.alpha = 0;
  content.addChild(floor.view);

  /** `?debug=1`에서만 seed를 남긴다 (§06-3) */
  if (ctx.debug.debugHud) {
    const seedText = new Text({
      text: `seed ${match.seed}`,
      style: {
        fill: UI_TEXT,
        fontFamily: FONT_FAMILY,
        fontSize: T_LABEL.size,
        fontWeight: "700",
        wordWrap: true,
        wordWrapWidth: 200,
      },
    });
    seedText.anchor.set(1, 1);
    seedText.position.set(DESIGN_W - 16, DESIGN_H - 12);
    seedText.alpha = 0.6;
    content.addChild(seedText);
  }

  const flash = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0xffffff });
  flash.alpha = 0;
  flash.eventMode = "none";
  view.addChild(flash);

  let elapsedMs = 0;
  /** 와이프가 실제로 시작한 뒤의 경과. 준비가 늦으면 그만큼 늦게 흐른다 */
  let wipeMs = 0;
  let ready = false;
  let stamped = false;
  let handedOff = false;
  let posed = false;

  return {
    view,
    enter(): void {
      // 준비는 화면을 가린 상태에서 병렬로 돈다 — 이 씬이 벌어주는 시간이다
      void opts.prepare().then(
        () => {
          ready = true;
        },
        (err: unknown) => {
          // 세션 생성 실패는 여기서 삼키지 않는다 — 넘어가면 빈 전투 화면이 된다
          console.error("[vs] 세션 준비 실패", err);
          ready = true;
        },
      );
    },
    exit(): void {},
    update(dtMs: number): void {
      elapsedMs += dtMs;
      for (const p of namePills) p.update(dtMs);
      floor.update(dtMs);
      // 프레임을 넘겨 주지 않으면 스프라이트가 첫 프레임에 얼어 있다
      for (const c of chars) c.update(dtMs);

      // 흰 플래시가 걷힌 뒤 한 번 벼른다 (§06-1). 늦게 로드된 캐릭터는
      // 이 시각을 지나쳤으므로 idle로 남는다 — 없는 동작을 소급하지 않는다
      if (posesNow(elapsedMs, posed)) {
        posed = true;
        for (const c of chars) c.playOnce("attack1", "idle");
      }

      const slide = slideOffset(elapsedMs);
      // 화면 밖 1.2배까지 밀어 둔다 — 정확히 화면폭이면 큰 캐릭터가 삐져나온다
      ours.group.x = DESIGN_W * 0.38 - slide * DESIGN_W * 1.2;
      theirs.group.x = DESIGN_W * 0.62 + slide * DESIGN_W * 1.2;

      const scale = stampScale(elapsedMs);
      stamp.scale.set(scale);
      if (!stamped && scale > 0) {
        stamped = true;
        playSfx("skill_cast");
      }
      flash.alpha = stampFlash(elapsedMs) * 0.75;
      // 흔들림은 배경까지 흔들면 사선 무늬가 어긋나 보인다 — 내용만 흔든다
      content.x = screenShake(elapsedMs);

      const na = namesAlpha(elapsedMs);
      for (const p of namePills) p.view.alpha = na;
      kindLabel.alpha = na;
      floor.view.alpha = floorAlpha(elapsedMs);

      // 사선 배경이 갈라진다 — 그 틈으로 전장이 보인다.
      // 세션이 준비되기 전에는 열지 않는다 (§06-5)
      if (wipeGate(elapsedMs, ready)) wipeMs += dtMs;
      const wipe = wipeProgress(wipeMs);
      wipeTop.y = -halfH * wipe;
      wipeBottom.y = halfH + halfH * wipe;
      // 갈라지는 동안 VS 내용도 같이 빠진다. 남겨두면 전투 화면 위에 겹친다
      content.alpha = 1 - wipe;

      if (showsWaitRing(elapsedMs, ready)) {
        waitRing.visible = true;
        waitRing.clear();
        const a = (elapsedMs / 700) * Math.PI * 2;
        strokePixelArc(waitRing, 0, 0, 70, a, a + Math.PI * 1.2, {
          color: ACCENT_GOLD,
          width: ART_PX * 2,
        });
      } else if (waitRing.visible) {
        waitRing.visible = false;
      }

      if (!vsHolds(elapsedMs, wipeMs) && !handedOff) {
        handedOff = true;
        opts.onDone();
      }
    },
    destroy(): void {
      disposed = true;
      for (const p of namePills) p.destroy();
      // 스프라이트는 자기 텍스처·틱을 들고 있다. `view.destroy`로는 안 놓는다
      for (const c of chars) c.destroy();
      chars.length = 0;
      floor.destroy();
      view.destroy({ children: true });
    },
  };
}
