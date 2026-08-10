/**
 * 부팅 씬의 순수 규칙 — 단계별 진행률 가중, 팁 선택, 지연 문구.
 *
 * 설계 문서: specs/2026-07-27-ux/03-scene-boot.md §3
 *
 * Pixi를 import하지 않는다 (`bootScene.ts`가 재export한다).
 */

/** 로딩 단계. 가중 합은 1이어야 한다 (테스트로 강제) */
export const BOOT_STEPS = [
  { id: "font", weight: 0.1, label: "글꼴 준비 중" },
  { id: "bg", weight: 0.18, label: "배경 불러오는 중" },
  { id: "fx", weight: 0.1, label: "이펙트 불러오는 중" },
  // 캐릭터 시트는 22장을 순차로 받는다 — 부팅에서 가장 오래 걸리는 단계다.
  // 아군/적을 따로 세지 않는다: 같은 매니페스트 한 번에 다 받으므로
  // 두 단계로 쪼개면 앞 단계가 끝나는 시점을 지어내는 셈이 된다.
  { id: "chars", weight: 0.48, label: "캐릭터 불러오는 중" },
  { id: "warmup", weight: 0.1, label: "준비 중" },
  { id: "sfx", weight: 0.04, label: "효과음 불러오는 중" },
] as const;
export type BootStepId = (typeof BOOT_STEPS)[number]["id"];

/** 완료된 단계들의 가중 합 = 진행률 0..1 */
export function bootProgress(done: readonly BootStepId[]): number {
  const set = new Set(done);
  let sum = 0;
  for (const s of BOOT_STEPS) if (set.has(s.id)) sum += s.weight;
  return Math.max(0, Math.min(1, sum));
}

/**
 * 진행률은 되돌아가지 않는다 (§03-3).
 *
 * 단계가 병렬로 끝나면 보고 순서가 뒤집힐 수 있다. 뒤로 가는 바는
 * "뭔가 실패했다"로 읽힌다 — 실제로는 아무 문제가 없는데도.
 */
export function monotonic(prev: number, next: number): number {
  const n = Number.isFinite(next) ? next : prev;
  return Math.max(prev, Math.max(0, Math.min(1, n)));
}

/** 진행률 문구 — 퍼센트는 정수로 (§03-2) */
export function progressText(
  step: BootStepId | null,
  progress: number,
): string {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const label =
    BOOT_STEPS.find((s) => s.id === step)?.label ?? "에셋 불러오는 중";
  return `${label} ${pct}%`;
}

/**
 * 팁 문구 (§03-3). 이 5개가 **유일한 온보딩이다** — 튜토리얼을 만들지 않는다.
 *
 * 순서에 의미가 있다: 0번(쿨다운 초록)과 2번(게이지가 화면을 넓힌다)이
 * 규칙 이해에 가장 중요하다.
 */
export const BOOT_TIPS = [
  "스킬은 쿨다운이 차면 테두리가 초록으로 빛난다.",
  "AUTO를 켜면 알아서 싸운다 — 하지만 직접 쓰는 게 더 빠르다.",
  "게이지가 내 쪽으로 기울면 화면이 넓어진다.",
  "방해 스킬은 상대 화면에 직접 꽂힌다.",
  "제한 시간 120초. 그때까지 앞서 있으면 판정 승이다.",
] as const;

/**
 * 팁 선택. **첫 진입에서는 0번을 고정한다** (§03-3) —
 * 첫 판이 매칭 직행이라 규칙을 배울 다른 지점이 없다.
 */
export function pickTip(seed: number, firstVisit: boolean): string {
  if (firstVisit) return BOOT_TIPS[0];
  const s = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
  return BOOT_TIPS[s % BOOT_TIPS.length]!;
}

/** 팁이 나타나는 시각 (§03-3 지연 대응) */
export const TIP_AFTER_MS = 3_000;
/** 느린 네트워크 안내 */
export const SLOW_AFTER_MS = 8_000;
export const SLOW_NOTICE = "네트워크가 느린 것 같습니다";
/** 이 시간을 넘기면 오류 화면으로 (버튼 2개) */
export const BOOT_TIMEOUT_MS = 20_000;

/** 바가 목표까지 따라가는 반감기 — 뚝뚝 끊기면 느려 보인다 (§03-3) */
export const BAR_LERP_HALF_LIFE_MS = 200;

/**
 * 부팅 실패 원인 분류 (§03-5).
 *
 * 문구가 원인을 짚어야 유저가 할 수 있는 일(브라우저 교체 / 네트워크 확인)을
 * 안다. "알 수 없는 오류"는 아무 정보도 주지 않는다.
 */
export type BootErrorKind = "gpu" | "network" | "asset" | "unknown";

export function classifyBootError(err: unknown): BootErrorKind {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  /**
   * 에셋 데이터 문제를 GPU보다 먼저 본다 — 메시지에 두 단어가 같이 나올 수 있다
   * ("Unable to render X on WebGL context"류). 캐릭터 매니페스트가 깨지거나
   * 시트 규격이 어긋난 경우는 브라우저를 바꿔도 해결되지 않는다.
   */
  if (
    msg.includes("chars.json") ||
    msg.includes("형식이 아니다") ||
    msg.includes("unknown char") ||
    msg.includes("skeleton")
  ) {
    return "asset";
  }
  if (msg.includes("webgl") || msg.includes("webgpu") || msg.includes("gpu")) {
    return "gpu";
  }
  if (
    msg.includes("fetch") ||
    msg.includes("404") ||
    msg.includes("failed to load") ||
    msg.includes("network")
  ) {
    return "network";
  }
  return "unknown";
}

export function bootErrorText(kind: BootErrorKind): string {
  switch (kind) {
    case "gpu":
      return "이 브라우저는 게임 그래픽을 지원하지 않습니다. Chrome·Safari 최신 버전을 사용해 주세요.";
    case "network":
      return "게임 파일을 받지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.";
    case "asset":
      return "게임 데이터를 읽을 수 없습니다. 다시 시도해 주세요.";
    default:
      return "브라우저가 WebGL을 지원하지 않거나 에셋을 불러오지 못했습니다.";
  }
}

/** 에셋 데이터 오류는 상세를 자동으로 펼친다 — 개발자가 봐야 하는 정보다 (§03-5) */
export function expandsDetail(kind: BootErrorKind): boolean {
  return kind === "asset";
}
