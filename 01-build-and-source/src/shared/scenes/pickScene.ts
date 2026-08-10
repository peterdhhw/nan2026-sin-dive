import { Container, Graphics, Sprite, Text } from "pixi.js";
import { DESIGN_H, DESIGN_W } from "../viewport";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  T_BODY,
  T_CAPTION,
  T_TITLE,
  UI_TEXT_DIM,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  fontWeightOf,
} from "../theme";
import { darken, lighten } from "../color";
import { playSfx } from "../audio";
import { PICK_SLUGS, type HeroSlug } from "../charManifest";
import { heroDisplayName } from "../../loadout/preset";
import type { PortraitSet } from "../portraits";
import { ART_PX, RADIUS_CARD, snapPx } from "../ui/shapeRules";
import { createButton, type Button } from "../ui/button";
import { createToast, type Toast } from "../ui/hint";
import { fillPixelRect, strokePixelRect } from "../ui/pixelShape";
import { caption, fitText, sceneText } from "./common";
import type { Scene, SceneCtx } from "../sceneManager";
import {
  PICK_BUTTON_H,
  PICK_CELL_H,
  PICK_CELL_W,
  PICK_GRID_GAP,
  pickAnySelectable,
  pickBorderWidth,
  pickCellPos,
  pickEmptyNotice,
  pickGridSize,
  pickLayout,
  pickPreviewY,
  pickLockNotice,
  pickPulse,
  pickSelectable,
  type PickMode,
} from "./pickRules";

/**
 * 캐릭터 선택 화면 — 모드를 고른 **다음**에 선다.
 *
 * 설계 문서: specs/2026-07-27-ux/05-scene-matchmaking.md §8
 *
 * ## 오버레이에서 씬으로 — 그 결정의 근거가 뒤집혔다 (결정 기록)
 *
 * 이 코드의 원형은 대기 화면(S2) 위에 뜨는 **오버레이**였고, 그 파일은 별도 씬
 * 안을 명시적으로 기각했다: "§05-0이 첫 화면까지 ~9.6초, **탭 0회**를 첫인상
 * 규칙으로 못 박아 놨고, 선택 씬을 세우면 탭이 1회 이상으로 늘고 그만큼 전투가
 * 늦어진다." 격자를 대기 화면에 끼울 자리가 없다는 실측(로고 90 · 타이틀 192 ·
 * 링 358 · 토스트 454 · 우리 팀 538~688 · 상대 팀 819~969 · 스트립 1024 · 캡션
 * 1120 · 건너뛰기 1184~1252 — 1280px에 빈 띠가 없다)이 그 안을 오버레이로 몰았다.
 *
 * **그 근거가 사용자 지시로 뒤집혔다.** 지시는 "맨처음 유저가 접속하면 싱글·PvP를
 * 고를 수 있고, 그 캐릭터 중에 골라서 하는 것"이다 — 탭 0회는 더 이상 목표가
 * 아니고, 선택이 첫 화면의 일부다. 지시가 스펙을 이긴다.
 *
 * 버린 논거를 남기는 이유는 되돌릴 때 필요해서다. **탭 0회를 되살리려면** 이 씬을
 * 건너뛰고 `readPick()`의 저장값으로 직행하면 된다 — 저장 키(`abyss.pick.lead`)가
 * 그대로라 그것이 배선 한 줄이다.
 *
 * ## 왜 두 모드가 같은 씬인가
 *
 * 잠금만 다르다(`pickSelectable`). 싱글용·대전용으로 두 벌 만들면 잠금 규칙이
 * 갈리고, 갈린 쪽은 조용하다 — 한쪽에만 새 조건이 붙는 날 "싱글에서는 고를 수
 * 있는데 대전에서는 안 보이는" 캐릭터가 생기고 그건 화면만 봐서는 버그로 읽힌다.
 */

export interface PickSceneOpts {
  ctx: SceneCtx;
  /** 어느 모드로 들어가는 선택인가 — 잠금이 갈린다 */
  mode: PickMode;
  /** 싱글에서 키운 캐릭터. PvP에서 이것만 고를 수 있다 (요구사항 3) */
  grown: ReadonlySet<string>;
  /** 카드 삽화·전신 삽화. 없으면 도형으로 그린다 */
  portraits: PortraitSet;
  /** 처음 켜져 있는 칸 — 저장된 선택이다 */
  initial: HeroSlug;
  /** 확정. 저장은 배선층 몫이다 */
  onConfirm(slug: HeroSlug): void;
  /** 뒤로 (타이틀). 없으면 뒤로 버튼을 그리지 않는다 */
  onBack?(): void;
}

/** 격자 칸 하나 */
interface Cell {
  view: Container;
  readonly slug: HeroSlug;
  setSelected(on: boolean): void;
  update(dtMs: number): void;
  destroy(): void;
}

/**
 * 칸 크기·간격은 `pickRules`가 갖는다 — 세로 배치(`pickLayout`)가 같은 값으로
 * 격자 높이를 재기 때문이다. 여기 따로 적으면 칸을 키웠을 때 격자가 버튼을
 * 덮는 것을 node 테스트가 못 잡는다.
 */
const CELL_W = PICK_CELL_W;
const CELL_H = PICK_CELL_H;
const GRID_GAP = PICK_GRID_GAP;

/**
 * 진입 직후의 탭은 먹지 않는다 — 앞 화면(타이틀)의 탭이 씬 전환 프레임에 이 씬으로
 * 넘어와 격자나 버튼을 눌러 버리는 것을 막는다. 타이틀의 `titleArmed`와 같은
 * 근거이고, 시간은 페이드인(`SCENE_FADE_IN_MS` = 220ms)보다 살짝 길게 잡는다.
 *
 * 빈 화면과 격자 화면이 **같은 값을 쓴다**: 두 벌로 두면 한쪽만 고쳐지는 날
 * "빈 화면에서는 첫 탭이 삼켜지는데 격자에서는 안 삼켜진다"가 생긴다.
 */
const EMPTY_ARM_MS = 260;

function createCell(
  slug: HeroSlug,
  portraits: PortraitSet,
  locked: boolean,
  onTap: () => void,
): Cell {
  const view = new Container();
  const bg = new Graphics();
  const pulse = new Graphics();
  view.addChild(bg);

  const art = portraits.sprite(slug, "card");
  if (art) {
    // 삽화 폭은 캐릭터마다 다르다(54~134px) — 칸 중앙에 세운다
    art.anchor.set(0.5, 0);
    art.position.set(CELL_W / 2, 8);
    /**
     * **잠긴 칸은 삽화를 어둡게 깐다.** tint는 곱셈이라 밝힐 수는 없지만
     * 어둡게는 할 수 있다 — 여기서 필요한 것이 그쪽이다. 알파를 낮추지 않는
     * 이유: 배경 패널이 비쳐서 인물 실루엣이 흐려지고, 그러면 "무엇이 잠겼는지"
     * 조차 안 읽힌다.
     */
    if (locked) art.tint = 0x4a4458;
    view.addChild(art);
  } else {
    // 삽화가 없어도 무엇을 고르는지 알아야 한다 — 이름은 아래 라벨이 말한다
    const ph = new Graphics();
    fillPixelRect(ph, CELL_W / 2 - 24, 20, 48, 60, ART_PX * 2, {
      color: darken(UI_PANEL, 0.2),
    });
    view.addChild(ph);
  }

  const label = new Text({
    text: heroDisplayName(slug),
    style: {
      fill: locked ? UI_TEXT_DIM : UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: fontWeightOf(T_CAPTION),
      align: "center",
      wordWrap: true,
      wordWrapWidth: CELL_W - 8,
    },
  });
  label.anchor.set(0.5);
  label.position.set(CELL_W / 2, CELL_H - 16);
  fitText(label, CELL_W - 8);
  view.addChild(label, pulse);

  let selected = false;
  let pulseMs = -1;

  const paint = (): void => {
    bg.clear();
    const base = locked ? darken(UI_PANEL, 0.35) : UI_PANEL;
    const body = selected ? lighten(base, 0.12) : base;
    fillPixelRect(bg, 0, 0, CELL_W, CELL_H, RADIUS_CARD, { color: body });
    strokePixelRect(bg, 0, 0, CELL_W, CELL_H, RADIUS_CARD, {
      // 고른 칸은 **색과 두께로 두 번** 말한다 (§01-6: 색만으로는 부족)
      color: selected ? ACCENT_GOLD : locked ? darken(UI_OUTLINE, 0.4) : UI_OUTLINE,
      width: pickBorderWidth(selected),
      alignment: 1,
    });
    label.style.fill = selected ? ACCENT_GOLD : locked ? UI_TEXT_DIM : UI_TEXT;
  };
  paint();

  view.eventMode = "static";
  view.cursor = "pointer";
  view.hitArea = {
    contains: (x, y) => x >= 0 && x <= CELL_W && y >= 0 && y <= CELL_H,
  };
  /**
   * **잠긴 칸도 탭을 받는다.** 무반응은 버그처럼 느껴진다 — 누르면 왜 못 고르는지
   * 토스트가 뜬다(호출자가 `pickLockNotice`로 낸다). hitArea를 빼면 그 안내가
   * 나올 자리가 없다.
   */
  view.on("pointertap", () => onTap());

  return {
    view,
    slug,
    setSelected(on: boolean): void {
      if (selected === on) return;
      selected = on;
      if (on) pulseMs = 0;
      paint();
    },
    update(dtMs: number): void {
      if (pulseMs < 0) return;
      pulseMs += dtMs;
      const a = pickPulse(pulseMs);
      pulse.clear();
      if (a > 0) {
        fillPixelRect(pulse, 0, 0, CELL_W, CELL_H, RADIUS_CARD, {
          color: 0xffffff,
          alpha: a * 0.5,
        });
        return;
      }
      pulseMs = -1;
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}

/**
 * 고를 것이 없는 화면. 안내 한 줄 + 나가는 버튼 하나뿐이다.
 *
 * **격자를 그리는 씬과 같은 `view`를 쓴다** — 딤·제목은 이미 붙어 있고, 여기서
 * 더하는 것은 안내와 버튼이다. 별 씬으로 만들면 제목·딤이 두 벌이 된다.
 */
function createEmptyPick(
  view: Container,
  mode: PickMode,
  onBack: () => void,
): Scene {
  /**
   * `caption()`(흐린 색)을 쓰지 않는다 — 이 화면에 있는 글자가 이것뿐이므로
   * 흐리게 하면 강조를 뺄 상대가 없다. 캡처로 확인했다: 흐린 색으로 찍으니
   * 밝은 숲 배경 띠에 반쯤 묻혀 안내가 배경 장식처럼 읽혔다.
   */
  const notice = sceneText(pickEmptyNotice(mode), T_BODY);
  notice.position.set(DESIGN_W / 2, DESIGN_H * 0.42);
  view.addChild(notice);

  const out: Button = createButton({
    label: "돌아가기",
    // 유일한 행동이므로 주 행동이다 — 이 화면에서 할 수 있는 것이 이것뿐이다
    state: "ready",
    w: DESIGN_W * 0.6,
    h: PICK_BUTTON_H,
    onTap: () => {
      if (!ready) return;
      playSfx("ui_tap");
      onBack();
    },
  });
  out.view.position.set(
    (DESIGN_W - out.width) / 2,
    snapPx(pickLayout().buttonY),
  );
  view.addChild(out.view);

  // 앞 화면의 탭이 넘어와 바로 나가 버리는 것을 막는다 (아래 `ARM_MS`와 같은 근거)
  let ready = false;
  let ms = 0;

  return {
    view,
    enter(): void {},
    exit(): void {},
    update(dtMs: number): void {
      ms += dtMs;
      ready = ms >= EMPTY_ARM_MS;
      out.update(dtMs);
    },
    destroy(): void {
      out.destroy();
      view.destroy({ children: true });
    },
  };
}

export function createPickScene(opts: PickSceneOpts): Scene {
  const view = new Container();
  view.label = "pick";

  const selectable = (slug: HeroSlug): boolean =>
    pickSelectable(slug, { mode: opts.mode, grown: opts.grown });

  /**
   * 전면 딤. **씬인데도 필요하다** — 공용 배경(`manager.background`)은 씬보다
   * 오래 살고 밝은 지표면 테마일 수 있다. 딤 없이 찍어 보니 청록 미리보기가
   * 초록 숲에 묻혀 인물 실루엣이 안 읽혔다(캡처로 확인). tint는 곱셈이라
   * 캐릭터를 밝힐 수 없으므로 배경을 어둡게 하는 쪽이 유일한 길이다.
   *
   * `ui/scrim`을 쓰지 않는 이유는 원본과 같다: 저쪽은 채도 필터를 뒤 컨테이너에
   * 걸지만 여기서 필요한 것은 배경 누르기와 **탭 삼키기**뿐이다. 격자 밖을 눌러도
   * 아무 일이 없어야 한다 — 나가는 길은 [뒤로]다.
   */
  const dim = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x0a0812, alpha: 0.88 });
  dim.eventMode = "static";
  view.addChild(dim);

  const title = sceneText("캐릭터 선택", T_TITLE);
  title.position.set(DESIGN_W / 2, 52);
  view.addChild(title);

  /**
   * 고를 것이 하나도 없으면 **격자를 아예 그리지 않는다.** 잠긴 칸 7개와 영원히
   * 잠긴 확정 버튼을 보여주는 것은 막다른 길이다 — 왜 비었는지 말하고 나갈 길
   * 하나만 준다.
   *
   * `onBack`이 없으면 이 분기로 가지 않는다: 나갈 길이 없는데 격자까지 지우면
   * 아무것도 못 하는 화면이 된다. 그 경우는 잠긴 격자를 그리는 쪽이 낫다 —
   * 최소한 무엇이 잠겼는지는 보인다.
   */
  if (opts.onBack && !pickAnySelectable({ mode: opts.mode, grown: opts.grown })) {
    return createEmptyPick(view, opts.mode, opts.onBack);
  }

  const hint = caption(
    opts.mode === "pvp"
      ? "싱글에서 키운 캐릭터로 대전에 나갑니다"
      : "고른 캐릭터로 심연에 내려갑니다",
  );
  hint.position.set(DESIGN_W / 2, 92);
  view.addChild(hint);

  /**
   * 잠금 안내. 버튼·격자보다 **먼저 만들고 나중에 `addChild`한다** — Pixi의
   * 그리는 순서는 만든 순서가 아니라 붙인 순서다. 여기서 같이 붙이면 안내문이
   * 격자 뒤에 깔려 글자 가운데가 칸에 가린다(타이틀 씬이 같은 실수를 캡처로 잡았다).
   */
  const toast: Toast = createToast({ cx: DESIGN_W / 2, cy: DESIGN_H * 0.62 });

  // ── 전신 미리보기. 고른 캐릭터가 **누구인지** 여기서 읽힌다
  const previewSlot = new Container();
  previewSlot.position.set(DESIGN_W / 2, 120);
  view.addChild(previewSlot);
  let previewArt: Sprite | null = null;

  const name = new Text({
    text: "",
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      fontSize: T_BODY.size,
      fontWeight: fontWeightOf(T_BODY),
      align: "center",
      wordWrap: true,
      wordWrapWidth: DESIGN_W * 0.8,
    },
  });
  name.anchor.set(0.5);
  view.addChild(name);

  // ── 격자
  const grid = new Container();
  const gridSize = pickGridSize({
    cellW: CELL_W,
    cellH: CELL_H,
    gap: GRID_GAP,
  });
  const gridX = (DESIGN_W - gridSize.w) / 2;
  view.addChild(grid);

  let picked = opts.initial;
  const cells: Cell[] = PICK_SLUGS.map((slug, i) => {
    const cell = createCell(slug, opts.portraits, !selectable(slug), () =>
      choose(slug),
    );
    const p = pickCellPos(i, {
      x: 0,
      y: 0,
      cellW: CELL_W,
      cellH: CELL_H,
      gap: GRID_GAP,
    });
    cell.view.position.set(p.x, p.y);
    grid.addChild(cell.view);
    return cell;
  });

  const done: Button = createButton({
    label: opts.mode === "pvp" ? "이 캐릭터로 대전" : "이 캐릭터로 하강",
    // 초록 = 주 행동. 이 화면에서 다음으로 넘어가는 길은 이것뿐이다 (§3-3)
    state: "ready",
    w: DESIGN_W * 0.6,
    h: PICK_BUTTON_H,
    onTap: () => {
      if (!armed) return;
      playSfx("ui_tap");
      opts.onConfirm(picked);
    },
    // 왜 안 되는지는 버튼 밖에서 말한다 — 흔들림만으로는 조건을 알 수 없다
    onLocked: () => toast.show(pickLockNotice(opts.mode)),
  });
  view.addChild(done.view);

  /**
   * 뒤로 — 모드 선택으로 돌아간다. 선택 화면이 막다른 길이 되면 안 된다.
   *
   * **확정 버튼 왼쪽 여백에 앉힌다.** 처음에 상단 중앙에 뒀더니 제목("캐릭터
   * 선택")을 덮었다(캡처로 확인). 확정 버튼은 화면 폭의 60%라 좌우에 각 144px이
   * 남고, 여기가 화면에서 유일하게 비어 있는 자리다. 주 행동과 나란히 두면
   * 위계가 흐려질 수 있으므로 크기(110×52 vs 432×68)와 색(neutral vs ready)으로
   * 두 번 갈라 둔다.
   */
  let back: Button | null = null;
  if (opts.onBack) {
    back = createButton({
      label: "뒤로",
      state: "neutral",
      w: 110,
      h: 52,
      onTap: () => {
        if (!armed) return;
        opts.onBack?.();
      },
    });
    view.addChild(back.view);
  }

  // 안내문은 격자·버튼 위에 얹힌다 (선언은 위, 그리는 순서는 여기)
  view.addChild(toast.view);

  /**
   * 미리보기 갱신. 전신 삽화는 512px 높이라 화면 절반을 먹는다 — 그래서
   * 격자·버튼 자리를 먼저 잡고 **남은 높이에 맞춰 줄인다**. 삽화 자체는
   * 매니페스트 비율로 만들어지므로 여기서 재는 것은 스케일뿐이다.
   */
  const layout = (): void => {
    previewArt?.destroy();
    previewArt = opts.portraits.sprite(picked, "select");
    const L = pickLayout();
    if (previewArt) {
      previewArt.anchor.set(0.5, 0);
      if (previewArt.height > L.previewH) {
        // 종횡비를 지켜 줄인다 — 높이만 줄이면 인물이 눌린다
        const k = L.previewH / previewArt.height;
        previewArt.height = L.previewH;
        previewArt.width *= k;
      }
      // 남은 자리를 위아래로 나눠 삽화를 띠 가운데에 놓는다 (신고: "위에 붙어 있어")
      previewArt.position.set(0, snapPx(pickPreviewY(previewArt.height, L.previewH)));
      // 잠긴 캐릭터를 고른 채로 볼 수 있다 — 미리보기도 잠금을 말한다
      if (!selectable(picked)) previewArt.tint = 0x4a4458;
      previewSlot.addChild(previewArt);
    }
    previewSlot.position.set(DESIGN_W / 2, L.previewTop);
    name.text = heroDisplayName(picked);
    name.position.set(DESIGN_W / 2, snapPx(L.nameY));
    grid.position.set(gridX, snapPx(L.gridY));
    done.view.position.set((DESIGN_W - done.width) / 2, snapPx(L.buttonY));
    if (back) {
      // 확정 버튼과 세로 중심을 맞춘다 — 높이가 다르므로 y를 그대로 쓰면 어긋난다
      const x = (DESIGN_W - done.width) / 2 - back.width - 12;
      back.view.position.set(
        snapPx(Math.max(8, x)),
        snapPx(L.buttonY + (PICK_BUTTON_H - back.height) / 2),
      );
    }
    /**
     * **확정 버튼은 고른 칸이 선택 가능할 때만 활성이다.** 잠긴 캐릭터를 켠 채로
     * 확정이 눌리면 안 키운 캐릭터가 대전에 나가고, 그건 1층 스탯으로 싸운다는
     * 뜻이다(`grownLoadout`) — 무엇을 눌러도 지는 판을 만들어 주는 셈이다.
     */
    done.setState(selectable(picked) ? "ready" : "disabled");
  };

  function choose(slug: HeroSlug): void {
    /**
     * **잠긴 칸을 골라도 커서는 옮긴다.** 안 옮기면 탭이 삼켜진 것과 구별되지
     * 않는다 — 무엇을 눌렀는지 보이고, 왜 못 쓰는지 토스트가 말하고, 확정
     * 버튼이 잠기는 세 신호가 같은 얘기를 한다.
     */
    if (!selectable(slug)) toast.show(pickLockNotice(opts.mode));
    for (const c of cells) c.setSelected(c.slug === slug);
    if (picked === slug) return;
    picked = slug;
    layout();
    playSfx("ui_tap");
  }

  for (const c of cells) c.setSelected(c.slug === picked);
  layout();

  /** 진입 직후의 탭은 먹지 않는다 (`EMPTY_ARM_MS`에 근거가 있다) */
  const ARM_MS = EMPTY_ARM_MS;
  let armed = false;
  let elapsedMs = 0;

  return {
    view,
    enter(): void {},
    exit(): void {},
    update(dtMs: number): void {
      elapsedMs += dtMs;
      armed = elapsedMs >= ARM_MS;
      done.update(dtMs);
      back?.update(dtMs);
      toast.update(dtMs);
      for (const c of cells) c.update(dtMs);
    },
    destroy(): void {
      done.destroy();
      back?.destroy();
      toast.destroy();
      for (const c of cells) c.destroy();
      view.destroy({ children: true });
    },
  };
}
