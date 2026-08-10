import { ColorMatrixFilter, Container, Graphics, Text } from "pixi.js";
import type { Scene, SceneCtx } from "../shared/sceneManager";
import { DESIGN_H, DESIGN_W } from "../shared/viewport";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FONT_FAMILY,
  TEAM_OURS,
  TEAM_THEIRS,
  T_BODY,
  T_HEADLINE,
  T_NUM_L,
  UI_OUTLINE,
  UI_TEXT_DIM,
  fontWeightOf,
} from "../shared/theme";
import { darken, saturateDelta } from "../shared/color";
import { createPanel, HEADER_H } from "../shared/ui/panel";
import { createButton, type Button } from "../shared/ui/button";
import { createPill, type Pill } from "../shared/ui/pill";
import { formatClock, formatGauge, formatInt } from "../shared/format";
import { opponentLabel, rematchHint, resultText } from "./matchText";
import { playSfx } from "../shared/audio";
import type { SessionResult } from "./session";
import type { MatchResult } from "../net/matchmaking";
import { caption, fitText } from "../shared/scenes/common";
import { SCRIM_COLOR } from "../shared/theme";
import { CELEBRATE_PERIOD_MS } from "./sessionRules";
import {
  fillPixelRect,
  strokePixelCircle,
  strokePixelRect,
} from "../shared/ui/pixelShape";
import { ART_PX, snapPx } from "../shared/ui/shapeRules";
import {
  MINI_GAUGE_H,
  MINI_GAUGE_W,
  PARTICLE_COUNT,
  V_ART_VARIANT,
  buttonAlpha,
  buttonsLive,
  cameraDrop,
  fieldSaturate,
  finishFlash,
  metricAtMs,
  miniGaugeRatio,
  miniThresholds,
  panelScale,
  particleT,
  particleX,
  scrimAlpha,
  showsVictory,
  stampScale,
  stampShake,
} from "./resultRules";
import { loadPortraits } from "../shared/portraits";
import {
  createShowcaseOverlay,
  type ShowcaseOverlay,
} from "../shared/scenes/showcaseOverlay";
import { findCard, loadCardArt, loadCardManifest } from "../shared/cards";
import { rewardCaption, type CardReward } from "../shared/scenes/cardRules";
import { heroDisplayName } from "../loadout/preset";
import type { HeroSlug } from "../shared/charManifest";

// 순수 규칙은 resultRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  buttonAlpha,
  buttonsLive,
  cameraDrop,
  fieldSaturate,
  metricAtMs,
  miniGaugeRatio,
  miniThresholds,
  panelScale,
  scrimAlpha,
  stampScale,
} from "./resultRules";

/**
 * S5. 결과.
 *
 * 설계 문서: specs/2026-07-27-ux/08-scene-result.md
 *
 * **`location.reload()` 제거가 이 씬의 핵심이다** (§08-5). `[다시 대전]`은
 * 세션·전장을 파괴하고 S2 매칭으로 돌아간다 — 에셋을 다시 받지 않으므로
 * 재대전이 6.6초(매칭 5 + VS 1.6) 안에 시작된다.
 *
 * 뒤 전장은 파괴하지 않고 남긴다 (§08-1) — 딤 뒤에서 계속 숨을 쉰다.
 */

export interface ResultSceneOpts {
  ctx: SceneCtx;
  result: SessionResult;
  match: MatchResult;
  /**
   * 내가 고른 캐릭터 — 승리 삽화가 **누구인지** 이 값이 정한다 (§08-8).
   *
   * `match.slots`에서 유도할 수 없다: 슬롯은 누가 조작하는가만 담고(§06-4)
   * 캐릭터 슬러그가 없다. `main`이 `leadSlug`를 그대로 넘긴다 — 로드아웃을
   * 만든 값과 같아야 화면의 인물과 방금 조작한 캐릭터가 일치한다.
   */
  mySlug: HeroSlug;
  /**
   * 이번 판의 카드 보상 (§10-2). 이겼을 때만 온다.
   *
   * **씬이 정하지 않는다.** 판정에는 판 시드와 보유 목록이 필요하고 그 둘은
   * `main`이 갖는다(`readOwned`/`nextSeed`) — 씬이 직접 뽑으면 저장하는 곳과
   * 뽑는 곳이 갈려서, 화면에 뜬 카드와 카드함에 들어간 카드가 다를 수 있다.
   */
  reward?: CardReward | undefined;
  /**
   * 승리 축하 포즈를 요청한다 (§08-1). 전장이 살아 있을 때만 온다 —
   * `?result=` 디버그 진입에는 전장이 없으므로 없을 수 있다.
   */
  celebrate?: ((turn: number) => void) | undefined;
  /** S2 매칭으로 (§08-5) */
  onRematch(): void;
  /** S1 타이틀로 (§08-5) */
  onTitle(): void;
}

/** 지표 행 하나 */
interface MetricRow {
  /** 카운트업이 시작될 시각 */
  atMs: number;
  start(): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createResultScene(opts: ResultSceneOpts): Scene {
  const { ctx, result, match } = opts;
  const view = new Container();
  view.label = "result";

  const text = resultText(result);
  const won = result.winner === 0;
  const lost = result.winner === 1;

  /**
   * 뒤 전장은 그대로 살아 있다 (§08-1) — 딤과 **채도 40%**를 같이 준다.
   *
   * `createScrim`을 쓰지 않는 이유: 그 위젯은 `target`에 필터를 걸고 자기
   * 페이드를 따로 돌리는데, 결과 씬의 딤은 §08-1 타임라인(140ms 시작)에
   * 묶여 있어야 한다. 채도 상수는 `scrimRules`에서 같이 가져온다.
   */
  const scrim = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: SCRIM_COLOR });
  scrim.alpha = 0;
  // 전장이 뒤에서 계속 돌기 때문에 딤이 탭을 삼켜야 한다 — 안 그러면 결과
  // 화면 밑의 스킬 슬롯이 그대로 눌린다 (실측에서 확인)
  scrim.eventMode = "static";
  scrim.hitArea = {
    contains: (x, y) => x >= 0 && y >= 0 && x <= DESIGN_W && y <= DESIGN_H,
  };
  view.addChild(scrim);

  /**
   * 전장 채도·하강을 거는 대상. `app.battleRoot`는 전투 레이어 6개를 묶은
   * 컨테이너다 — 레이어마다 걸면 필터 패스가 6번 돌고, 루트에 걸면 결과 UI가
   * 같이 흐려진다.
   *
   * **씬을 나갈 때 반드시 되돌린다.** 재대전은 같은 `battleRoot`를 다시 쓰므로
   * 필터가 남으면 다음 판이 흑백으로 시작한다 (§09-4 누수 항목).
   */
  const field = ctx.app.battleRoot;
  const desat = new ColorMatrixFilter();
  const fieldY0 = field.y;
  let filterApplied = false;
  const applyFieldFilter = (on: boolean): void => {
    if (on === filterApplied) return;
    filterApplied = on;
    const cur = field.filters;
    const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
    field.filters = on
      ? [...list.filter((f) => f !== desat), desat]
      : list.filter((f) => f !== desat);
  };

  /** 승리 파티클 (§08-1). 몰수 승리에는 없다 — 유저가 잘한 게 없다 (§08-3) */
  const particles = new Graphics();
  particles.visible = text.celebrate;
  view.addChild(particles);

  /** 흔들림이 헤드라인·패널을 같이 먹는다 */
  const content = new Container();
  view.addChild(content);

  // ── 헤드라인 스탬프
  const stamp = new Container();
  const rays = new Graphics();
  const headline = new Text({
    text: text.stamp,
    style: {
      fill: won ? ACCENT_GOLD : result.winner === 1 ? TEAM_THEIRS : UI_TEXT_DIM,
      fontFamily: FONT_FAMILY,
      fontSize: T_HEADLINE.size,
      fontWeight: "700",
      letterSpacing: 2,
      // 이음새는 각지게 — 둥근 이음새는 도트 글리프의 직각 모서리를 굴려서
      // 아웃라인이 글자보다 매끄러워진다 (theme.ts의 FIELD_TEXT_STROKE와 같은 이유)
      stroke: { color: UI_OUTLINE, width: 8, join: "miter", miterLimit: 1 },
      align: "center",
      wordWrap: true,
      wordWrapWidth: DESIGN_W - 60,
    },
  });
  headline.anchor.set(0.5);

  /**
   * 헤드라인 **좌우** 금색 라인 (§08-2).
   *
   * 화면을 가로지르는 한 줄이었는데, 글자 중앙 높이에 깔리는 바람에 "승리!"의
   * 가운데를 관통해서 글자를 갈라 놨다 — 스크린샷에서 확인했다. 벡터 폰트에서는
   * 얇은 선이 글자에 묻혀 티가 안 났지만, 도트 글리프는 획이 굵고 균일해서
   * 같은 두께의 선이 획으로 읽힌다.
   *
   * 스펙이 요구한 것은 애초에 "좌우 금색 라인"이다. 글자 폭을 재서 양옆으로만
   * 뻗는다 — 문구 길이가 사유마다 다르므로(`승 리 !` / `판 정 패`) 상수로 못 둔다.
   */
  const RAY_GAP = 20;
  const rayY = snapPx(-ART_PX);
  const rayH = ART_PX * 2;
  const inner = snapPx(headline.width / 2 + RAY_GAP);
  const outer = DESIGN_W / 2;
  if (outer > inner) {
    for (const sign of [-1, 1]) {
      const x = sign < 0 ? -outer : inner;
      rays.rect(x, rayY, outer - inner, rayH).fill({
        color: won ? ACCENT_GOLD_DEEP : darken(TEAM_THEIRS, 0.3),
        alpha: 0.85,
      });
    }
  }
  stamp.addChild(rays, headline);
  stamp.position.set(DESIGN_W / 2, DESIGN_H * 0.22);
  stamp.scale.set(0);
  content.addChild(stamp);

  const subtitle = caption(text.subtitle);
  subtitle.position.set(DESIGN_W / 2, DESIGN_H * 0.29);
  subtitle.alpha = 0;
  content.addChild(subtitle);

  /** 연결이 끊겨 패배한 경우에만 재연결 안내를 더한다 (§08-3) */
  const notice =
    result.reason === "forfeit" && result.winner === 1
      ? caption("네트워크를 확인한 뒤 다시 대전해 주세요")
      : null;
  if (notice) {
    notice.position.set(DESIGN_W / 2, DESIGN_H * 0.325);
    notice.alpha = 0;
    content.addChild(notice);
  }

  // ── 전적 패널
  const PANEL_W = DESIGN_W * 0.84;
  // 4행 + 미니 게이지 여유 + 헤더(HEADER_H) — 행 높이를 바꾸면 여기도 따라와야 한다
  const PANEL_H = 372;
  const panel = createPanel({
    w: PANEL_W,
    h: PANEL_H,
    variant: "cream",
    header: "전적",
  });
  const panelHolder = new Container();
  panelHolder.addChild(panel.view);
  // 스케일 중심을 패널 중앙으로 — 좌상단 기준이면 커지면서 오른쪽으로 쏠린다
  panelHolder.pivot.set(PANEL_W / 2, PANEL_H / 2);
  panelHolder.position.set(DESIGN_W / 2, DESIGN_H * 0.38 + PANEL_H / 2);
  panelHolder.scale.set(0);
  content.addChild(panelHolder);

  const rows: MetricRow[] = [];
  const ROW_H = 52;
  /**
   * 미니 게이지 바(3행)가 행 아래로 삐져나온 만큼 그 뒤 행을 밀어낸다.
   * 없으면 바가 `상대` 행 글자와 겹친다 — 스크린샷에서 확인했다.
   */
  const MINI_ROW_EXTRA = 34;
  const rowY = (index: number): number =>
    index * ROW_H + (index >= 3 ? MINI_ROW_EXTRA : 0);
  const makeRow = (
    index: number,
    glyph: (g: Graphics, cx: number, cy: number) => void,
    label: string,
    valueOf: () => string,
    extra?: (row: Container, y: number) => void,
  ): void => {
    const row = new Container();
    const y = rowY(index);
    const icon = new Graphics();
    glyph(icon, 16, y + ROW_H / 2 - 4);
    const name = new Text({
      text: label,
      style: {
        fill: panel.textColor,
        fontFamily: FONT_FAMILY,
        fontSize: T_BODY.size,
        fontWeight: fontWeightOf(T_BODY),
        wordWrap: true,
        wordWrapWidth: panel.innerW * 0.6,
      },
    });
    name.anchor.set(0, 0.5);
    name.position.set(40, y + ROW_H / 2 - 4);
    const value = new Text({
      text: "",
      style: {
        fill: panel.textColor,
        fontFamily: FONT_FAMILY,
        fontSize: T_NUM_L.size,
        fontWeight: "700",
        align: "right",
        wordWrap: true,
        wordWrapWidth: panel.innerW * 0.5,
      },
    });
    value.anchor.set(1, 0.5);
    value.position.set(panel.innerW, y + ROW_H / 2 - 4);
    row.addChild(icon, name, value);
    extra?.(row, y);
    panel.content.addChild(row);

    let elapsed = -1;
    rows.push({
      atMs: metricAtMs(index),
      start(): void {
        elapsed = 0;
        value.text = valueOf();
        fitText(value, panel.innerW * 0.5);
      },
      update(dtMs: number): void {
        if (elapsed < 0) return;
        elapsed += dtMs;
      },
      destroy(): void {},
    });
  };

  // 처치 — 검 모양 (아이콘 아틀라스를 기다리지 않는다, §03-3)
  makeRow(
    0,
    (g, cx, cy) => {
      g.poly([
        { x: cx, y: cy - 12 },
        { x: cx + 5, y: cy - 4 },
        { x: cx + 2, y: cy + 10 },
        { x: cx - 2, y: cy + 10 },
        { x: cx - 5, y: cy - 4 },
      ]).fill({ color: TEAM_OURS });
      g.rect(cx - 9, cy + 2, 18, 4).fill({ color: darken(TEAM_OURS, 0.3) });
    },
    "처치",
    () => formatInt(result.myKills),
  );
  // 시간 — 시계
  makeRow(
    1,
    (g, cx, cy) => {
      strokePixelCircle(g, cx, cy, 11, { color: TEAM_OURS, width: ART_PX });
      g.rect(cx - 1, cy - 7, 2, 8).fill({ color: TEAM_OURS });
      g.rect(cx, cy - 1, 6, 2).fill({ color: TEAM_OURS });
    },
    "시간",
    () => formatClock(result.elapsedMs),
  );
  // 최종 게이지 — 마름모 + 미니 바
  makeRow(
    2,
    (g, cx, cy) => {
      g.poly([
        { x: cx, y: cy - 10 },
        { x: cx + 9, y: cy },
        { x: cx, y: cy + 10 },
        { x: cx - 9, y: cy },
      ]).fill({ color: ACCENT_GOLD });
    },
    "최종 게이지",
    () => formatGauge(result.gaugePos),
    (row, y) => {
      const mini = new Graphics();
      const x0 = 40;
      const y0 = y + ROW_H - 6;
      fillPixelRect(
        mini,
        x0,
        y0,
        MINI_GAUGE_W,
        MINI_GAUGE_H,
        MINI_GAUGE_H / 2,
        { color: darken(ACCENT_GOLD_DEEP, 0.6) },
      );
      // 우리 쪽 채움 — 왼쪽이 우리다 (전투 화면과 같은 방향)
      const r = miniGaugeRatio(result.gaugePos);
      fillPixelRect(
        mini,
        x0,
        y0,
        MINI_GAUGE_W * r,
        MINI_GAUGE_H,
        MINI_GAUGE_H / 2,
        { color: r >= 0.5 ? TEAM_OURS : TEAM_THEIRS },
      );
      // 임계선 두 개 — 마커가 선에 닿아 있으면 "선점해서 이겼다"가 읽힌다
      for (const t of miniThresholds()) {
        mini
          .rect(x0 + MINI_GAUGE_W * t - 1, y0 - 3, 2, MINI_GAUGE_H + 6)
          .fill({ color: 0xffffff, alpha: 0.75 });
      }
      strokePixelRect(
        mini,
        x0,
        y0,
        MINI_GAUGE_W,
        MINI_GAUGE_H,
        MINI_GAUGE_H / 2,
        { color: UI_OUTLINE, width: 3, alignment: 1 },
      );
      row.addChild(mini);
    },
  );
  // 구분선 + 상대
  const divider = new Graphics();
  divider
    .rect(0, rowY(3) - 12, panel.innerW, 2)
    .fill({ color: darken(panel.textColor, 0.1), alpha: 0.3 });
  panel.content.addChild(divider);
  makeRow(
    3,
    (g, cx, cy) => {
      // 머리 + 어깨. 이 크기(지름 12px)에서 원·타원은 전부 번짐이라 블록이다
      fillPixelRect(g, cx - 6, cy - 10, 12, 12, ART_PX, { color: TEAM_THEIRS });
      fillPixelRect(g, cx - 9, cy + 2, 18, 12, ART_PX, {
        color: darken(TEAM_THEIRS, 0.2),
      });
    },
    "상대",
    () => opponentLabel(match.slots),
  );

  // ── 버튼
  const rematch: Button = createButton({
    label: "다시 대전",
    state: "ready",
    w: DESIGN_W * 0.7,
    h: 96,
    onTap: () => {
      if (!live) return;
      opts.onRematch();
    },
  });
  rematch.view.position.set((DESIGN_W - rematch.width) / 2, DESIGN_H * 0.72);
  rematch.view.alpha = 0;
  content.addChild(rematch.view);

  const toTitle: Button = createButton({
    label: "타이틀로",
    state: "neutral",
    w: DESIGN_W * 0.7,
    h: 76,
    onTap: () => {
      if (!live) return;
      opts.onTitle();
    },
  });
  toTitle.view.position.set((DESIGN_W - toTitle.width) / 2, DESIGN_H * 0.825);
  toTitle.view.alpha = 0;
  content.addChild(toTitle.view);

  /** AI 대전이었다는 사실이 "이 게임은 AI랑 하는 게임"으로 굳지 않게 (§08-5-1) */
  const hint: Pill = createPill({
    w: DESIGN_W * 0.72,
    text: rematchHint(match.slots),
  });
  hint.view.position.set(DESIGN_W * 0.14, DESIGN_H * 0.91);
  hint.view.alpha = 0;
  content.addChild(hint.view);

  const flash = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0xffffff });
  flash.alpha = 0;
  flash.eventMode = "none";
  view.addChild(flash);

  /**
   * 승리 삽화 오버레이 (§08-8). 이긴 판에만, 몰수 승리는 제외한다 —
   * 게이트는 파티클과 **같은 소스**다(`showsVictory(text.celebrate, …)`).
   *
   * 플래시보다 **뒤에** 붙는다: 결과 확정의 흰 플래시(140ms)는 "여기서부터
   * 다른 화면"의 경계이므로 오버레이가 그걸 가리면 승패가 확정된 순간이
   * 사라진다. 오버레이는 120ms부터 올라오므로 두 연출이 40ms 겹친다.
   */
  const victory: ShowcaseOverlay | null = showsVictory(
    text.celebrate,
    result.winner,
  )
    ? createShowcaseOverlay({
        word: "VICTORY",
        sub: "게이지를 밀어냈다",
        variant: V_ART_VARIANT,
        // 삽화는 아직 없다 — 아래에서 받아 `setPortraits`로 세운다.
        // 기다리면 결과 화면 전체가 435px PNG 도착까지 늦어진다
        portraits: null,
        slug: opts.mySlug,
        ...(opts.reward
          ? {
              card:
                opts.reward.kind === "card"
                  ? // 이름은 `cards.json`이 정한다 — 아직 안 왔다(`setCard`).
                    // 캡션은 등급을 말한다(`rewardCaption`): 매니페스트를 안
                    // 기다려도 되는 값이라 첫 프레임부터 뜬다
                    { title: "", caption: rewardCaption(opts.reward) }
                  : {
                      title: `${heroDisplayName(opts.mySlug)} 카드를 다 모았다`,
                      caption: "수집 완료",
                    },
            }
          : {}),
        onDone: () => {
          // 여기서 버튼을 켜지 않는다. `live`는 매 프레임 `victory.live`를
          // 보므로(아래 `update`) 이 콜백이 늦거나 안 와도 잠금이 풀린다 —
          // 콜백으로 켜면 그게 유일한 경로가 되어, 오버레이가 예외로 죽으면
          // 결과 화면이 영구히 잠긴다.
        },
      })
    : null;
  if (victory) view.addChild(victory.view);

  let elapsedMs = 0;
  let live = false;
  let stamped = false;
  /** 축하 포즈 회차 — 마지막으로 요청한 값 */
  let celebrateTurn = -1;
  const started = new Set<number>();
  /**
   * 씬이 파괴됐다. 늦게 도착한 삽화를 이미 없는 오버레이에 붙이지 않기 위한
   * 표시다 — 재대전을 빠르게 누르면 승리 삽화(435px)가 그 뒤에 도착한다.
   */
  let disposed = false;

  return {
    view,
    enter(): void {
      // 몰수 승리는 약하게 울린다 — 유저가 잘한 게 없다 (§08-7)
      if (result.winner === 0) {
        playSfx("win", result.reason === "forfeit" ? 0.6 : 1);
      } else if (result.winner === 1) {
        playSfx("lose");
      }

      if (victory === null) return;
      /**
       * 승리 삽화를 받는다. **결과 화면을 막지 않는다** — `await`하면 딤·스탬프·
       * 패널이 PNG 도착까지 안 뜬다. 늦게 오면 오버레이가 워드마크만 띄우고,
       * 아주 늦으면(걷힌 뒤) `setPortraits`가 스스로 무시한다.
       *
       * **판정된 variant 하나만 받는다** (`V_ART_VARIANT` = `win`). 셋 다 받으면
       * 16.4MB 중 11MB가 끝까지 안 쓰인다(`portraits.ts` 주석).
       * 슬러그도 내 것 하나다 — 7종을 받을 이유가 없다.
       */
      void loadPortraits([V_ART_VARIANT], [opts.mySlug]).then((set) => {
        if (disposed) return;
        victory.setPortraits(set);
      });

      // 카드 그림·이름. 딴 카드일 때만 — "수집 완료"는 그림이 없다
      const reward = opts.reward;
      if (reward?.kind !== "card") return;
      void loadCardManifest().then(async (manifest) => {
        if (disposed) return;
        const row = findCard(manifest, reward.id);
        if (!row) {
          // 저장은 이미 됐다(`main`이 한다) — 카드함에서는 보인다. 여기서만
          // 그림이 빠지고 "새 카드 획득!"은 그대로 뜬다
          console.warn(`[pvp] 획득 카드 ${reward.id}가 cards.json에 없다`);
          return;
        }
        // 딴 카드니까 `thumb`이다 — 실루엣을 쓰면 방금 딴 카드를 못 본다
        const arts = await loadCardArt([{ row, kind: "thumb" }]);
        if (disposed) return;
        victory.setCard(arts.get(row.id) ?? null, row.title);
      });
    },
    exit(): void {
      // 재대전은 같은 `battleRoot`를 다시 쓴다 — 필터·오프셋이 남으면
      // 다음 판이 흑백으로, 12px 내려간 채로 시작한다
      applyFieldFilter(false);
      field.y = fieldY0;
    },
    update(dtMs: number): void {
      elapsedMs += dtMs;
      rematch.update(dtMs);
      toTitle.update(dtMs);
      hint.update(dtMs);
      for (const row of rows) row.update(dtMs);

      flash.alpha = finishFlash(elapsedMs);

      // 딤·채도·하강이 한 시계로 움직인다 (§08-1)
      scrim.alpha = scrimAlpha(elapsedMs);
      const sat = fieldSaturate(elapsedMs, lost);
      if (sat < 1) {
        applyFieldFilter(true);
        desat.saturate(saturateDelta(sat), false);
      }
      // 패배는 전장이 미세하게 내려앉는다 — 무게가 실린다 (§08-1)
      field.y = fieldY0 + cameraDrop(elapsedMs, lost);

      // 승리 축하 포즈 반복 (§08-1). 파티클과 같은 조건이다 — 몰수 승리는 없다
      if (text.celebrate && opts.celebrate) {
        const turn = Math.floor(elapsedMs / CELEBRATE_PERIOD_MS);
        if (turn > celebrateTurn) {
          celebrateTurn = turn;
          opts.celebrate(turn);
        }
      }

      const scale = stampScale(elapsedMs);
      stamp.scale.set(scale);
      if (!stamped && scale > 0) {
        stamped = true;
        playSfx("gauge_danger", 0.5);
      }
      content.x = stampShake(elapsedMs);
      subtitle.alpha = scale >= 1 ? 1 : Math.max(0, scale - 0.6) * 2.5;
      if (notice) notice.alpha = subtitle.alpha;

      panelHolder.scale.set(panelScale(elapsedMs));

      for (const [i, row] of rows.entries()) {
        if (started.has(i) || elapsedMs < row.atMs) continue;
        started.add(i);
        row.start();
      }

      // 오버레이는 결과 화면과 **같은 시계**로 돈다 — 자기 dt를 따로 세면
      // 프레임을 건너뛴 뒤 두 연출의 마디가 어긋난다
      victory?.update(dtMs);

      const ba = buttonAlpha(elapsedMs);
      rematch.view.alpha = ba;
      toTitle.view.alpha = ba;
      hint.view.alpha = ba;
      /**
       * 오버레이가 화면에 있으면 결과 버튼은 잠긴다. 딤이 탭을 삼키긴 하지만
       * (`victoryOverlay`의 `dim`) 그건 **그리는 쪽**의 방어다 — 여기서도 막아야
       * 오버레이의 히트 영역이 어긋나도 안 보이는 버튼이 눌리지 않는다.
       */
      live = buttonsLive(elapsedMs) && !(victory?.live ?? false);

      if (particles.visible) {
        particles.clear();
        for (let i = 0; i < PARTICLE_COUNT; i += 1) {
          const t = particleT(elapsedMs, i);
          const x = particleX(i) * DESIGN_W;
          const y = DESIGN_H * (1 - t);
          // 위로 갈수록 흐려진다 — 끝에서 툭 끊기면 사라지는 게 눈에 걸린다
          // 반짝이는 한 칸~세 칸 사각이다 — 반지름 3px 원은 회색 점이 된다
          const d = ART_PX * (1 + (i % 3));
          particles
            .rect(x - d / 2, y - d / 2, d, d)
            .fill({ color: ACCENT_GOLD, alpha: (1 - t) * 0.7 });
        }
      }
    },
    destroy(): void {
      // `exit()`가 먼저 불리지만, 관리자가 exit 없이 파괴하는 경로(앱 종료)가
      // 생겨도 필터가 남지 않게 여기서도 되돌린다
      applyFieldFilter(false);
      field.y = fieldY0;
      // 늦게 도착하는 삽화·카드가 파괴된 컨테이너에 붙지 않게 먼저 세운다
      disposed = true;
      victory?.destroy();
      rematch.destroy();
      toTitle.destroy();
      hint.destroy();
      panel.destroy();
      for (const row of rows) row.destroy();
      view.destroy({ children: true });
    },
  };
}

/** 패널 헤더 높이를 외부에서 확인할 수 있게 남긴다 (레이아웃 회귀 검증용) */
export { HEADER_H };
