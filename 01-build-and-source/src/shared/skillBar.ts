import { Container, Graphics } from "pixi.js";
import type { SkillDef } from "../core/types";
import type { CooldownTracker } from "../core/cooldown";
import type { SplitRect } from "./viewport";
import { playSfx } from "./audio";
import { cooldownSweep, pickAutoSkill } from "./skillRules";
import {
  AUTO_INTERVAL_MS,
  GOLD_LINE_H,
  autoBadgeD,
  autoLabel,
  barLayout,
  initialAutoFor,
  woodBands,
  type AutoScope,
} from "./skillBarRules";
// `autoScopeNotice`는 재export만 한다 (아래) — 문구를 쓰는 곳은 세션이다.
import { ACCENT_GOLD, STATE_OFF, STATE_OK, UI_OUTLINE } from "./theme";
import { ART_PX, SHAKE_MS, shakeOffset } from "./ui/shapeRules";
import { strokePixelCircle } from "./ui/pixelShape";
import {
  SLOT_DIAMETER_RATIO,
  createCircleButton,
  createSkillSlot,
  type CircleButton,
  type SkillSlot,
} from "./ui/skillSlot";

export { cooldownSweep, pickAutoSkill };
// 순수 규칙은 skillBarRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  AUTO_DEFAULT_ON,
  AUTO_INTERVAL_MS,
  autoBadgeD,
  autoLabel,
  autoScopeNotice,
  barLayout,
  initialAutoFor,
  woodBands,
  type AutoScope,
} from "./skillBarRules";

/**
 * 하단 스킬바 — 나무 스트립 + 스킬 슬롯(4~6칸). AUTO 배지는 **바 밖에 있다.**
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §7
 *
 * 로직(쿨다운·AUTO 시전)은 이전과 같다. 바뀐 것 둘:
 * - **쿨다운 완료 피드백**이 슬롯 위젯으로 옮겨가 시각(플래시+펄스+초록 링)과
 *   청각(`cooldown_ready`, 세션이 울린다)이 같은 프레임에 온다.
 * - **AUTO 배지가 바를 떠났다** (3단계). 바 안 왼쪽 구역을 슬롯에 돌려주지
 *   않으면 6번째 칸이 안 들어간다 — 자리는 모드가 주고(`autoBadgeAt`) 배지는
 *   `autoView`라는 별도 뷰로 나온다. 지름만 바가 정한다(`autoBadgeD`).
 */

export interface SkillBarOpts {
  skills: readonly SkillDef[];
  rect: SplitRect;
  cooldowns: CooldownTracker;
  /**
   * 실제 시전은 세션이 처리한다 — 바는 입력만 알린다.
   *
   * **`boolean`을 돌려주는 이유** (2026-08-10, 유저 신고 "스킬 눌러도 동작안하고").
   * 세션은 바가 모르는 이유로 시전을 거부한다: 실명, 그리고 모션 게이트
   * (`castGateRules` — 방금 지른 타격의 임팩트를 다음 입력이 지우지 않게 막는다).
   * 거부를 알리지 않으면 바는 `ui_tap`을 울리고 아무 일도 일어나지 않는다 —
   * 캡처 A/B에서 빠른 두 번 탭의 4번이 그렇게 조용히 사라졌다.
   *
   * 판정은 세션만 할 수 있고(게이트를 세션이 쥔다) 반응은 바만 할 수 있다
   * (슬롯 위젯이 바의 것이다). 그래서 값 하나를 돌려받아 잇는다.
   *
   * `true` = 시전됐다. `false` = 거부됐다(쿨은 소모되지 않았다).
   */
  onCast(skill: SkillDef, nowMs: number): boolean;
  /**
   * AUTO 배지 중심의 **디자인 좌표**. 모드별 규칙이 정한다
   * (`single/diveHudRules.autoBadgePos` · `pvp/autoBadgeRules.autoBadgePos`).
   *
   * **왜 인자로 받는가** (3단계): 배지가 바 밖으로 나갔다. 바 안 왼쪽 구역
   * (101px)을 슬롯에 돌려주지 않으면 6번째 칸의 폭이 92.5px로 떨어져 라벨이
   * 옆 칸과 이어 붙었다(`skillBarRules.barLayout` 주석). 나간 뒤의 자리는 바가
   * 알 수 없다 — 이웃이 무엇인지는 모드마다 다르다.
   *
   * 지름은 여전히 바가 정한다(`autoBadgeD(rect.h)`) — "슬롯보다 작은 보조
   * 위젯"이라는 관계는 바의 것이다.
   */
  autoBadgeAt: { x: number; y: number };
  /**
   * 이 배지가 끄는 범위 — 싱글은 `"battle"`, PvP는 `"skill"`.
   *
   * **바가 알아야 하는 이유는 배지의 처음 상태다**(`initialAutoFor`). 싱글의
   * 배지는 전장을 통째로 쥐므로 전장의 기본값(ON)을 물려받아야 하고, PvP는
   * 자기 스킬 자동 시전만 말하므로 OFF에서 시작한다. 이 값이 없던 동안 배지는
   * 늘 OFF로 출발했고 싱글 진입 직후 `AUTO OFF`인데 캐릭터가 싸웠다
   * (유저 신고 2번 — `initialAutoFor`의 결정 기록).
   *
   * 문구(`autoScopeNotice`)도 이 범위에서 나온다. 씬이 토스트에 쓸 때 같은 값을
   * 다시 적지 않게 `onAutoToggle`이 두 번째 인자로 되돌려 준다 — 두 곳에 적으면
   * 배지가 ON에서 시작하는데 문구는 "팀은 계속 싸운다"가 되는 조합이 생긴다.
   */
  autoScope: AutoScope;
  /**
   * AUTO 배지를 눌렀을 때 범위를 알린다 (`autoScopeNotice`).
   *
   * 바가 토스트를 직접 만들지 않는다 — 토스트는 화면 하단 20% 지점에 뜨는
   * 씬 소유 위젯이고(§C10), 바는 자기 밴드 안에만 그린다. 배선이 없으면
   * 조용히 안 뜨는 게 맞다(갤러리·디버그 진입은 토스트가 없다).
   */
  onAutoToggle?(on: boolean, scope: AutoScope): void;
}

export interface SkillBar {
  view: Container;
  /**
   * AUTO 배지 — **바 밴드 밖에 사는 별도 뷰**다. 좌표는 디자인 좌표(720×1280)이고
   * 씬이 자기 레이어에 얹는다.
   *
   * 왜 `view`의 자식이 아닌가: `view`는 바 밴드 원점에 놓여 있어서 배지를 그
   * 안에 넣으면 좌표가 음수 y가 된다 — 그러면 "바는 자기 밴드 안에만 그린다"가
   * 깨지고, 씬이 z순서를 정할 수 없다(배지가 늘 바와 같은 층에 묶인다).
   */
  autoView: Container;
  readonly auto: boolean;
  setAuto(on: boolean): void;
  /**
   * 이 스킬 칸이 아직 안 열렸다 — 회색 판 + 탭 무효 + AUTO 제외.
   *
   * **바가 세 가지를 같이 처리하는 것이 요점이다.** 씬이 그림만 잠그면
   * (`slot.setLocked`) 잠긴 칸을 눌러도 시전되고 AUTO가 그 칸을 골라 쓴다 —
   * 그 누출은 화면에 회색 원으로 잠겨 있는 것처럼 보이므로 캡처로 안 잡힌다.
   * 실제로 AUTO 배지가 같은 종류의 누출을 낸 적이 있다 (1단계-C).
   *
   * 모르는 id는 조용히 무시한다 — 씬이 모드마다 다른 스킬 구성을 갖는다
   * (싱글은 방해 두 칸이 없다).
   */
  setLocked(skillId: string, locked: boolean): void;
  /**
   * 스킬 슬롯 중심의 **디자인 좌표**(720×1280 기준)와 슬롯 지름. 광선 궤적의
   * 출발점이다 — 궤적은 스킬바에서 필드로 넘어가므로 밴드 로컬 좌표로는 표현할
   * 수 없다. 없는 스킬이면 null.
   *
   * **지름을 같이 주는 이유:** 슬롯 원의 크기는 칸 수에 따라 변한다
   * (`barLayout`의 `cell * 0.82` — 4칸 138.7, 6칸 92.5). 슬롯 **테두리 위**에
   * 무엇을 얹으려면(힌트 손가락) 중심만으로는 못 구한다. 실제로 두 세션이
   * `y - 70`을 눈대중으로 적었고 4칸 바에서 손이 슬롯을 파고들었다.
   */
  slotCenter(skillId: string): { x: number; y: number; d: number } | null;
  /** nowMs = Battle의 elapsedMs. 쿨다운 링과 AUTO 시전을 갱신한다. */
  update(nowMs: number): void;
  /** 프레임 델타 — 눌림·펄스 같은 표현 애니메이션용 (전투 시간과 다르다) */
  animate(dtMs: number): void;
  destroy(): void;
}

/** kind별 슬롯 색 (기존 값 유지 — §7이 "KIND_COLOR 유지"로 못박았다) */
const KIND_COLOR: Record<SkillDef["kind"], number> = {
  attack: 0x6a4bb0,
  interference: 0xb04b6a,
  buff: 0x4bb08a,
};

interface Entry {
  slot: SkillSlot;
  skill: SkillDef;
  cx: number;
  cy: number;
  /** 쿨다운 중 탭 흔들림. -1 = 안 흔들림 */
  shakeMs: number;
}

export function createSkillBar(opts: SkillBarOpts): SkillBar {
  const { rect, skills, cooldowns } = opts;
  const view = new Container();
  view.position.set(rect.x, rect.y);

  const bg = new Graphics();
  view.addChild(bg);

  const geo = barLayout(rect.w, rect.h, skills.length, SLOT_DIAMETER_RATIO);

  const paintBg = (): void => {
    const wood = woodBands();
    bg.clear();
    // 세로 3단 나무톤. 레퍼런스 frame_02의 나무 스킬바가 이 구조다
    const topH = Math.round(rect.h * 0.18);
    const botH = Math.round(rect.h * 0.24);
    bg.rect(0, 0, rect.w, rect.h).fill({ color: wood.mid });
    bg.rect(0, 0, rect.w, topH).fill({ color: wood.top });
    bg.rect(0, rect.h - botH, rect.w, botH).fill({ color: wood.bottom });
    // 나무결 — 가로 어두운 선 몇 줄. 결정론적 좌표(고정 배열)라 프레임마다 같다
    for (const r of [0.32, 0.46, 0.61, 0.78]) {
      bg.rect(0, Math.round(rect.h * r), rect.w, 1).fill({
        color: UI_OUTLINE,
        alpha: 0.25,
      });
    }
    // 상단 금색 2px — 바가 화면에 물려 있는 경계
    bg.rect(0, 0, rect.w, GOLD_LINE_H).fill({ color: ACCENT_GOLD });
  };
  paintBg();

  /**
   * 배지에 적히는 상태. 처음 값은 **범위가 정한다**(`initialAutoFor`) — 여기
   * `false`를 적어 둔 동안 싱글 진입 직후 배지가 `AUTO OFF`인데 캐릭터가 싸우는
   * 화면이 나왔다(그 함수의 결정 기록).
   */
  let auto = initialAutoFor(opts.autoScope);
  let lastNowMs = 0;
  let nextAutoMs = 0;

  /**
   * 배지 뷰 — 바 밴드 밖이므로 `view`가 아니라 따로 둔다. 위치는 모드가 준
   * 디자인 좌표 그대로다.
   */
  const autoView = new Container();
  autoView.label = "auto-badge";
  autoView.position.set(opts.autoBadgeAt.x, opts.autoBadgeAt.y);

  const autoD = autoBadgeD(rect.h);

  const autoBadge: CircleButton = createCircleButton({
    diameter: autoD,
    color: STATE_OFF,
    top: autoLabel(false)[0],
    bottom: autoLabel(false)[1],
    onTap: () => {
      setAuto(!auto);
      /**
       * 공지는 **탭 경로에서만** 낸다. `setAuto` 안에 넣으면 생성 직후의
       * `setAuto(false)`가 판 시작마다 토스트를 띄우고, PvP가 상대 필드를
       * 자동으로 고정하는 호출까지 공지를 낸다.
       */
      opts.onAutoToggle?.(auto, opts.autoScope);
    },
  });
  autoView.addChild(autoBadge.view);

  /** AUTO ON일 때 배지 주위에 도는 링 — 자동이 켜져 있음을 상시 알린다 */
  const autoRing = new Graphics();
  autoRing.visible = false;
  autoView.addChild(autoRing);

  const setAuto = (on: boolean): void => {
    auto = on;
    autoBadge.setColor(on ? STATE_OK : STATE_OFF);
    autoBadge.setText(...autoLabel(on));
    autoRing.visible = on;
    autoRing.clear();
    if (on) {
      strokePixelCircle(autoRing, 0, 0, autoD / 2 + ART_PX * 2, {
        color: STATE_OK,
        width: ART_PX,
        alpha: 0.7,
      });
    }
  };
  /**
   * 배지 색·라벨·링을 초기 상태로 **한 번 칠한다**. 인자가 `auto`인 것이 요점이다 —
   * 예전에는 `setAuto(false)`였고, 그래서 위에서 초기값을 무엇으로 두든 배지는
   * 늘 `AUTO OFF`로 그려졌다(유저 신고 2번, `initialAutoFor`의 결정 기록).
   * 리터럴을 다시 적으면 초기값이 조용히 무효가 된다.
   */
  setAuto(auto);

  const entries: Entry[] = skills.map((skill, i) => {
    const cx = geo.slotX(i);
    const cy = geo.slotY;
    const slot = createSkillSlot({
      skill,
      diameter: geo.slotD,
      // 라벨은 원이 아니라 **칸**에 맞춘다 — 안 주면 옆 칸 이름과 이어 붙는다
      labelMaxW: geo.labelMaxW,
      // 높이도 준다 — 두 단어 이름은 접어서 온전히 보여주는 게 맞다
      labelMaxH: geo.labelMaxH,
      color: KIND_COLOR[skill.kind],
      onTap: () => {
        /**
         * 못 누르는 버튼도 반응한다 — 무반응은 버그처럼 느껴진다 (§C2).
         * 잠긴 칸도 같은 반응이다: 흔들림 + 잠김 소리로 "있지만 아직 아니다"
         */
        const reject = (): void => {
          const e = entries[i];
          if (e) e.shakeMs = 0;
          playSfx("ui_locked");
        };
        if (entries[i]?.slot.locked === true || !cooldowns.isReady(skill.id, lastNowMs)) {
          reject();
          return;
        }
        /**
         * **세션이 거부해도 같은 반응을 준다.** 바가 모르는 거부 사유가 둘 있다
         * (실명, 모션 게이트 — `SkillBarOpts.onCast` 주석). 여기서 반환을 안 보면
         * `ui_tap`만 울리고 화면이 그대로여서, 고친 결함의 증상이 남는다.
         *
         * `ui_tap`을 먼저 울리지 않는다 — 거부된 탭에 두 소리가 겹치면 눌린
         * 것으로 들린다. 성공한 뒤에 울린다.
         */
        if (!opts.onCast(skill, lastNowMs)) {
          reject();
          return;
        }
        playSfx("ui_tap");
      },
    });
    slot.view.position.set(cx, cy);
    view.addChild(slot.view);
    return { slot, skill, cx, cy, shakeMs: -1 };
  });

  return {
    view,
    autoView,
    get auto(): boolean {
      return auto;
    },
    setAuto,
    setLocked(skillId: string, locked: boolean): void {
      entries.find((e) => e.skill.id === skillId)?.slot.setLocked(locked);
    },
    slotCenter(skillId: string): { x: number; y: number; d: number } | null {
      const e = entries.find((x) => x.skill.id === skillId);
      if (!e) return null;
      return { x: rect.x + e.cx, y: rect.y + e.cy, d: geo.slotD };
    },
    update(nowMs: number): void {
      lastNowMs = nowMs;

      for (const e of entries) {
        // 슬롯이 상태·파이·숫자·완료 펄스를 전부 남은 시간에서 파생시킨다
        e.slot.setRemaining(cooldowns.remainingMs(e.skill.id, nowMs));
      }

      if (auto && nowMs >= nextAutoMs) {
        /**
         * **잠긴 칸은 AUTO에서도 빠진다.** 쿨다운 추적기는 잠금을 모르므로
         * (진행도는 코어 밖의 개념이다) 여기서 걸러야 한다 — 안 걸면 잠긴
         * 채로 회색인 칸의 딜이 AUTO를 통해 계속 들어간다. 1단계-C가 같은
         * 종류의 누출이었다: 화면은 꺼져 있는데 딜은 흘렀다.
         */
        const lockedIds = new Set(
          entries.filter((e) => e.slot.locked).map((e) => e.skill.id),
        );
        const pick = pickAutoSkill(
          cooldowns.readySkills(nowMs).filter((s) => !lockedIds.has(s.id)),
        );
        if (pick) {
          nextAutoMs = nowMs + AUTO_INTERVAL_MS;
          // AUTO가 뭘 썼는지 슬롯에 표시한다 — 안 보이면 자동이 켜진 동안
          // 스킬바가 죽은 UI가 된다 (§7)
          entries.find((e) => e.skill.id === pick.id)?.slot.pulseAuto();
          opts.onCast(pick, nowMs);
        }
      }
    },
    animate(dtMs: number): void {
      autoBadge.update(dtMs);
      for (const e of entries) {
        e.slot.update(dtMs);
        if (e.shakeMs < 0) continue;
        e.shakeMs += dtMs;
        e.slot.view.x = e.cx + shakeOffset(e.shakeMs);
        if (e.shakeMs >= SHAKE_MS) {
          e.shakeMs = -1;
          e.slot.view.x = e.cx;
        }
      }
    },
    destroy(): void {
      // 배지는 바 뷰의 자식이 아니다 — 따로 지워야 씬 전환에 남지 않는다
      autoView.destroy({ children: true });
      view.destroy({ children: true });
    },
  };
}
