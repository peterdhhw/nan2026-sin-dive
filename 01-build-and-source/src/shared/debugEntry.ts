/**
 * 디버그 진입 파라미터 파싱.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §3 (스크린샷 회귀)
 *
 * **왜 필요한가**: `?gauge=-0.72`(밀리는 중)나 `?wave=3`(심연 테마) 같은 상태는
 * 실제 플레이로는 40~60초를 기다려야 도달하고, 도달 시점을 예측할 수 없다.
 * 그래서 최소 필드 235px에서 캐릭터·HP바·숫자가 다 보이는지 같은 검증이
 * 사실상 불가능했다.
 *
 * **DEV에서만 활성화한다.** 프로덕션에서 URL로 게이지를 조작할 수 있으면
 * 그건 디버그 기능이 아니라 치트다. `enabled: false`면 전부 무시하고 기본값을
 * 돌려준다 — 호출부가 분기하지 않아도 안전하다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

import { parseSceneName, type SceneName } from "./sceneRules";

export interface DebugEntry {
  /** 시작 게이지 위치 -1..1. null = 기본(0) */
  gauge: number | null;
  /** 시작 웨이브 번호 (1-based). null = 기본(1) */
  wave: number | null;
  /** 매칭 대기를 건너뛴다 — 스크린샷 검증에서 대기 화면을 기다릴 이유가 없다 */
  skipMatch: boolean;
  /** `?debug=1` — 탭 카운터·dps 표기 (§README-3-1 실측용) */
  debugHud: boolean;
  /**
   * `?gallery=1` — 전투 대신 공용 위젯 갤러리를 띄운다.
   *
   * 위젯을 전투 중에만 볼 수 있으면 형태 규칙(§01-3)의 회귀를 잡을 수 없다.
   * 배너는 1.26초 만에 지나가고, 잠긴 버튼·크림 패널은 결과 화면에만 나온다.
   */
  gallery: boolean;
  /**
   * `?scene=title|match|vs|battle|result` — 그 씬으로 직행한다.
   *
   * 정상 흐름은 S0→S2(5초)→S3(1.6초)→S4다. 결과 화면 하나를 보려고 매번
   * 2분 대전을 끝까지 돌 수는 없다 (설계 문서 09-3 스크린샷 표).
   */
  scene: SceneName | null;
  /**
   * `?result=win|lose|draw|forfeit` — 결과 씬을 이 결과로 띄운다.
   * `?scene=result`를 함께 주지 않아도 결과 씬으로 직행한다는 뜻으로 읽는다.
   */
  result: DebugResult | null;
}

/** `?result=`가 받는 값. `SessionResult`의 조합을 이름으로 줄인 것이다 */
export const DEBUG_RESULTS = ["win", "lose", "draw", "forfeit"] as const;
export type DebugResult = (typeof DEBUG_RESULTS)[number];

export const NO_DEBUG: DebugEntry = {
  gauge: null,
  wave: null,
  skipMatch: false,
  debugHud: false,
  gallery: false,
  scene: null,
  result: null,
};

/** 웨이브 번호 상한. 코어의 웨이브 개수를 넘어서면 의미가 없다 */
export const MAX_DEBUG_WAVE = 40;

/**
 * `Number("")`은 0이다. 빈 값(`?gauge=`)을 0으로 읽으면 지정하지 않은 것과
 * 구분이 안 되는데, 0은 "균형에서 시작"이라는 유효한 지시라 조용히 덮어쓴다.
 * 공백만 있는 값도 같은 이유로 미지정으로 본다.
 */
function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 쿼리 문자열 → 디버그 진입값.
 *
 * @param enabled `import.meta.env.DEV`. false면 전부 무시한다
 */
export function parseDebugEntry(search: string, enabled: boolean): DebugEntry {
  if (!enabled) return NO_DEBUG;
  const q = new URLSearchParams(search);

  const g = num(q.get("gauge"));
  const w = num(q.get("wave"));
  const result = parseDebugResult(q.get("result"));
  // `?result=`만 준 것도 결과 화면을 보러 온 것이다 — 씬을 따로 적게 하지 않는다
  const scene =
    parseSceneName(q.get("scene")) ?? (result !== null ? "result" : null);
  return {
    gauge: g === null ? null : Math.max(-1, Math.min(1, g)),
    // 1 미만·소수는 접는다. 0을 그대로 넘기면 웨이브 인덱스가 -1이 된다
    wave:
      w === null ? null : Math.max(1, Math.min(MAX_DEBUG_WAVE, Math.floor(w))),
    // gauge/wave를 지정한 건 이미 전투를 보러 온 것이다 — 매칭 대기는 방해다
    // `?scene=`으로 매칭 이후 씬을 지정한 것도 같다 (매칭 씬 자체는 예외)
    skipMatch:
      q.has("nowait") ||
      g !== null ||
      w !== null ||
      (scene !== null && scene !== "match"),
    debugHud: q.get("debug") === "1",
    gallery: q.get("gallery") === "1",
    scene,
    result,
  };
}

function parseDebugResult(raw: string | null): DebugResult | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return (DEBUG_RESULTS as readonly string[]).includes(v)
    ? (v as DebugResult)
    : null;
}
