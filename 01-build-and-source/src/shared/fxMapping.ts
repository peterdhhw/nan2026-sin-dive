import type { InterferenceKind } from "../core/types";
import type { FX_SHEETS } from "./fxManifest";

export interface FxPoint {
  x: number;
  y: number;
}

/**
 * 지연된 이펙트가 **뜨는 순간** 앉을 자리.
 *
 * `requested`는 요청 시점(=지연 시작) 좌표, `at`은 지금 물어본 좌표다. 앵커가
 * 없으면(`null`) 요청 좌표를 그대로 쓴다 — 지연이 0인 층이 그 경우다.
 *
 * 망가진 좌표는 **요청 좌표로 되돌린다.** 캐릭터가 파괴되는 순간에 앵커가
 * 불리면 NaN이 올 수 있는데, 그대로 넣으면 스프라이트가 화면에서 사라져
 * "이펙트가 안 나왔다"로 보인다 — 제자리에 뜨는 편이 덜 나쁘다.
 */
export function fxRevealAt(requested: FxPoint, at: FxPoint | null): FxPoint {
  if (!at) return requested;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return requested;
  return at;
}

/**
 * 재생 **도중** 매 프레임 따라가는 자리.
 *
 * **왜 뜨는 순간만으로는 부족한가**: 시전 층은 208~667ms를 산다(`FX_SHEETS`의
 * frames÷fps). 그 사이 캐릭터는 적 앞까지 **95px** 달려간다(실측). 한 번 앉힌
 * 자리에 그대로 두면 몸에서 피어난 기운이 대기 자리에 남아 캐릭터만 떠나서,
 * 한 번 누른 스킬이 화면에서 **두 조각**으로 갈라진다. 지연이 0인 첫 층이
 * 특히 그렇다 — 뜨는 순간이 곧 요청 순간이라 앵커를 다시 읽어도 같은 값이다.
 *
 * `current`는 지금 스프라이트가 있는 자리다. 앵커가 없거나 망가진 값을 주면
 * **그 자리를 지킨다** — `fxRevealAt`처럼 요청 좌표로 되돌리면 재생 중에
 * 이펙트가 출발 지점으로 되돌아가 튄다(요청 좌표는 이미 지난 자리다).
 */
export function fxFollowAt(current: FxPoint, at: FxPoint | null): FxPoint {
  if (!at) return current;
  if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return current;
  return at;
}

/**
 * 방해 종류 → 어떤 시트·색·문구로 보여줄지.
 *
 * effects.ts가 아니라 여기 있는 이유: Pixi v8은 import만으로 navigator를
 * 참조하므로 node 환경 테스트에서 effects.ts를 불러올 수 없다. 매핑 규칙은
 * 순수 함수이므로 분리해 테스트 가능하게 둔다.
 */
export function interferenceFx(kind: InterferenceKind): {
  sheet: keyof typeof FX_SHEETS;
  tintHex: number;
  label: string;
} {
  switch (kind) {
    case "slow":
      return { sheet: "aura", tintHex: 0x5fb7d8, label: "감속!" };
    case "gauge_drain":
      return { sheet: "impact", tintHex: 0xd85f8f, label: "게이지 역류!" };
    case "spawn_adds":
      return { sheet: "impact", tintHex: 0x7ad86a, label: "적 증원!" };
    case "blind":
      return { sheet: "aura", tintHex: 0x3a2a55, label: "실명!" };
  }
}
