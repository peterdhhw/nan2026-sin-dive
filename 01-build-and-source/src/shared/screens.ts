import {
  bootErrorText,
  classifyBootError,
  expandsDetail,
} from "./scenes/bootRules";

// 순수 문구 함수는 screenText.ts(공용)와 pvp/matchText.ts(대전 전용)에 있다 —
// node 테스트가 pixi를 못 불러오기 때문이다. 예전엔 이 파일이 `matchStatusText`·
// `resultHeadline`을 재export했지만 그 통로로 가져다 쓰는 곳이 하나도 없었고,
// 남겨 두면 **공용 모듈이 PvP 결과 타입(`SessionResult`)에 묶인다.**
// 부팅 실패 화면은 대전 개념을 몰라야 한다 — 대전을 시작하기도 전에 뜨는 화면이다.

/**
 * 부팅 자체가 실패했을 때의 최후 방어선 (S0-E).
 *
 * 설계 문서: specs/2026-07-27-ux/03-scene-boot.md §5
 *
 * **DOM만 쓴다.** Pixi가 안 뜬 상태일 수 있으므로 캔버스에 그릴 수 없다.
 * 검은 화면은 절대 금지다 — 무슨 일이 일어났는지 화면에 남긴다.
 *
 * `location.reload()`는 **여기서만** 허용한다 (§03-5). 다른 곳에서는 씬 전환으로
 * 해결한다 — 리로드는 에셋을 다시 받고 흰 화면을 번쩍이게 한다 (§08-5).
 */

export interface FatalErrorOpts {
  /**
   * `[그래도 시작]`. 20초 타임아웃처럼 "일부 에셋 없이도 굴러갈 수 있는"
   * 실패에만 준다 (§03-3). WebGL 실패에는 주면 안 된다 — 눌러도 아무것도 안 뜬다
   */
  onContinue?: () => void;
}

export function showFatalError(
  mount: HTMLElement,
  err: unknown,
  opts: FatalErrorOpts = {},
): void {
  const msg = err instanceof Error ? err.message : String(err);
  const kind = classifyBootError(err);
  mount.innerHTML = "";

  const box = document.createElement("div");
  box.style.cssText =
    "position:absolute;inset:0;display:flex;align-items:center;" +
    "justify-content:center;padding:24px;background:#07050e";
  const panel = document.createElement("div");
  // 형태만 §01 규칙에 맞춘다 — 두꺼운 외곽선 + 밝은 내부 림 (§01-3-1)
  panel.style.cssText =
    "max-width:420px;width:100%;display:flex;flex-direction:column;gap:14px;" +
    "padding:24px;border-radius:20px;background:#404058;" +
    "border:6px solid #211c2e;box-shadow:inset 0 0 0 2px #f0ecff33;" +
    "color:#ffffff;font:16px/1.6 system-ui,sans-serif;text-align:center";

  const h = document.createElement("div");
  h.style.cssText = "font-size:28px;font-weight:700";
  h.textContent = "게임을 시작할 수 없습니다";

  const p = document.createElement("div");
  p.style.cssText = "color:#c9c2e0;font-size:17px";
  // 원인을 짚어야 유저가 할 수 있는 일(브라우저 교체 / 네트워크 확인)을 안다
  p.textContent = bootErrorText(kind);

  // 상세는 기본 접힘. 에셋 데이터 오류만 자동으로 펼친다 — 개발자가 봐야 하는 정보다
  const detail = document.createElement("details");
  detail.open = expandsDetail(kind);
  detail.style.cssText = "text-align:left;font-size:13px";
  const sum = document.createElement("summary");
  sum.style.cssText = "cursor:pointer;color:#c9c2e0;font-size:15px";
  sum.textContent = "오류 상세";
  const code = document.createElement("code");
  code.style.cssText =
    "display:block;margin-top:8px;padding:10px;border-radius:10px;" +
    "background:#211c2e;color:#f07a92;word-break:break-all;user-select:text";
  code.textContent = msg;
  detail.append(sum, code);

  const mkButton = (
    label: string,
    bg: string,
    onTap: () => void,
  ): HTMLElement => {
    const b = document.createElement("button");
    b.style.cssText =
      `width:100%;padding:16px;border-radius:16px;border:4px solid #211c2e;` +
      `background:${bg};color:#ffffff;font:700 20px system-ui,sans-serif;cursor:pointer`;
    b.textContent = label;
    b.addEventListener("click", onTap);
    return b;
  };

  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;flex-direction:column;gap:10px";
  if (opts.onContinue) {
    buttons.appendChild(mkButton("그래도 시작", "#505070", opts.onContinue));
  }
  buttons.appendChild(
    mkButton("다시 시도", "#2878d0", () => location.reload()),
  );

  panel.append(h, p, detail, buttons);
  box.appendChild(panel);
  mount.appendChild(box);
  console.error("[pvp] fatal", err);
}
