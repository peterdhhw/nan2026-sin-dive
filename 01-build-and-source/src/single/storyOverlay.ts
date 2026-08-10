/**
 * 스토리 오버레이 — 프롤로그(페이지 넘김), 심연의 선택(2버튼), 엔딩(1버튼).
 * 문구·분기는 `storyRules.ts`가 정본이다. 열려 있는 동안 세션은 멈춘다
 * (일시정지는 세션 몫 — 이 위젯은 모달 표시와 콜백만 담당한다).
 */

import { Container, Text } from "pixi.js";
import {
  ACCENT_GOLD,
  ACCENT_MAGENTA,
  T_BODY,
  T_CAPTION,
  T_TITLE,
  UI_TEXT_DIM,
} from "../shared/theme";
import { DESIGN_W, DESIGN_H } from "../shared/viewport";
import { createButton, type Button } from "../shared/ui/button";
import { createPanel, type Panel } from "../shared/ui/panel";
import { createScrim, type Scrim } from "../shared/ui/scrim";
import { sceneText } from "../shared/scenes/common";
import {
  STORY_BUTTON_H,
  STORY_PANEL_W,
  STORY_PANEL_X,
  storyBottomH,
  storyButtonSlots,
  storyButtonY,
  storyPageMarkY,
  storyPanelH,
  storyPanelY,
  storyStackY,
} from "./storyPanelRules";

export interface ChoiceOpts {
  title: string;
  body: string;
  /** 첫 제안에만 붙는 튜토리얼 한 줄 */
  hint?: string;
  acceptLabel: string;
  refuseLabel: string;
  onAccept(): void;
  onRefuse(): void;
}

export interface StoryOverlay {
  view: Container;
  readonly open: boolean;
  /** 프롤로그 — 줄 단위 페이지. 마지막 장에서 [하강 시작]으로 닫힌다 */
  showPrologue(lines: readonly string[], onDone: () => void): void;
  showChoice(opts: ChoiceOpts): void;
  showEnding(title: string, body: string, onClose: () => void): void;
  update(dtMs: number): void;
  destroy(): void;
}

export function createStoryOverlay(): StoryOverlay {
  const view = new Container();
  view.label = "story-overlay";
  view.visible = false;

  // 스토리 모달은 딤 탭으로 닫히지 않는다 — 선택지가 있는 모달에서 배경 탭이
  // "거부"인지 "취소"인지 모호해지기 때문. 닫기는 항상 버튼이 한다.
  const scrim: Scrim = createScrim({ w: DESIGN_W, h: DESIGN_H });
  view.addChild(scrim.view);

  /** 현재 모달의 위젯들 — 닫을 때 통째로 파괴한다 */
  let modal: Container | null = null;
  let modalWidgets: Array<{ update(dtMs: number): void; destroy(): void }> = [];
  let open = false;

  const closeModal = (): void => {
    open = false;
    scrim.hide();
    if (modal) {
      for (const w of modalWidgets) w.destroy();
      modalWidgets = [];
      // Panel.destroy가 자식을 정리하므로 컨테이너만 마저 지운다
      modal.destroy({ children: true });
      modal = null;
    }
  };

  /**
   * 위에서 쌓은 글의 아래 끝(패널 내부 좌표). `addText`가 갱신한다.
   *
   * **재는 것이 줄 수가 아니다.** 프롤로그는 페이지를 넘기면 본문이 바뀌므로
   * (`body.text = …`) 줄 수로 어림하면 2줄짜리 높이에 3줄이 들어간다. 실제
   * 텍스트 높이를 재서 쌓는다.
   */
  let contentBottom = 0;

  /**
   * 모달을 짓는다 — **내용을 먼저 쌓고 그 높이로 패널을 만든다.**
   *
   * 순서가 닭과 달걀이다: 글은 패널 없이 못 그리는데(색·줄바꿈 폭이 패널에
   * 있다) 패널 높이는 글을 알아야 나온다. 그래서 두 단계로 나눈다 —
   *
   * 1. 상한 높이로 패널을 짓고 `content`로 글을 쌓아 `contentBottom`을 잰다.
   * 2. 그 값으로 높이를 확정해 `resize`하고, **그 다음에** 아래 블록(버튼·
   *    페이지 표시)을 놓는다.
   *
   * 순서를 안 지키면 버튼이 상한 높이 기준으로 앉아 패널 밖에 남는다 —
   * "모달을 열면 닫을 수 없다"다(스토리 모달은 딤 탭으로도 안 닫힌다).
   *
   * 두 단계 사이에 줄바꿈이 달라지지 않는 이유: `innerW`는 폭에서만 나오고
   * (`panel.innerW`) 폭은 안 바꾼다.
   */
  const openModal = (
    build: {
      /** 글을 쌓는다. `addText`가 `contentBottom`을 갱신한다 */
      content(panel: Panel): void;
      /** 아래 블록. 높이가 확정된 뒤에 불린다 */
      bottom(panel: Panel, innerH: number): void;
      /** 프롤로그의 `1 / 3` 줄이 있는가 — 아래 블록 높이가 달라진다 */
      pageMark?: boolean;
    },
  ): void => {
    closeModal();
    open = true;
    view.visible = true;
    scrim.show();
    modal = new Container();
    contentBottom = 0;

    const bottomH = storyBottomH(build.pageMark === true);
    const panel = createPanel({
      w: STORY_PANEL_W,
      h: storyPanelH(Number.MAX_SAFE_INTEGER, bottomH),
    });
    modal.addChild(panel.view);
    modalWidgets.push({ update: () => {}, destroy: () => panel.destroy() });

    build.content(panel);

    const h = storyPanelH(contentBottom, bottomH);
    panel.resize(STORY_PANEL_W, h);
    panel.view.position.set(STORY_PANEL_X, storyPanelY(h));

    build.bottom(panel, panel.innerH);

    view.addChild(modal);
  };

  /**
   * 글 한 블록을 **앞 블록 아래에** 쌓는다.
   *
   * y를 인자로 받지 않는다 — 받으면 호출부가 다시 숫자를 적고, 그게 고치기 전
   * 상태다(선택 모달의 힌트 `y=200`이 본문 2줄을 가정하고 있었다).
   */
  const addText = (
    panel: Panel,
    content: string,
    token = T_BODY,
    color?: number,
  ): Text => {
    const t = sceneText(content, token, color ?? panel.textColor, panel.innerW - 16);
    const y = storyStackY(contentBottom);
    t.anchor.set(0.5, 0);
    t.position.set(panel.innerW / 2, y);
    panel.content.addChild(t);
    contentBottom = y + t.height;
    return t;
  };

  const addButton = (
    panel: Panel,
    opts: { label: string; sublabel?: string; state?: "ready" | "neutral"; x: number; y: number; w: number },
    onTap: () => void,
  ): Button => {
    const btn = createButton({
      label: opts.label,
      ...(opts.sublabel !== undefined ? { sublabel: opts.sublabel } : {}),
      state: opts.state ?? "ready",
      w: opts.w,
      h: STORY_BUTTON_H,
      onTap,
    });
    btn.view.position.set(opts.x, opts.y);
    panel.content.addChild(btn.view);
    modalWidgets.push(btn);
    return btn;
  };

  return {
    view,
    get open(): boolean {
      return open;
    },

    showPrologue(lines: readonly string[], onDone: () => void): void {
      let page = 0;
      let body: Text | null = null;
      let pageMark: Text | null = null;
      openModal({
        pageMark: true,
        content(panel) {
          addText(panel, "프롤로그", T_CAPTION, UI_TEXT_DIM);
          /**
           * **가장 긴 장으로 높이를 잡는다.** 페이지를 넘기면 본문만 바뀌는데
           * (`body.text = …`) 패널은 한 번만 지어진다 — 1장으로 재면 더 긴
           * 장에서 본문이 버튼을 파고든다. 3장 중 가장 긴 것을 넣어 재고 곧
           * 1장으로 되돌린다(같은 `Text`라 줄바꿈 폭이 같다).
           */
          const longest = [...lines].sort((a, b) => b.length - a.length)[0] ?? "";
          body = addText(panel, longest, T_BODY);
          body.text = lines[0] ?? "";
        },
        bottom(panel, innerH) {
          pageMark = sceneText(
            `1 / ${lines.length}`,
            T_CAPTION,
            UI_TEXT_DIM,
            panel.innerW - 16,
          );
          pageMark.anchor.set(0.5, 0);
          pageMark.position.set(panel.innerW / 2, storyPageMarkY(innerH));
          panel.content.addChild(pageMark);

          const slot = storyButtonSlots(panel.innerW, 1, 240)[0] ?? { x: 0, w: panel.innerW };
          const nextBtn = addButton(
            panel,
            { label: "계속", x: slot.x, y: storyButtonY(innerH), w: slot.w },
            () => {
              page += 1;
              if (page >= lines.length) {
                closeModal();
                onDone();
                return;
              }
              if (body) body.text = lines[page] ?? "";
              if (pageMark) pageMark.text = `${page + 1} / ${lines.length}`;
              if (page === lines.length - 1) nextBtn.setLabel("하강 시작");
            },
          );
        },
      });
    },

    showChoice(opts: ChoiceOpts): void {
      openModal({
        content(panel) {
          addText(panel, opts.title, T_TITLE, ACCENT_MAGENTA);
          addText(panel, opts.body, T_BODY);
          if (opts.hint) addText(panel, opts.hint, T_CAPTION, UI_TEXT_DIM);
        },
        bottom(panel, innerH) {
          const y = storyButtonY(innerH);
          const slots = storyButtonSlots(panel.innerW, 2);
          const accept = slots[0];
          const refuse = slots[1];
          if (accept) {
            addButton(panel, { label: opts.acceptLabel, x: accept.x, y, w: accept.w }, () => {
              closeModal();
              opts.onAccept();
            });
          }
          if (refuse) {
            addButton(
              panel,
              { label: opts.refuseLabel, state: "neutral", x: refuse.x, y, w: refuse.w },
              () => {
                closeModal();
                opts.onRefuse();
              },
            );
          }
        },
      });
    },

    showEnding(title: string, body: string, onClose: () => void): void {
      openModal({
        content(panel) {
          addText(panel, title, T_TITLE, ACCENT_GOLD);
          addText(panel, body, T_BODY);
        },
        bottom(panel, innerH) {
          const slot = storyButtonSlots(panel.innerW, 1, 280)[0] ?? { x: 0, w: panel.innerW };
          addButton(
            panel,
            { label: "심연에 남는다", x: slot.x, y: storyButtonY(innerH), w: slot.w },
            () => {
              closeModal();
              onClose();
            },
          );
        },
      });
    },

    update(dtMs: number): void {
      scrim.update(dtMs);
      for (const w of modalWidgets) w.update(dtMs);
      // 스크림 페이드가 끝난 뒤에 통째로 숨긴다
      if (!open && view.visible && !scrim.visible) view.visible = false;
    },

    destroy(): void {
      closeModal();
      scrim.destroy();
      view.destroy({ children: true });
    },
  };
}
