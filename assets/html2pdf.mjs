#!/usr/bin/env node
/**
 * HTML → PDF (A4). CDP `Page.printToPDF`를 직접 쓴다.
 *
 * 사용: node assets/html2pdf.mjs <in.html> <out.pdf>
 *
 * ## 왜 puppeteer가 아니라 CDP 직접인가
 *
 * puppeteer가 설치돼 있지 않다. 하지만 크롬 바이너리는 `~/.cache/puppeteer`에
 * 이미 있어서(다른 도구가 받아 뒀다) 브라우저를 직접 띄우고 CDP로 말하면 된다 —
 * 의존성 하나 안 늘리고 같은 일을 한다. 탐색 로직은 `tools/shot.mjs`와 같은 근거다.
 *
 * ## `printBackground: true`가 필수다
 *
 * 기본값은 false다. 표 헤더·강조 박스·표지가 **색으로 정보를 나르는데**
 * 배경을 끄면 흰 종이에 검은 글자만 남아 구조가 사라진다. CSS의
 * `print-color-adjust: exact`는 "인쇄 시 색을 죽이지 말라"는 요청이고,
 * 이 플래그는 "배경을 아예 그려라"다 — 둘 다 있어야 한다.
 *
 * ## 여백은 CSS `@page`가 정한다
 *
 * 여기서 margin을 주면 CSS와 이중으로 걸려 표지의 음수 마진(`margin: -16mm`)이
 * 어긋난다. 그래서 `preferCSSPageSize: true`로 CSS에 넘긴다.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// Node 20의 WebSocket은 플래그 뒤에 있다 — 없으면 플래그를 붙여 자신을 다시 띄운다.
// (`tools/shot.mjs`와 같은 처방)
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
const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: html2pdf.mjs <in.html> <out.pdf>");
  process.exit(1);
}

/** 크롬을 찾는다 — puppeteer 캐시 안의 headless shell 또는 full chrome */
function findChrome() {
  const bases = [
    join(homedir(), ".cache/puppeteer/chrome"),
    join(homedir(), ".cache/puppeteer/chrome-headless-shell"),
  ];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const dir of readdirSync(base)) {
      for (const [sub, bin] of [
        ["chrome-linux64", "chrome"],
        ["chrome-linux", "chrome"],
        ["chrome-headless-shell-linux64", "chrome-headless-shell"],
      ]) {
        const p = join(base, dir, sub, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ["/usr/bin/chromium", "/usr/bin/google-chrome"]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("크롬을 못 찾았다 — ~/.cache/puppeteer 확인");
  process.exit(1);
}

const PORT = 9333 + (process.pid % 400);
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "about:blank",
]);
proc.on("error", (e) => {
  console.error("크롬 실행 실패:", e.message);
  process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CDP 웹소켓 주소를 얻는다 — 크롬이 뜰 때까지 재시도 */
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
  throw new Error("CDP 접속 실패");
}

const ws = new WebSocket(await wsUrl());
await new Promise((r) => (ws.onopen = r));

let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: res, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : res(m.result);
  } else if (m.method) {
    events.push(m);
  }
};

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, reject) => {
    pending.set(id, { resolve: res, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

// 새 탭을 열고 그 탭 세션에 붙는다
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", {
  targetId,
  flatten: true,
});

await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);

const url = `file://${resolve(inPath)}`;
await send("Page.navigate", { url }, sessionId);

// 로드 완료를 기다린다. 폰트 대기까지 확인해야 글자 폭이 확정된다 —
// 폰트가 늦게 오면 레이아웃이 밀린 채로 PDF가 굳는다.
for (let i = 0; i < 80; i++) {
  await sleep(100);
  const { result } = await send(
    "Runtime.evaluate",
    { expression: "document.readyState", returnByValue: true },
    sessionId,
  );
  if (result.value === "complete") break;
}
await send(
  "Runtime.evaluate",
  { expression: "document.fonts.ready.then(() => true)", awaitPromise: true },
  sessionId,
);
await sleep(300);

const { data } = await send(
  "Page.printToPDF",
  {
    printBackground: true, // 색이 정보를 나른다 — 끄면 구조가 사라진다
    preferCSSPageSize: true, // 여백은 CSS `@page`가 정한다 (이중 적용 방지)
    displayHeaderFooter: false,
    scale: 1,
  },
  sessionId,
);

writeFileSync(outPath, Buffer.from(data, "base64"));
console.log(`wrote ${outPath}`);

ws.close();
proc.kill();
process.exit(0);
}
