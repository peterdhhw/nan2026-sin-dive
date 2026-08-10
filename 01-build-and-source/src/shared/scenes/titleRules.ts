/**
 * 타이틀 씬의 순수 규칙 — 로고 진입, 버튼 무장, 캐릭터 프리뷰 공격 추첨.
 *
 * 설계 문서: specs/2026-07-27-ux/04-scene-title.md
 *
 * Pixi를 import하지 않는다 (`titleScene.ts`가 재export한다).
 */

import { easeOutBack } from "../tween";
import { T_LOGO, snapFontSize } from "../theme";

/** 로고 진입 (§04-3: scale 0.85→1.0, 420ms easeOutBack) */
export const LOGO_IN_MS = 420;

/**
 * 로고 밑줄의 폭 — 화면 폭 기준 비율. 로고의 **가장 넓은 부분**이다
 * (`ABYSS`/`DIVE` 글자보다 이 선이 넓다).
 *
 * `createLogo`가 이 값으로 그린다. 여기 있는 이유: 로고 옆에 무엇을 놓을 때
 * 겹치는지 아닌지를 node 테스트가 물어야 하는데(카드함 입구 버튼, §10-3),
 * 씬 파일에 px가 박혀 있으면 그 검사를 Pixi 없이 할 수 없다.
 */
export const LOGO_LINE_W_RATIO = 0.45;

/**
 * `createLogo(scale)`이 차지하는 폭. 중앙 정렬이므로 좌우로 절반씩 뻗는다.
 *
 * **요청 배율이 그대로 곱해지지 않는다.** 폰트 크기가 도트 격자로 접히고(12px
 * 배수) 장식은 접힌 크기의 비를 따른다(`createLogo`의 `s`). 0.42를 주면 72→36으로
 * 접혀 실제 배율은 0.5다 — 눈대중으로 0.42를 곱하면 로고를 20% 좁게 본다.
 */
export function logoWidth(designW: number, scale: number): number {
  const s = snapFontSize(T_LOGO.size * scale) / T_LOGO.size;
  return designW * LOGO_LINE_W_RATIO * s;
}

/**
 * 로고 스케일.
 *
 * @param replay 재진입인가. **재진입에서는 진입 애니메이션을 재생하지 않는다**
 *   (§04-7) — 결과→타이틀을 오갈 때마다 같은 연출을 보면 지루하다.
 */
export function logoIntroScale(elapsedMs: number, replay: boolean): number {
  if (replay) return 1;
  const t = Number.isFinite(elapsedMs) ? elapsedMs : LOGO_IN_MS;
  if (t <= 0) return 0.85;
  if (t >= LOGO_IN_MS) return 1;
  return 0.85 + 0.15 * easeOutBack(t / LOGO_IN_MS, 1.6);
}

/** 로고 알파 — 재진입은 페이드만 한다 (§04-7) */
export function logoIntroAlpha(elapsedMs: number): number {
  const t = Number.isFinite(elapsedMs) ? elapsedMs : LOGO_IN_MS;
  if (t <= 0) return 0;
  if (t >= LOGO_IN_MS) return 1;
  return t / LOGO_IN_MS;
}

/**
 * 주 버튼이 활성되는 시각 (§04-5: 진입 후 300ms).
 *
 * 씬 전환 중에 손가락이 이미 그 자리에 있으면 타이틀을 본 적도 없이 다음 판이
 * 시작된다 — 결과 화면의 버튼 지연(§08-1)과 같은 이유다.
 */
export const TITLE_ARM_MS = 300;

export function titleArmed(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= TITLE_ARM_MS;
}

/* ── 위쪽 띠: 연결 상태 필 + 카드함 입구 (§04-6, §10-3)
 *
 * 두 위젯의 자리를 **여기서** 정한다. 씬 파일에 비율이 박혀 있으면 "겹치지
 * 않는가"를 node 테스트가 못 묻는다(로고 폭을 여기 둔 것과 같은 근거,
 * `LOGO_LINE_W_RATIO`). 위쪽 띠는 이 게임에서 가장 붐비지 않는 자리지만
 * **비어 있지는 않다** — 필이 가로 52%를 가운데로 먹는다. */

/** 연결 상태 필: 가로 52%를 가운데에 (좌우 여백 24%씩) */
export const STATUS_PILL_W_RATIO = 0.52;
export const STATUS_PILL_X_RATIO = (1 - STATUS_PILL_W_RATIO) / 2;
export const STATUS_PILL_Y_RATIO = 0.05;

/**
 * 카드함 입구 — 타이틀 **우상단**.
 *
 * 유저 지시: "맨 처음 화면에서도 카드함 있어서 바로 카드 볼 수 있으면 좋겠어."
 *
 * ## 왜 버튼을 세 번째로 쌓지 않는가
 *
 * 아래쪽 버튼 기둥은 위계가 이미 정해져 있다: `[심연 하강]`(초록 96px, 0.72)이
 * 주 버튼이고 `[대전]`(파랑 76px, 0.815)이 그 아래다. 여기에 카드함을 한 줄 더
 * 쌓으면 세 버튼이 같은 무게로 보이고, 첫 화면이 "무엇을 눌러야 하는가"를 잃는다.
 * 카드함은 진행이 아니라 수집이므로 기둥 밖이 맞는 자리다.
 *
 * ## 왜 필 **위**인가 — 옆이 아니라
 *
 * 필이 172.8~547.2px을 먹으므로 오른쪽에 남는 폭은 160.8px이다. 가장 긴 라벨
 * (`카드함 35/35`)이 글자만 144px + 안쪽 여백 16px = 160px이라 옆에 두면 여유가
 * 0.8px이다 — 로스터가 늘어 `35/35`가 `50/50`이 되는 순간 넘친다. 필 위 띠는
 * 폭이 720px 전체라 그 위험이 없다.
 *
 * 그래서 높이가 48이다: 위 여백 12px에서 필 위(720×1280에서 y=64)까지 52px이
 * 남고, 관용을 줄 4px을 빼면 48이다. `MIN_TAP`(88)보다 작지만 싱글 HUD의 `타이틀`(132×48)과
 * 같은 크기이고 관용(`tapSlack`)이 위·좌·우로 붙는다 — 아래로는 못 준다
 * (필의 위쪽을 삼키면 연결 상태를 만졌다가 카드함이 열린다).
 */
export const TITLE_BOX_ENTRY_H = 48;
export const TITLE_BOX_ENTRY_MARGIN = 12;
/**
 * 입구 버튼 폭. **가장 긴 라벨에서 유도한다** — `카드함 35/35`는 한글 3자
 * (24px 정폭) + 공백 1 + ASCII 5자(반칸 12px) = 144px이고 버튼 안쪽 여백
 * (`BUTTON_TEXT_INSET` 2×8)을 더해 160px이다. 176은 그 위 16px 여유다
 * (도트 폰트 실폭이 추정과 몇 px 다를 수 있다). 테스트가 이 산술을 다시 한다.
 */
export const TITLE_BOX_ENTRY_W = 176;

/** 입구 버튼의 좌상단 */
export function titleBoxEntryPos(designW: number): { x: number; y: number } {
  return {
    x: designW - TITLE_BOX_ENTRY_W - TITLE_BOX_ENTRY_MARGIN,
    y: TITLE_BOX_ENTRY_MARGIN,
  };
}

/**
 * 입구 버튼의 탭 관용 한도 (`tapSlack`의 `room`).
 *
 * - `bottom`: 연결 상태 필의 위쪽 변까지. 무제한으로 두면 관용 20px이 필을
 *   덮어서, 연결 상태를 만진 손가락이 카드함을 연다.
 * - `top`: 화면 위쪽 여백까지. 무제한이면 관용이 화면 밖으로 나가는데, 그러면
 *   위아래가 비대칭으로 잘려 **눈에 보이는 버튼 중심과 받는 영역의 중심이
 *   어긋난다**(싱글 HUD `타이틀`이 같은 이유로 `top`을 넘긴다).
 *
 * 좌우는 안 넘긴다 — 폭 176px이라 `tapSlack`이 0이고, 옆에 이웃도 없다.
 */
export function titleBoxEntryTapRoom(designH: number): {
  top: number;
  bottom: number;
} {
  return {
    top: TITLE_BOX_ENTRY_MARGIN,
    bottom: Math.max(
      0,
      designH * STATUS_PILL_Y_RATIO -
        (TITLE_BOX_ENTRY_MARGIN + TITLE_BOX_ENTRY_H),
    ),
  };
}

/** 무입력 힌트 (§04-5: 30초) */
export const TITLE_IDLE_HINT_MS = 30_000;

export function showsIdleHint(idleMs: number): boolean {
  return Number.isFinite(idleMs) && idleMs >= TITLE_IDLE_HINT_MS;
}

/** 캐릭터 프리뷰 (§04-4) */
export const PREVIEW_H_RATIO = 0.18;
/**
 * 타이틀 무대에 세우는 인원. **1명이다.**
 *
 * §04-4가 2명이라고 적은 것은 대전(2:2)이 유일한 진행이던 시절의 값이다. 지금
 * 첫 화면의 주 버튼은 `[심연 하강]`이고 그 판은 **혼자 내려간다**(싱글 1인) —
 * 둘을 세우면 눌렀을 때 한 명이 사라지고, 그건 "동료를 잃었나?"로 읽힌다.
 * 타이틀은 그 다음 화면을 미리 보여 주는 자리다.
 *
 * 슬라이스 길이를 여기서 정하는 이유: `titleScene`에 `slice(0, 2)`로 박혀
 * 있었고, 그 2는 위치식·바라보는 방향·위상 오프셋 세 곳이 각자 재유도하고
 * 있었다(`i === 0 ? … : …` 삼항 두 개). 인원이 바뀌면 그 셋이 따로 틀린다.
 */
export const TITLE_PREVIEW_COUNT = 1;
/**
 * `i`번째 프리뷰가 설 가로 위치(화면 폭 비율).
 *
 * 가운데를 기준으로 `PREVIEW_GAP_RATIO` 간격으로 늘어놓는다 — 값을 박지 않는
 * 이유는 인원이 바뀔 때다. 2인 시절의 0.36·0.64가 이 식의 count=2다
 * (`derived-constants-need-their-derivation`).
 */
export function previewXRatio(i: number, count: number): number {
  const n = Math.max(1, Math.floor(count));
  const k = Math.min(Math.max(0, Math.floor(i)), n - 1);
  return 0.5 + (k - (n - 1) / 2) * PREVIEW_GAP_RATIO;
}
/** 프리뷰 간격(화면 폭 비율). 2인일 때 0.36·0.64가 되는 값이다 */
export const PREVIEW_GAP_RATIO = 0.28;
/**
 * `i`번째 프리뷰가 볼 **월드** 방향(+1 = 오른쪽).
 *
 * 여럿이면 서로를 본다(가운데를 향한다). 혼자면 오른쪽이다 — 왼쪽을 보게
 * 세우면 화면 진행 방향(하강은 오른쪽으로 나아간다)에 등을 돌린다.
 */
export function previewFacing(i: number, count: number): 1 | -1 {
  const n = Math.max(1, Math.floor(count));
  if (n <= 1) return 1;
  return i < (n - 1) / 2 ? 1 : -1;
}
/** 두 명이 같은 프레임이면 인형처럼 보인다 — 위상을 어긋낸다 (§04-4) */
export const PREVIEW_PHASE_OFFSET_MS = 400;
/** 8초마다 한 명이 attack 1회 (§04-4) */
export const PREVIEW_ATTACK_PERIOD_MS = 8_000;

/**
 * `n`번째 공격 차례에 누가 공격하는가.
 *
 * `Math.random()`을 쓰지 않는다 — 씬 진입 시각 기반 seed로 결정론을 유지한다
 * (§04-4). 랜덤이면 스크린샷 회귀에서 프레임마다 다른 캐릭터가 잡힌다.
 */
export function previewAttacker(
  turn: number,
  seed: number,
  count: number,
): number {
  if (count <= 0) return 0;
  const t = Number.isFinite(turn) ? Math.max(0, Math.floor(turn)) : 0;
  const s = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
  // 곱하기만으로는 안 섞인다: 홀수 배수의 최하위 비트는 turn의 홀짝을 그대로
  // 따라가므로 두 명일 때 0,1,0,1로 번갈아 나온다. 시프트-xor로 상위 비트를
  // 아래로 끌어내려야 순서가 흐트러진다
  let h = Math.imul(s, 374_761_393) + Math.imul(t, 668_265_263);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % count;
}

/**
 * 주 버튼 라벨 (§04-5).
 *
 * 오프라인인데 `[대전 시작]`이라고 적으면 거짓 기대를 만든다 — 눌러도 사람은
 * 안 나온다. 라벨에서 미리 말한다.
 */
export function startButtonLabel(online: boolean): string {
  return online ? "대전 시작" : "오프라인 (AI 대전)";
}

/** 직전 결과 배지 (§04-7). 처음 진입이면 배지가 없다 */
export function lastResultBadge(
  winner: 0 | 1 | null | undefined,
): string | null {
  if (winner === 0) return "직전 승리 ▲";
  if (winner === 1) return "직전 패배 ▼";
  return null;
}

/** 모드 요약 (§04-2 y93%) */
export const TITLE_MODE_SUMMARY = "2:2 줄다리기 · 120초";

/** 싱글(하강) 진입이 있는 타이틀의 모드 요약 — 두 모드를 한 줄로 */
export const TITLE_MODE_SUMMARY_SINGLE = "심연 하강 9,999층 · 대전 2:2 줄다리기 120초";

/**
 * 대전이 열리는 최소 도달 층.
 *
 * **왜 잠그는가**: 대전은 내가 싱글에서 키운 캐릭터로 싸운다(2단계). 1층
 * 캐릭터로 들어가면 무엇을 눌러도 지고, 첫 판에서 지면 조작을 배울 기회
 * 자체를 잃는다(§3-4의 "방치가 지도록 만들지 않은 이유"와 같은 근거다).
 *
 * **100인 이유는 이미 측정돼 있다.** 싱글 페이싱 테스트가 **10분에 100층**을
 * 고정하고 있고(`singlePacing`), 100층은 첫 네임드 보스다 — 여기까지 온
 * 플레이어는 강화·스킬·콤보를 다 만져 봤다. 30층(3분)은 강화를 한 번도 안 산
 * 채로 닿을 수 있고, 1000층은 첫 세션 안에 못 닿는다.
 */
export const PVP_UNLOCK_FLOOR = 100;

export function pvpUnlocked(floor: number): boolean {
  return Number.isFinite(floor) && floor >= PVP_UNLOCK_FLOOR;
}

/**
 * 대전 버튼 라벨. 잠겨 있으면 **조건을 라벨에 적는다.**
 *
 * 잠긴 버튼에 `대전`만 적고 눌렀을 때 토스트로 알리면, 못 누르는 이유를
 * 알기 위해 반드시 한 번 눌러야 한다. 진열장의 목적은 "지금 무엇을 할 수
 * 있는가"이므로 조건은 누르기 전에 보여야 한다.
 */
export function matchButtonLabel(floor: number): string {
  return pvpUnlocked(floor) ? "대전" : `대전 · ${PVP_UNLOCK_FLOOR}층`;
}

/** 잠긴 대전을 눌렀을 때의 안내 — 지금 몇 층인지 같이 말한다 */
export function matchLockedNotice(floor: number): string {
  const at = Number.isFinite(floor) ? Math.max(0, Math.floor(floor)) : 0;
  return `심연 ${PVP_UNLOCK_FLOOR}층에 닿으면 대전이 열린다 (지금 ${at.toLocaleString("en-US")}층)`;
}
