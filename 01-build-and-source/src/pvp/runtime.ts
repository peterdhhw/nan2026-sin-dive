import type { GameApp } from "../shared/app";
import type { DebugEntry } from "../shared/debugEntry";
import type { Session, SessionResult } from "./session";
import type { Loadout } from "../loadout/types";
import type { MatchResult } from "../net/matchmaking";

/**
 * 씬이 네트워크·AI에 닿는 유일한 통로.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §1 (모듈 지도)
 *
 * **L2(`src/shared/`)는 L3(`src/net/`)·L4(`src/ai/`)를 import하지 않는다.**
 * 그래서 매칭·상대 소스·발행·전략 배선은 전부 `main.ts`가 만들고, 씬은 이
 * 인터페이스만 본다. 타입 import는 런타임 의존을 만들지 않으므로 허용한다
 * (`screenText.ts`가 `MATCH_WAIT_MS`를 쓰는 것과 같은 선).
 */

export interface MatchProgress {
  waitedMs: number;
  /** 나를 포함해 로비에 있는 사람 수 */
  humanCount: number;
}

/**
 * 진행 중인 매칭 탐색.
 *
 * `Promise` 하나만 돌려주면 `[건너뛰기]`(§05-6)를 구현할 수 없다 — 대기를
 * 중간에 끊고 로비에 `bye`를 발행해야 유령 슬롯이 남지 않는다.
 */
export interface MatchSearch {
  result: Promise<MatchResult>;
  /** 대기를 즉시 끊고 빈 자리를 AI로 확정한다. 이미 끝났으면 아무 일도 없다 */
  skip(): void;
}

export interface BattleHandle {
  session: Session;
  match: MatchResult;
  /** 씬을 나갈 때 — 채널·전략 구독을 끊는다. `session.destroy()`는 씬이 부른다 */
  dispose(): void;
}

export interface Runtime {
  /**
   * AppSync 설정이 살아 있는가. 상태 스트립(§05-2)에 그대로 표기한다 —
   * 키가 만료되면(2026-08-25) 유저가 이유도 모르고 AI만 만나게 된다.
   */
  readonly online: boolean;
  /** 판마다 새 시드. `?seed=`로 고정했으면 항상 같은 값을 준다 (§08-5) */
  nextSeed(): number;
  findMatch(opts: {
    onProgress?: (p: MatchProgress) => void;
    /** 매칭 대기를 돌지 않는다 — 즉시 AI로 채운다 (`?nowait`, [연습]) */
    skipWait: boolean;
  }): MatchSearch;
  /** 세션 + 상대·발행·전략 배선을 한 덩어리로 만든다 */
  startBattle(opts: {
    app: GameApp;
    loadout: Loadout;
    match: MatchResult;
    debug: DebugEntry;
    onFinish(result: SessionResult): void;
  }): Promise<BattleHandle>;
}
