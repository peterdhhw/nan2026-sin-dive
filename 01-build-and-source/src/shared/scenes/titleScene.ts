import { Container } from "pixi.js";
import type { Scene, SceneCtx } from "../sceneManager";
import { DESIGN_H, DESIGN_W } from "../viewport";
import {
  STATE_OFF,
  STATE_OK,
  T_LABEL,
  UI_CARD,
  UI_TEXT_DIM,
} from "../theme";
import { darken } from "../color";
import { floatOffset } from "../tween";
import { createButton, type Button } from "../ui/button";
import { createPill, type Pill } from "../ui/pill";
import { createHintFinger, createToast, type HintFinger } from "../ui/hint";
import { createHeroChar, type SpriteChar } from "../spriteChar";
import { createUiBackdrop } from "../uiBackdrop";
import { serverStatusText } from "../screenText";
import { startBgm, unlockAudio } from "../audio";
import type { Loadout } from "../../loadout/types";
import { caption, createLogo, dimLayer, sceneText } from "./common";
import {
  PREVIEW_ATTACK_PERIOD_MS,
  PREVIEW_H_RATIO,
  PREVIEW_PHASE_OFFSET_MS,
  STATUS_PILL_W_RATIO,
  STATUS_PILL_X_RATIO,
  STATUS_PILL_Y_RATIO,
  TITLE_BOX_ENTRY_H,
  TITLE_BOX_ENTRY_W,
  TITLE_MODE_SUMMARY,
  TITLE_MODE_SUMMARY_SINGLE,
  TITLE_PREVIEW_COUNT,
  lastResultBadge,
  logoIntroAlpha,
  logoIntroScale,
  matchButtonLabel,
  matchLockedNotice,
  previewAttacker,
  previewFacing,
  previewXRatio,
  pvpUnlocked,
  showsIdleHint,
  startButtonLabel,
  titleArmed,
  titleBoxEntryPos,
  titleBoxEntryTapRoom,
} from "./titleRules";
import { cardBoxLabel } from "./cardRules";
import { createCardBoxOverlay, type CardBoxOverlay } from "./cardBoxOverlay";
import { loadCardManifest } from "../cards";
import type { CardManifest } from "../cardManifest";
import { snapPx } from "../ui/shapeRules";

// 순수 규칙은 titleRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  PVP_UNLOCK_FLOOR,
  TITLE_ARM_MS,
  TITLE_IDLE_HINT_MS,
  TITLE_MODE_SUMMARY,
  TITLE_PREVIEW_COUNT,
  lastResultBadge,
  logoIntroAlpha,
  logoIntroScale,
  matchButtonLabel,
  matchLockedNotice,
  previewAttacker,
  previewFacing,
  previewXRatio,
  pvpUnlocked,
  showsIdleHint,
  startButtonLabel,
  titleArmed,
} from "./titleRules";

/**
 * S1. 타이틀 — **선택적 씬**.
 *
 * 설계 문서: specs/2026-07-27-ux/04-scene-title.md
 *
 * **첫 진입 경로가 아니다** (§05-0). 도달 경로는 결과 화면 `[타이틀로]`와
 * `?scene=title` 둘뿐이다. 설정·크레딧의 입구 역할 때문에 폐기하지 않는다.
 *
 * 설정 팝업(§04-6)은 9단계 몫이다 — 지금은 연결 상태만 상태 필로 보여준다.
 */

export interface TitleSceneOpts {
  ctx: SceneCtx;
  loadout: Loadout;
  /** AppSync 설정이 살아 있는가 — 주 버튼 라벨이 갈린다 (§04-5) */
  online: boolean;
  /** 직전 대전 결과. 재진입 배지·연출 생략 판단에 쓴다 (§04-7) */
  lastWinner?: 0 | 1 | null;
  /** 사람을 찾는 대전 (S2 매칭으로) */
  onStart(): void;
  /**
   * 싱글(하강 모드) 진입. **옵셔널이다** — 없으면 버튼도 없고 기존 PvP 전용
   * 레이아웃이 그대로 컴파일된다 (SINGLE-BRIEF §5-2).
   */
  onSingle?(): void;
  /**
   * 싱글에서 도달한 최고 층. **대전이 이 값으로 잠긴다**
   * (`pvpUnlocked`, 100층).
   *
   * 왜 여기로 받는가: 이 씬은 `shared/`라서 `single/`을 import할 수 없다
   * (경계 규칙, CI가 검사한다). 저장소를 읽는 것은 배선층(`main.ts`)의 일이고
   * 씬은 **결과 숫자만** 받는다.
   *
   * 생략하면 0으로 본다 — 잠긴 쪽이 기본이다. 옵셔널을 "열림"으로 두면
   * 이 값을 넘기는 것을 잊은 호출자에서 잠금이 조용히 사라진다.
   */
  singleFloor?: number;
  /**
   * 지금까지 모은 카드 id — 우상단 카드함 입구의 `12/35`와 격자의 실루엣 여부.
   *
   * **옵셔널이다.** 없으면 입구 버튼이 아예 안 생긴다 — 빈 카드함을 보여
   * 주는 것보다 없는 것이 낫다(0/35는 "내 진행이 날아갔나"로 읽힌다).
   * 대기 화면(S2)과 같은 값을 받는다(`matchScene`의 `owned`).
   *
   * 씬이 저장소를 직접 읽지 않는 이유는 `singleFloor`와 같다: 카드함은
   * `abyss.cards.owned`에 있고 저장 키를 아는 것은 배선층(`main.ts`)이다.
   */
  owned?: ReadonlySet<string>;
}

export async function createTitleScene(opts: TitleSceneOpts): Promise<Scene> {
  const { ctx, loadout } = opts;
  const view = new Container();
  view.label = "title";

  /**
   * ## 배경을 전용 키 아트로 바꿨다 (2026-08-09)
   *
   * 여태 배경은 S4와 같은 무대였다(§04-2). 그 무대는 전투용 무한 스크롤 띠라
   * 정지한 타이틀에서는 삽화 타일의 이음새와 공중의 가산합성 균열이 그대로
   * 보였고, 그 위에 코드로 그린 지면 사각형이 66%에 얹혀 있었다 — 유저 지시:
   * "타이틀도 마찬가지있고" (덜 만든 것처럼 느껴진다).
   *
   * 직전 대전의 테마를 물려받아 "계속 내려가고 있다"를 만든다는 §04-7의 근거는
   * 여기서 접는다. **그 연속감은 배경 한 장으로 산 것보다 비쌌다** — 대전을
   * 거치지 않은 첫 진입(대부분이다)에서는 어차피 지상 테마 한 종류였고,
   * 그 화면이 미완성으로 읽히는 손해가 컸다. 테마 연속감은 하강 화면(S5)이
   * 층마다 이어 간다.
   */
  ctx.manager.showBackground(false);
  const backdrop = await createUiBackdrop("title");
  view.addChild(backdrop.view);
  /**
   * 딤은 **얇게** 얹는다(0.42 → 0.22). 예전 값은 필드 삽화의 잡음을 눌러
   * 위젯을 읽히게 하려는 것이었는데, 키 아트는 가운데를 비우도록 프롬프트로
   * 요구해 뽑았으므로(생성기 docstring) 그만큼 덮을 이유가 없다 — 덮으면
   * 배경을 새로 뽑은 의미가 사라진다. 0으로 두지 않는 이유는 하늘 띠(로고가
   * 앉는 22%)가 그림에서 가장 밝은 곳이기 때문이다.
   */
  view.addChild(dimLayer(DESIGN_W, DESIGN_H, 0.22));

  /** 재진입이면 진입 연출을 생략한다 (§04-7) */
  const replay = opts.lastWinner !== undefined;

  const logo = createLogo(1);
  const logoY = DESIGN_H * 0.22;
  logo.position.set(DESIGN_W / 2, logoY);
  logo.alpha = 0;
  view.addChild(logo);

  const tagline = sceneText("심연으로 내려가라", T_LABEL, UI_TEXT_DIM);
  tagline.position.set(DESIGN_W / 2, DESIGN_H * 0.3);
  view.addChild(tagline);

  /**
   * ── 캐릭터가 서는 선.
   *
   * **그림의 지평선을 쓴다.** 예전에는 여기에 사각형 두 개로 지면 밴드를 직접
   * 그렸는데(어두운 흙 + 4px 립), 그림 위에 코드가 그린 띠가 겹치면 그 경계가
   * 화면을 가로지르는 실선으로 남는다 — 배경과 지면이 서로 다른 그림에서 온
   * 것으로 읽히는 자리였다.
   *
   * 그림이 없으면(매니페스트 실패) 옛 자리인 66%로 간다 — `groundRatio`도
   * 0.66이라 두 경로가 같은 화면을 만든다. 그 상수는 저 그림이 지평선을
   * 어디에 그렸는가이므로 매니페스트가 진실이고, 여기 값은 폴백이다.
   */
  const groundY = backdrop.groundY ?? DESIGN_H * 0.66;

  // ── 캐릭터 프리뷰. 인원은 `TITLE_PREVIEW_COUNT`가 정한다 — 지금 1명이고,
  // 그 이유가 그 상수 주석에 있다(주 버튼이 싱글 1인이다)
  const previewChars = loadout.characters.slice(0, TITLE_PREVIEW_COUNT);
  const chars: SpriteChar[] = [];
  const namePills: Pill[] = [];
  const stage = new Container();
  view.addChild(stage);
  for (const [i, c] of previewChars.entries()) {
    const cell = new Container();
    const sc = await createHeroChar(c.charSlug, DESIGN_H * PREVIEW_H_RATIO);
    sc.setFacing(previewFacing(i, previewChars.length));
    // 위상을 어긋내 두 명이 같은 프레임에 있지 않게 한다 (§04-4)
    sc.update(i * PREVIEW_PHASE_OFFSET_MS);
    cell.addChild(sc.view);
    chars.push(sc);

    const pill = createPill({
      w: 150,
      h: 44,
      text: c.displayName,
      // 밝은 톤은 필 배경으로 쓰면 글자가 안 보인다 (§04-4)
      bg: c.tintHex === 0xffffff ? UI_CARD : darken(c.tintHex, 0.35),
    });
    pill.view.position.set(-75, 24);
    cell.addChild(pill.view);
    namePills.push(pill);

    cell.position.set(
      DESIGN_W * previewXRatio(i, previewChars.length),
      groundY,
    );
    // 탭하면 공격 1회 — 정보는 없지만 "만져지는" 느낌을 준다 (§04-4)
    cell.eventMode = "static";
    cell.cursor = "pointer";
    cell.hitArea = {
      contains: (x, y) =>
        x >= -70 && x <= 70 && y >= -DESIGN_H * PREVIEW_H_RATIO && y <= 40,
    };
    cell.on("pointertap", () => {
      unlockAudio();
      idleMs = 0;
      sc.playOnce("attack", "idle");
    });
    stage.addChild(cell);
  }

  /**
   * 잠긴 대전을 눌렀을 때의 안내. 버튼보다 먼저 **만든다** — `onLocked` 콜백이
   * 이것을 참조하므로 선언이 앞이어야 한다.
   *
   * **`addChild`는 버튼 뒤로 미룬다.** Pixi의 그리는 순서는 만든 순서가 아니라
   * `addChild` 순서다 — 여기서 같이 붙이면 안내문이 버튼 **뒤에** 깔려서
   * 하강 버튼이 글자 가운데를 가린다(캡처로 확인).
   */
  const toast = createToast({ cx: DESIGN_W / 2, cy: DESIGN_H * 0.68 });

  // ── 버튼. 싱글 진입(onSingle)이 있으면 [심연 하강]이 주 버튼이 되고 대전은
  // 그 아래 작은 버튼으로 내려간다 — 싱글이 대전의 입구이기 때문이다(잠금)
  const hasSingle = opts.onSingle !== undefined;
  /** 주 버튼(맨 위)의 y 비율 — 무입력 힌트가 이 버튼을 가리킨다 */
  const primaryY = hasSingle ? 0.72 : 0.74;

  let single: Button | null = null;
  if (hasSingle) {
    single = createButton({
      label: "심연 하강",
      sublabel: "싱글 · 9,999층",
      state: "ready",
      w: DESIGN_W * 0.62,
      h: 96,
      onTap: () => {
        if (!armed) return;
        unlockAudio();
        hint.dismiss();
        opts.onSingle?.();
      },
    });
    single.view.position.set((DESIGN_W - single.width) / 2, DESIGN_H * primaryY);
    view.addChild(single.view);
  }

  /**
   * 대전은 **싱글 100층에 잠겨 있다** (`pvpUnlocked`).
   *
   * 대전은 내가 싱글에서 키운 캐릭터로 싸우므로(2단계) 1층 캐릭터로 들어가면
   * 무엇을 눌러도 진다. 잠금 상태는 `disabled` — 탭하면 흔들리고 이유가
   * 토스트로 나온다(`matchLockedNotice`). 라벨에도 조건을 적는다.
   */
  const floor = Number.isFinite(opts.singleFloor) ? (opts.singleFloor as number) : 0;
  const unlocked = pvpUnlocked(floor);
  const start: Button = createButton({
    label: unlocked ? startButtonLabel(opts.online) : matchButtonLabel(floor),
    sublabel: lastResultBadge(opts.lastWinner) ?? undefined,
    // 싱글이 주 버튼(초록)일 때 대전은 파랑으로 갈라 위계를 만든다
    state: !unlocked ? "disabled" : hasSingle ? "confirm" : "ready",
    w: DESIGN_W * (hasSingle ? 0.52 : 0.62),
    h: hasSingle ? 76 : 96,
    onTap: () => {
      if (!armed) return;
      unlockAudio();
      hint.dismiss();
      opts.onStart();
    },
    // 왜 안 되는지는 버튼 밖에서 말한다 — 흔들림만으로는 조건을 알 수 없다
    onLocked: () => {
      toast.show(matchLockedNotice(floor));
    },
  });
  start.view.position.set(
    (DESIGN_W - start.width) / 2,
    DESIGN_H * (hasSingle ? 0.815 : 0.74),
  );
  view.addChild(start.view);
  // 안내문은 버튼 위에 얹힌다 (선언은 위, 그리는 순서는 여기)
  view.addChild(toast.view);

  const summary = caption(
    `ⓘ ${hasSingle ? TITLE_MODE_SUMMARY_SINGLE : TITLE_MODE_SUMMARY}`,
  );
  summary.position.set(DESIGN_W / 2, DESIGN_H * 0.93);
  view.addChild(summary);

  /**
   * 연결 상태. 설정 팝업(§04-6)이 오기 전까지 여기가 유일한 표기다 —
   * 키가 만료되면(2026-08-25) 유저가 이유도 모르고 AI만 만난다.
   */
  const status: Pill = createPill({
    w: DESIGN_W * STATUS_PILL_W_RATIO,
    iconColor: opts.online ? STATE_OK : STATE_OFF,
    text: serverStatusText(opts.online, opts.online ? 1 : 0),
  });
  status.view.position.set(
    DESIGN_W * STATUS_PILL_X_RATIO,
    DESIGN_H * STATUS_PILL_Y_RATIO,
  );
  view.addChild(status.view);

  /**
   * 카드함 입구 — 우상단 (§10-3). 자리 근거는 `titleBoxEntryPos`에 있다.
   *
   * 유저 지시: "맨 처음 화면에서도 카드함 있어서 바로 카드 볼 수 있으면 좋겠어."
   *
   * **`owned`를 안 넘긴 호출자에게는 안 생긴다.** 옵셔널을 "빈 카드함"으로
   * 두면 배선을 잊은 화면에서 `0/35`가 뜨는데, 그건 진행이 날아간 것으로 읽힌다.
   *
   * 대기 화면(S2)의 입구와 **같은 라벨 함수**를 쓴다(`cardBoxLabel`) — 두 곳이
   * 각자 문구를 만들면 한쪽만 `12/35`고 다른 쪽은 `12장`이 된다.
   */
  const owned = opts.owned;
  let boxEntry: Button | null = null;
  let cardBox: CardBoxOverlay | null = null;
  /**
   * `cards.json`. **결판나기 전에는 버튼이 잠긴다** — 오버레이는 처음 열 때
   * 한 번 만들어지고 그때의 매니페스트를 들고 있으므로, 도착 전에 열면 이
   * 씬에서는 격자가 영구히 빈다(`matchScene`의 같은 배선과 같은 근거).
   *
   * 실패(`null`)도 결판이다 — 그때는 열려서 "못 받았다"고 말해야 한다.
   */
  let cardManifest: CardManifest | null = null;
  let cardManifestSettled = false;

  const openCardBox = (): void => {
    if (owned === undefined || !cardManifestSettled) return;
    unlockAudio();
    idleMs = 0;
    if (cardBox === null) {
      cardBox = createCardBoxOverlay({
        manifest: cardManifest,
        owned,
        onClose: () => {},
      });
      // 오버레이는 **맨 위**다 — 버튼·힌트보다 늦게 붙어야 그 위에 깔린다
      view.addChild(cardBox.view);
    }
    cardBox.show();
  };

  if (owned !== undefined) {
    boxEntry = createButton({
      label: cardBoxLabel(owned),
      // 매니페스트가 오기 전에는 `disabled` — 탭하면 흔들려서 "지금은 안 된다"고
      // 답한다(§C2). 무반응이면 버그로 읽힌다
      state: "disabled",
      w: TITLE_BOX_ENTRY_W,
      h: TITLE_BOX_ENTRY_H,
      // 아래는 연결 상태 필이다 — 관용을 그쪽으로 주면 필을 만졌다가 카드함이 열린다
      tapRoom: titleBoxEntryTapRoom(DESIGN_H),
      onTap: () => openCardBox(),
    });
    const p = titleBoxEntryPos(DESIGN_W);
    boxEntry.view.position.set(snapPx(p.x), snapPx(p.y));
    view.addChild(boxEntry.view);
  }

  /** 30초 무입력이면 주 버튼 위에 손가락 (§04-5) */
  const hint: HintFinger = createHintFinger({ store: null });
  view.addChild(hint.view);

  let elapsedMs = 0;
  let idleMs = 0;
  let armed = false;
  let attackTurn = 0;
  /** 씬 진입 시각 기반 시드 — 공격 추첨을 결정론으로 유지한다 (§04-4) */
  const seed = ctx.debug.scene === "title" ? 1 : loadout.characters.length;

  const bumpIdle = (): void => {
    idleMs = 0;
  };
  view.eventMode = "static";
  view.on("pointerdown", bumpIdle);

  return {
    view,
    enter(): void {
      // **첫 접속은 여전히 무음이다** — 브라우저 자동재생 정책상 `unlockAudio()`
      // 전에는 어떤 소리도 안 난다(설계 §4-1). 여기서 켜 두면 첫 탭(모드 버튼)에서
      // `unlockAudio`가 컨텍스트를 만들고 그때 `tryPlayBgm`이 이어 받는다 —
      // 그 배선이 이미 있다(`unlockAudio`의 마지막 줄).
      startBgm("title");

      /**
       * 카드 **매니페스트만** 받는다 (7KB). 그림 105장(0.5MB)은 카드함을 열 때
       * 받는다 — 첫 화면에서 대부분 안 열린다.
       *
       * `enter`에서 받는 이유: 씬 팩토리는 `await`되므로 여기서 기다리면 타이틀이
       * 그만큼 늦게 뜬다. 버튼은 도착할 때까지 `disabled`다.
       */
      if (owned !== undefined) {
        void loadCardManifest().then((manifest) => {
          cardManifest = manifest;
          cardManifestSettled = true;
          boxEntry?.setState("neutral");
        });
      }
    },
    exit(): void {},
    update(dtMs: number): void {
      elapsedMs += dtMs;
      idleMs += dtMs;
      single?.update(dtMs);
      start.update(dtMs);
      toast.update(dtMs);
      status.update(dtMs);
      boxEntry?.update(dtMs);
      // 열려 있을 때만 도는 것은 오버레이가 스스로 판단한다
      cardBox?.update(dtMs);
      hint.update(dtMs);
      for (const p of namePills) p.update(dtMs);
      for (const c of chars) c.update(dtMs);

      logo.alpha = replay
        ? Math.min(1, elapsedMs / 260)
        : logoIntroAlpha(elapsedMs);
      logo.scale.set(logoIntroScale(elapsedMs, replay));
      logo.y = logoY + floatOffset(elapsedMs, 5, 3400);

      armed = titleArmed(elapsedMs);

      // 8초마다 한 명이 공격 1회 (§04-4)
      const turn = Math.floor(elapsedMs / PREVIEW_ATTACK_PERIOD_MS);
      if (turn > attackTurn) {
        attackTurn = turn;
        const who = previewAttacker(turn, seed, chars.length);
        chars[who]?.playOnce("attack", "idle");
      }

      if (showsIdleHint(idleMs) && !hint.active) {
        hint.showAt(DESIGN_W / 2, DESIGN_H * primaryY + 48);
      }
    },
    destroy(): void {
      view.off("pointerdown", bumpIdle);
      single?.destroy();
      start.destroy();
      toast.destroy();
      status.destroy();
      boxEntry?.destroy();
      cardBox?.destroy();
      hint.destroy();
      for (const p of namePills) p.destroy();
      for (const c of chars) c.destroy();
      view.destroy({ children: true });
    },
  };
}
