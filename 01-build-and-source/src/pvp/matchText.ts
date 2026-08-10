import { MATCH_WAIT_MS, type MatchSlot } from "../net/matchmaking";
import type { SessionResult } from "./session";

/**
 * 매칭·결과 문구의 순수 규칙 — **상대가 있어야 성립하는 문구만** 있다.
 *
 * `shared/screenText.ts`에서 갈라져 나왔다. 옛 파일은 층 이름(모드 공용)과
 * 매칭 문구(PvP 전용)를 한곳에 담았고, 그래서 **공용 모듈이 `pvp/session`의
 * `SessionResult`를 타입으로 끌어왔다.** 싱글은 승/패/무승부·몰수라는 결과
 * 모양 자체가 다르므로(층 도달·타락도) 이 문구를 물려받으면 안 된다.
 *
 * pixi.js를 import하지 않는다 — node 테스트가 이 파일을 그대로 불러온다.
 */

export function resultHeadline(r: SessionResult): string {
  if (r.reason === "forfeit") {
    return r.winner === 0
      ? "상대가 연결을 잃었습니다 — 승리"
      : "연결이 끊겨 패배했습니다";
  }
  if (r.winner === 0) {
    return r.reason === "timeLimit" ? "시간 종료 — 판정 승" : "승리!";
  }
  if (r.winner === 1) {
    return r.reason === "timeLimit" ? "시간 종료 — 판정 패" : "패배";
  }
  return "무승부";
}

/** 매칭 대기 화면 문구. 남은 초와 합류한 사람 수를 보여준다. */
export function matchStatusText(waitedMs: number, humanCount: number): string {
  return `상대를 찾는 중… ${matchCountdownSec(waitedMs)}초 (합류 ${humanCount}명)`;
}

/**
 * 카운트다운 링에 찍을 정수 초 (§05-4).
 *
 * `matchStatusText`와 **같은 소스**를 쓴다 — 두 곳에서 따로 계산하면 링이 2를
 * 가리키는 동안 캡션이 3을 말하는 사고가 난다.
 */
export function matchCountdownSec(
  waitedMs: number,
  totalMs: number = MATCH_WAIT_MS,
): number {
  const w = Number.isFinite(waitedMs) ? waitedMs : 0;
  return Math.max(0, Math.ceil((totalMs - w) / 1000));
}

/**
 * 오프라인(AppSync 없음·연결 실패)일 때의 단축 대기 (§05-6).
 * 기다릴 이유가 없다 — 사람이 올 수 있는 통로가 아예 없다.
 */
export const MATCH_OFFLINE_WAIT_MS = 1_500;

/**
 * 슬롯 카드 라벨 (§05-3).
 *
 * **캐릭터 이름이 아니라 누가 조작하는가를 보여준다** (§06-4). MVP는 양 팀이
 * 같은 프리셋이라 캐릭터 이름을 쓰면 화면에 같은 이름이 네 번 나온다.
 */
export function matchSlotLabel(
  slot: Pick<MatchSlot, "kind" | "displayName">,
  isMe: boolean,
): string {
  // 이름이 이미 "나"인 경로(로컬 매칭·AppSync 자기 슬롯)에서 "나 (나)"가 되면
  // 안 된다. 표시 이름을 정하는 곳이 두 군데(L3)라 여기서 접는다
  if (isMe)
    return slot.displayName === "나" ? "나" : `${slot.displayName} (나)`;
  return slot.kind === "ai" ? "AI" : slot.displayName;
}

/** 아직 아무도 없는 슬롯 */
export const MATCH_SLOT_EMPTY = "대기";

/** 매칭 확정 스탬프 (§05-5). 사람 수는 나를 포함한 값이다 */
export function matchConfirmHeadline(humanCount: number): string {
  const n = Number.isFinite(humanCount) ? Math.floor(humanCount) : 0;
  if (n >= 4) return "사람 대전!";
  if (n >= 2) return "AI가 자리를 채웠다";
  return "AI 대전";
}

/**
 * 결과 스탬프와 부제 (§08-3).
 *
 * `resultHeadline`은 한 줄에 사유까지 담느라 길어졌다(`시간 종료 — 판정 승`).
 * 스탬프는 크게 찍히므로 **짧아야** 하고, 사유는 그 아래 작게 붙는다.
 * 기존 함수는 남긴다 — 로그·토스트에서 한 줄로 쓸 자리가 있다.
 */
export interface ResultText {
  stamp: string;
  subtitle: string;
  /** 승리 파티클을 띄우는가. 몰수 승리에는 주지 않는다 (§08-3) */
  celebrate: boolean;
}

export function resultText(r: SessionResult): ResultText {
  if (r.reason === "forfeit") {
    return r.winner === 0
      ? { stamp: "승 리", subtitle: "상대가 연결을 잃었다", celebrate: false }
      : { stamp: "패 배", subtitle: "연결이 끊겼다", celebrate: false };
  }
  if (r.winner === null) {
    return { stamp: "무 승 부", subtitle: "완벽한 균형", celebrate: false };
  }
  if (r.reason === "timeLimit") {
    return r.winner === 0
      ? {
          stamp: "판 정 승",
          subtitle: "시간 종료 — 앞서 있었다",
          celebrate: true,
        }
      : {
          stamp: "판 정 패",
          subtitle: "시간 종료 — 뒤처져 있었다",
          celebrate: false,
        };
  }
  return r.winner === 0
    ? { stamp: "승 리 !", subtitle: "게이지 선점", celebrate: true }
    : { stamp: "패 배", subtitle: "상대가 먼저 밀어냈다", celebrate: false };
}

/** 결과 패널의 상대 표기 (§08-4) */
export function opponentLabel(slots: readonly MatchSlot[]): string {
  const theirs = slots.filter((s) => s.team === 1);
  const human = theirs.find((s) => s.kind === "human");
  return human ? human.displayName : "AI 상대";
}

/**
 * 재대전 버튼 아래 캡션 (§08-5-1).
 *
 * AI 대전으로 끝났을 때 "이 게임은 AI랑 하는 게임"이라는 오해를 막는다.
 */
export function rematchHint(slots: readonly MatchSlot[]): string {
  const human = slots.some((s) => s.team === 1 && s.kind === "human");
  return human
    ? `${opponentLabel(slots)}와의 대전`
    : "실제 유저와도 대전할 수 있습니다";
}
