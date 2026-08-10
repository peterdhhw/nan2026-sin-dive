import { isInterferenceEvent, type InterferenceEvent } from "../../core/types";
import { slotIdOf, type MatchResult, type MatchSlot } from "../matchmaking";

/** 매칭 대기자가 모이는 채널 */
export const LOBBY_CHANNEL = "pvp/lobby";

/** 매칭이 성립한 뒤 전투 정보를 주고받는 채널 */
export function matchChannel(matchId: string): string {
  return `pvp/m-${matchId}`;
}

export interface HelloMsg {
  t: "hello";
  clientId: string;
  teamSize: number;
  atMs: number;
}

export interface SnapMsg {
  t: "snap";
  clientId: string;
  /** 발신자 팀의 이번 구간 합산 딜 */
  rawDamage: number;
  atMs: number;
  /** 순서 역전 감지용 단조 증가 번호 */
  seq: number;
}

export interface IntfMsg {
  t: "intf";
  clientId: string;
  event: InterferenceEvent;
}

export interface ByeMsg {
  t: "bye";
  clientId: string;
}

export type ChannelMsg = HelloMsg | SnapMsg | IntfMsg | ByeMsg;

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * 채널에서 온 값은 전부 신뢰할 수 없다 — 다른 버전의 클라이언트나 장난 입력이 섞일 수 있다.
 * 통과하지 못한 메시지는 null로 조용히 버린다 (throw하면 수신 루프가 죽는다).
 */
export function parseChannelMsg(raw: unknown): ChannelMsg | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o["clientId"])) return null;

  switch (o["t"]) {
    case "hello":
      if (!isNum(o["teamSize"]) || !isNum(o["atMs"])) return null;
      return {
        t: "hello",
        clientId: o["clientId"],
        teamSize: o["teamSize"],
        atMs: o["atMs"],
      };
    case "snap":
      if (!isNum(o["rawDamage"]) || !isNum(o["atMs"]) || !isNum(o["seq"])) {
        return null;
      }
      return {
        t: "snap",
        clientId: o["clientId"],
        rawDamage: o["rawDamage"],
        atMs: o["atMs"],
        seq: o["seq"],
      };
    case "intf":
      // 코어의 가드를 그대로 재사용한다 — 스키마 정의가 한 곳에만 있어야 한다
      if (!isInterferenceEvent(o["event"])) return null;
      return { t: "intf", clientId: o["clientId"], event: o["event"] };
    case "bye":
      return { t: "bye", clientId: o["clientId"] };
    default:
      return null;
  }
}

export interface RosterEntry {
  clientId: string;
  teamSize: number;
  /** 마지막 hello 수신 시각 */
  lastSeenMs: number;
}

/** hello가 이 시간 이상 끊기면 로비를 떠난 것으로 본다 */
export const ROSTER_STALE_MS = 3_000;

export function pruneRoster(
  roster: readonly RosterEntry[],
  nowMs: number,
  staleMs: number = ROSTER_STALE_MS,
): RosterEntry[] {
  return roster.filter((e) => nowMs - e.lastSeenMs <= staleMs);
}

/** FNV-1a 32bit. 같은 문자열 → 같은 seed. 양쪽이 독립적으로 계산해도 일치한다. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface GlobalMatch {
  matchId: string;
  seed: number;
  /** 전역 슬롯 순서로 정렬된 사람 clientId 목록. 짝수 인덱스=전역 team0 */
  humanIds: string[];
  teamSize: number;
}

/** 명단에서 가장 많이 요청된 teamSize를 고른다 (동수면 작은 값) */
function majorityTeamSize(
  roster: readonly RosterEntry[],
  fallback: number,
): number {
  const counts = new Map<number, number>();
  for (const e of roster) {
    if (e.teamSize < 1) continue;
    counts.set(e.teamSize, (counts.get(e.teamSize) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = -1;
  for (const [size, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 명단에서 결정론적으로 매치를 만든다. **서버 합의가 없으므로 순서에 의존하면 안 된다** —
 * clientId를 정렬해 앞에서부터 채우고, 교대로 두 팀에 배치한다.
 * 같은 명단을 본 클라이언트들은 같은 GlobalMatch를 얻는다.
 */
export function resolveMatch(
  roster: readonly RosterEntry[],
  teamSize: number,
): GlobalMatch | null {
  const size = majorityTeamSize(roster, teamSize);
  const ids = [...new Set(roster.map((e) => e.clientId))].sort();
  // 최소 조건: 양 팀에 사람이 1명씩. 부족한 자리는 AI가 채운다 (스펙 §2-1)
  if (ids.length < 2) return null;

  const humanIds = ids.slice(0, size * 2);
  const matchId = `${humanIds[0]!}-${humanIds[1]!}-${size}`;
  return { matchId, seed: hashSeed(matchId), humanIds, teamSize: size };
}

/**
 * 상대 팀 사람들의 clientId. 전역 명단은 짝수/홀수로 팀이 갈리므로
 * 내 인덱스와 홀짝이 다른 자리가 상대다. 여기서 나온 id만 스냅샷을 인정한다.
 */
export function opponentClientIds(
  m: GlobalMatch,
  myClientId: string,
): string[] {
  const myIndex = m.humanIds.indexOf(myClientId);
  if (myIndex < 0) {
    throw new Error(`clientId "${myClientId}" is not part of match ${m.matchId}`);
  }
  return m.humanIds.filter((_, i) => i % 2 !== myIndex % 2);
}

const AI_NAMES = ["심연의 그림자", "타락한 순례자", "공허 추적자"] as const;

/**
 * 전역 매치를 "나는 항상 team 0" 관점으로 변환한다.
 * 게임은 위쪽(team 0)이 우리 팀이라고 전제하므로, 전역 team1에 배치된 클라이언트는
 * 팀을 뒤집어 본다. 딜 스냅샷도 각자 자기 팀 합산만 보내므로 이 반전이 성립한다.
 */
export function localizeMatch(m: GlobalMatch, myClientId: string): MatchResult {
  const myGlobalIndex = m.humanIds.indexOf(myClientId);
  if (myGlobalIndex < 0) {
    throw new Error(`clientId "${myClientId}" is not part of match ${m.matchId}`);
  }
  // 교대 배치: 짝수=전역 team0, 홀수=전역 team1
  const myGlobalTeam = myGlobalIndex % 2;
  const mySeat = Math.floor(myGlobalIndex / 2);

  const slots: MatchSlot[] = [];
  for (const team of [0, 1] as const) {
    const globalTeam = team === 0 ? myGlobalTeam : 1 - myGlobalTeam;
    for (let seat = 0; seat < m.teamSize; seat++) {
      // 내 좌석을 0번으로 끌어온다 — 게임은 characters[0]을 내 캐릭터로 쓴다.
      // 0 ↔ mySeat 스왑이므로 id 중복이 생기지 않는다.
      let globalSeat = seat;
      if (team === 0) {
        if (seat === 0) globalSeat = mySeat;
        else if (seat === mySeat) globalSeat = 0;
      }
      const humanId = m.humanIds[globalSeat * 2 + globalTeam];
      const isMe = humanId === myClientId;
      slots.push({
        slotId: slotIdOf(team, seat),
        team,
        kind: humanId === undefined ? "ai" : "human",
        displayName: isMe
          ? "나"
          : humanId !== undefined
            ? `플레이어 ${humanId.slice(0, 4)}`
            : AI_NAMES[(team * m.teamSize + seat) % AI_NAMES.length]!,
      });
    }
  }

  return {
    matchId: m.matchId,
    seed: m.seed,
    mySlotId: slotIdOf(0, 0),
    slots,
    waitedMs: 0,
  };
}
