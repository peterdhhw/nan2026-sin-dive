import { Container, Graphics, Text } from "pixi.js";
import type { SplitRect } from "../shared/viewport";
import { formatGauge } from "../shared/format";
import {
  fillPixelCircle,
  fillPixelRect,
  strokePixelCircle,
} from "../shared/ui/pixelShape";
import { ART_PX, snapPx } from "../shared/ui/shapeRules";
import {
  ACCENT_GOLD,
  ACCENT_GOLD_DEEP,
  FIELD_TEXT_STROKE,
  FONT_FAMILY,
  T_CAPTION,
  TEAM_OURS,
  TEAM_OURS_HI,
  TEAM_THEIRS,
  TEAM_THEIRS_HI,
  UI_OUTLINE,
  UI_TEXT,
  fontWeightOf,
} from "../shared/theme";
import {
  FLASH_MS,
  FRAME_SLANT,
  STRIPE_PERIOD_PX,
  STRIPE_W,
  SURGE_MS,
  WIN_THRESHOLD,
  advanceStripe,
  fadeOut,
  fillSpan,
  glowStrength,
  isDanger,
  posToX,
  pushDiff,
  stripeSpeed,
  surgePose,
  thresholdPulse,
  trackRect,
} from "./gaugeBarRules";
import {
  DRAIN_PARTICLES,
  DRAIN_TOTAL_MS,
  drainParticleSpread,
  drainParticleT,
} from "./interferenceRules";

// 순수 규칙은 gaugeBarRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export { BAR_H, DANGER_POS, WIN_THRESHOLD, pushDiff } from "./gaugeBarRules";
// 게이지 탈취 입자 규칙 (§9) — 같은 이유로 pixi 없는 모듈에 있다
export {
  DRAIN_PARTICLES,
  DRAIN_PARTICLE_MS,
  DRAIN_STAGGER_MS,
  DRAIN_TOTAL_MS,
  drainParticleSpread,
  drainParticleT,
} from "./interferenceRules";

export interface GaugeBar {
  view: Container;
  /** 게이지가 움직이면 상/하 필드 경계가 바뀌므로 바 자체도 따라 내려간다 */
  setRect(rect: SplitRect): void;
  /** -1..1 */
  setPos(pos: number): void;
  /**
   * 양 팀 초당 딜. 스트라이프 흐름 방향·속도와 마커 발광이 이것으로 결정된다.
   * `데미지 → 게이지` 인과를 잇는 유일한 시각 장치다 (README §3-2).
   */
  setDps(myDps: number, theirDps: number): void;
  /** 큰 딜(적 처치)이 들어갔을 때 마커에서 파동을 퍼뜨린다 */
  surge(): void;
  /** 게이지 역류 등에 흔들림을 준다 (0..1) */
  shake(strength: number): void;
  /**
   * 게이지를 빼앗겼다 (§9 `gauge_drain`) — 마커에서 **상대 쪽으로** 입자가 흐른다.
   *
   * 줄어든 양은 숫자로도 보이지만(§C6의 붉은 숫자), **어디로 갔는지**는
   * 방향이 있는 움직임만 말할 수 있다.
   */
  drain(): void;
  /** 임계 도달 — 전체 흰 플래시 (§5) */
  flash(): void;
  update(dtMs: number): void;
  destroy(): void;
}

const SHAKE_DECAY_MS = 320;
/** 트랙 바탕 */
const TRACK_COLOR = 0x1a1428;

/**
 * 게이지 바 — 줄다리기 시각화.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §5
 *
 * 이 바가 게임의 핵심 정보를 혼자 들고 있다. 채움 위치만으로는 "지금 밀고 있는가"를
 * 알 수 없다 — 위치는 **누적**이고 유저가 알고 싶은 건 **변화율**이다. 그래서
 * 스트라이프가 우세한 쪽으로 흐르고, 마커가 그 세기만큼 발광한다 (README §3-2).
 */
export function createGaugeBar(initial: SplitRect): GaugeBar {
  let rect = initial;
  const view = new Container();
  view.position.set(rect.x, rect.y);

  /** 프레임·트랙 — pos와 무관하므로 rect가 바뀔 때만 다시 그린다 */
  const frame = new Graphics();
  /** 채움 + 스트라이프 */
  const fill = new Graphics();
  /** 임계선·중앙선 */
  const ticks = new Graphics();
  /**
   * 마커 앞쪽 발광. **가산 합성 전용 레이어**로 뗀다 — 일반 합성으로 반투명
   * 사각을 겹치면 트랙 위에 회색 블록이 얹힌 것처럼 보인다(스크린샷에서 확인).
   * 빛은 밑색을 덮는 게 아니라 더해야 빛으로 읽힌다.
   */
  const glowG = new Graphics();
  glowG.blendMode = "add";
  /**
   * 게이지 탈취 입자 (§9). 마커에서 상대 쪽으로 흐른다.
   * 가산 합성 — 빼앗기는 것은 빛이 흘러 나가는 그림이어야 읽힌다.
   */
  const drainG = new Graphics();
  drainG.blendMode = "add";
  /** 마커와 파동 */
  const marker = new Graphics();
  /** 임계 도달 흰 플래시 */
  const flashG = new Graphics();
  view.addChild(frame, fill, ticks, glowG, drainG, marker, flashG);

  const readout = new Text({
    text: formatGauge(0),
    style: {
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: fontWeightOf(T_CAPTION),
      fill: UI_TEXT,
      stroke: FIELD_TEXT_STROKE,
    },
  });
  readout.anchor.set(0.5);
  view.addChild(readout);

  let pos = 0;
  let diff = 0;
  let stripeOffset = 0;
  let shakeMs = 0;
  let shakeStrength = 0;
  /** 임계선 펄스용 자체 시계. 결정론이어야 하므로 dt를 누적한다 */
  let clockMs = 0;
  let surgeMs = -1;
  let flashMs = -1;
  /** 게이지 탈취 입자 시계. −1 = 흐르는 중이 아니다 */
  let drainMs = -1;

  const paintFrame = (): void => {
    const track = trackRect(rect.w, rect.h);
    frame.clear();
    // 좌우 끝을 사선으로 깎은 몸통 (§5)
    frame
      .poly([
        FRAME_SLANT,
        0,
        rect.w - FRAME_SLANT,
        0,
        rect.w,
        rect.h / 2,
        rect.w - FRAME_SLANT,
        rect.h,
        FRAME_SLANT,
        rect.h,
        0,
        rect.h / 2,
      ])
      .fill({ color: UI_OUTLINE, alpha: 0.96 });
    // 상하 금색 라인 — 레퍼런스 룩의 프레임 규칙 (§5)
    frame
      .rect(FRAME_SLANT, 1, rect.w - FRAME_SLANT * 2, 1.5)
      .fill({ color: ACCENT_GOLD, alpha: 0.55 })
      .rect(FRAME_SLANT, rect.h - 2.5, rect.w - FRAME_SLANT * 2, 1.5)
      .fill({ color: ACCENT_GOLD_DEEP, alpha: 0.45 });
    // 트랙 + 안쪽 그림자
    fillPixelRect(frame, track.x, track.y, track.w, track.h, ART_PX, {
      color: TRACK_COLOR,
    });
    // 안쪽 그림자는 한 칸 두께 직선 — 깎을 모서리가 없다
    frame
      .rect(track.x, track.y, track.w, ART_PX)
      .fill({ color: 0x000000, alpha: 0.35 });

    readout.position.set(rect.w / 2, -T_CAPTION.size * 0.72);
  };

  const paintTicks = (): void => {
    const track = trackRect(rect.w, rect.h);
    ticks.clear();
    // 중앙선 (§5: 흰색 alpha 0.4)
    ticks
      .rect(track.x + track.w / 2 - 1, track.y, 2, track.h)
      .fill({ color: UI_TEXT, alpha: 0.4 });

    // ±임계선. 점선으로 그어야 채움과 구분된다.
    // 펄스는 |pos| ≥ 0.7일 때만 — 항상 깜빡이면 정보가 아니라 장식이 된다
    const pulse = isDanger(pos) ? thresholdPulse(clockMs) : 0;
    for (const sign of [-1, 1]) {
      const x = posToX(sign * WIN_THRESHOLD, track);
      // 임박한 쪽만 펄스한다 — 양쪽이 같이 깜빡이면 어느 쪽이 위험한지 모른다
      const hot = pulse > 0 && Math.sign(pos) === sign;
      const alpha = hot ? 0.55 + pulse * 0.45 : 0.5;
      const w = hot ? 3 : 2;
      const dash = 5;
      for (let y = track.y; y < track.y + track.h; y += dash * 2) {
        const seg = Math.min(dash, track.y + track.h - y);
        ticks.rect(x - w / 2, y, w, seg).fill({ color: ACCENT_GOLD, alpha });
      }
      // 왕관 대신 삼각 꼭지 — "여기까지 밀면 이긴다" (§5의 왕관 아이콘 자리).
      // 이모지는 플랫폼마다 모양이 달라서 도형으로 그린다
      ticks
        .poly([x, track.y - 3, x - 4, track.y - 9, x + 4, track.y - 9])
        .fill({ color: ACCENT_GOLD, alpha: hot ? 1 : 0.75 });
    }
  };

  const paintFill = (): void => {
    const track = trackRect(rect.w, rect.h);
    const span = fillSpan(pos, track);
    fill.clear();
    if (span.w <= 0) return;

    const base = span.ours ? TEAM_OURS : TEAM_THEIRS;
    const hi = span.ours ? TEAM_OURS_HI : TEAM_THEIRS_HI;
    fill.rect(span.x, track.y, span.w, track.h).fill({ color: base });
    // 세로 그라디언트 대용 2단 — 진짜 그라디언트보다 드로우콜이 싸고,
    // 42px 높이에서는 두 방식의 차이가 보이지 않는다
    fill
      .rect(span.x, track.y, span.w, track.h * 0.42)
      .fill({ color: hi, alpha: 0.55 });

    // 사선 스트라이프. 채움 범위 안으로 좌표를 직접 잘라서 긋는다 —
    // 마스크를 쓰면 게이지가 매 프레임 바뀌므로 마스크도 매 프레임 다시 그려야 한다
    const h = track.h;
    const right = span.x + span.w;
    const start = span.x - h - STRIPE_PERIOD_PX + stripeOffset;
    for (let x = start; x < right + h; x += STRIPE_PERIOD_PX) {
      // 평행사변형: 위쪽 변이 오른쪽으로 h만큼 밀린 사선
      const bl = Math.min(Math.max(x, span.x), right);
      const br = Math.min(Math.max(x + STRIPE_W, span.x), right);
      const tr = Math.min(Math.max(x + STRIPE_W + h, span.x), right);
      const tl = Math.min(Math.max(x + h, span.x), right);
      if (br - bl <= 0 && tr - tl <= 0) continue;
      fill
        .poly([bl, track.y + h, br, track.y + h, tr, track.y, tl, track.y])
        .fill({ color: 0xffffff, alpha: 0.11 });
    }
  };

  const paintMarker = (): void => {
    const track = trackRect(rect.w, rect.h);
    const x = posToX(pos, track);
    const cy = track.y + track.h / 2;
    const half = track.h * 0.62;
    const glow = glowStrength(diff);
    // 우리가 밀 때 금색, 상대가 밀 때 상대색 — 색이 방향을 말한다 (§5)
    const glowColor = diff >= 0 ? ACCENT_GOLD : TEAM_THEIRS_HI;

    marker.clear();
    glowG.clear();

    // 마커 앞쪽 발광. 밀고 있는 방향으로 번진다 (가산 레이어)
    if (glow > 0.02) {
      const dir = diff >= 0 ? 1 : -1;
      for (let i = 3; i >= 1; i--) {
        const w = 12 * i * glow;
        // 가산이므로 alpha가 곧 밝기다. 안쪽 겹이 더 밝아져 그라데이션이 된다
        glowG
          .rect(dir > 0 ? x : x - w, track.y, w, track.h)
          .fill({ color: glowColor, alpha: 0.16 * glow });
      }
      // 마커 바로 옆의 코어 — 가장 밝은 점이 있어야 "여기서 힘이 나온다"가 된다.
      // 계단 원이다: 이 하나만 매끈하면 바 안에서 유일하게 흐린 요소가 된다
      fillPixelCircle(
        glowG,
        x + dir * 6,
        cy,
        track.h * 0.5 * (0.5 + glow * 0.5),
        { color: glowColor, alpha: 0.3 * glow },
      );
    }

    // 처치 파동 — 마커에서 원이 퍼진다
    if (surgeMs >= 0) {
      const p = surgePose(surgeMs);
      strokePixelCircle(marker, x, cy, p.radius, {
        color: ACCENT_GOLD,
        width: ART_PX,
        alpha: p.alpha * 0.9,
      });
    }

    // 다이아 마커 ◆ + 3단 셰이딩 (§5)
    marker
      .poly([x, cy - half, x + 9, cy, x, cy + half, x - 9, cy])
      .fill({ color: UI_OUTLINE })
      .poly([x, cy - half + 3, x + 6, cy, x, cy + half - 3, x - 6, cy])
      .fill({ color: ACCENT_GOLD })
      .poly([x, cy - half + 5, x + 3, cy - 3, x - 2, cy - 1])
      .fill({ color: 0xfff4c0, alpha: 0.9 });
    // 화살표는 밀리는 방향을 가리킨다
    if (Math.abs(diff) > 0.001) {
      const dir = diff >= 0 ? 1 : -1;
      const tipX = x + dir * 15;
      marker
        .poly([tipX, cy - 5, tipX + dir * 7, cy, tipX, cy + 5])
        .fill({ color: glowColor, alpha: 0.55 + glow * 0.45 });
    }
  };

  /**
   * 탈취 입자 — 마커에서 **상대 끝(왼쪽)** 으로 흐른다.
   *
   * 방향이 정보다: 우리 게이지가 상대 쪽으로 흘러 나가는 그림이어야
   * "빼앗겼다"가 된다. 마커 위치가 아니라 트랙의 상대 끝을 목표로 잡는다 —
   * 게이지가 어디 있든 흘러가는 방향은 같아야 한다.
   */
  const paintDrain = (): void => {
    drainG.clear();
    if (drainMs < 0) return;
    const track = trackRect(rect.w, rect.h);
    const fromX = posToX(pos, track);
    const toX = track.x;
    const cy = track.y + track.h / 2;
    for (let i = 0; i < DRAIN_PARTICLES; i++) {
      const t = drainParticleT(drainMs, i);
      if (t <= 0 || t >= 1) continue;
      const x = fromX + (toX - fromX) * t;
      // 도착할수록 사그라진다 — 끝에서 툭 사라지면 어디로 갔는지 모른다
      const alpha = (1 - t) * 0.9;
      // 입자 한 알은 한 칸~두 칸 사각. 반지름 2~4px 원은 전부 번짐이다
      const d = snapPx(4 + (1 - t) * 5);
      const py = cy + drainParticleSpread(i) * Math.sin(t * Math.PI);
      drainG
        .rect(x - d / 2, py - d / 2, d, d)
        .fill({ color: TEAM_THEIRS_HI, alpha });
    }
  };

  const paintFlash = (): void => {
    flashG.clear();
    const k = fadeOut(flashMs, FLASH_MS);
    if (k <= 0) return;
    flashG
      .rect(0, 0, rect.w, rect.h)
      .fill({ color: 0xffffff, alpha: k * 0.85 });
  };

  const redraw = (): void => {
    paintFill();
    paintTicks();
    paintDrain();
    paintMarker();
  };

  paintFrame();
  redraw();

  return {
    view,
    setRect(next: SplitRect): void {
      rect = next;
      view.position.set(rect.x, rect.y);
      paintFrame();
      redraw();
      paintFlash();
    },
    setPos(next: number): void {
      pos = Math.max(-1, Math.min(1, next));
      readout.text = formatGauge(pos);
      // 임계선을 넘기 직전이면 수치도 금색으로 — 두 신호가 같이 움직여야 읽힌다
      readout.style.fill = isDanger(pos) ? ACCENT_GOLD : UI_TEXT;
    },
    setDps(myDps: number, theirDps: number): void {
      diff = pushDiff(myDps, theirDps);
    },
    surge(): void {
      surgeMs = 0;
    },
    shake(strength: number): void {
      shakeStrength = Math.max(shakeStrength, Math.min(1, strength));
      shakeMs = SHAKE_DECAY_MS;
    },
    drain(): void {
      drainMs = 0;
    },
    flash(): void {
      flashMs = 0;
    },
    update(dtMs: number): void {
      clockMs += dtMs;
      stripeOffset = advanceStripe(stripeOffset, stripeSpeed(diff), dtMs);
      if (surgeMs >= 0) {
        surgeMs += dtMs;
        if (surgeMs >= SURGE_MS) surgeMs = -1;
      }
      if (drainMs >= 0) {
        drainMs += dtMs;
        if (drainMs >= DRAIN_TOTAL_MS) drainMs = -1;
      }
      if (flashMs >= 0) {
        flashMs += dtMs;
        paintFlash();
        if (flashMs >= FLASH_MS) {
          flashMs = -1;
          flashG.clear();
        }
      }
      redraw();

      if (shakeMs <= 0) {
        view.position.set(rect.x, rect.y);
        return;
      }
      shakeMs -= dtMs;
      const decay = Math.max(0, shakeMs / SHAKE_DECAY_MS);
      const amp = 6 * shakeStrength * decay;
      // 시간 기반 결정론적 흔들림 (Math.random 불필요)
      const phase = (SHAKE_DECAY_MS - shakeMs) / 18;
      view.position.set(
        rect.x + Math.sin(phase) * amp,
        rect.y + Math.cos(phase * 1.7) * amp * 0.5,
      );
      if (shakeMs <= 0) shakeStrength = 0;
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
