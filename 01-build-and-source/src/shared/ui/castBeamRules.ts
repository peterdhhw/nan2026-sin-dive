/**
 * 시전 광선 궤적의 순수 규칙 — 슬롯에서 필드로 뻗는 선.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §7 (탭 → 광선 궤적),
 *            README §3-2 (인과 사슬)
 *
 * **왜 필요한가**: `탭 → 데미지 → dps → push → 게이지`는 추상화가 4단이다.
 * 첫 단(탭 → 스킬이 필드에 작용)이 안 보이면 유저는 버튼과 결과를 잇지 못하고
 * 게임이 슬롯머신처럼 느껴진다 (README §3-2).
 *
 * Pixi를 import하지 않는다 (`castBeam.ts`가 재export한다).
 */

/** 광선이 날아가는 시간 (§7: 180ms) */
export const BEAM_MS = 180;
/** 잔상이 사라지기까지 추가로 더 걸리는 시간 */
export const BEAM_FADE_MS = 120;
/** 머리(선두)의 길이 비율 — 꼬리는 이만큼 뒤에서 따라온다 */
export const BEAM_TAIL_RATIO = 0.42;
/** 선 두께(px). 머리 쪽이 두껍다 */
export const BEAM_W = 7;
/** 동시에 날 수 있는 광선 개수. 4슬롯 연타 + AUTO를 감당한다 */
export const BEAM_POOL = 6;
/**
 * 직선이 아니라 살짝 휜다. 직선은 UI 요소처럼 보이고, 곡선은 "발사된 것"처럼 보인다.
 * 궤적 길이에 대한 비율로 옆으로 부푼다.
 */
export const BEAM_BOW_RATIO = 0.14;

export interface BeamPose {
  /** 꼬리 진행도 0..1 */
  from: number;
  /** 머리 진행도 0..1 */
  to: number;
  alpha: number;
  done: boolean;
}

/**
 * 경과 시간 → 궤적 위의 꼬리/머리 위치.
 *
 * 머리는 `BEAM_MS`에 목표에 닿고, 그 뒤 `BEAM_FADE_MS` 동안 꼬리가 머리에
 * 흡수되며 사라진다 — 화살이 꽂히는 그림이다. 머리와 꼬리를 따로 두는 이유는
 * 선분 하나를 늘였다 줄이는 것만으로 속도감이 생기기 때문이다.
 */
export function beamPose(elapsedMs: number): BeamPose {
  if (!(elapsedMs >= 0)) return { from: 0, to: 0, alpha: 0, done: true };
  const total = BEAM_MS + BEAM_FADE_MS;
  if (elapsedMs >= total) return { from: 1, to: 1, alpha: 0, done: true };

  if (elapsedMs <= BEAM_MS) {
    const t = elapsedMs / BEAM_MS;
    // 머리는 가속(easeInQuad)한다 — 등속은 밋밋하고, 감속은 힘이 빠져 보인다
    const head = t * t * 0.35 + t * 0.65;
    return {
      from: Math.max(0, head - BEAM_TAIL_RATIO),
      to: Math.min(1, head),
      alpha: 1,
      done: false,
    };
  }

  const f = (elapsedMs - BEAM_MS) / BEAM_FADE_MS;
  return {
    from: Math.min(1, 1 - BEAM_TAIL_RATIO * (1 - f)),
    to: 1,
    alpha: 1 - f,
    done: false,
  };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 궤적 위 한 점. 2차 베지에 — 제어점은 시작·끝의 중점에서 법선 방향으로 부푼다.
 *
 * @param bowSign 휘는 방향. 슬롯 위치에 따라 좌우로 갈라 놓으면 4슬롯을 연타해도
 *   궤적이 겹쳐 한 줄로 보이지 않는다.
 */
export function beamPoint(
  a: Point,
  b: Point,
  t: number,
  bowSign: number,
): Point {
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const bow = len * BEAM_BOW_RATIO * (bowSign >= 0 ? 1 : -1);
  // 법선 = (-dy, dx) 정규화. 길이 0이면 부풀리지 않는다
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;
  const cx = (a.x + b.x) / 2 + nx * bow;
  const cy = (a.y + b.y) / 2 + ny * bow;
  const u = 1 - k;
  return {
    x: u * u * a.x + 2 * u * k * cx + k * k * b.x,
    y: u * u * a.y + 2 * u * k * cy + k * k * b.y,
  };
}

/** 궤적을 몇 조각으로 나눠 그릴지. 곡선이라 선분 하나로는 안 된다 */
export const BEAM_SEGMENTS = 10;

/**
 * 이 종류의 스킬에 광선을 그리는가.
 *
 * **공격 스킬은 안 그린다.** 광선의 목적은 "버튼이 저기에 작용했다"를 잇는
 * 것인데(§3-2), 공격 스킬은 이제 아군이 직접 달려가 때린다
 * (`skillMeleeRules`) — 인과의 주체가 캐릭터다. 거기에 광선까지 얹으면
 * 버튼에서 먼저 뭔가 날아가 적을 맞히고 **그 다음에** 캐릭터가 달려가는,
 * 두 번 때리는 그림이 된다. 유저가 지적한 것이 정확히 이것이다
 * ("이펙트가 직접 몬스터한테 날라가").
 *
 * 방해·버프는 유지한다. 그 둘은 캐릭터를 움직이지 않으므로 광선을 빼면
 * 눌렀다는 증거가 화면에서 사라진다 — 방해는 **상대 필드**에 작용해서
 * 내 캐릭터가 대신 보여줄 수 없고, 버프도 즉시 보이는 것은 배너뿐이다.
 */
export function castBeamShown(kind: string): boolean {
  return kind !== "attack";
}
