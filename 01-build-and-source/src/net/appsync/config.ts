import { Amplify } from "aws-amplify";

export interface AppSyncEnv {
  endpoint: string;
  region: string;
  apiKey: string;
}

const nonBlank = (v: string | undefined): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/**
 * 세 값이 모두 있어야 AppSync를 쓴다. 하나라도 없으면 null →
 * 호출부는 로컬 AI 대전으로 폴백한다 (설계 스펙 §7).
 *
 * `source`를 인자로 받는 이유: `import.meta.env`는 Node 테스트에서 비어 있다.
 */
export function readAppSyncEnv(
  source: Record<string, string | undefined> = import.meta.env as unknown as Record<
    string,
    string | undefined
  >,
): AppSyncEnv | null {
  const endpoint = nonBlank(source["VITE_APPSYNC_EVENTS_ENDPOINT"]);
  const region = nonBlank(source["VITE_APPSYNC_REGION"]);
  const apiKey = nonBlank(source["VITE_APPSYNC_API_KEY"]);
  if (endpoint === null || region === null || apiKey === null) return null;
  if (!endpoint.startsWith("https://")) {
    console.warn("[pvp] AppSync endpoint must be https, ignoring:", endpoint);
    return null;
  }
  return { endpoint, region, apiKey };
}

let configured = false;

/**
 * Amplify.configure는 앱 전체에서 한 번만 부른다. 두 번 부르면
 * 진행 중인 소켓 상태가 흔들린다.
 */
export function ensureAmplifyConfigured(env: AppSyncEnv): void {
  if (configured) return;
  Amplify.configure({
    API: {
      Events: {
        endpoint: env.endpoint,
        region: env.region,
        defaultAuthMode: "apiKey",
        apiKey: env.apiKey,
      },
    },
  });
  configured = true;
}
