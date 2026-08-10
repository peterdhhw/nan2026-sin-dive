export type SlotKind = "human" | "ai";

export interface MatchSlot {
  slotId: string;
  /** 0 = 상단(내 팀), 1 = 하단(상대 팀) */
  team: 0 | 1;
  kind: SlotKind;
  displayName: string;
}

export interface MatchRequest {
  teamSize: number;
  /** MVP는 단일 큐. 확장 지점으로만 남긴다 (설계 스펙 §2-2) */
  levelBracket: number;
}

export interface MatchResult {
  matchId: string;
  /** 양 팀이 같은 웨이브를 보기 위한 공유 seed */
  seed: number;
  mySlotId: string;
  slots: MatchSlot[];
  /** 사람을 기다린 실제 시간(ms). UI 표시용 */
  waitedMs: number;
}

export interface MatchmakingService {
  /** 최대 MATCH_WAIT_MS 대기 후, 빈 자리는 AI로 채워 반환한다. */
  findMatch(req: MatchRequest): Promise<MatchResult>;
}

/**
 * 사람을 기다리는 최대 시간.
 *
 * 5초다. 첫 진입에서 타이틀을 경유하지 않고 바로 이 씬으로 들어가므로
 * (설계 문서 05-0) 이 시간이 곧 "게임 화면을 보기까지의 대기"가 된다.
 * 사람 대전 기회는 남겨야 하지만 10초는 첫인상에서 너무 길다 —
 * 5초 안에 안 모이면 AI로 확정하고, 재대전 때 다시 5초를 돈다.
 */
export const MATCH_WAIT_MS = 5_000;

/** 팀·인덱스로 결정론적 슬롯 id를 만든다. Plan 2의 AppSync 구현체도 같은 규칙을 쓴다. */
export function slotIdOf(team: 0 | 1, index: number): string {
  return `t${team}-s${index}`;
}

const AI_NAMES = ["심연의 그림자", "타락한 순례자", "공허 추적자"] as const;

/**
 * 오프라인·개발용 매칭. 기다리지 않고 즉시 AI로 채운다.
 * AppSync 연결 실패 시의 폴백 경로이기도 하다 (설계 스펙 §7).
 */
export class LocalMatchmaking implements MatchmakingService {
  constructor(private readonly opts: { seed: number; matchId?: string }) {}

  async findMatch(req: MatchRequest): Promise<MatchResult> {
    if (req.teamSize < 1) {
      throw new Error(`teamSize must be >= 1, got ${req.teamSize}`);
    }
    const slots: MatchSlot[] = [];
    const mySlotId = slotIdOf(0, 0);

    for (const team of [0, 1] as const) {
      for (let i = 0; i < req.teamSize; i++) {
        const id = slotIdOf(team, i);
        const isMe = id === mySlotId;
        slots.push({
          slotId: id,
          team,
          kind: isMe ? "human" : "ai",
          displayName: isMe
            ? "나"
            : `${AI_NAMES[(team * req.teamSize + i) % AI_NAMES.length]!}`,
        });
      }
    }

    return {
      matchId: this.opts.matchId ?? `local-${this.opts.seed}`,
      seed: this.opts.seed,
      mySlotId,
      slots,
      waitedMs: 0,
    };
  }
}
