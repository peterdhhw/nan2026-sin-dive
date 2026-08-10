#!/usr/bin/env node
/**
 * 헤드리스 스크린샷 + 콘솔 수집 하네스.
 *
 * 왜 --screenshot 플래그를 쓰지 않는가:
 * Chromium의 --virtual-time-budget 아래에서는 createImageBitmap()이 절대
 * resolve되지 않는다(이미지 디코더 태스크가 가상 시간에 스케줄되지 않음).
 * Pixi v8은 모든 텍스처를 그 경로로 디코드하므로 에셋 로드가 영구 대기에
 * 걸린다. 그래서 가상 시간 대신 CDP로 붙어 실제 시간만큼 기다린 뒤 찍는다.
 *
 * 사용: node tools/shot.mjs <url> <out.png> [waitMs] [--size WxH]
 *       [--click x,y[@delayMs] ...] [--drag x1,y1-x2,y2[@delayMs[~durMs]] ...]
 * 출력: 콘솔 메시지·페이지 에러를 stdout에 흘리고 PNG를 저장한다.
 *
 * --click은 스크린샷 좌표 그대로 준다 (delayMs = navigate 후 경과 시각).
 * --drag는 눌러서 끌고 떼는 제스처다 (durMs 기본 200ms) —
 * 싱글의 스와이프 하강·강화 시트 열기를 헤드리스로 검증하기 위해 있다.
 * --init <js>는 페이지 스크립트보다 먼저 실행된다(addScriptToEvaluateOnNewDocument) —
 * localStorage 주입으로 "99층에서 시작" 같은 저장 상태를 재현하기 위해 있다.
 *
 * **--size가 왜 필요한가**: 기본 480x900은 디자인 해상도(720x1280)보다 작아서
 * 화면 전체가 0.667배로 축소된다 — 도트 UI를 그렇게 찍으면 코드가 격자에
 * 정확히 얹혀 있어도 캡처에서는 획이 뭉개져서, 렌더 결함인지 축소 탓인지
 * 구분할 수 없다. 도트 검증은 `--size 720x1280`(1:1)으로 찍어야 한다.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Node 20의 WebSocket은 플래그 뒤에 있다 — 없으면 플래그를 붙여 자신을 다시 띄운다.
if (typeof WebSocket === "undefined") {
  const r = spawn(
    process.execPath,
    [
      "--experimental-websocket",
      new URL(import.meta.url).pathname,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  r.on("exit", (code) => process.exit(code ?? 1));
} else {
  await main();
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  const clicks = [];
  const initScripts = [];
  let viewW = 480;
  let viewH = 900;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--click") {
      const [xy, delay] = String(argv[++i]).split("@");
      const [x, y] = xy.split(",").map(Number);
      clicks.push({ kind: "click", x, y, atMs: Number(delay ?? 1000) });
    } else if (argv[i] === "--drag") {
      const [path, timing] = String(argv[++i]).split("@");
      const [from, to] = path.split("-");
      const [x1, y1] = from.split(",").map(Number);
      const [x2, y2] = to.split(",").map(Number);
      const [delay, dur] = String(timing ?? "1000").split("~");
      clicks.push({
        kind: "drag",
        x: x1,
        y: y1,
        x2,
        y2,
        atMs: Number(delay ?? 1000),
        durMs: Number(dur ?? 200),
      });
    } else if (argv[i] === "--init") {
      initScripts.push(String(argv[++i]));
    } else if (argv[i] === "--size") {
      const [w, h] = String(argv[++i]).split("x").map(Number);
      if (!w || !h) {
        console.error("--size는 WxH 형식이다 (예: 720x1280)");
        process.exit(2);
      }
      viewW = w;
      viewH = h;
    } else {
      positional.push(argv[i]);
    }
  }
  const [url, out, waitMsArg] = positional;
  if (!url || !out) {
    console.error(
      "usage: node tools/shot.mjs <url> <out.png> [waitMs] [--click x,y[@delayMs]]",
    );
    process.exit(2);
  }
  const waitMs = Number(waitMsArg ?? 6000);
  clicks.sort((a, b) => a.atMs - b.atMs);

  function findChrome() {
    const base = join(process.env.HOME, ".cache", "ms-playwright");
    for (const dir of readdirSync(base).filter((d) =>
      d.startsWith("chromium-"),
    )) {
      for (const sub of ["chrome-linux64", "chrome-linux"]) {
        const p = join(base, dir, sub, "chrome");
        if (existsSync(p)) return p;
      }
    }
    return null;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("chromium not found under ~/.cache/ms-playwright");
    process.exit(2);
  }

  const PORT = 9333 + (process.pid % 500);
  const proc = spawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      `--window-size=${viewW},${viewH}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  proc.stderr.on("data", () => {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function wsUrl() {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
        const j = await r.json();
        if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
      } catch {
        /* 아직 안 떴다 */
      }
      await sleep(250);
    }
    throw new Error("devtools endpoint never came up");
  }

  const ws = new WebSocket(await wsUrl());
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let nextId = 1;
  const pending = new Map();
  let sessionId = null;

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      return;
    }
    const p = msg.params ?? {};
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (p.args ?? [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
        .join(" ");
      console.log(`[console.${p.type}] ${text}`);
    } else if (msg.method === "Log.entryAdded") {
      console.log(`[log.${p.entry.level}] ${p.entry.text}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = p.exceptionDetails ?? {};
      console.log(
        `[pageerror] ${d.exception?.description ?? d.text ?? "unknown"}`,
      );
    }
  };

  const send = (method, params = {}, useSession = true) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(useSession && sessionId ? { sessionId } : {}),
        }),
      );
    });

  const { targetInfos } = await send("Target.getTargets", {}, false);
  const page = targetInfos.find((t) => t.type === "page");
  ({ sessionId } = await send(
    "Target.attachToTarget",
    { targetId: page.targetId, flatten: true },
    false,
  ));

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewW,
    height: viewH,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const source of initScripts) {
    await send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  await send("Page.navigate", { url });

  // 예약된 탭·드래그를 시각 순서대로 흘려보낸다 (Pixi는 pointer 이벤트를 본다)
  const mouse = (type, x, y, pressed) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: pressed ? 1 : 0,
      clickCount: type === "mouseMoved" ? 0 : 1,
      pointerType: "mouse",
    });
  let elapsed = 0;
  for (const c of clicks) {
    const gap = Math.max(0, Math.min(c.atMs, waitMs) - elapsed);
    await sleep(gap);
    elapsed += gap;
    if (c.kind === "drag") {
      // 이동 이벤트는 응답을 기다리지 않는다 — 헤드리스에서 CDP 왕복이
      // 스텝당 수십 ms라, 기다리면 150ms 드래그가 실제 600ms를 넘겨
      // 게임의 스와이프 판정(SWIPE_MAX_MS)이 "느린 드래그"로 기각한다.
      // WebSocket이 순서를 보존하므로 press → moves → release 순서는 안전하다.
      const steps = 4;
      await mouse("mousePressed", c.x, c.y, true);
      for (let s = 1; s <= steps; s++) {
        await sleep(c.durMs / steps);
        void mouse(
          "mouseMoved",
          c.x + ((c.x2 - c.x) * s) / steps,
          c.y + ((c.y2 - c.y) * s) / steps,
          true,
        );
      }
      await mouse("mouseReleased", c.x2, c.y2, false);
      elapsed += c.durMs;
      console.log(`[drag] ${c.x},${c.y} → ${c.x2},${c.y2} at ${elapsed}ms (${c.durMs}ms)`);
    } else {
      await mouse("mousePressed", c.x, c.y, true);
      await mouse("mouseReleased", c.x, c.y, false);
      console.log(`[click] ${c.x},${c.y} at ${elapsed}ms`);
    }
  }
  await sleep(Math.max(0, waitMs - elapsed));

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log(`wrote ${out}`);

  ws.close();
  proc.kill("SIGKILL");
  process.exit(0);
}
