import { events } from "aws-amplify/data";
import { ensureAmplifyConfigured, type AppSyncEnv } from "./config";
import { parseChannelMsg, type ChannelMsg } from "./protocol";

/** 연결이 이 시간 안에 안 되면 포기하고 로컬 폴백으로 간다 */
export const CONNECT_TIMEOUT_MS = 5_000;

export interface ChannelHandle {
  publish(msg: ChannelMsg): Promise<void>;
  close(): void;
  readonly connected: boolean;
}

/** 브라우저 세션마다 고유한 id. 서버가 없으므로 클라이언트가 스스로 만든다. */
export function newClientId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${rnd}`;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * 채널 하나를 연다. 수신 payload는 `{ id, type, event }` 형태이며
 * 우리가 보낸 값은 `event` 안에 들어온다 (SDK 소스로 확인).
 */
export async function openChannel(opts: {
  env: AppSyncEnv;
  path: string;
  onMessage(msg: ChannelMsg): void;
  onError?(err: unknown): void;
}): Promise<ChannelHandle> {
  ensureAmplifyConfigured(opts.env);

  const channel = await withTimeout(
    events.connect(opts.path),
    CONNECT_TIMEOUT_MS,
    `connect(${opts.path})`,
  );

  let alive = true;
  const sub = channel.subscribe({
    next: (data: unknown) => {
      // { id, type, event } 래퍼를 벗기고, 벗겨진 값이 없으면 원본을 시도한다
      const payload =
        typeof data === "object" && data !== null && "event" in data
          ? (data as { event: unknown }).event
          : data;
      const msg = parseChannelMsg(payload);
      // 스키마를 통과하지 못한 값은 조용히 버린다 — 수신 루프를 죽이면 안 된다
      if (msg !== null) opts.onMessage(msg);
    },
    error: (err: unknown) => {
      alive = false;
      console.warn(`[pvp] channel ${opts.path} error`, err);
      opts.onError?.(err);
    },
  });

  return {
    async publish(msg: ChannelMsg): Promise<void> {
      if (!alive) return;
      try {
        // SDK는 `DocumentType`을 요구한다. 우리 메시지는 JSON 직렬화 가능한
        // 평범한 객체이므로 안전하지만, 구조적으로는 맞지 않아 캐스트가 필요하다.
        await channel.publish(msg as unknown as Parameters<typeof channel.publish>[0]);
      } catch (err) {
        // 발행 실패로 게임을 멈추지 않는다. 다음 스냅샷이 따라잡는다.
        console.warn(`[pvp] publish to ${opts.path} failed`, err);
      }
    },
    close(): void {
      alive = false;
      sub.unsubscribe();
      channel.close();
    },
    get connected(): boolean {
      return alive;
    },
  };
}
