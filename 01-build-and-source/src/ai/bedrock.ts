import {
  DEFAULT_STRATEGY,
  sanitizeStrategy,
  STRATEGY_PRESETS,
  type AiStrategy,
} from "./strategy";

/** dev 서버 미들웨어 경로. 프로덕션에는 존재하지 않는다. */
export const STRATEGY_ENDPOINT = "/__bedrock/strategy";
/** 전략 갱신 주기 (설계 스펙 §10 — 3~5초 중 4초로 시작) */
export const STRATEGY_REFRESH_MS = 4_000;
/** 이 시간 안에 응답이 없으면 포기하고 로컬 프리셋을 쓴다 */
export const STRATEGY_TIMEOUT_MS = 2_500;

export interface StrategyInput {
  gaugePos: number;
  elapsedMs: number;
  myDps: number;
  theirDps: number;
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * 모델 응답에서 전략 JSON을 뽑는다. 실측 결과 Haiku는 ```json 펜스로 감싸 응답했고,
 * 설명 문장을 덧붙일 수도 있다. 그러니 첫 `{`부터 마지막 `}`까지를 잘라 파싱한다.
 */
export function parseStrategyResponse(text: string): AiStrategy | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isNum(o["aggression"]) || !isNum(o["harass"]) || !isNum(o["support"])) {
    return null;
  }

  // 범위를 벗어난 값은 버리지 않고 클램프한다 — 모델이 1.2를 주는 건 흔한 일이다
  return sanitizeStrategy({
    aggression: o["aggression"],
    harass: o["harass"],
    support: o["support"],
  });
}

/**
 * Bedrock 없이도 상황에 맞는 전략을 고른다.
 * 배포 환경(정적 사이트)의 기본 경로이며, 호출 실패 시의 폴백이기도 하다.
 */
export function presetForSituation(input: StrategyInput): AiStrategy {
  // gaugePos는 "우리(팀0) 우세"가 +다. AI는 팀1이므로 +가 곧 AI의 열세다.
  // 뒤처진 AI는 몰아치고, 앞선 AI는 방해로 굳힌다 (이기는 쪽이 더 세게 때리면
  // 스노우볼이 되어 역전이 사라진다).
  if (input.gaugePos > 0.35) return STRATEGY_PRESETS.rush;
  if (input.gaugePos < -0.35) return STRATEGY_PRESETS.harasser;
  return STRATEGY_PRESETS.balanced;
}

export interface StrategyAdapter {
  start(): void;
  stop(): void;
  /** 매 틱 최신 상황을 알린다 (전송은 하지 않는다) */
  report(input: StrategyInput): void;
  /** 즉시 한 번 갱신한다. 테스트와 start()의 타이머가 함께 쓴다. */
  refreshNow(): Promise<void>;
}

function buildPrompt(input: StrategyInput): string {
  return [
    "You are the tactical brain of an enemy team in a tug-of-war PvP battle.",
    "Weights control how often the AI picks each action type.",
    `gauge: ${input.gaugePos.toFixed(2)} (positive = the human team is winning)`,
    `elapsed: ${Math.round(input.elapsedMs / 1000)}s of 120s`,
    `dps mine: ${Math.round(input.theirDps)}, dps human: ${Math.round(input.myDps)}`,
    'Reply with ONLY this JSON: {"aggression":<0-1>,"harass":<0-1>,"support":<0-1>}',
  ].join("\n");
}

export function createStrategyAdapter(opts: {
  apply(s: AiStrategy): void;
  /** dev 환경에서만 true. 프로덕션은 로컬 프리셋만 쓴다. */
  enabled?: boolean;
  fetchImpl?: typeof fetch;
}): StrategyAdapter {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const enabled = opts.enabled ?? false;
  let latest: StrategyInput | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const refreshNow = async (): Promise<void> => {
    if (latest === null) {
      opts.apply(DEFAULT_STRATEGY);
      return;
    }
    const fallback = presetForSituation(latest);
    if (!enabled) {
      opts.apply(fallback);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STRATEGY_TIMEOUT_MS);
    try {
      const res = await doFetch(STRATEGY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: buildPrompt(latest) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`strategy endpoint returned ${res.status}`);
      const body = (await res.json()) as { text?: unknown };
      const parsed =
        typeof body.text === "string" ? parseStrategyResponse(body.text) : null;
      // 파싱 실패도 실패다 — 조용히 로컬 프리셋으로 간다 (스펙 §7)
      opts.apply(parsed ?? fallback);
    } catch (err) {
      console.warn("[pvp] strategy refresh failed, keeping local preset", err);
      opts.apply(fallback);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => void refreshNow(), STRATEGY_REFRESH_MS);
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    report(input: StrategyInput): void {
      latest = input;
    },
    refreshNow,
  };
}
