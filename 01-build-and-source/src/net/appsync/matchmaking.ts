import {
  LocalMatchmaking,
  MATCH_WAIT_MS,
  type MatchRequest,
  type MatchResult,
  type MatchmakingService,
} from "../matchmaking";
import {
  newClientId,
  openChannel as defaultOpenChannel,
  type ChannelHandle,
} from "./client";
import type { AppSyncEnv } from "./config";
import {
  LOBBY_CHANNEL,
  localizeMatch,
  pruneRoster,
  resolveMatch,
  type ChannelMsg,
  type GlobalMatch,
  type RosterEntry,
} from "./protocol";

/** 로비에 존재를 알리는 주기. ROSTER_STALE_MS(3초)보다 충분히 짧아야 한다. */
export const HELLO_INTERVAL_MS = 500;

export interface Deps {
  openChannel: typeof defaultOpenChannel;
  now(): number;
  sleep(ms: number): Promise<void>;
  clientId: string;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export class AppSyncMatchmaking implements MatchmakingService {
  private readonly deps: Deps;
  private handle: ChannelHandle | null = null;
  /** 매치가 사람 대전으로 성립하면 이 채널을 세션이 재사용한다 */
  private keptLobby: ChannelHandle | null = null;
  private resolved: GlobalMatch | null = null;
  /** 매칭 후 들어오는 snap/intf/bye를 받아갈 쪽 (AppSyncOpponentSource) */
  private sink: ((msg: ChannelMsg) => void) | null = null;
  /** `[건너뛰기]`가 세웠는가 (설계 문서 05-6) */
  private cancelled = false;
  /** 대기 sleep을 깨우는 쪽. 취소가 최대 500ms 늦게 먹는 것을 막는다 */
  private wake: (() => void) | null = null;

  constructor(
    private readonly opts: {
      env: AppSyncEnv;
      /** AI 폴백 시 쓸 seed */
      fallbackSeed: number;
      deps?: Partial<Deps>;
      onStatus?(waitedMs: number, humanCount: number): void;
    },
  ) {
    this.deps = {
      openChannel: opts.deps?.openChannel ?? defaultOpenChannel,
      now: opts.deps?.now ?? ((): number => Date.now()),
      sleep: opts.deps?.sleep ?? realSleep,
      clientId: opts.deps?.clientId ?? newClientId(),
    };
  }

  get lobby(): ChannelHandle | null {
    return this.keptLobby;
  }

  get clientId(): string {
    return this.deps.clientId;
  }

  /** 성립한 전역 매치 (사람 대전일 때만). 상대 clientId 목록을 뽑는 데 쓴다. */
  get globalMatch(): GlobalMatch | null {
    return this.resolved;
  }

  /**
   * 로비 채널은 매칭 후에도 그대로 전투 채널로 쓴다 — 채널을 새로 열면
   * 재연결 사이에 첫 스냅샷들이 유실된다. 여기 등록한 쪽이 이후 메시지를 받는다.
   */
  route(sink: (msg: ChannelMsg) => void): void {
    this.sink = sink;
  }

  /**
   * 대기를 즉시 끊는다 (`[건너뛰기]`, 설계 문서 05-6).
   *
   * 로비에 `bye`를 먼저 발행한다 — 안 하면 다른 클라이언트의 로스터에 내가
   * 최대 ROSTER_STALE_MS(3초) 동안 남아, 없는 사람과 매칭이 성립할 수 있다.
   * 이미 매칭이 성립했으면(keptLobby가 있다) 아무 일도 하지 않는다.
   */
  cancelWait(): void {
    if (this.cancelled || this.resolved !== null) return;
    this.cancelled = true;
    void this.handle?.publish({ t: "bye", clientId: this.deps.clientId });
    // 지금 sleep 중이면 깨운다 — 안 깨우면 탭이 최대 500ms 늦게 먹는다
    this.wake?.();
  }

  async findMatch(req: MatchRequest): Promise<MatchResult> {
    if (req.teamSize < 1) {
      throw new Error(`teamSize must be >= 1, got ${req.teamSize}`);
    }

    const roster = new Map<string, RosterEntry>();
    const me = this.deps.clientId;

    const onMessage = (msg: ChannelMsg): void => {
      if (msg.t !== "hello") {
        // 매칭이 끝난 뒤의 전투 메시지 — 등록된 수신자에게 넘긴다
        this.sink?.(msg);
        return;
      }
      roster.set(msg.clientId, {
        clientId: msg.clientId,
        teamSize: msg.teamSize,
        // 발신자 시각을 믿지 않는다 — 클라이언트 시계는 어긋난다. 수신 시각을 쓴다.
        lastSeenMs: this.deps.now(),
      });
    };

    try {
      this.handle = await this.deps.openChannel({
        env: this.opts.env,
        path: LOBBY_CHANNEL,
        onMessage,
      });
    } catch (err) {
      console.warn("[pvp] lobby connect failed, using local AI match", err);
      return new LocalMatchmaking({ seed: this.opts.fallbackSeed }).findMatch(req);
    }

    // 경과 시간은 자체 누적으로 센다. now()에만 의존하면 가짜 시계에서 무한 루프가 된다.
    let waitedMs = 0;
    while (waitedMs < MATCH_WAIT_MS && !this.cancelled) {
      roster.set(me, {
        clientId: me,
        teamSize: req.teamSize,
        lastSeenMs: this.deps.now(),
      });
      await this.handle.publish({
        t: "hello",
        clientId: me,
        teamSize: req.teamSize,
        atMs: this.deps.now(),
      });

      const live = pruneRoster([...roster.values()], this.deps.now());
      this.opts.onStatus?.(waitedMs, live.length);

      const match = resolveMatch(live, req.teamSize);
      if (match !== null && match.humanIds.includes(me)) {
        this.keptLobby = this.handle;
        this.resolved = match;
        const local = localizeMatch(match, me);
        return { ...local, waitedMs };
      }

      // 취소 신호로 깨울 수 있는 sleep. 둘 중 먼저 오는 쪽을 쓴다
      await Promise.race([
        this.deps.sleep(HELLO_INTERVAL_MS),
        new Promise<void>((resolve) => {
          this.wake = resolve;
        }),
      ]);
      this.wake = null;
      waitedMs += HELLO_INTERVAL_MS;
    }

    // 대기 시간 안에 아무도 안 왔다(또는 건너뛰기) — 로비를 닫고 AI 대전으로 간다
    // (스펙 §7 정상 경로)
    this.handle.close();
    this.handle = null;
    this.keptLobby = null;
    const ai = await new LocalMatchmaking({
      seed: this.opts.fallbackSeed,
    }).findMatch(req);
    return { ...ai, waitedMs };
  }
}
