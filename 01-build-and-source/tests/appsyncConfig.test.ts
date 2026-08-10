import { expect, test } from "vitest";
import { readAppSyncEnv } from "../src/net/appsync/config";

const full = {
  VITE_APPSYNC_EVENTS_ENDPOINT:
    "https://x.appsync-api.ap-northeast-2.amazonaws.com/event",
  VITE_APPSYNC_REGION: "ap-northeast-2",
  VITE_APPSYNC_API_KEY: "da2-abc",
};

test("reads a complete env", () => {
  expect(readAppSyncEnv(full)).toEqual({
    endpoint: full.VITE_APPSYNC_EVENTS_ENDPOINT,
    region: full.VITE_APPSYNC_REGION,
    apiKey: full.VITE_APPSYNC_API_KEY,
  });
});

test("any missing or blank value disables AppSync entirely", () => {
  for (const key of Object.keys(full)) {
    expect(readAppSyncEnv({ ...full, [key]: "" })).toBeNull();
    const without: Record<string, string | undefined> = { ...full };
    delete without[key];
    expect(readAppSyncEnv(without)).toBeNull();
  }
});

test("whitespace-only values count as missing", () => {
  expect(readAppSyncEnv({ ...full, VITE_APPSYNC_API_KEY: "   " })).toBeNull();
});

test("an endpoint that is not https is rejected", () => {
  // 잘못된 값으로 연결을 시도하면 5초를 날린다. 미리 거른다.
  expect(
    readAppSyncEnv({ ...full, VITE_APPSYNC_EVENTS_ENDPOINT: "ws://x/event" }),
  ).toBeNull();
});
