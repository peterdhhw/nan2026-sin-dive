import type {
  OpponentSnapshot,
  OpponentSource,
  OpponentUpdate,
} from "../../core/battle";
import type { InterferenceEvent } from "../../core/types";
import { SNAPSHOT_INTERVAL_MS } from "../publisher";
import type { ChannelMsg } from "./protocol";

/** 이 시간 동안 아무 메시지도 없으면 이탈로 본다 (200ms 스냅샷 15회 누락) */
export const DISCONNECT_MS = 3_000;

/**
 * 채널 메시지를 코어가 아는 `OpponentUpdate`로 바꾼다.
 * 채널 수신은 비동기지만 `poll`은 동기여야 하므로, 도착한 것을 버퍼에 쌓고 poll에서 꺼낸다.
 */
export class AppSyncOpponentSource implements OpponentSource {
  private readonly peers: Set<string>;
  /** clientId → 마지막 스냅샷 딜 */
  private readonly damageByPeer = new Map<string, number>();
  /** clientId → 마지막 seq (역순 도착 방어) */
  private readonly seqByPeer = new Map<string, number>();
  private pendingEvents: InterferenceEvent[] = [];
  private readonly seenEventIds = new Set<string>();
  private dirty = false;
  /**
   * 마지막 수신 시각. 전투 시작(0)을 기준으로 침묵을 센다 —
   * 첫 poll 시각으로 다시 맞추면 "한 번도 못 받았다"를 영원히 이탈로 보지 않게 된다.
   */
  private lastMessageMs = 0;
  private lastPollMs = 0;
  private byeReceived = false;
  private disconnectFired = false;
  private disconnectCb: (() => void) | null = null;

  /** 상대가 딜을 모아 보내는 구간 길이. publisher의 발행 주기와 같아야 한다. */
  private readonly windowMs: number;

  constructor(opts: { peerIds: readonly string[]; windowMs?: number }) {
    this.peers = new Set(opts.peerIds);
    this.windowMs = opts.windowMs ?? SNAPSHOT_INTERVAL_MS;
  }

  /** client.ts의 onMessage에서 호출한다. */
  accept(msg: ChannelMsg): void {
    if (!this.peers.has(msg.clientId)) return;

    switch (msg.t) {
      case "snap": {
        const lastSeq = this.seqByPeer.get(msg.clientId);
        // 늦게 도착한 옛 스냅샷은 버린다 — 게이지가 뒤로 튀면 안 된다
        if (lastSeq !== undefined && msg.seq <= lastSeq) return;
        this.seqByPeer.set(msg.clientId, msg.seq);
        this.damageByPeer.set(msg.clientId, msg.rawDamage);
        this.dirty = true;
        break;
      }
      case "intf": {
        // 재전송 대비 dedupe (스펙 §7) — 같은 방해를 두 번 연출하면 신뢰가 깨진다
        if (this.seenEventIds.has(msg.event.eventId)) return;
        this.seenEventIds.add(msg.event.eventId);
        this.pendingEvents.push(msg.event);
        break;
      }
      case "bye":
        this.byeReceived = true;
        break;
      case "hello":
        break;
    }
  }

  poll(nowMs: number): OpponentUpdate {
    if (this.dirty || this.pendingEvents.length > 0) this.lastMessageMs = nowMs;

    let snapshot: OpponentSnapshot | null = null;
    if (this.dirty) {
      let total = 0;
      for (const d of this.damageByPeer.values()) total += d;
      // windowMs를 반드시 붙인다 — 상대는 이 구간의 딜을 모아서 보낸다.
      // 빼먹으면 코어가 초당 값으로 오해해 상대가 12배 강해 보인다.
      snapshot = { rawDamage: total, atMs: nowMs, windowMs: this.windowMs };
      this.dirty = false;
    }

    const events = this.pendingEvents;
    this.pendingEvents = [];

    // 이탈 판정 전에 현재 시각을 반영해야 한다
    this.lastPollMs = nowMs;
    if (this.disconnected && !this.disconnectFired) {
      this.disconnectFired = true;
      this.disconnectCb?.();
    }

    return { snapshot, events };
  }

  get disconnected(): boolean {
    if (this.byeReceived) return true;
    return this.lastPollMs - this.lastMessageMs > DISCONNECT_MS;
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }
}
