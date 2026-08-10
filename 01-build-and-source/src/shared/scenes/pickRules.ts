/**
 * 캐릭터 선택의 순수 규칙 — 격자 배치, 저장/복원, 대기 화면 안의 자리.
 *
 * 설계 문서: specs/2026-07-27-ux/05-scene-matchmaking.md §8 (이 파일과 함께 추가)
 *
 * Pixi를 import하지 않는다 (`matchScene.ts`가 쓴다).
 *
 * ## 왜 별도 씬이 아니라 대기 화면 안인가 (결정 기록)
 *
 * 유저 지시는 "**대기화면에** 캐릭터 선택 단계"다. 새 씬을 앞에 세우는 안을
 * 먼저 그렸다가 접었다 — §05-0이 "첫 화면까지 ~9.6초, **탭 0회**"를 이 게임의
 * 첫인상 규칙으로 못 박아 놨고, 선택 씬을 세우면 탭이 1회 이상으로 늘고 그만큼
 * 전투가 늦어진다. 매칭 5초는 이미 **비어 있는 시간**이라(그 5초를 구경거리로
 * 바꾸는 것이 §05 전체의 존재 이유다) 여기에 얹으면 시간이 0초 늘어난다.
 *
 * 그래서 기본값을 미리 골라 둔 상태로 시작한다 — 아무것도 안 누르면 예전과
 * 똑같이 흘러가고, 누르면 그 5초 안에 바뀐다.
 *
 * ## 확정 뒤에는 못 바꾼다
 *
 * 확정 연출(§05-5)이 시작되면 슬롯이 이미 그 캐릭터로 그려지고, `VsScene`이
 * 로드아웃을 들고 세션을 만든다(§06-5). 그 뒤에 바꾸면 화면과 세션이 갈린다.
 * `pickLocked`가 그 경계다.
 */

import { PICK_SLUGS, type HeroSlug } from "../charManifest";
import { appStore, type AppStore } from "../store";
import { DESIGN_H, DESIGN_W } from "../viewport";

/** 내 캐릭터를 기억한다 — 매판 다시 고르게 하면 선택이 귀찮은 일이 된다 */
export const PICK_STORAGE_KEY = "abyss.pick.lead";

/**
 * 격자 열 수. **2열 = 2+2**다.
 *
 * 7종 시절의 근거는 "4열로 놓으면 4+3이 되어 둘째 줄이 비뚤어 보인다"였고 그래서
 * 3열이었다. 4종에서는 같은 근거가 2열을 가리킨다 — 3열이면 3+1이 되어 마지막 칸
 * 하나가 혼자 남고, 그 모양을 앞선 주석이 "특별한 캐릭터로 읽힌다"고 기각했다.
 *
 * 칸이 4개면 칸당 면적이 커진다. 그것이 확정 버튼·미리보기를 파고들지 않는지는
 * `pickLayout`이 계산하고 테스트가 묻는다.
 */
export const PICK_COLS = 2;

/** 격자 행 수 — 4종 2열이면 2행이다. **분모가 목록 길이다**(상수로 박으면 목록을
 * 늘린 날 행이 안 늘어난다) */
export const PICK_ROWS = Math.ceil(PICK_SLUGS.length / PICK_COLS);

/**
 * 저장된 선택을 읽는다. 모르는 슬러그·빈 값이면 `null`.
 *
 * **로스터가 바뀌면 저장값이 유효하지 않다** — 자체 생성 4종에서 chierit 7종으로
 * 갈아탄 적이 있고(`HERO_SLUGS` 주석), 그때 남아 있던 `rize`를 그대로 믿으면
 * 프리셋에 없는 슬러그가 1번 자리로 들어가 스킬이 빈다. 목록으로 검증한다.
 *
 * **격자 밖 슬러그도 무효다.** 배포본에서 `ground_monk`를 골라 둔 사람이 있고,
 * 그 값은 `HERO_SLUGS`에는 있지만 격자에는 없다 — 통과시키면 아무 칸도 선택
 * 표시가 없는 화면이 된다. 첫 칸(리제)으로 떨어뜨린다.
 */
export function parseStoredPick(
  raw: string | null | undefined,
): HeroSlug | null {
  if (typeof raw !== "string") return null;
  const hit = PICK_SLUGS.find((s) => s === raw);
  return hit ?? null;
}

/**
 * 기본 선택 — 저장값이 있으면 그것, 없으면 목록 첫 번째.
 *
 * **`undefined`를 돌려주지 않는다.** `PresetLoadoutProvider`는 `leadSlug`가
 * 없으면 목록 순서를 쓰는데, 그러면 "고른 것이 없는 상태"와 "첫 번째를 고른
 * 상태"가 화면에서 구별되지 않는다 — 격자에 아무 칸도 선택 표시가 없어서
 * 유저가 고를 수 있다는 걸 모른다. 항상 하나가 선택돼 있어야 탭 0회가 성립한다.
 */
export function defaultPick(stored: string | null | undefined): HeroSlug {
  return parseStoredPick(stored) ?? PICK_SLUGS[0]!;
}

/**
 * 선택 저장소. **`appStore()`에 위임한다** — 사파리 프라이빗 모드 방어를 두 번
 * 만들지 않는다.
 *
 * 이 함수의 본체가 원래 여기 있었고, 2단계에서 선택 화면을 지울 때 `store.ts`로
 * 옮겨 갔다(그쪽 헤더에 그 이력이 있다). 선택 화면을 되살리면서 본체까지 되살리면
 * 같은 래퍼가 두 벌이 되고, **사본은 갈라진다** — 한쪽에만 방어가 붙는 날 조용히
 * 다르게 동작한다. 이름만 남겨 부르는 쪽의 import 경로를 한 곳으로 유지한다.
 */
export function pickStore(): AppStore {
  return appStore();
}

export function readPick(store: Pick<Storage, "getItem"> | null): HeroSlug {
  if (!store) return defaultPick(null);
  try {
    return defaultPick(store.getItem(PICK_STORAGE_KEY));
  } catch {
    return defaultPick(null);
  }
}

export function writePick(
  store: Pick<Storage, "setItem"> | null,
  slug: HeroSlug,
): void {
  if (!store) return;
  try {
    store.setItem(PICK_STORAGE_KEY, slug);
  } catch {
    // 저장에 실패하면 다음 판에 기본값으로 돌아간다 — 이번 판은 이미 고른
    // 값으로 굴러가므로 화면과 세션이 갈리지는 않는다
  }
}

/** 격자 칸의 행·열 (0부터) */
export function pickCell(index: number): { row: number; col: number } {
  const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  return { row: Math.floor(i / PICK_COLS), col: i % PICK_COLS };
}

/**
 * 칸 하나의 좌상단 좌표(디자인 px).
 *
 * 폭·높이를 인자로 받는다 — 씬이 남은 자리를 재서 넘긴다. 여기에 상수로
 * 박으면 대기 화면 레이아웃이 바뀔 때 격자가 겹치는 것을 테스트가 못 잡는다.
 */
export function pickCellPos(
  index: number,
  o: { x: number; y: number; cellW: number; cellH: number; gap: number },
): { x: number; y: number } {
  const { row, col } = pickCell(index);
  return {
    x: o.x + col * (o.cellW + o.gap),
    y: o.y + row * (o.cellH + o.gap),
  };
}

/**
 * 격자 전체가 차지하는 크기 — 씬이 자리가 있는지 확인하는 데 쓴다.
 * 마지막 줄이 덜 찼어도 **행 수만큼** 높이를 잡는다(빈 칸도 자리를 먹는다).
 */
export function pickGridSize(o: {
  cellW: number;
  cellH: number;
  gap: number;
}): { w: number; h: number } {
  return {
    w: PICK_COLS * o.cellW + (PICK_COLS - 1) * o.gap,
    h: PICK_ROWS * o.cellH + (PICK_ROWS - 1) * o.gap,
  };
}

/** 오버레이 칸 크기 — 격자 폭은 화면의 90%다 */
export const PICK_GRID_W = DESIGN_W * 0.9;
export const PICK_GRID_GAP = 12;
export const PICK_CELL_W =
  (PICK_GRID_W - PICK_GRID_GAP * (PICK_COLS - 1)) / PICK_COLS;
/** 카드 삽화 93px + 이름 한 줄 + 여백 */
export const PICK_CELL_H = 140;
/** 확정 버튼 높이·하단 여백, 격자와 버튼 사이 간격 */
export const PICK_BUTTON_H = 68;
export const PICK_BUTTON_GAP = 32;
export const PICK_BUTTON_MARGIN = 24;
/** 이름 줄이 격자 위에서 차지하는 띠 */
export const PICK_NAME_GAP = 44;
/** 전신 미리보기가 시작하는 y — 위쪽 제목·설명 두 줄 아래 */
export const PICK_PREVIEW_TOP = 120;

/**
 * 오버레이 세로 배치를 한 곳에서 계산한다.
 *
 * **씬에 흩어 놓으면 겹치는 것을 테스트가 못 잡는다.** 전신 삽화는 512px로
 * 구워져 있어서(`portraits.json`) 그대로 놓으면 화면 절반을 먹고 격자를 밀어
 * 낸다 — 남는 높이(`previewH`)를 여기서 재고, 씬은 그 높이에 맞춰 줄이기만 한다.
 *
 * `previewH`가 0 이하면 배치가 성립하지 않는다(격자·버튼이 화면을 다 먹었다).
 */
export function pickLayout(o?: {
  cellW?: number;
  cellH?: number;
  gap?: number;
}): {
  gridY: number;
  nameY: number;
  buttonY: number;
  previewTop: number;
  previewH: number;
} {
  const grid = pickGridSize({
    cellW: o?.cellW ?? PICK_CELL_W,
    cellH: o?.cellH ?? PICK_CELL_H,
    gap: o?.gap ?? PICK_GRID_GAP,
  });
  const buttonY = DESIGN_H - PICK_BUTTON_H - PICK_BUTTON_MARGIN;
  const gridY = buttonY - PICK_BUTTON_GAP - grid.h;
  const nameY = gridY - PICK_NAME_GAP;
  return {
    gridY,
    nameY,
    buttonY,
    previewTop: PICK_PREVIEW_TOP,
    // 이름 줄 위로 20px을 남긴다 — 삽화 발끝이 글자에 닿으면 둘이 한 덩어리로 읽힌다
    previewH: nameY - 20 - PICK_PREVIEW_TOP,
  };
}

/**
 * 미리보기 삽화의 y (`previewTop` 기준 상단 anchor).
 *
 * 유저 신고: "캐릭터 이미지가 조금 더 중앙쪽으로 내려와야 자연스러울 것 같아,
 * 지금 위에 붙어 있어."
 *
 * **원인은 띠가 삽화보다 크다는 것이다.** `select` 삽화는 전부 512px이고
 * (`portraits.json` — 일곱 종 모두), 띠(`previewH`)는 680px이다. 상단에 붙여
 * 놓으면 아래로 168px이 비고, 그 빈 자리가 삽화를 화면 위쪽으로 밀어 올린
 * 것처럼 보인다. **삽화를 옮기는 것이 아니라 남은 자리를 위아래로 나눈다.**
 *
 * 상수 오프셋(예: `+80`)으로 내리지 않는다 — 삽화 높이나 격자 크기가 바뀌면
 * 그 숫자가 근거를 잃고, 최악의 경우 이름 줄을 파고든다
 * (`panels-that-grow-upward`와 같은 병). 남은 자리에서 계산하면 띠가 좁아지면
 * 오프셋도 저절로 0이 된다.
 *
 * @param artH 삽화의 실제 표시 높이(축소 적용 후)
 */
export function pickPreviewY(artH: number, previewH: number): number {
  const h = Number.isFinite(artH) ? Math.max(0, artH) : 0;
  const band = Number.isFinite(previewH) ? Math.max(0, previewH) : 0;
  // 띠보다 큰 삽화는 씬이 이미 줄여서 넘긴다. 그래도 음수가 되지 않게 막는다 —
  // 위로 올라가면 제목을 덮는다
  return Math.max(0, (band - h) / 2);
}

/**
 * 탭이 먹히는가. 확정 연출이 시작된 뒤에는 아니다.
 *
 * @param confirmMs 확정 경과. 음수 = 아직 대기 중
 */
export function pickLocked(confirmMs: number): boolean {
  return Number.isFinite(confirmMs) ? confirmMs >= 0 : true;
}

/**
 * 선택 칸의 강조 테두리 두께. 고른 칸이 **형태로** 구분돼야 한다 —
 * 색만으로는 부족하다(§01-6, 카드 `me`와 같은 규칙).
 */
export function pickBorderWidth(selected: boolean): number {
  return selected ? 5 : 2;
}

/**
 * 고른 순간의 강조 펄스(0~1). 짧다 — 5초 안에 여러 번 눌러 볼 수 있어야 한다.
 */
export const PICK_PULSE_MS = 220;

export function pickPulse(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  if (elapsedMs >= PICK_PULSE_MS) return 0;
  return 1 - elapsedMs / PICK_PULSE_MS;
}

/** 선택 화면이 서는 자리 — 잠금 규칙이 갈린다 */
export type PickMode = "single" | "pvp";

/**
 * 이 캐릭터를 고를 수 있는가.
 *
 * **싱글은 전부 열려 있다.** 요구사항 1은 "고를 수 있고"이지 "잠근다"가 아니다 —
 * 싱글에서 잠그면 아직 아무도 키우지 않은 첫 방문자가 어떤 캐릭터도 못 골라
 * 게임에 들어가지 못한다.
 *
 * **PvP는 싱글에서 키운 캐릭터만이다**(요구사항 3). 싱글에서 1명만 키웠으면
 * 대전에서도 그 1명만 고를 수 있다. 근거는 대전이 싱글의 성장을 그대로 쓰기
 * 때문이다(`main.ts`의 `grownLoadout`) — 안 키운 캐릭터로 들어가면 1층 스탯으로
 * 싸우고, 무엇을 눌러도 진다.
 *
 * `grown`을 인자로 받는다: 이 파일은 `shared/`라서 `single/`을 import할 수 없다
 * (경계 규칙). 저장을 읽는 것은 배선층 몫이고 여기는 결과 집합만 본다.
 */
export function pickSelectable(
  slug: HeroSlug,
  o: { mode: PickMode; grown: ReadonlySet<string> },
): boolean {
  if (o.mode === "single") return true;
  return o.grown.has(slug);
}

/**
 * 고를 수 있는 칸이 하나라도 있는가.
 *
 * **씬이 이걸 먼저 묻는다.** 0개인 화면에 사람을 세우면 잠긴 칸 4개와 영원히
 * 잠긴 확정 버튼만 남는다 — 나갈 길은 [뒤로]뿐이고, 그건 막다른 길이다.
 *
 * 이 경우가 **실제로 도달 가능하다**는 것이 이 함수의 존재 이유다: 대전 입구는
 * 100층으로 잠겨 있고 100층을 찍으려면 반드시 누군가를 키웠으므로 정상 경로로는
 * 0개가 안 나오지만, 심사자 해제(`?unlock=pvp`)는 층수를 건드리지 않고 입구만
 * 연다(`main.ts`의 `unlockFloor`). 그 링크로 들어온 심사자가 보는 첫 화면이
 * 막다른 길이면 안 된다.
 */
export function pickAnySelectable(o: {
  mode: PickMode;
  grown: ReadonlySet<string>;
}): boolean {
  return PICK_SLUGS.some((s) => pickSelectable(s, o));
}

/**
 * 고를 것이 없는 화면의 안내. `pickLockNotice`와 **다른 문장이어야 한다** —
 * 저쪽은 "이 칸은 안 된다"이고 여기는 "여기서는 아무것도 못 한다"다. 같은 말을
 * 쓰면 사람이 다른 칸을 눌러 볼 수 있다고 오해한다.
 */
export function pickEmptyNotice(mode: PickMode): string {
  return mode === "pvp"
    ? "아직 키운 캐릭터가 없다 — 먼저 심연에 내려가라"
    : "고를 수 있는 캐릭터가 없다";
}

/**
 * 잠긴 칸을 눌렀을 때의 안내. **왜 못 고르는지 말한다** —
 * 흔들림만으로는 이유를 못 말한다(`matchLockedNotice`와 같은 근거).
 */
export function pickLockNotice(mode: PickMode): string {
  return mode === "pvp"
    ? "싱글에서 키운 캐릭터만 대전에 나갈 수 있다"
    : "지금은 고를 수 없다";
}
