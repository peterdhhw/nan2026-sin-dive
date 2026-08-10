/**
 * 전폭 공지 배너의 순수 규칙 — 종류별 색, 진입/유지/퇴장 타이밍, 큐 병합.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C8
 *
 * Pixi를 import하지 않는다 (`ui/banner.ts`가 재export한다).
 */

import {
  ACCENT_GOLD,
  STATE_OK,
  TEAM_OURS,
  TEAM_THEIRS,
  UI_PANEL,
} from "../theme";
import { darken } from "../color";

/**
 * `myCast` / `teammate`가 왜 따로 있는가.
 *
 * 시전 공지는 세 갈래인데 전에는 종류가 하나였다:
 * ① 내가 방해를 걸었다 ② **AI 팀원이** 걸었다 ③ 상대에게 당했다.
 * ①②는 `system`, ③은 `interference`였다 — 즉 **내가 건 것과 팀원이 건 것이
 * 글자까지 같았다.** 입력 0회로 118초를 돌린 캡처에 `심연의 장막 → 상대`가
 * 찍혀 있는데 그 판에서 아무것도 누르지 않았다. 유저가 "AUTO를 안 켰는데
 * 자동으로 동작한다"고 읽은 것의 가장 큰 몫이 이 배너다.
 *
 * 종류를 가르면 **색과 배너 슬롯이 같이 갈린다** — `bannerAction`이 종류당 한
 * 장을 주므로, 내 시전 공지가 팀원 것에 밀려 사라지지 않는다. 색만 바꾸고
 * 종류를 합치면 그 슬롯 하나를 셋이 다투게 된다.
 *
 * `myCast`는 우리 팀 색(`TEAM_OURS`)이다. `interference`(상대색)를 그대로 쓰면
 * "내가 걸었다"와 "당했다"가 같은 붉은 배너가 되어 방향이 사라진다.
 */
export type BannerKind =
  | "interference"
  | "myCast"
  | "teammate"
  | "buff"
  | "wave"
  | "system";

/**
 * 팀원 시전 배너색 — **내 진영색을 어둡게 죽인 것**이다.
 *
 * `UI_PANEL`(= `system`색)을 쓰지 않는다. 그러면 "팀원이 방해를 걸었다"가
 * 시스템 공지와 같은 회색이 되어 우리 팀이 한 일로 안 읽히고, `BANNER_COLOR`의
 * 색이 두 종류에서 겹쳐 종류를 색으로 구분할 수 없다(아래 테스트가 이걸 잡는다).
 *
 * 어둡게 만드는 것이 요점이다: 같은 진영색 계열이라 "우리 편"으로 읽히면서
 * 내가 누른 `myCast`보다 눈에 덜 띈다 — 화면의 주인공은 내 조작이다.
 */
export const BANNER_TEAMMATE = darken(TEAM_OURS, 0.45);

/** 종류별 바탕색 (§C8) */
export const BANNER_COLOR: Record<BannerKind, number> = {
  interference: TEAM_THEIRS,
  myCast: TEAM_OURS,
  teammate: BANNER_TEAMMATE,
  buff: STATE_OK,
  wave: ACCENT_GOLD,
  system: UI_PANEL,
};

/** 높이 72, 전폭 (§C8) */
export const BANNER_H = 72;

/** 좌우 끝 사선의 x 오프셋 — 레퍼런스 보스전 "VS" 배경 모티프 */
export const SLANT = 26;

/**
 * HUD 밴드 아래와 배너 사이 간격 — **두 모드가 같은 값을 쓴다.**
 *
 * 두 세션이 `banner.view.y = hud 아래 + 16`으로 각자 들고 있던 16이다. 씬에
 * 두면 배너 띠가 어디까지 내려오는지를 다른 위젯이 **베껴야** 하고(AUTO 배지가
 * 그 아래에 앉는다 — `single/diveHudRules`·`pvp/autoBadgeRules`), 그러면 배너를
 * 움직인 날 배지가 따라오지 않는다. 배너가 1.26초만 떠 있어서 그 겹침은 캡처
 * 한 장으로는 안 잡힌다.
 */
export const BANNER_GAP_Y = 16;

/** 배너 띠의 아래 끝 — HUD 밴드 아래 끝을 받는다 */
export function bannerBottomY(hudBottomY: number): number {
  const y = Number.isFinite(hudBottomY) ? hudBottomY : 0;
  return y + BANNER_GAP_Y + BANNER_H;
}

/** 모션 (§01-4: 180 / 900 / 180ms) */
export const BANNER_IN_MS = 180;
export const BANNER_HOLD_MS = 900;
export const BANNER_OUT_MS = 180;
export const BANNER_TOTAL_MS = BANNER_IN_MS + BANNER_HOLD_MS + BANNER_OUT_MS;

export type BannerPhase = "in" | "hold" | "out" | "done";

export function bannerPhase(elapsedMs: number, holdMs: number): BannerPhase {
  if (elapsedMs < 0) return "done";
  if (elapsedMs < BANNER_IN_MS) return "in";
  if (elapsedMs < BANNER_IN_MS + holdMs) return "hold";
  if (elapsedMs < BANNER_IN_MS + holdMs + BANNER_OUT_MS) return "out";
  return "done";
}

/**
 * 배너의 x 오프셋(화면 폭 배수). −1 = 좌측 화면 밖, 0 = 중앙, +1 = 우측 밖.
 *
 * 좌에서 들어와 우로 빠진다 — 같은 방향으로 통과하는 스와이프여야 "지나갔다"로
 * 읽힌다. 들어온 쪽으로 되돌아가면 취소된 것처럼 보인다.
 */
export function bannerOffset(elapsedMs: number, holdMs: number): number {
  const phase = bannerPhase(elapsedMs, holdMs);
  if (phase === "done") return 1;
  if (phase === "in") {
    const t = elapsedMs / BANNER_IN_MS;
    // easeOutCubic — 도착이 부드럽다
    return -1 + (1 - Math.pow(1 - t, 3));
  }
  if (phase === "hold") return 0;
  const t = (elapsedMs - BANNER_IN_MS - holdMs) / BANNER_OUT_MS;
  // 퇴장은 가속(easeInCubic) — 미련 없이 빠진다
  return t * t * t;
}

export interface BannerRequest {
  readonly kind: BannerKind;
  readonly text: string;
  readonly holdMs: number;
}

/**
 * 새 요청을 어떻게 처리할지 (§C8).
 *
 * - `start` — 떠 있는 배너가 없다. 바로 띄운다
 * - `refill` — 완전히 같은 요청이다. 유지 시간만 다시 채운다
 * - `retarget` — **같은 종류인데 내용이 바뀌었다. 지금 배너의 문구를 갈아탄다**
 * - `queue` — 다른 종류다. 뒤에 세운다
 *
 * `retarget`이 핵심이다. 배너 한 장이 1.26초를 쓰는데 초반 웨이브는 그보다 빨리
 * 넘어간다. 순서대로 재생하면 `WAVE 5`를 싸우는 중에 `WAVE 4` 배너가 떠서
 * **지난 정보를 지금 정보처럼** 보여준다 — 정보 표시로서 최악이다.
 * 종류당 화면 슬롯 하나를 주고 최신 내용이 그 슬롯을 차지한다.
 */
export type BannerAction = "start" | "refill" | "retarget" | "queue";

export function bannerAction(
  current: BannerRequest | null,
  next: BannerRequest,
): BannerAction {
  if (current === null) return "start";
  if (current.kind !== next.kind) return "queue";
  return current.text === next.text ? "refill" : "retarget";
}

/**
 * 큐에 `next`를 넣은 결과. **종류당 한 장만 남기고 최신이 이긴다.**
 * `retarget`과 같은 이유다 — 대기 줄에서도 지난 내용을 들고 있지 않는다.
 */
export function enqueue(
  queue: readonly BannerRequest[],
  next: BannerRequest,
): BannerRequest[] {
  return [...queue.filter((q) => q.kind !== next.kind), next];
}
