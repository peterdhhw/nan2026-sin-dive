/**
 * 배경 배치의 순수 규칙 — 레이어 구성, 패럴랙스, 타일 폭 유도, 결정론적 프롭 배치.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §2 (BackgroundStage)
 *
 * Pixi를 import하지 않는다 (`background.ts`가 재export한다).
 *
 * **왜 순수 모듈이 필요한가**: 배치가 결정론이어야 한다. 같은 웨이브 seed면
 * 상/하 필드와 재접속 후가 모두 같은 그림이어야 하는데, `Math.random()`을
 * 한 번 쓰면 그 순간 재현이 불가능해지고 스크린샷 회귀도 성립하지 않는다.
 * 또 무한 스크롤 랩어라운드는 부호 하나만 틀려도 배경이 통째로 사라지는데,
 * 그건 스크린샷으로는 "왜 없지?"로만 보인다 — 테스트로 잡아야 하는 종류다.
 */

import { createRng } from "../core/rng";
import { mixColor } from "./color";
import type { BgAtlasName } from "./fxManifest";
import type { WaveTheme } from "./theme";

/** 지면 상단 y = 필드 높이 × 이 비율. `battleFieldRules.GROUND_RATIO`와 같아야 한다 */
export const BG_GROUND_RATIO = 0.88;

/**
 * 배경 삽화 3겹의 패럴랙스 계수·알파 (뒤 → 앞).
 *
 * 설계 문서 §2의 6레이어 표에서 원경/중경/근경 3겹만 뽑은 것이다.
 * 하늘(0)·천체(0.05)·지면(1.0)은 스크롤하지 않거나 따로 관리한다.
 *
 * **개체를 뿌리지 않고 띠 한 장을 잇는다.** 예전에는 단색 실루엣 스프라이트
 * 5개를 결정론으로 배치했는데, 그러면 나무 5그루가 흩어진 그림밖에 안 나오고
 * 지상·심연이 "같은 나무의 색만 다른 것"이 됐다 — 그게 배경이 허접했던 원인이다.
 * 이제 테마별로 그린 삽화(`scenery_*` 아틀라스)를 좌우로 이어 붙인다.
 *
 * **크기는 여기 없다.** 표시 높이는 아틀라스 region의 `ratio`(생성기의
 * `h_ratio`)에서 오고, 타일 폭은 텍스처 종횡비에서 유도한다. 그림의 치수를
 * 그림 밖에 적으면 생성기를 고쳐도 화면이 안 바뀐다.
 */
export interface SceneryLayerSpec {
  /** 아틀라스 region 키. 원경 → 근경 */
  readonly region: "far" | "mid" | "near";
  /** 0 = 정지, 1 = 지면과 같은 속도 */
  readonly parallax: number;
  /**
   * 하늘 위로 얼마나 지워 보이는지 = 대기 원근.
   * 원경을 0.45로 깔면 하늘색이 배어 나와 안개가 된다 — 그림에 안개를 그려
   * 넣는 것보다 낫다(테마 하늘색이 바뀌면 같이 따라온다).
   */
  readonly alpha: number;
  /** 지면선을 기준으로 얼마나 아래로 내려 밟는지 (필드 높이 비율) */
  readonly sink: number;
}

export const SCENERY_LAYERS: readonly SceneryLayerSpec[] = [
  { region: "far", parallax: 0.15, alpha: 0.45, sink: 0.0 },
  { region: "mid", parallax: 0.35, alpha: 0.75, sink: 0.012 },
  { region: "near", parallax: 0.7, alpha: 1.0, sink: 0.028 },
];

/**
 * 테마 → 삽화 아틀라스 이름. `gen_bg_art.py`의 `build_atlas`와 같은 규칙이다.
 *
 * 반환형을 `BgAtlasName`으로 좁혀 둔다 — 테마를 늘리면 `BG_ATLASES`에 아틀라스를
 * 넣기 전까지 **컴파일이 안 된다**. `string`이면 조용히 통과하고 런타임에
 * 배경 한 겹이 사라진다(하늘만 남은 필드는 스크린샷으로 원인을 알기 어렵다).
 */
export function sceneryAtlas(themeId: WaveTheme["id"]): BgAtlasName {
  return `scenery_${themeId}`;
}

/**
 * 타일 폭 = 표시 높이 × 텍스처 종횡비.
 *
 * 폭을 상수로 잡으면 그림이 늘어난다(예전 `TILE_W = 900`). 종횡비를 지키는
 * 대신 폭이 필드 폭보다 좁을 수 있으므로, 몇 장이 필요한지는 호출부가 센다.
 */
export function sceneryTileW(
  texW: number,
  texH: number,
  displayH: number,
): number {
  if (!(texH > 0) || !(texW > 0) || !(displayH > 0)) return 0;
  return (displayH * texW) / texH;
}

/**
 * 필드 폭을 덮는 데 필요한 타일 장수.
 *
 * +1은 스크롤 여유다 — 왼쪽으로 한 장이 빠져 나가는 동안 오른쪽 끝이 비면
 * 하늘만 남은 세로 띠가 화면을 지나간다.
 */
export function sceneryTileCount(fieldW: number, tileW: number): number {
  if (!(tileW > 0) || !(fieldW > 0)) return 0;
  return Math.ceil(fieldW / tileW) + 1;
}

/** 천체·발광 레이어의 패럴랙스 (구름 / 균열) */
export const CELESTIAL_PARALLAX = 0.05;

/**
 * 전투 중 기준 스크롤 속도(px/s, 패럴랙스 1.0 기준).
 *
 * **아주 느려야 한다.** 빠르면 캐릭터가 뛰는 것처럼 보이는데, 우리 게임은
 * 고정 위치 자동전투다 — 그림과 규칙이 어긋나면 배경이 거짓말을 한다 (§2).
 */
export const SCROLL_IDLE_PX_S = 12;
/** 웨이브 클리어 전진 연출에서만 쓰는 속도 (8단계에서 배선) */
export const SCROLL_ADVANCE_PX_S = 240;

/**
 * 스크롤 오프셋을 타일 폭 안으로 접는다.
 *
 * 두 장을 이어 붙여 무한 스크롤하므로 오프셋은 항상 `[0, tileW)`여야 한다.
 * **음수 모듈로가 함정이다**: JS의 `%`는 음수를 유지하므로 왼쪽으로 스크롤할 때
 * `-3 % 100 === -3`이 되고, 그 상태로 두 장을 배치하면 오른쪽 끝에 빈 틈이 생긴다.
 */
export function wrapScroll(offsetPx: number, tileW: number): number {
  if (!(tileW > 0) || !Number.isFinite(offsetPx)) return 0;
  const m = offsetPx % tileW;
  return m < 0 ? m + tileW : m;
}

/** 경과 시간만큼 오프셋을 전진시킨다 (dt 기반이라 프레임레이트에 무관) */
export function advanceScroll(
  offsetPx: number,
  speedPxPerSec: number,
  parallax: number,
  dtMs: number,
  tileW: number,
): number {
  if (!(dtMs > 0)) return wrapScroll(offsetPx, tileW);
  return wrapScroll(offsetPx + (speedPxPerSec * parallax * dtMs) / 1000, tileW);
}

/** 필드 높이 → 지면 상단 y */
export function groundY(fieldH: number): number {
  return fieldH * BG_GROUND_RATIO;
}

/**
 * 축소 표현 2단계 (§1-2).
 *
 * 필드가 420px 아래로 줄면 원경(far)을 생략한다 — 3겹이 235px 안에 겹치면
 * 서로를 지워 얼룩으로 보이고, 드로우콜만 늘어난다.
 */
export const COMPACT_FIELD_H = 420;

export function fieldDetailLevel(fieldH: number): "full" | "compact" {
  return fieldH >= COMPACT_FIELD_H ? "full" : "compact";
}

/** `compact`에서 그리는 삽화 레이어 인덱스 (원경 생략) */
export function visibleSceneryLayers(fieldH: number): readonly number[] {
  return fieldDetailLevel(fieldH) === "full" ? [0, 1, 2] : [1, 2];
}

// ── 지면 장식·천체 (삽화와 달리 개체를 뿌린다 — 지면 위에 서는 작은 것들)

/** 테마별 지면 장식 region */
export const THEME_PROPS: Record<WaveTheme["id"], readonly string[]> = {
  surface: ["tuft_a", "tuft_b", "tuft_c", "pebble"],
  abyss: ["crystal", "pebble"],
};

/** 테마별 천체/발광 region */
export const THEME_CELESTIALS: Record<WaveTheme["id"], readonly string[]> = {
  surface: ["cloud_a", "cloud_b"],
  abyss: ["crack"],
};

export interface PropPlacement {
  readonly region: string;
  readonly xr: number;
  readonly scale: number;
  readonly flip: boolean;
}

/** 지면 장식 개수 — 지면 밴드가 얇아서 이 이상은 지저분해진다 */
export const PROPS_PER_FIELD = 7;

/** 지면 장식 배치. 지면 위에 서므로 y는 항상 지면선이다 */
export function propPlacements(
  themeId: WaveTheme["id"],
  seed: number,
  count: number = PROPS_PER_FIELD,
): PropPlacement[] {
  const regions = THEME_PROPS[themeId];
  if (regions.length === 0 || count <= 0) return [];
  const rng = createRng(seed * 131 + 977);
  const out: PropPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const slot = (i + 0.5) / count;
    out.push({
      region: regions[rng.int(regions.length)]!,
      xr: Math.min(1, Math.max(0, slot + (rng.next() - 0.5) / count)),
      scale: 0.7 + rng.next() * 0.5,
      flip: rng.next() < 0.5,
    });
  }
  return out;
}

export interface CelestialPlacement {
  readonly region: string;
  readonly xr: number;
  /** 하늘 구간(지면 위) 안의 y 비율 0..1 */
  readonly yr: number;
  readonly scale: number;
  readonly alpha: number;
}

/** 천체 개수 (§2: 구름 2~3개 / 균열) */
export const CELESTIALS_PER_FIELD = 3;

export function celestialPlacements(
  themeId: WaveTheme["id"],
  seed: number,
  count: number = CELESTIALS_PER_FIELD,
): CelestialPlacement[] {
  const regions = THEME_CELESTIALS[themeId];
  if (regions.length === 0 || count <= 0) return [];
  const rng = createRng(seed * 733 + 401);
  const out: CelestialPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const slot = (i + 0.5) / count;
    out.push({
      region: regions[rng.int(regions.length)]!,
      xr: Math.min(1, Math.max(0, slot + (rng.next() - 0.5) / count)),
      // 하늘 상단 8~52% 구간. 아래로 내려오면 캐릭터 머리와 겹친다
      yr: 0.08 + rng.next() * 0.44,
      scale: 0.6 + rng.next() * 0.55,
      alpha: 0.55 + rng.next() * 0.35,
    });
  }
  return out;
}

/**
 * 하늘 그라디언트 단계 수.
 *
 * Pixi에는 저렴한 세로 그라디언트가 없어서 가로 띠를 여러 장 겹쳐 근사한다.
 * 10단이면 240px 높이에서 띠 하나가 24px — 색차가 눈에 안 띄는 한계다.
 */
export const SKY_STEPS = 10;

/** 0..1 → 두 색 사이 선형 보간. 하늘 띠와 테마 크로스페이드가 같이 쓴다 */
export { mixColor };

/** i번째 하늘 띠의 색 */
export function skyBandColor(
  theme: Pick<WaveTheme, "skyTop" | "skyBottom">,
  index: number,
  steps: number = SKY_STEPS,
): number {
  if (steps <= 1) return theme.skyTop;
  const t = Math.max(0, Math.min(steps - 1, index)) / (steps - 1);
  return mixColor(theme.skyTop, theme.skyBottom, t);
}

/**
 * 테마 크로스페이드 진행도 0..1 (`-1` 센티넬 = 전환 중 아님 → 1).
 *
 * `theme.THEME_FADE_MS`를 인자로 받는다 — 여기서 다시 상수를 정의하면
 * 두 값이 갈라진다.
 */
export function themeFade(elapsedMs: number, durationMs: number): number {
  if (elapsedMs < 0 || !(durationMs > 0)) return 1;
  return Math.max(0, Math.min(1, elapsedMs / durationMs));
}
