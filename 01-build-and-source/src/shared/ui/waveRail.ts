import { Container, Graphics, Text } from "pixi.js";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  STATE_ALERT,
  T_LABEL,
  UI_OUTLINE,
  UI_TEXT,
  UI_TEXT_DIM,
} from "../theme";
import {
  BOSS_PULSE_MS,
  LABEL_PULSE_MS,
  MARKER_SIZE,
  PASSED_ALPHA,
  REMAIN_ALPHA,
  RAIL_H,
  TICK_R,
  WAVE_COUNT,
  bossPulse,
  isBossIndex,
  isPassed,
  labelFlashAlpha,
  labelPulse,
  markerX,
  railIndex,
  tickX,
  waveLabel,
} from "./waveRailRules";
import { ART_PX, pillRadius, snapPx } from "./shapeRules";

import { fillPixelRect, strokePixelRect } from "./pixelShape";
// 순수 규칙은 waveRailRules.ts에 있다 (node 테스트가 pixi를 못 불러온다).
export {
  RAIL_H,
  WAVE_COUNT,
  isBossIndex,
  markerX,
  railIndex,
  tickX,
  waveLabel,
} from "./waveRailRules";

/**
 * 웨이브 진행 레일 + 구름형 웨이브 라벨.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C7
 *
 * **레퍼런스보다 작게 만든다.** 우리 승패는 게이지가 결정하므로 웨이브 진행은
 * 보조 정보다 — 게이지 바와 같은 비중을 주면 무엇을 봐야 하는지 헷갈린다.
 */

export interface WaveRailOpts {
  /** 레일 폭 (라벨은 이 폭의 중앙에 놓인다) */
  w: number;
  count?: number;
}

export interface WaveRail {
  view: Container;
  /** 라벨 + 레일 높이 합 */
  readonly height: number;
  /** 웨이브 변경 — 라벨 펄스 + 금색 플래시 */
  setWave(waveIndex: number): void;
  /** 웨이브 내 진행률 0..1 — 마커가 칸 사이를 부드럽게 이동한다 */
  setProgress(progress: number): void;
  resize(w: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

/** 구름 라벨 크기 */
const CLOUD_H = 34;
const CLOUD_PAD_X = 18;
/** 라벨과 레일 사이 */
const GAP = 12;
/** 보스 해골 반지름 */
const SKULL_R = 9;

export function createWaveRail(opts: WaveRailOpts): WaveRail {
  const count = Math.max(1, Math.floor(opts.count ?? WAVE_COUNT));
  const view = new Container();

  /** 구름 라벨 — 펄스가 라벨만 먹게 따로 담는다 */
  const cloud = new Container();
  const cloudBg = new Graphics();
  const cloudFlash = new Graphics();
  const label = new Text({
    text: waveLabel(0),
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_LABEL.size,
      fontWeight: "700",
    },
  });
  label.anchor.set(0.5);
  cloud.addChild(cloudBg, cloudFlash, label);
  view.addChild(cloud);

  const rail = new Graphics();
  rail.position.set(0, CLOUD_H / 2 + GAP + RAIL_H / 2);
  view.addChild(rail);

  /**
   * 보스 칸 해골 — 이모지(💀) 대신 직접 그린다.
   *
   * 헤드리스 크로미움에는 이모지 폰트가 없어서 아예 안 그려졌고, 실기기에서도
   * 플랫폼마다 모양·크기·베이스라인이 다 다르다. 레일 끝 표식 하나를 폰트
   * 운에 맡길 이유가 없다.
   */
  const skull = new Container();
  const skullG = new Graphics();
  skull.addChild(skullG);
  const paintSkull = (color: number): void => {
    const s = SKULL_R;
    skullG.clear();
    /**
     * 두개골 + 턱. 반지름 9px에서 원은 테두리가 전부 번짐이라 계단 블록으로
     * 쌓는다 — 이 크기의 도트 해골은 원래 사각 두개골 + 두 칸 눈이다.
     */
    fillPixelRect(skullG, -s, -s * 1.12, s * 2, s * 2, ART_PX, { color });
    fillPixelRect(skullG, -s * 0.52, s * 0.5, s * 1.04, s * 0.5, ART_PX, {
      color,
    });
    // 눈구멍·코 — 배경이 아니라 검정으로 파낸다 (레일 선이 뒤로 지나간다)
    const eye = ART_PX;
    skullG
      .rect(-s * 0.36 - eye / 2, -s * 0.16 - eye / 2, eye, eye)
      .fill({ color: 0x000000 })
      .rect(s * 0.36 - eye / 2, -s * 0.16 - eye / 2, eye, eye)
      .fill({ color: 0x000000 })
      .rect(-eye / 2, s * 0.18, eye, s * 0.32)
      .fill({ color: 0x000000 });
  };
  paintSkull(UI_TEXT_DIM);
  skull.alpha = REMAIN_ALPHA;
  view.addChild(skull);

  const marker = new Graphics();
  view.addChild(marker);

  let w = Math.max(1, opts.w);
  /** 레일 실제 길이 — 양 끝 보스 아이콘 자리를 남긴다 */
  let railW = 0;
  let railX0 = 0;
  /** 구름 라벨이 말하는 절대 웨이브 번호 */
  let absIndex = 0;
  /** 레일 칸 인덱스 — 보스 주기 안의 위치 */
  let cell = 0;
  let progress = 0;
  let labelMs = -1;
  /** 보스 칸 펄스는 도달했을 때만 돈다 */
  let bossMs = -1;
  /** 해골을 붉게 칠해 뒀는지 */
  let bossRed = false;

  const paintCloud = (): void => {
    const cw = label.width + CLOUD_PAD_X * 2;
    const r = pillRadius(CLOUD_H);
    cloudBg.clear();
    /**
     * 구름 근사 (§C7: PIL 텍스처가 필요 없다).
     *
     * 원래는 알약 + 좌우 작은 **원** 2개였다. 도트 룩에서는 원이 유일하게
     * 매끈한 곡선으로 남아 눈에 걸리므로, 양쪽 봉우리도 계단 블록으로 쌓는다.
     */
    const puff = snapPx(CLOUD_H * 0.34);
    fillPixelRect(
      cloudBg,
      -cw / 2 + 6 - puff,
      2 - puff,
      puff * 2,
      puff * 2,
      ART_PX,
      {
        color: UI_OUTLINE,
        alpha: 0.78,
      },
    );
    fillPixelRect(
      cloudBg,
      cw / 2 - 6 - puff,
      2 - puff,
      puff * 2,
      puff * 2,
      ART_PX,
      {
        color: UI_OUTLINE,
        alpha: 0.78,
      },
    );
    fillPixelRect(cloudBg, -cw / 2, -CLOUD_H / 2, cw, CLOUD_H, r, {
      color: UI_OUTLINE,
      alpha: 0.78,
    });
    strokePixelRect(cloudBg, -cw / 2, -CLOUD_H / 2, cw, CLOUD_H, r, {
      color: UI_TEXT_DIM,
      width: ART_PX,
      alpha: 0.5,
    });
    cloudFlash.clear();
    fillPixelRect(cloudFlash, -cw / 2, -CLOUD_H / 2, cw, CLOUD_H, r, {
      color: ACCENT_GOLD,
    });
    cloudFlash.alpha = 0;
  };

  const paintRail = (): void => {
    rail.clear();
    // 지나온 구간은 금색, 남은 구간은 흐린 회색. 선 하나로 그리면 경계가 없다
    const mx = railX0 + markerX(cell, progress, count) * railW;
    rail
      .moveTo(railX0, 0)
      .lineTo(mx, 0)
      .stroke({ color: ACCENT_GOLD, width: 3, alpha: PASSED_ALPHA });
    rail
      .moveTo(mx, 0)
      .lineTo(railX0 + railW, 0)
      .stroke({ color: UI_TEXT_DIM, width: 3, alpha: REMAIN_ALPHA });

    for (let i = 0; i < count; i += 1) {
      const x = railX0 + tickX(i, count) * railW;
      if (isBossIndex(i, count)) continue; // 마지막 칸은 해골이 대신한다
      const passed = isPassed(i, cell);
      // 칸 표식은 두 칸 사각 — 반지름 5px 원은 회색 번짐으로만 보인다
      const d = snapPx(TICK_R * 2);
      rail.rect(x - d / 2, -d / 2, d, d).fill({
        color: passed ? ACCENT_GOLD : UI_TEXT_DIM,
        alpha: passed ? PASSED_ALPHA : REMAIN_ALPHA,
      });
    }
  };

  const paintMarker = (): void => {
    const mx = railX0 + markerX(cell, progress, count) * railW;
    const my = rail.position.y;
    marker.clear();
    // 위를 가리키는 작은 삼각 ▴ — 레일 **아래**에 둔다. 위에 두면 구름 라벨과 겹친다
    marker
      .moveTo(mx, my + 3)
      .lineTo(mx - MARKER_SIZE / 2, my + 3 + MARKER_SIZE)
      .lineTo(mx + MARKER_SIZE / 2, my + 3 + MARKER_SIZE)
      .fill({ color: UI_TEXT });
  };

  const layout = (): void => {
    // 해골이 오른쪽 끝에 걸리므로 레일을 그만큼 안쪽으로 넣는다
    const inset = 16;
    railX0 = -w / 2 + inset;
    railW = w - inset * 2;
    cloud.position.set(0, CLOUD_H / 2);
    // 해골은 레일 끝보다 살짝 위로 띄운다 — 레일 선상에 두면 마커 삼각과
    // 겹쳐서 보스 웨이브에서 둘 다 안 읽힌다
    skull.position.set(railX0 + railW, rail.position.y - SKULL_R - 2);
    paintCloud();
    paintRail();
    paintMarker();
  };
  layout();

  return {
    view,
    get height(): number {
      return CLOUD_H + GAP + RAIL_H;
    },
    setWave(next: number): void {
      const i = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
      if (i === absIndex) return;
      absIndex = i;
      // 레일은 5칸이지만 코어는 40웨이브다 — 칸은 보스 주기 안의 위치다
      cell = railIndex(i, count);
      progress = 0;
      label.text = waveLabel(i);
      labelMs = 0;
      // 보스 칸에 도달하면 해골이 붉게 뛴다 — 여기만 강조를 허용한다 (§C7)
      bossMs = isBossIndex(cell, count) ? 0 : -1;
      if (bossMs < 0 && bossRed) {
        bossRed = false;
        paintSkull(UI_TEXT_DIM);
        skull.alpha = REMAIN_ALPHA;
        skull.scale.set(1);
      }
      paintCloud();
      paintRail();
      paintMarker();
    },
    setProgress(next: number): void {
      const p = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0;
      if (Math.abs(p - progress) < 0.002) return;
      progress = p;
      paintRail();
      paintMarker();
    },
    resize(nextW: number): void {
      w = Math.max(1, nextW);
      layout();
    },
    update(dtMs: number): void {
      if (labelMs >= 0) {
        labelMs += dtMs;
        cloud.scale.set(labelPulse(labelMs));
        cloudFlash.alpha = labelFlashAlpha(labelMs) * 0.6;
        if (labelMs >= LABEL_PULSE_MS) {
          labelMs = -1;
          cloud.scale.set(1);
          cloudFlash.alpha = 0;
        }
      }
      if (bossMs >= 0) {
        bossMs += dtMs;
        const k = bossPulse(bossMs);
        // 색은 한 번만 바꾼다 — 매 프레임 다시 그리면 레일 하나 때문에
        // 지오메트리를 60번/초 재빌드한다
        if (!bossRed) {
          bossRed = true;
          paintSkull(STATE_ALERT);
        }
        skull.alpha = 0.5 + 0.5 * k;
        skull.scale.set(1 + 0.18 * k);
        // 무한 펄스다 — BOSS_PULSE_MS로 나눈 나머지를 쓰므로 값이 커지는 것만 막는다
        if (bossMs > BOSS_PULSE_MS * 1000) bossMs %= BOSS_PULSE_MS;
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
