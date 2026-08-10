import { Container, Graphics, Text } from "pixi.js";
import type { CharacterLoadout } from "../loadout/types";
import { formatClock } from "./format";
import type { SplitRect } from "./viewport";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  STATE_ALERT,
  TEAM_OURS,
  TEAM_THEIRS,
  T_CAPTION,
  T_LABEL,
  T_NUM_L,
  UI_OUTLINE,
  UI_PANEL,
  UI_TEXT,
  UI_TEXT_DIM,
  snapFontSize,
} from "./theme";
import { darken, lighten } from "./color";
import {
  HUD_FLASH_MS,
  TIMER_PULSE_MS,
  dpsReadout,
  gaugeReadout,
  hudFlashAlpha,
  timerPulse,
  timerWarning,
} from "./hudRules";
import { ART_PX, RADIUS_CARD, snapPx } from "./ui/shapeRules";
import { fillPixelRect, strokePixelRect } from "./ui/pixelShape";
import { liveCharCount } from "./spriteChar";
import { createWaveRail, type WaveRail } from "./ui/waveRail";

// 순수 규칙은 hudRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export { dpsReadout, gaugeReadout, timerPulse, timerWarning } from "./hudRules";

/**
 * 상단 HUD — 팀 플레이트 · 타이머 · 게이지 수치 · 웨이브 레일.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §3
 *
 * 이전 버전은 전부 맨 텍스트였다. 여기서 바뀐 핵심은 **게이지 수치를 숫자로
 * 보여준다는 것** — 화면 분할과 게이지 바는 아날로그라 "지금 얼마나 이기고
 * 있는가"를 정확히 읽을 수 없었다.
 */

export interface HudOpts {
  rect: SplitRect;
  myTeamName: string;
  theirTeamName: string;
  /** 팀 플레이트의 미니 초상에 쓰는 진영 캐릭터. 없으면 원만 그린다 */
  myCharacters?: readonly CharacterLoadout[];
  /** `?debug=1` — 우측에 dps 표기 */
  debugHud?: boolean;
}

export interface Hud {
  view: Container;
  setTime(remainingMs: number): void;
  setWave(waveIndex: number): void;
  /** 웨이브 내 진행률 0..1 — 레일 마커가 움직인다 */
  setWaveProgress(progress: number): void;
  /** 게이지 위치 — `▲ 0.32` 표기 */
  setGauge(pos: number): void;
  /** 방해를 맞았다 — HUD 전체가 상대색으로 60ms 번쩍인다 (§3) */
  flashInterference(): void;
  /** `?debug=1`에서만 보인다 */
  setDps(myDps: number, theirDps: number): void;
  setRect(rect: SplitRect): void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 팀 플레이트 폭 (§3) */
const PLATE_W = 200;
const PLATE_H = 64;
/** 미니 초상 지름 */
const PORTRAIT_D = 44;

/**
 * 미니 초상.
 *
 * Spine 스켈레톤을 렌더 타깃에 굽는 방법도 있지만(정확한 초상), HUD 하나 때문에
 * 매치 시작에 렌더 타깃 2장을 추가하는 값은 하지 않는다. 캐릭터 틴트 판 +
 * 어두운 머리/어깨 실루엣으로 "누구인지"는 톤으로 구분된다.
 *
 * **원형 크롭이 아니라 모서리 깎은 사각 크롭이다.** 지름 44px 원은 테두리
 * 전체가 안티에일리어싱 곡선이라, 4배 도트 캐릭터가 뛰는 화면의 HUD에서
 * 유일하게 매끈한 요소가 된다 — 도트 게임의 초상 프레임은 사각이 정석이다.
 */
function drawPortrait(g: Graphics, cx: number, cy: number, tint: number): void {
  const r = PORTRAIT_D / 2;
  const cut = ART_PX * 2;
  const box = (half: number, c: number, fill: { color: number }): void => {
    fillPixelRect(g, cx - half, cy - half, half * 2, half * 2, c, fill);
  };
  box(r, cut, { color: lighten(tint, 0.15) });
  box(r - ART_PX, cut, { color: tint });
  // 어깨 — 판 아래쪽을 가로지르는 넓은 블록
  fillPixelRect(g, cx - r * 0.78, cy + r * 0.12, r * 1.56, r * 0.88, ART_PX, {
    color: darken(tint, 0.45),
  });
  // 머리
  fillPixelRect(g, cx - r * 0.36, cy - r * 0.54, r * 0.72, r * 0.72, ART_PX, {
    color: darken(tint, 0.45),
  });
  strokePixelRect(g, cx - r, cy - r, r * 2, r * 2, cut, {
    color: UI_OUTLINE,
    width: ART_PX,
    alignment: 0.5,
  });
}

interface Plate {
  view: Container;
  bg: Graphics;
  label: Text;
  /** 지연 배지 `⋯` (§6-4) — 상대 플레이트에만 쓴다 */
  lag: Text;
}

function createPlate(
  name: string,
  accent: number,
  characters: readonly CharacterLoadout[],
  /**
   * 진영 정보가 없을 때 그릴 무명 초상 수.
   *
   * 상대 로드아웃은 우리가 모른다(네트워크로 받지 않는다 — §6). 그렇다고 초상
   * 자리를 비우면 두 플레이트가 비대칭이 되어 우리 쪽만 판이 채워진 것처럼
   * 보이고, 빈 공간이 로딩 실패로 읽힌다. 실루엣으로 자리를 잡아 둔다.
   */
  unknownCount = 0,
): Plate {
  const view = new Container();
  const bg = new Graphics();
  const label = new Text({
    text: name,
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: "800",
    },
  });
  label.anchor.set(0, 0.5);
  const lag = new Text({
    text: "⋯",
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      // 라벨보다 한 칸 크게. 1.4배(33.6px)는 도트 격자에서 벗어난다
      fontSize: snapFontSize(T_LABEL.size * 1.4),
      fontWeight: "800",
    },
  });
  lag.anchor.set(1, 0.5);
  lag.visible = false;

  // 판 + 진영색 테두리 4px. 3단 셰이딩은 roundRect를 겹쳐 자른다
  bg.roundRect(0, 0, PLATE_W, PLATE_H, RADIUS_CARD).fill({ color: UI_PANEL });
  bg.roundRect(0, 0, PLATE_W, PLATE_H * 0.34, RADIUS_CARD).fill({
    color: lighten(UI_PANEL, 0.22),
  });
  bg.roundRect(0, PLATE_H * 0.78, PLATE_W, PLATE_H * 0.22, RADIUS_CARD).fill({
    color: darken(UI_PANEL, 0.25),
  });
  bg.roundRect(0, PLATE_H * 0.3, PLATE_W, PLATE_H * 0.5).fill({
    color: UI_PANEL,
  });
  bg.roundRect(0, 0, PLATE_W, PLATE_H, RADIUS_CARD).stroke({
    color: accent,
    width: 4,
    alignment: 1,
  });

  // 초상은 최대 2개. 진영 정보가 없으면 진영색 실루엣으로 자리를 채운다
  const tints =
    characters.length > 0
      ? characters.slice(0, 2).map((c) => c.tintHex)
      : Array.from({ length: Math.min(2, unknownCount) }, () =>
          darken(accent, 0.35),
        );
  const shown = tints;
  shown.forEach((tint, i) => {
    drawPortrait(
      bg,
      10 + PORTRAIT_D / 2 + i * (PORTRAIT_D - 10),
      PLATE_H / 2,
      tint,
    );
  });
  label.position.set(
    shown.length > 0
      ? 10 + PORTRAIT_D + (shown.length - 1) * (PORTRAIT_D - 10) + 10
      : 14,
    PLATE_H / 2,
  );
  lag.position.set(PLATE_W - 10, PLATE_H / 2);

  view.addChild(bg, label, lag);
  return { view, bg, label, lag };
}

export function createHud(opts: HudOpts): Hud {
  let rect = opts.rect;
  const view = new Container();
  view.position.set(rect.x, rect.y);

  const bg = new Graphics();
  /** 방해 피격 플래시 — 맨 위에 얹는다 */
  const flash = new Graphics();

  const mine = createPlate(opts.myTeamName, TEAM_OURS, opts.myCharacters ?? []);
  const theirs = createPlate(
    opts.theirTeamName,
    TEAM_THEIRS,
    [],
    // 상대 진영은 모르지만 인원 수는 같다 — 자리만 맞춰 둔다
    opts.myCharacters?.length ?? 0,
  );

  const timer = new Text({
    text: "0:00",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_NUM_L.size,
      fontWeight: "800",
    },
  });
  // Pixi `TextStyle`에는 `font-variant-numeric`이 없다 — tabular를 켤 수 없으므로
  // **중앙 정렬**로 폭 변동을 흡수한다. 좌측 정렬이면 초가 바뀔 때 문자열 폭이
  // 달라져 타이머 전체가 좌우로 흔들린다
  timer.anchor.set(0.5, 0);

  const gauge = new Text({
    text: gaugeReadout(0),
    style: {
      fill: UI_TEXT_DIM,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: "800",
    },
  });
  gauge.anchor.set(0.5, 0);

  /**
   * 타이머 한 줄이 실제로 차지하는 높이.
   *
   * `T_NUM_L.size + 4`로 잡고 있었는데, 폰트 크기는 글자 상자의 **em**이고 렌더된
   * 줄 상자는 그보다 높다(어센더·디센더 여유). 그래서 아래 줄이 타이머의 디센더
   * 영역에 파고들어 "1:55"와 "0.00"이 겹쳐 찍혔다 — 스크린샷에서 확인했다.
   *
   * 잰 값을 쓴다. 폰트를 바꾸거나 크기 토큰을 올려도 따라온다. 격자로 접어서
   * 두 줄 사이 간격도 도트 칸에 맞춘다.
   *
   * **여기서 재야 한다**: 매초 펄스가 `timer.scale`을 건드리므로 `layout()`
   * 시점에 재면 그 프레임의 확대율이 간격에 섞여 들어간다.
   */
  const timerLineH = snapPx(timer.height) + ART_PX;

  const dps = new Text({
    text: "",
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: "600",
    },
  });
  dps.anchor.set(1, 0);
  dps.visible = opts.debugHud === true;

  const rail: WaveRail = createWaveRail({ w: rect.w * 0.62 });

  view.addChild(
    bg,
    mine.view,
    theirs.view,
    timer,
    gauge,
    dps,
    rail.view,
    flash,
  );

  const paint = (): void => {
    bg.clear();
    bg.rect(0, 0, rect.w, rect.h).fill({ color: UI_PANEL, alpha: 0.92 });
    // 하단 금색 2px — HUD가 필드 위에 얹힌 판임을 말한다 (§3)
    bg.rect(0, rect.h - 2, rect.w, 2).fill({ color: ACCENT_GOLD, alpha: 0.85 });
    flash.clear();
    flash.rect(0, 0, rect.w, rect.h).fill({ color: TEAM_THEIRS });
    flash.alpha = 0;
    flash.eventMode = "none";
  };

  const layout = (): void => {
    view.position.set(rect.x, rect.y);
    mine.view.position.set(12, 10);
    theirs.view.position.set(rect.w - PLATE_W - 12, 10);
    timer.position.set(rect.w / 2, 8);
    gauge.position.set(rect.w / 2, 8 + timerLineH);
    dps.position.set(rect.w - 12, PLATE_H + 14);
    rail.resize(rect.w * 0.62);
    // 레일은 HUD 아래쪽에 붙인다 — 금색 라인 바로 위
    rail.view.position.set(rect.w / 2, rect.h - rail.height - 8);
    paint();
  };
  layout();

  let flashMs = -1;
  let pulseMs = -1;
  /** 직전에 표시한 초 — 매초 펄스를 한 번만 준다 */
  let lastSec = -1;

  return {
    view,
    setTime(remainingMs: number): void {
      timer.text = formatClock(remainingMs);
      const warn = timerWarning(remainingMs);
      timer.style.fill = warn ? STATE_ALERT : UI_TEXT;
      const sec = Math.max(0, Math.ceil(remainingMs / 1000));
      // 10초 이하에서만 매초 펄스. 항상 뛰면 2분 내내 시선을 잡아먹는다
      if (warn && sec !== lastSec) pulseMs = 0;
      lastSec = sec;
    },
    setWave(waveIndex: number): void {
      rail.setWave(waveIndex);
    },
    setWaveProgress(progress: number): void {
      rail.setProgress(progress);
    },
    setGauge(pos: number): void {
      const text = gaugeReadout(pos);
      if (text === gauge.text) return;
      gauge.text = text;
      // 색 + 기호를 같이 준다 (§01-6). 색만으로는 색맹 유저에게 정보가 없다
      gauge.style.fill =
        pos > 0.02 ? ACCENT_GOLD : pos < -0.02 ? TEAM_THEIRS : UI_TEXT_DIM;
    },
    flashInterference(): void {
      flashMs = 0;
    },
    setDps(myDps: number, theirDps: number): void {
      if (!dps.visible) return;
      // 스켈레톤 수는 여기 얹는다 — 누수 검증(§09-4)에 화면 한 곳만 보면 되게
      dps.text = dpsReadout(myDps, theirDps, liveCharCount());
    },
    setRect(next: SplitRect): void {
      rect = next;
      layout();
    },
    update(dtMs: number): void {
      rail.update(dtMs);
      if (flashMs >= 0) {
        flashMs += dtMs;
        flash.alpha = hudFlashAlpha(flashMs) * 0.55;
        if (flashMs >= HUD_FLASH_MS) {
          flashMs = -1;
          flash.alpha = 0;
        }
      }
      if (pulseMs >= 0) {
        pulseMs += dtMs;
        timer.scale.set(timerPulse(pulseMs));
        if (pulseMs >= TIMER_PULSE_MS) {
          pulseMs = -1;
          timer.scale.set(1);
        }
      }
    },
    destroy(): void {
      rail.destroy();
      view.destroy({ children: true });
    },
  };
}
