/**
 * 강화 UI(하단 강화 줄 + 접이식 시트)의 순수 규칙.
 * `single/upgradePanel.ts`(Pixi)가 소비한다.
 *
 * 배치(2026-08-03 정호 확정 — 접이식 하단 시트안):
 * 전장을 크게 유지하고, 스킬바(아래 18%) 바로 위에 강화 버튼 줄을 상시
 * 노출한다. 줄에서 위로 끌면 전체 강화 목록 시트가 올라온다.
 */

import { DESIGN_W, DESIGN_H, SKILLBAR_RATIO } from "../shared/viewport";
import { HEADER_H, PAD_PANEL } from "../shared/ui/shapeRules";
import { DRAW_COST, canDraw } from "../core/deck/deck";
import { formatGold } from "../shared/format";
// 배너 띠의 아래 끝. 시트가 위로 자라 이 선을 넘으면 배너가 헤더를 덮는다
// HUD_H는 전장의 위쪽 경계다 (`SINGLE_FIELD_H`)
import { BANNER_BOTTOM_Y, HUD_H } from "./diveHudRules";
import {
  UPGRADE_IDS,
  upgradeCost,
  upgradeDefOf,
  type UpgradeId,
  type UpgradeLevels,
} from "./economyRules";

/** 강화 줄 높이 — 이만큼 전장 아래를 떼어 쓴다 */
export const UPGRADE_ROW_H = 96;

/** 강화 줄의 y (스킬바 바로 위) */
export const UPGRADE_ROW_Y = DESIGN_H * (1 - SKILLBAR_RATIO) - UPGRADE_ROW_H;

/**
 * 싱글 전장의 높이 — HUD 아래부터 강화 줄 위까지.
 *
 * **왜 규칙에 올렸나 (2026-08-07):** `session.ts`가 이 산수를 직접 하고 있었고,
 * 그래서 **전장이 몇 px인지 아무도 물어볼 수 없었다.** 그 사이 이펙트 크기는
 * `allyDisplayPx()`를 인자 없이 불러 PvP 기준 필드(512)로 계산했다 — 싱글은
 * 800이라 이펙트가 캐릭터 키의 42%가 아니라 27%로 나왔다(1:1 캡처로 확인).
 * 검사가 두 모드의 필드 높이를 **다른 값으로** 물으려면 여기 있어야 한다.
 */
export const SINGLE_FIELD_H = UPGRADE_ROW_Y - HUD_H;

export const ROW_MARGIN_X = 20;
export const ROW_BUTTON_GAP = 10;
export const ROW_BUTTON_H = 64;

/**
 * 줄 위 그래버(시트를 끌어올리는 손잡이) 치수.
 *
 * 버튼 자리(`ROW_BUTTON_Y`)가 이 값에서 유도되므로 그 위에 있어야 한다 —
 * `const`는 호이스팅되지 않아서 아래에 두면 모듈 로드가 TDZ로 죽는다.
 */
export const GRABBER_W = 120;
export const GRABBER_H = 8;
export const GRABBER_Y = 6;

/** 줄 안에서 버튼의 위쪽 y (그래버 아래, 세로 중앙) */
export const ROW_BUTTON_Y = (UPGRADE_ROW_H - ROW_BUTTON_H) / 2 + GRABBER_Y;

/**
 * 줄 버튼의 탭 관용 한도 (`ui/button.tapRoom`).
 *
 * 64px이라 §3-4의 88에 24px 모자라고 위아래 12px씩이 필요한데, 줄이 96px밖에
 * 안 되어 아래로는 10px만 남는다(버튼 아래 끝 86 / 줄 끝 96). 줄 밖으로 넘기면
 * **스킬바 쪽으로 새고**, 그 아래는 엄지가 가장 많이 오는 밴드다.
 *
 * 좌우는 서로 10px 떨어진 이웃 버튼이므로 **간격의 절반씩만** 나눠 갖는다 —
 * 안 나누면 두 버튼의 관용이 겹쳐서 경계 픽셀의 주인이 그리는 순서로 정해진다
 * (`강화`를 눌렀는데 `공격 속도`가 올라간다).
 *
 * 위는 그래버(y 6~14)까지 8px이다. 그래버는 그림이지 탭 대상이 아니라(제스처는
 * `diveScene`이 스테이지에서 받는다) 덮어도 눌릴 것이 없지만, 줄 밖으로는
 * 나가지 않게 버튼 위 여백까지만 준다.
 */
export const ROW_BUTTON_TAP_ROOM = {
  top: ROW_BUTTON_Y,
  bottom: UPGRADE_ROW_H - (ROW_BUTTON_Y + ROW_BUTTON_H),
  left: ROW_BUTTON_GAP / 2,
  right: ROW_BUTTON_GAP / 2,
} as const;

/** 줄 버튼 폭 — 4칸 균등 */
export function rowButtonW(count = UPGRADE_IDS.length): number {
  const n = Math.max(1, count);
  return Math.floor((DESIGN_W - ROW_MARGIN_X * 2 - ROW_BUTTON_GAP * (n - 1)) / n);
}

export function rowButtonX(index: number, count = UPGRADE_IDS.length): number {
  return ROW_MARGIN_X + index * (rowButtonW(count) + ROW_BUTTON_GAP);
}

/**
 * 시트(전체 목록) 치수.
 *
 * **높이를 손으로 적지 않는다 — 남은 화면에서 유도한다.** 3단계에서 행이 하나
 * 늘었을 때(카드 뽑기) `SHEET_H = 826`을 손으로 박았고, 그게 캡처로 잡힌
 * 결함이 됐다: 시트는 스킬바 위에 붙어 **위로** 자라므로 헤더("강화")가 배너
 * 띠(169.6~241.6)에 들어가 `2층 돌파` 배너가 헤더를 덮었다. 배너는 `fx`
 * 레이어라 시트보다 위에 그려지고 900ms만 뜨므로 조용한 겹침이다.
 *
 * **그래서 방향을 뒤집었다: 화면이 높이를 정하고, 내용이 거기 맞춰야 한다.**
 * 위는 배너 띠 아래, 아래는 스킬바 위 — 두 선 사이가 시트의 전부다. 이렇게
 * 두면 배너와의 겹침이 **구조적으로 불가능**하다(높이를 늘릴 여지가 없다).
 *
 * 대가는 행이 늘 때 조용히 넘칠 수 있다는 것이고, 그건 `sheetFits`가 본다 —
 * 넘치면 닫기 버튼이 패널 밖으로 나가고 그건 "시트를 열면 닫을 수 없다"다
 * (스크림 탭을 아는 사람만 빠져나온다). 그때 손볼 것은 높이가 아니라 **행
 * 높이나 스크롤**이다.
 */
export const SHEET_W = DESIGN_W - 48;

/** 배너 띠 / 스킬바와 시트 사이 여백 */
export const SHEET_GAP_Y = 8;

export const SHEET_X = 24;
/** 시트 top — 배너 띠 바로 아래에 고정한다 (위로 더 자라지 않는다) */
export const SHEET_Y = BANNER_BOTTOM_Y + SHEET_GAP_Y;
export const SHEET_H =
  DESIGN_H * (1 - SKILLBAR_RATIO) - SHEET_GAP_Y - SHEET_Y;

/**
 * 시트의 딤이 어둡게 **칠할** 구역 — HUD 밴드 아래 전부.
 *
 * ## 왜 전면이 아닌가 (2026-08-07)
 *
 * 시트가 `layers.fx`(최상단)로 올라가면서(`diveLayerRules`의 세 부등식) 전면
 * 딤이 **HUD 위에** 앉았다. 1:1 캡처 실측: 골드 필 명도 0.28 → 0.10(2.8배),
 * 심연석 필 0.35 → 0.12, 층 숫자 0.28 → 0.10.
 *
 * 하필 그 셋이 이 시트를 쓸 때 **읽어야 하는 수다.** 시트 안에는 골드 필이
 * 없고 심연석 필도 HUD에 있다(`drawEffectLabel` 주석이 그래서 잔고를 행 설명에
 * 다시 적는다). 강화 화면이 하는 일은 비용과 잔고의 뺄셈인데(`upgradeCostLabel`
 * 주석) 그 뺄셈의 한쪽이 어두워졌다.
 *
 * **z순서를 되돌리는 것으로는 못 푼다** — 시트가 이펙트 위여야 하는 이유가
 * `diveLayerRules`에 부등식으로 남아 있다(이펙트에 글자가 묻혔던 결함이다).
 * 고칠 것은 순서가 아니라 딤의 **면적**이다.
 *
 * HUD 아래를 경계로 잡는 이유: 시트가 가리려는 것은 전장이고(하강이 계속 돌아서
 * 시선이 끌린다) 남겨야 하는 것은 잔고다. 그 둘의 경계가 정확히 HUD 밴드
 * 아래다. 강화 줄·스킬바는 딤 안에 남는다 — 시트가 열린 동안 쓸 수 없는
 * 것들이므로 어두운 게 맞다.
 *
 * **탭 삼키기는 전면이다.** 딤을 좁힌다고 히트 영역까지 좁히면 시트 위에서
 * HUD의 타이틀 버튼이 눌려 씬이 바뀐다 — `scrimRules.scrimDimRect` 주석에
 * 그 부등식이 있다.
 */
export const SHEET_DIM_RECT = {
  x: 0,
  y: HUD_H,
  w: DESIGN_W,
  h: DESIGN_H - HUD_H,
} as const;

/**
 * 행 높이 — 위 예산에 5행 + 닫기가 들어가는 값이다(`sheetFits`가 지킨다).
 * 행 안에서 가장 큰 것은 88px 강화 버튼이므로 그보다는 커야 한다.
 */
export const SHEET_ROW_H = 106;
export const SHEET_ROW_GAP = 14;

/** 닫기 버튼 치수·행과의 간격 */
export const SHEET_CLOSE_W = 200;
export const SHEET_CLOSE_H = 68;
export const SHEET_CLOSE_GAP = 8;

/**
 * 시트 안쪽 여백 — 패널이 위아래로 `PAD_PANEL`씩 준다. **여기에 48을 적지
 * 않는다**: 패딩을 바꾸면 이 예산이 조용히 틀린다(그 증상은 닫기 버튼이 패널
 * 밖으로 나가는 것이라 시트를 열어 봐야 보인다).
 */
export const SHEET_PAD = PAD_PANEL * 2;

/** 시트 총 행 수 — 강화 4 + 뽑기 1 (3단계). `sheetFits`가 이 수를 본다 */
export const SHEET_ROWS = UPGRADE_IDS.length + 1;

/** 뽑기 행의 자리 (강화 행 다음) */
export const DRAW_ROW_INDEX = UPGRADE_IDS.length;

/**
 * `rows`개 행 + 닫기 버튼이 시트 안에 들어가는가.
 *
 * 높이는 이제 화면이 정하므로(`SHEET_H` 주석) 이쪽이 **넘치는지만** 본다 —
 * 예전에는 높이를 키워 늘 통과시킬 수 있었고, 실제로 3단계에서 그렇게 했다가
 * 배너와 겹쳤다. 지금은 여유가 없는 예산이라 행을 하나 더 얹으면 여기서 깨진다.
 */
export function sheetFits(rows: number = SHEET_ROWS): boolean {
  const n = Math.max(0, Math.floor(rows));
  const innerH = SHEET_H - SHEET_PAD - HEADER_H;
  const used =
    n * (SHEET_ROW_H + SHEET_ROW_GAP) + SHEET_CLOSE_GAP + SHEET_CLOSE_H;
  return used <= innerH;
}

export const SHEET_OPEN_MS = 260;

/** 시트를 여는 위 드래그 최소 거리(강화 줄에서 시작한 제스처) */
export const SHEET_DRAG_OPEN_PX = 40;

/** 버튼 라벨: "공격력 Lv.3" */
export function upgradeButtonLabel(id: UpgradeId, level: number): string {
  return `${upgradeDefOf(id).name} Lv.${Math.max(0, Math.floor(level))}`;
}

/**
 * 버튼 서브라벨: 비용 또는 MAX.
 *
 * **골드 필과 같은 함수로 쓴다 (2026-08-07).** 강화 화면이 하는 일은 비용과
 * 잔고의 뺄셈인데, 한쪽만 축약하면 `1.15M G` 버튼과 `1,154,837 G` 필이 나란히
 * 서서 같은 수인지 알 수 없다. 임계값(100만) 아래는 둘 다 콤마라 초반 뺄셈은
 * 그대로다 — `shared/format.formatGold` 주석의 유도가 그 지점을 정한다.
 */
export function upgradeCostLabel(id: UpgradeId, level: number): string {
  const cost = upgradeCost(id, level);
  if (cost === null) return "MAX";
  return formatGold(cost);
}

/**
 * 시트 상세 행의 효과 설명 — 현재 배율을 사람이 읽는 말로.
 * 수치는 economyRules가 정본이고 여기는 표기만 한다.
 */
export function upgradeEffectLabel(id: UpgradeId, level: number): string {
  const def = upgradeDefOf(id);
  const lv = Math.max(0, Math.floor(level));
  const mul = Math.pow(def.effectGrowth, lv);
  switch (id) {
    case "atk":
      return `팀 공격력 ×${mul.toFixed(2)}`;
    case "spd":
      return `공격 간격 ×${mul.toFixed(2)}`;
    case "gold":
      return `골드 획득 ×${mul.toFixed(2)}`;
    case "skill":
      return `스킬 위력 ×${mul.toFixed(2)}`;
  }
}

/* ── 카드 뽑기 행 (3단계)
 *
 * 강화 시트에 얹는 이유: 뽑기는 "번 것을 쓴다"라 강화와 같은 동작이고, 화면을
 * 하나 더 만들면 하강 중에 들를 곳이 둘이 된다. 시트는 이미 스크림·닫기·행
 * 레이아웃을 가졌으므로 행 하나를 더 붙이는 것이 가장 적은 추가다.
 */

export function sheetRowY(index: number): number {
  return Math.max(0, Math.floor(index)) * (SHEET_ROW_H + SHEET_ROW_GAP);
}

/** 닫기 버튼의 y — 마지막 행 아래 */
export function sheetCloseY(rows: number = SHEET_ROWS): number {
  return sheetRowY(rows) - SHEET_ROW_GAP + SHEET_CLOSE_GAP;
}

export const DRAW_ROW_NAME = "카드 뽑기";

/** 뽑기 버튼 서브라벨 — 비용 */
export function drawCostLabel(): string {
  return `${DRAW_COST} 심연석`;
}

/**
 * 뽑기 행 설명 — 지금 잔고로 몇 번 뽑는지까지 적는다.
 *
 * 비용만 적으면 "왜 못 누르는가"가 안 보인다: 이 시트에는 골드 필이 없고
 * 심연석 필은 HUD 위쪽에 있어서, 비활성 버튼과 잔고가 한눈에 안 들어온다.
 */
export function drawEffectLabel(abyss: number | null): string {
  if (abyss === null) return "심연석 잔고 확인 불가";
  const n = Math.floor(Math.max(0, abyss) / DRAW_COST);
  return `심연석 ${Math.max(0, Math.floor(abyss)).toLocaleString("en-US")} · ${n}회 가능`;
}

/**
 * 뽑기 버튼 상태. `core/deck.canDraw`가 판정의 정본이고 여기는 UI 상태로만
 * 옮긴다 — 잔고 실패(null)는 강화와 같이 비활성이다.
 */
export function drawButtonState(abyss: number | null): "ready" | "disabled" {
  return canDraw(abyss) ? "ready" : "disabled";
}

/** 강화 버튼 상태 — 잔고 실패(null)는 전부 비활성 */
export function upgradeButtonState(
  gold: number | null,
  id: UpgradeId,
  levels: UpgradeLevels,
): "ready" | "disabled" {
  const cost = upgradeCost(id, levels[id]);
  if (cost === null || gold === null || !Number.isFinite(gold)) return "disabled";
  return gold >= cost ? "ready" : "disabled";
}
