import { Container, Text } from "pixi.js";
import type { Rng } from "../../core/rng";
import { formatInt } from "../format";
import { ART_PX } from "./shapeRules";
import {
  ACCENT_GOLD,
  FIELD_TEXT_STROKE,
  FONT_FAMILY,
  T_DMG,
  TEAM_THEIRS,
  UI_OUTLINE,
  UI_TEXT,
  fontWeightOf,
} from "../theme";
import {
  CROWD_RADIUS_PX,
  type DamageKind,
  POOL_SIZE,
  THEIRS_SCALE,
  isExpired,
  motionAt,
  nextSlot,
  shouldMerge,
  staggerOffset,
} from "./damageTextRules";

export type { DamageKind };

/**
 * 데미지 숫자 레이어 (40개 링버퍼 풀).
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C6
 *
 * **미러 보정에 대한 설계 편차**: §C6은 상대 필드가 반전 컨테이너 안에 있으므로
 * `Text`마다 역보정을 걸라고 한다. 대신 이 레이어를 **반전 컨테이너 밖**(`view`
 * 직속)에 두고 좌표만 변환해서 넣는다 — 역보정을 빼먹을 여지가 아예 없고,
 * 스케일이 곱해지는 크리티컬 팝 연출과 부호가 꼬이지도 않는다.
 * 반전 여부는 `battleField`가 좌표를 넘길 때(`flipX`) 흡수한다.
 *
 * (반전 축은 상하 → **좌우**로 바뀌었다. 좌우 반전은 숫자를 거울 글자로 만들기
 * 때문에 이 "밖에 두고 좌표만 변환한다"가 더 중요해졌다.)
 */

/** 지터 범위 ±px. 같은 자리에 여러 개가 겹쳐 한 덩어리로 보이는 걸 막는다 */
const JITTER_PX = 14;

interface Slot {
  text: Text;
  active: boolean;
  elapsedMs: number;
  baseX: number;
  baseY: number;
  kind: DamageKind;
  jitterX: number;
  /** 합산용 누적값 */
  amount: number;
}

export interface DamageSpawn {
  /** 필드 로컬 좌표 (반전은 호출자가 이미 흡수했다) */
  x: number;
  y: number;
  amount: number;
  kind?: DamageKind;
}

export interface DamageTextLayer {
  view: Container;
  spawn(s: DamageSpawn): void;
  update(dtMs: number): void;
  /** 저사양 폴백 3단계에서 상대 필드 숫자를 먼저 끈다 (§07-10-1) */
  setEnabled(on: boolean): void;
  destroy(): void;
}

function colorFor(kind: DamageKind): number {
  if (kind === "crit") return ACCENT_GOLD;
  if (kind === "interference") return TEAM_THEIRS;
  return UI_TEXT;
}

export function createDamageTextLayer(opts: {
  rng: Rng;
  /** 상대 필드는 0.85 (§C6) */
  mine: boolean;
}): DamageTextLayer {
  const view = new Container();
  const baseScale = opts.mine ? 1 : THEIRS_SCALE;
  /**
   * 숫자는 **양 필드 모두 위로** 떠오른다.
   *
   * 예전에는 방향을 뒤집는 `flipMotion` 옵션이 있었다 — 상대 필드가 상하
   * 반전이던 시절엔 지면이 위(게이지 바)에 붙어서 그대로 두면 숫자가 게이지
   * 바를 침범했다. 반전을 좌우로 바꾼 뒤로는 두 필드의 지면이 모두 아래에
   * 있으므로 "머리 위로 떠오른다"가 양쪽에서 같은 의미다.
   */
  const slots: Slot[] = [];

  for (let i = 0; i < POOL_SIZE; i++) {
    const text = new Text({
      text: "",
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: T_DMG.size,
        fontWeight: fontWeightOf(T_DMG),
        fill: UI_TEXT,
        // 기본 4px보다 두껍게. 숫자가 적의 몸통 위에 뜨는데 리그가 어두워서
        // 4px로는 경계가 녹았다 (스크린샷에서 확인)
        stroke: { ...FIELD_TEXT_STROKE, width: 6 },
        // 어두운 배경 위 판독성을 확보한다. 그림자는 아웃라인만으로 안 되는
        // 케이스(같은 명도 대비)를 메운다.
        //
        // **번지지 않는다**(blur 0). 도트 폰트 글자에 가우시안 블러를 걸면
        // 획 주변이 회색 뭉개짐이 되어, 도트로 찍힌 글자가 벡터 폰트처럼 보인다.
        // 거리는 아트 픽셀 한 칸 — 도트 게임의 하드 섀도가 이 모양이다.
        dropShadow: {
          color: UI_OUTLINE,
          alpha: 0.9,
          blur: 0,
          distance: ART_PX,
          angle: Math.PI / 2,
        },
        align: "center",
      },
    });
    text.anchor.set(0.5);
    text.visible = false;
    // 풀은 만들어두고 재사용만 한다 — 판중 Text 생성은 텍스처 아틀라스를 흔든다
    view.addChild(text);
    slots.push({
      text,
      active: false,
      elapsedMs: 0,
      baseX: 0,
      baseY: 0,
      kind: "normal",
      jitterX: 0,
      amount: 0,
    });
  }

  let cursor = 0;
  let enabled = true;
  /** 이번 프레임에 띄운 개수와 마지막 슬롯 — 합산 판정용 */
  let spawnedThisFrame = 0;
  let lastSlot = -1;

  const paint = (s: Slot): void => {
    s.text.text = formatInt(s.amount);
    s.text.style.fill = colorFor(s.kind);
  };

  const apply = (s: Slot): void => {
    const m = motionAt(s.elapsedMs, s.kind, s.jitterX);
    s.text.position.set(s.baseX + m.dx, s.baseY + m.dy);
    s.text.alpha = m.alpha;
    s.text.scale.set(baseScale * m.scale);
  };

  return {
    view,
    spawn(sp: DamageSpawn): void {
      if (!enabled) return;
      const amount = Number.isFinite(sp.amount) ? Math.max(0, sp.amount) : 0;
      // 1 미만은 띄우지 않는다. 60fps 틱당 딜은 소수점이 나오므로 "0"이 쏟아진다
      if (amount < 1) return;
      const kind = sp.kind ?? "normal";

      // 한 프레임에 너무 많으면 직전 숫자에 합산한다 — 숫자 폭포 방지 (§07-4-4)
      const prev = lastSlot >= 0 ? slots[lastSlot] : undefined;
      if (
        prev?.active &&
        prev.kind === kind &&
        shouldMerge(spawnedThisFrame, opts.mine)
      ) {
        prev.amount += amount;
        paint(prev);
        return;
      }

      // 같은 자리에 살아있는 숫자를 센다. 누적기가 250ms마다 내보내는데
      // 수명이 700ms라 한 적 위에 최대 3개가 겹친다 (damageTextRules 주석)
      let crowd = 0;
      for (const other of slots) {
        if (!other.active) continue;
        if (
          Math.abs(other.baseX - sp.x) < CROWD_RADIUS_PX &&
          Math.abs(other.baseY - sp.y) < CROWD_RADIUS_PX * 2
        ) {
          crowd += 1;
        }
      }

      const s = slots[cursor]!;
      cursor = nextSlot(cursor);
      spawnedThisFrame += 1;
      lastSlot = slots.indexOf(s);

      s.active = true;
      s.elapsedMs = 0;
      s.baseX = sp.x;
      s.baseY = sp.y + staggerOffset(crowd);
      s.kind = kind;
      s.amount = amount;
      s.jitterX = (opts.rng.next() * 2 - 1) * JITTER_PX;
      s.text.visible = true;
      paint(s);
      apply(s);
    },
    update(dtMs: number): void {
      spawnedThisFrame = 0;
      lastSlot = -1;
      for (const s of slots) {
        if (!s.active) continue;
        s.elapsedMs += dtMs;
        if (isExpired(s.elapsedMs)) {
          s.active = false;
          s.text.visible = false;
          continue;
        }
        apply(s);
      }
    },
    setEnabled(on: boolean): void {
      enabled = on;
      if (on) return;
      for (const s of slots) {
        s.active = false;
        s.text.visible = false;
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
