import { Container, Graphics, Text } from "pixi.js";
import type { Scene, SceneCtx } from "../shared/sceneManager";
import type { MatchSearch, Runtime } from "./runtime";
import { DESIGN_H, DESIGN_W } from "../shared/viewport";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  STATE_OFF,
  STATE_OK,
  TEAM_OURS,
  TEAM_THEIRS,
  THEME_SURFACE,
  T_CAPTION,
  T_LABEL,
  T_NUM_L,
  T_TITLE,
  UI_CARD,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  UI_TEXT_DIM,
  fontWeightOf,
} from "../shared/theme";
import { darken, lighten } from "../shared/color";
import { ART_PX, RADIUS_CARD, snapPx } from "../shared/ui/shapeRules";
import { createButton, type Button } from "../shared/ui/button";
import { createPill, type Pill } from "../shared/ui/pill";
import { createToast, type Toast } from "../shared/ui/hint";
import { unlockAudio, playSfx } from "../shared/audio";
import {
  MATCH_OFFLINE_WAIT_MS,
  MATCH_SLOT_EMPTY,
  matchConfirmHeadline,
  matchCountdownSec,
  matchSlotLabel,
} from "./matchText";
import { serverStatusText } from "../shared/screenText";
import {
  MATCH_WAIT_MS,
  type MatchResult,
  type MatchSlot,
} from "../net/matchmaking";
import {
  caption,
  createLogo,
  dimLayer,
  fitText,
  sceneText,
  sectionLabel,
} from "../shared/scenes/common";
import { HERO_SLUGS, type HeroSlug } from "../shared/charManifest";
import { loadPortraits, type PortraitSet } from "../shared/portraits";
import { createCardBoxOverlay, type CardBoxOverlay } from "../shared/scenes/cardBoxOverlay";
import {
  BOX_ENTRY_H,
  BOX_ENTRY_W,
  boxEntryPos,
  cardBoxLabel,
} from "../shared/scenes/cardRules";
import { loadCardManifest } from "../shared/cards";
import type { CardManifest } from "../shared/cardManifest";
import {
  fillPixelCircle,
  fillPixelRect,
  strokePixelArc,
  strokePixelCircle,
  strokePixelRect,
} from "../shared/ui/pixelShape";
import {
  CARD_H,
  CARD_W_RATIO,
  CONFIRM_TOTAL_MS,
  FLOURISH_MS,
  MATCH_LOGO_SCALE,
  RING_D,
  RING_W,
  aiFillAtMs,
  cardBorder,
  confirmFlashAlpha,
  dotPhase,
  flourishFlash,
  flourishScale,
  ringColor,
  ringSweep,
  ringUrgent,
  stampScale,
  waitingFillOrder,
  type SlotCardKind,
} from "./matchRules";

// 순수 규칙은 matchRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  CARD_H,
  RING_D,
  aiFillAtMs,
  cardBorder,
  flourishScale,
  ringColor,
  ringSweep,
  ringUrgent,
  waitingFillOrder,
} from "./matchRules";

/**
 * S2. 상대 찾기 — **첫 진입 씬**.
 *
 * 설계 문서: specs/2026-07-27-ux/05-scene-matchmaking.md
 *
 * **5초를 빈 대기로 만들지 않는 것이 이 씬의 존재 이유다.** 이전 구현은 검은
 * 배경에 흰 텍스트 한 줄이라 유저가 "고장났나"를 의심했다(§05 머리말).
 */

export interface MatchSceneOpts {
  ctx: SceneCtx;
  runtime: Runtime;
  /**
   * 내가 조작하는 캐릭터. `main`이 넘긴다 — 내 슬롯 카드에 이 얼굴이 선다.
   *
   * **고르는 화면은 없다** (2단계). 싱글에서 키운 그 팀이 그대로 나오므로
   * 여기서 바꿀 수 있으면 강화가 다른 캐릭터에 붙는다 — 10분 키운 것이 대전에서
   * 아무 의미가 없어진다. 예전에는 이 카드를 눌러 7칸 격자가 열리고 고른 값이
   * `abyss.pick.lead`에 남았다(격자·오버레이·저장 전부 제거).
   *
   * 씬이 직접 `localStorage`를 읽지 않는 이유: 로드아웃을 만드는 곳이 `main`이고
   * 씬이 따로 읽으면 두 곳이 서로 다른 값을 볼 수 있다.
   */
  leadSlug: HeroSlug;
  /**
   * 대기를 아예 돌지 않는다 — 즉시 AI로 확정한다.
   *
   * 디버그 진입(`?nowait`)과 세션 준비 실패 복귀가 여기로 들어온다.
   * `ctx.debug.skipMatch`와 따로 두는 이유: 실패 복귀는 프로덕션에서도 돌아야 한다
   */
  skipWait?: boolean;
  /**
   * 지금까지 모은 카드 id (§10-3). 카드함 버튼의 `12/35`와 격자의 실루엣 여부를
   * 이 값이 정한다.
   *
   * `leadSlug`와 같은 이유로 `main`이 넘긴다 — 저장을 읽고 쓰는 곳이 한 곳이어야
   * 결과 화면이 방금 넣은 카드와 이 화면이 세는 수가 갈리지 않는다. 씬은 매판
   * 새로 만들어지므로(재대전은 S2로 돌아온다) 스냅샷이면 충분하다.
   */
  owned: ReadonlySet<string>;
  /** 확정 연출까지 끝난 뒤 — S3 VS 인트로로 넘긴다 */
  onMatched(match: MatchResult): void;
}

const CARD_W = DESIGN_W * CARD_W_RATIO;
const SKIP_LABEL = "건너뛰기 (AI와 바로 시작)";

interface SlotCard {
  view: Container;
  set(kind: SlotCardKind, label: string): void;
  /**
   * 이 카드에 삽화를 세운다. `null`이면 지운다(도형 실루엣으로 돌아간다).
   *
   * 내 카드만 쓴다 — 상대 캐릭터는 확정 시점에 시드가 정하므로 대기 중에는
   * 누구인지 모른다. 모르는 것을 아무 얼굴로 채우면 확정 순간에 얼굴이
   * 바뀌면서 "아까 그 사람이 아니네"가 된다.
   */
  setArt(art: Container | null): void;
  update(dtMs: number): void;
  readonly kind: SlotCardKind;
}

function createSlotCard(team: 0 | 1): SlotCard {
  const view = new Container();
  /** 플러리시 스케일이 카드 전체를 먹어야 한다 — 배경만 커지면 글자가 떠 보인다 */
  const inner = new Container();
  const bg = new Graphics();
  const dots = new Graphics();
  /**
   * 캐릭터 실루엣 — **삽화가 없는 카드의 대체 그림**이다.
   *
   * **Spine 인스턴스를 여기 만들지 않는다.** 카드 4개에 스켈레톤 4개를 붙이면
   * 매칭 5초 중 300~600ms를 쓰고, 그 시간은 이어질 세션 생성(§06-5)에 써야 한다.
   * 머리 + 어깨 실루엣만으로 "누군가 앉아 있다"는 읽힌다.
   *
   * 내 카드에는 얼굴 삽화가 대신 들어간다(`setArt`) — 고른 캐릭터가 카드에서
   * 보이지 않으면 선택이 화면에 남지 않는다. 상대 카드는 확정 전까지 누구인지
   * 모르므로 이 실루엣이 그대로 산다.
   */
  const figure = new Graphics();
  /** 삽화 자리. `figure`보다 위, 라벨보다 아래 */
  const artSlot = new Container();
  const flash = new Graphics();
  const label = new Text({
    text: MATCH_SLOT_EMPTY,
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: fontWeightOf(T_LABEL),
      align: "center",
      wordWrap: true,
      wordWrapWidth: CARD_W - 24,
    },
  });
  label.anchor.set(0.5);
  inner.addChild(bg, figure, artSlot, dots, label, flash);
  view.addChild(inner);
  inner.pivot.set(CARD_W / 2, CARD_H / 2);
  inner.position.set(CARD_W / 2, CARD_H / 2);

  let kind: SlotCardKind = "empty";
  /** 플러리시 경과. -1 = 모션 없음 */
  let flourishMs = -1;
  let elapsedMs = 0;
  /** 삽화가 서 있는가 — 서 있으면 도형 실루엣을 그리지 않는다 */
  let hasArt = false;
  // 슬롯 카드는 **조작을 받지 않는다.** 예전에는 내 카드를 눌러 캐릭터 선택
  // 격자가 열렸다(2단계에서 제거). 진열장이므로 탭 영역을 두지 않는다 —
  // 눌러도 아무 일이 없는 탭은 "고장났나"를 만든다

  const paint = (): void => {
    const border = cardBorder(kind, team);
    bg.clear();
    figure.clear();
    label.position.set(CARD_W / 2, CARD_H - 24);
    if (kind === "empty") {
      // 점선 테두리 — 채워진 카드와 **형태로** 구분된다 (색만으로는 부족, §01-6)
      fillPixelRect(bg, 0, 0, CARD_W, CARD_H, RADIUS_CARD, {
        color: UI_PANEL,
        alpha: 0.35,
      });
      const dash = 12;
      const gap = 8;
      for (let x = 8; x < CARD_W - 8; x += dash + gap) {
        const w = Math.min(dash, CARD_W - 8 - x);
        bg.rect(x, 0, w, 2).fill({ color: border });
        bg.rect(x, CARD_H - 2, w, 2).fill({ color: border });
      }
      for (let y = 8; y < CARD_H - 8; y += dash + gap) {
        const h = Math.min(dash, CARD_H - 8 - y);
        bg.rect(0, y, 2, h).fill({ color: border });
        bg.rect(CARD_W - 2, y, 2, h).fill({ color: border });
      }
      label.style.fill = UI_TEXT_DIM;
      return;
    }
    dots.clear();
    const body = kind === "ai" ? darken(UI_PANEL, 0.18) : UI_PANEL;
    fillPixelRect(bg, 0, 0, CARD_W, CARD_H, RADIUS_CARD, { color: body });
    // 상단 립 — 위젯 전체가 지키는 3단 셰이딩 (§01-3)
    fillPixelRect(bg, 0, 0, CARD_W, CARD_H * 0.34, RADIUS_CARD, {
      color: lighten(body, 0.18),
    });
    bg.rect(0, CARD_H * 0.28, CARD_W, CARD_H * 0.5).fill({ color: body });
    strokePixelRect(bg, 0, 0, CARD_W, CARD_H, RADIUS_CARD, {
      color: border,
      // 내 카드만 굵다 — 네 칸 중 어디가 나인지 색과 두께로 두 번 말한다
      width: kind === "me" ? 5 : 3,
      alignment: 1,
    });
    // 삽화가 서 있으면 도형 실루엣을 겹쳐 그리지 않는다 — 겹치면 얼굴 뒤로
    // 계단 몸통이 삐져나와 두 해상도가 한 카드에 섞인다
    if (hasArt) {
      label.style.fill = kind === "me" ? ACCENT_GOLD : UI_TEXT;
      return;
    }
    const cx = CARD_W / 2;
    // 0.42로는 몸통 아래끝(cy+32+26=127)이 라벨(y 122)을 덮었다 — 위로 올린다
    const cy = CARD_H * 0.34;
    const tint = kind === "ai" ? UI_CARD : team === 0 ? TEAM_OURS : TEAM_THEIRS;
    // 몸통·머리는 계단 도형이다 — 타원·원은 도트 캐릭터와 다른 해상도로 보인다
    fillPixelRect(figure, cx - 33, cy + 6, 66, 52, ART_PX * 2, {
      color: darken(tint, 0.3),
    });
    strokePixelRect(figure, cx - 33, cy + 6, 66, 52, ART_PX * 2, {
      color: UI_OUTLINE,
      width: ART_PX,
    });
    fillPixelCircle(figure, cx, cy, 21, { color: tint });
    strokePixelCircle(figure, cx, cy, 21, {
      color: UI_OUTLINE,
      width: ART_PX,
    });
    label.style.fill = kind === "me" ? ACCENT_GOLD : UI_TEXT;
  };
  paint();

  return {
    view,
    get kind(): SlotCardKind {
      return kind;
    },
    setArt(art: Container | null): void {
      artSlot.removeChildren();
      hasArt = art !== null;
      if (art) {
        // 얼굴이 카드 위쪽에 오고 아래 라벨 자리를 남긴다(삽화 93px + 라벨 126px).
        // 삽화 폭은 캐릭터마다 다르므로(54~134px) **실측 폭으로** 가운데 세운다 —
        // `anchor`를 가정하지 않는다(`portraits.sprite`는 anchor를 세우지 않는다)
        art.position.set(Math.round((CARD_W - art.width) / 2), 8);
        artSlot.addChild(art);
      }
      // 실루엣을 지우거나 되살리려면 다시 그려야 한다
      paint();
    },
    set(next: SlotCardKind, text: string): void {
      const wasEmpty = kind === "empty";
      const changed =
        kind !== next || (next !== "empty" && label.text !== text);
      if (!changed) return;
      kind = next;
      paint();
      if (next !== "empty") {
        label.text = text;
        fitText(label, CARD_W - 24);
      }
      // 채워지는 순간이 이 씬의 핵심 도파민이다 (§05-3)
      if (wasEmpty && next !== "empty") flourishMs = 0;
    },
    update(dtMs: number): void {
      elapsedMs += dtMs;
      if (kind === "empty") {
        // `⋯` 세 점이 순차 점멸 — 화면이 살아 있음을 증명한다
        const on = dotPhase(elapsedMs);
        dots.clear();
        for (let i = 0; i < 3; i += 1) {
          // 점 하나는 한 칸 사각이다 — 반지름 6px 원은 전부 번짐이다
          fillPixelRect(
            dots,
            CARD_W / 2 + (i - 1) * 18 - ART_PX,
            CARD_H * 0.4 - ART_PX,
            ART_PX * 2,
            ART_PX * 2,
            0,
            { color: UI_TEXT_DIM, alpha: i === on ? 0.95 : 0.28 },
          );
        }
      }
      if (flourishMs >= 0) {
        flourishMs += dtMs;
        inner.scale.set(flourishScale(flourishMs));
        flash.clear();
        fillPixelRect(flash, 0, 0, CARD_W, CARD_H, RADIUS_CARD, {
          color: 0xffffff,
          alpha: flourishFlash(flourishMs) * 0.7,
        });
        if (flourishMs >= FLOURISH_MS) {
          flourishMs = -1;
          inner.scale.set(1);
          flash.clear();
        }
      }
    },
  };
}

export function createMatchScene(opts: MatchSceneOpts): Scene {
  const { ctx, runtime } = opts;
  const view = new Container();
  view.label = "match";

  // 배경은 지상 숲을 그대로 둔다 — 흐릿하게 보이는 전장이 "곧 여기서 싸운다"를
  // 말해준다 (§05-2). 심연에서 재대전으로 돌아온 경우 여기서 되돌린다 (§08-6)
  ctx.manager.setTheme(THEME_SURFACE, { immediate: true });
  ctx.manager.showBackground(true);

  view.addChild(dimLayer(DESIGN_W, DESIGN_H, 0.55));

  const logo = createLogo(MATCH_LOGO_SCALE);
  logo.position.set(DESIGN_W / 2, DESIGN_H * 0.07);
  view.addChild(logo);

  const title = sceneText("상대를 찾는 중", T_TITLE);
  title.position.set(DESIGN_W / 2, DESIGN_H * 0.15);
  view.addChild(title);

  // ── 카운트다운 링 (§05-4)
  const ring = new Container();
  const ringBg = new Graphics();
  const ringArc = new Graphics();
  const ringR = RING_D / 2;
  strokePixelCircle(ringBg, 0, 0, ringR, { color: 0x1a1428, width: RING_W });
  const ringNum = new Text({
    text: "5",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_NUM_L.size,
      fontWeight: "700",
      wordWrap: true,
      wordWrapWidth: RING_D,
    },
  });
  ringNum.anchor.set(0.5);
  const ringUnit = new Text({
    text: "초 남음",
    style: {
      fill: UI_TEXT_DIM,
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: fontWeightOf(T_CAPTION),
      wordWrap: true,
      wordWrapWidth: RING_D,
    },
  });
  ringUnit.anchor.set(0.5);
  /**
   * 두 줄을 **잰 높이**로 쌓는다.
   *
   * `T_NUM_L.size * 0.55`로 잡고 있었는데 폰트 크기는 글자 상자의 em이고 렌더된
   * 줄 상자는 그보다 높다 — 숫자 "2"의 아래쪽이 "초 남음"에 파고들었다
   * (스크린샷에서 확인). 두 줄 다 중앙 정렬이라 합쳐진 높이의 절반씩 나눠 갖는다.
   */
  const ringGap = ART_PX;
  const ringStackH = ringNum.height + ringGap + ringUnit.height;
  ringNum.position.set(0, snapPx(-(ringStackH - ringNum.height) / 2));
  ringUnit.position.set(0, snapPx((ringStackH - ringUnit.height) / 2));
  ring.addChild(ringBg, ringArc, ringNum, ringUnit);
  ring.position.set(DESIGN_W / 2, DESIGN_H * 0.28);
  view.addChild(ring);

  /** 확정 스탬프 — 링이 사라진 자리에 찍힌다 (§05-5) */
  const stamp = sceneText("", T_TITLE, ACCENT_GOLD);
  stamp.position.set(DESIGN_W / 2, DESIGN_H * 0.28);
  stamp.visible = false;
  view.addChild(stamp);

  // ── 슬롯 카드 2×2. 순서는 MatchResult.slots와 같다 (t0s0, t0s1, t1s0, t1s1)
  const cards: SlotCard[] = [];
  const cardXs = [DESIGN_W * 0.05, DESIGN_W * 0.51] as const;
  const teamYs = [DESIGN_H * 0.42, DESIGN_H * 0.64] as const;
  for (const team of [0, 1] as const) {
    const row = sectionLabel(
      team === 0 ? "우리 팀" : "상대 팀",
      team === 0 ? TEAM_OURS : TEAM_THEIRS,
      DESIGN_W * 0.88,
    );
    row.position.set(DESIGN_W * 0.06, teamYs[team] - 24);
    view.addChild(row);
    for (let i = 0; i < 2; i += 1) {
      const card = createSlotCard(team);
      card.view.position.set(cardXs[i]!, teamYs[team]);
      view.addChild(card.view);
      cards.push(card);
    }
  }

  /**
   * 내 카드. 대기 중에는 `waitingFillOrder`의 첫 자리(=우리 팀 1번)다 —
   * 확정 시점에 `mySlotId`가 다른 칸을 가리킬 수 있지만, 이 함수를 쓰는 곳은
   * 얼굴을 세우는 `paintMyArt`뿐이고 그건 대기 중에만 돈다.
   */
  const myCard = (): SlotCard | undefined => cards[waitingFillOrder(2)[0] ?? 0];

  // ── 상태 스트립 (§05-2). 연결 여부를 숨기지 않는다 — 키 만료 대비
  const strip: Pill = createPill({
    w: DESIGN_W * 0.78,
    iconColor: runtime.online ? STATE_OK : STATE_OFF,
    text: serverStatusText(runtime.online, 1),
  });
  strip.view.position.set(DESIGN_W * 0.11, DESIGN_H * 0.8);
  view.addChild(strip.view);

  const hint = caption(
    runtime.online
      ? "상대를 찾는 중… 없으면 AI와 대전합니다"
      : "대전 서버에 연결할 수 없어 AI와 대전합니다",
  );
  hint.position.set(DESIGN_W / 2, DESIGN_H * 0.875);
  view.addChild(hint);

  // 기본 위치(하단 20%)는 이 씬에서 상태 스트립과 겹친다 — 카드 위, 링 아래의
  // 빈 띠에 띄운다. 합류 알림은 카드가 채워지는 것을 보며 읽는 문구다
  const toast: Toast = createToast({
    cx: DESIGN_W / 2,
    cy: DESIGN_H * 0.355,
  });
  view.addChild(toast.view);

  /** 대기를 돌지 않는가 — 연습(§04-5)·디버그 진입 */
  const skipWait = opts.skipWait === true || ctx.debug.skipMatch;

  /** 대기 상한. 오프라인이면 단축한다 (§05-6) */
  let waitLimitMs = runtime.online ? MATCH_WAIT_MS : MATCH_OFFLINE_WAIT_MS;
  if (skipWait) waitLimitMs = 0;

  let search: MatchSearch | null = null;
  let skipRequested = false;

  const skip: Button = createButton({
    label: SKIP_LABEL,
    state: "neutral",
    w: DESIGN_W * 0.78,
    h: 68,
    onTap: () => {
      if (skipRequested) return;
      skipRequested = true;
      // 첫 탭일 가능성이 높다 — 여기서 AudioContext를 resume한다 (§05-6)
      unlockAudio();
      // 로비에 bye를 발행하고 대기를 끊는다 — 안 하면 유령 슬롯이 남는다
      search?.skip();
    },
  });
  skip.view.position.set((DESIGN_W - skip.width) / 2, DESIGN_H * 0.925);
  view.addChild(skip.view);

  /**
   * 카드함 입구 (§10-3). 자리 근거는 `boxEntryPos`에 있다.
   *
   * 라벨에 수를 적는다(`카드함 3/35`) — 아이콘만 두면 무엇인지 눌러 봐야 알고,
   * 수가 보이면 열지 않아도 진행이 읽힌다. 매니페스트를 안 기다린다: 수는
   * `owned`와 로스터만으로 나오고(`cardBoxLabel`), 그림은 열 때 받는다.
   */
  const boxEntry: Button = createButton({
    label: cardBoxLabel(opts.owned),
    // 매니페스트가 오기 전에는 `disabled`다. 탭하면 흔들려서 "지금은 안 된다"고
    // 답한다(§C2) — 무반응이면 버그로 읽힌다
    state: "disabled",
    w: BOX_ENTRY_W,
    h: BOX_ENTRY_H,
    onTap: () => openCardBox(),
  });
  {
    const p = boxEntryPos();
    boxEntry.view.position.set(snapPx(p.x), snapPx(p.y));
  }
  view.addChild(boxEntry.view);

  /** 확정 마지막 120ms의 흰 플래시 — "여기서부터 다른 화면"의 경계 */
  const flash = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0xffffff });
  flash.alpha = 0;
  flash.eventMode = "none";
  view.addChild(flash);

  let elapsedMs = 0;
  /** 매칭 서비스가 보고한 대기 시간 (500ms 간격) */
  let reportedMs = 0;
  let humanCount = 1;
  let shownHumanCount = -1;
  /** findMatch가 끝났지만 아직 확정 연출을 시작하지 않은 결과 */
  let pending: MatchResult | null = null;
  /** 확정 연출 경과. -1 = 아직 대기 중 */
  let confirmMs = -1;
  let confirmed: MatchResult | null = null;
  let handedOff = false;
  /** 순차로 AI로 전환할 카드 — [카드 인덱스, 라벨, 전환 시각] */
  let aiFills: { index: number; label: string; atMs: number }[] = [];

  /**
   * 내 슬롯에 세울 얼굴. **`let`이 아니다** — 고르는 화면이 없다(2단계).
   *
   * 예전에는 `picked`였고 선택 오버레이가 바꿨다. 지금 바뀌지 않는다는 사실이
   * 타입에 남아 있어야, 얼굴만 바꾸고 강화는 그대로 남는 코드가 다시 생기지 않는다.
   */
  const mySlug: HeroSlug = opts.leadSlug;
  /**
   * 카드 삽화 7장. 도착 전에는 도형으로 그려진다.
   *
   * **전신 삽화(`select`, 692KB)는 더 안 받는다** — 그건 선택 격자에서 골라진
   * 캐릭터를 크게 보여 주던 것이고, 격자가 없어진 지금은 한 판에서 한 번도
   * 화면에 오르지 않는다. 대기 5초의 대역폭을 카드 7장(112KB)에만 쓴다.
   */
  let portraits: PortraitSet | null = null;

  // ── 카드함 (§10-3)
  let cardBox: CardBoxOverlay | null = null;
  /**
   * `cards.json`. **매니페스트가 결판나기 전에는 버튼이 잠긴다** —
   * 오버레이는 처음 열 때 한 번 만들어지고 그때의 매니페스트를 들고 있으므로
   * (`createCardBoxOverlay`), 도착 전에 열면 그 씬에서는 격자가 영구히 빈다.
   *
   * 실패(`null`)도 결판이다 — 그때는 열려서 "못 받았다"고 말해야 한다.
   * 잠긴 채로 두면 카드함이 없는 게임처럼 보인다.
   */
  let cardManifest: CardManifest | null = null;
  let cardManifestSettled = false;

  /** 내 카드에 내 캐릭터의 얼굴을 세운다. 삽화가 없으면 도형으로 남는다 */
  const paintMyArt = (): void => {
    myCard()?.setArt(portraits?.sprite(mySlug, "card") ?? null);
  };

  /**
   * 카드함을 연다. **처음 열 때 만들고** 플래시를 다시 맨 위로 올린다 —
   * 오버레이를 나중에 `addChild`하면 확정 플래시를 덮는다(그리는 순서 = 층).
   *
   * 확정 뒤에는 열리지 않는다: 확정 연출 1.6초 뒤 VS로 넘어가는데(§05-5) 그
   * 사이에 열면 씬이 파괴되면서 카드함이 같이 사라진다 — 유저에게는 방금 누른
   * 버튼이 화면을 깜빡이고 삼킨 것으로 보인다.
   */
  const openCardBox = (): void => {
    if (confirmMs >= 0 || !cardManifestSettled) return;
    unlockAudio();
    if (cardBox === null) {
      cardBox = createCardBoxOverlay({
        manifest: cardManifest,
        owned: opts.owned,
        onClose: () => {},
      });
      view.addChild(cardBox.view);
      view.setChildIndex(flash, view.children.length - 1);
    }
    cardBox.show();
    playSfx("ui_tap");
  };

  const paintRing = (remainRatio: number): void => {
    const color = ringColor(remainRatio);
    ringArc.clear();
    if (remainRatio > 0.001) {
      // 12시에서 시계 반대로 줄어든다 — 남은 양이 "빠져나간다"로 읽힌다.
      // 호를 계단으로 접으므로 각은 작은 쪽을 앞에 넣는다 (선에 방향은 없다)
      const sweep = ringSweep(remainRatio);
      strokePixelArc(ringArc, 0, 0, ringR, -Math.PI / 2 - sweep, -Math.PI / 2, {
        color,
        width: RING_W,
      });
    }
    ringNum.style.fill = color;
  };

  /**
   * 대기 중 그림 — 사람 수만큼 앞 카드부터 채운다.
   *
   * 슬롯 배정은 확정 시점에만 결정되므로(로스터 정렬 → 슬롯), 대기 중에는
   * "몇 명 모였다"만 보여준다. 두 클라이언트가 같은 수를 보므로 그림도 같다.
   */
  const fillOrder = waitingFillOrder(2);
  const showWaiting = (humans: number): void => {
    fillOrder.forEach((cardIndex, rank) => {
      const card = cards[cardIndex];
      if (!card) return;
      if (rank === 0) {
        card.set(
          "me",
          matchSlotLabel({ kind: "human", displayName: "나" }, true),
        );
        return;
      }
      if (rank < humans) {
        card.set("human", `플레이어 ${String.fromCharCode(64 + rank)}`);
        return;
      }
      card.set("empty", MATCH_SLOT_EMPTY);
    });
  };
  showWaiting(1);

  /** 확정 — 사람 슬롯은 즉시, AI 슬롯은 120ms 간격으로 채운다 (§05-5) */
  const beginConfirm = (match: MatchResult): void => {
    confirmed = match;
    confirmMs = 0;
    // 카드함도 같이 닫는다. `close()`는 상세가 열려 있으면 상세만 닫으므로
    // (`cardBoxOverlay`) 여기서는 직접 숨긴다 — 확정 연출 뒤에 격자가 남으면
    // VS 커튼이 그 위로 덮인다
    if (cardBox?.open === true) cardBox.hide();
    boxEntry.view.visible = false;
    const humans = match.slots.filter((s) => s.kind === "human").length;
    stamp.text = matchConfirmHeadline(humans);
    stamp.style.fill =
      humans >= 4 ? ACCENT_GOLD : humans >= 2 ? UI_TEXT : UI_TEXT_DIM;
    stamp.visible = true;
    ring.visible = false;
    skip.view.visible = false;
    // 확정된 뒤에도 "상대를 찾는 중"이 남아 있으면 화면이 스스로를 부정한다
    hint.visible = false;
    strip.setText(serverStatusText(runtime.online, humans));
    title.text = "대전 상대 확정";

    let aiOrder = 0;
    aiFills = [];
    match.slots.forEach((slot: MatchSlot, i) => {
      const card = cards[i];
      if (!card) return;
      const isMe = slot.slotId === match.mySlotId;
      const label = matchSlotLabel(slot, isMe);
      if (slot.kind === "human") {
        card.set(isMe ? "me" : "human", label);
        return;
      }
      // AI는 순차로 — 전부 동시에 바뀌면 "채워지는 과정"이 안 보인다
      aiFills.push({ index: i, label, atMs: aiFillAtMs(aiOrder) });
      aiOrder += 1;
    });
    playSfx("ui_tap");
  };

  return {
    view,
    enter(): void {
      search = runtime.findMatch({
        skipWait,
        onProgress: (p) => {
          reportedMs = p.waitedMs;
          humanCount = Math.max(1, p.humanCount);
        },
      });
      void search.result.then((match) => {
        pending = match;
        humanCount = match.slots.filter((s) => s.kind === "human").length;
      });

      /**
       * 삽화를 받는다. **매칭을 기다리지 않는다** — `await`하면 5초 카운트다운이
       * 그만큼 늦게 시작하고, 삽화는 화면이 굴러가는 데 필요한 것이 아니다.
       *
       * 카드(112KB)와 전신(692KB)을 **따로** 받아 카드가 먼저 도착하게 한다.
       * 한 호출로 묶으면 692KB를 기다리는 동안 내 카드가 도형으로 남는데,
       * 대기 5초 중 그 시간이 선택을 열어 볼 수 있는 시간을 그만큼 깎는다.
       */
      void loadPortraits(["card"], HERO_SLUGS).then((cardSet) => {
        portraits = cardSet;
        paintMyArt();
      });

      /**
       * 카드 **매니페스트만** 받는다 (7KB). 그림 105장(0.5MB)은 카드함을 열 때
       * 받는다 — 대부분의 판에서 안 열리고, 대기 5초는 삽화 두 묶음(0.8MB)을
       * 이미 받는 중이다(`loadCardManifest` 주석).
       */
      void loadCardManifest().then((manifest) => {
        cardManifest = manifest;
        cardManifestSettled = true;
        if (confirmMs < 0) boxEntry.setState("neutral");
      });
    },
    exit(): void {},
    update(dtMs: number): void {
      elapsedMs += dtMs;
      strip.update(dtMs);
      skip.update(dtMs);
      toast.update(dtMs);
      for (const card of cards) card.update(dtMs);
      boxEntry.update(dtMs);
      // 열려 있을 때만 도는 것은 오버레이가 스스로 판단한다
      cardBox?.update(dtMs);

      if (confirmMs < 0) {
        // 보고는 500ms 간격이다 — 그 사이를 자체 시간으로 메워야 링이 끊기지 않는다
        const waitedMs = Math.max(reportedMs, Math.min(waitLimitMs, elapsedMs));
        const remain =
          waitLimitMs <= 0 ? 0 : Math.max(0, 1 - waitedMs / waitLimitMs);
        ringNum.text = String(matchCountdownSec(waitedMs, waitLimitMs));
        paintRing(remain);
        // 15% 미만에서만 링이 뛴다 — 항상 뛰면 5초 내내 시선을 잡아먹는다
        ring.scale.set(
          ringUrgent(remain)
            ? 1 + 0.04 * Math.abs(Math.sin(elapsedMs / 140))
            : 1,
        );

        if (humanCount !== shownHumanCount) {
          const joined = shownHumanCount >= 0 && humanCount > shownHumanCount;
          shownHumanCount = humanCount;
          showWaiting(humanCount);
          strip.setText(serverStatusText(runtime.online, humanCount));
          if (joined) {
            toast.show(
              `플레이어 ${String.fromCharCode(64 + humanCount - 1)} 합류!`,
            );
            playSfx("cooldown_ready");
          }
        }

        // 사람이 4/4로 다 찼거나(§05-4), 건너뛰기를 눌렀거나, 대기 상한을 넘겼다
        if (pending !== null) {
          beginConfirm(pending);
          pending = null;
          return;
        }
        // 링이 0에 닿았는데 매칭이 아직 안 끝났다 — 홀로 남은 hello 주기(500ms)를
        // 기다리게 하면 "0초 남음"이 화면에 멈춰 있다. 대기를 직접 끊는다
        if (elapsedMs >= waitLimitMs && !skipRequested) {
          skipRequested = true;
          search?.skip();
        }
        return;
      }

      confirmMs += dtMs;
      stamp.scale.set(stampScale(confirmMs));
      for (const fill of aiFills) {
        if (confirmMs < fill.atMs) continue;
        cards[fill.index]?.set("ai", fill.label);
      }
      aiFills = aiFills.filter((f) => confirmMs < f.atMs);
      flash.alpha = confirmFlashAlpha(confirmMs);
      if (confirmMs >= CONFIRM_TOTAL_MS && !handedOff && confirmed !== null) {
        handedOff = true;
        opts.onMatched(confirmed);
      }
    },
    destroy(): void {
      skip.destroy();
      strip.destroy();
      toast.destroy();
      boxEntry.destroy();
      cardBox?.destroy();
      view.destroy({ children: true });
    },
  };
}
