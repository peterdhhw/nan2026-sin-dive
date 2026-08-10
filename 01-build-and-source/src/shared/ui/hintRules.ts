/**
 * Toast / HintFinger의 순수 규칙.
 *
 * 설계 문서: specs/2026-07-27-ux/02-components.md §C10
 *
 * Pixi를 import하지 않는다 (`ui/hint.ts`가 재export한다).
 */

/** 토스트 유지 시간 (§C10: 1.8초 후 자동 소멸) */
export const TOAST_HOLD_MS = 1800;
export const TOAST_IN_MS = 180;
export const TOAST_OUT_MS = 220;

/** 화면 하단에서 위로 20% 지점 (§C10) */
export const TOAST_BOTTOM_RATIO = 0.2;

/**
 * 토스트 알약이 쓸 수 있는 최대 폭 — **화면 폭 기준 비율이다.**
 *
 * 왜 상한이 필요한가: 폭이 `라벨폭 + 패딩`뿐이면 안내문 길이가 곧 알약 폭이라
 * 상한이 없다. 안내문은 못 누르는 이유를 말하는 **유일한** 수단이므로 잘리면
 * 기능이 죽는다 — 그런데 잘려도 화면은 멀쩡해 보이니 눈으로 안 잡힌다.
 *
 * **여유가 얼마나 남았나**(1:1 캡처 실측, 720px 기준): 잠긴 대전 안내
 * (`matchLockedNotice`, 1층)가 556px이다. 아직 안 잘린다 — 이 상한은 관측된
 * 잘림을 고치는 게 아니라 남은 164px을 다 쓰기 전에 줄을 바꾸게 하는 방어다.
 * 층수가 네 자리가 되고 문구가 몇 자 늘면 닿는 거리다.
 *
 * 0.88인 이유: 좌우 6%씩 여백을 남긴다 — 알약이 화면에 꽉 차면 잘린 것인지
 * 원래 그런 것인지 구분이 안 된다.
 */
export const TOAST_MAX_W_RATIO = 0.88;

export function toastMaxW(designW: number): number {
  return Math.round(Math.max(0, designW) * TOAST_MAX_W_RATIO);
}

/**
 * 알약 높이. **라벨이 두 줄이 되면 같이 자란다** — 고정 높이(56)에 두 줄을
 * 넣으면 글자가 알약 위아래로 새어 나온다.
 */
export const TOAST_MIN_H = 56;
export const TOAST_PAD_Y = 14;

export function toastHeight(labelH: number): number {
  const h = Number.isFinite(labelH) ? Math.max(0, labelH) : 0;
  return Math.max(TOAST_MIN_H, Math.round(h) + TOAST_PAD_Y * 2);
}

export function toastAlpha(
  elapsedMs: number,
  holdMs: number = TOAST_HOLD_MS,
): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < TOAST_IN_MS) return elapsedMs / TOAST_IN_MS;
  if (elapsedMs < TOAST_IN_MS + holdMs) return 1;
  const t = (elapsedMs - TOAST_IN_MS - holdMs) / TOAST_OUT_MS;
  return t >= 1 ? 0 : 1 - t;
}

export function toastDone(
  elapsedMs: number,
  holdMs: number = TOAST_HOLD_MS,
): boolean {
  return elapsedMs >= TOAST_IN_MS + holdMs + TOAST_OUT_MS;
}

/** 진입 시 살짝 올라온다 (y 오프셋 px) */
export const TOAST_RISE_PX = 18;

export function toastRise(elapsedMs: number): number {
  if (elapsedMs < 0) return TOAST_RISE_PX;
  if (elapsedMs >= TOAST_IN_MS) return 0;
  const t = elapsedMs / TOAST_IN_MS;
  // easeOutCubic
  return TOAST_RISE_PX * Math.pow(1 - t, 3);
}

// ── HintFinger

/** 상하 흔들림 주기·진폭 (§C10) */
export const FINGER_PERIOD_MS = 900;
export const FINGER_AMP_PX = 10;

/**
 * 손 모양의 기하 — 검지 캡슐 위끝부터 손바닥 원 아래끝까지 (로컬 좌표).
 *
 * **왜 규칙으로 올렸나 (2026-08-07):** 이 숫자들은 `hint.ts`가 `Graphics`에
 * 직접 박고 있었고, 그래서 **호출자가 손끝이 어디인지 알 방법이 없었다.**
 * 두 세션(`single`/`pvp`)이 똑같이 `firstSlot.y - 70`을 적었는데, 70은
 * 어디서도 유도되지 않은 눈대중이다 — 4칸 스킬바(슬롯 지름 138.7)에서 손바닥
 * 원이 슬롯 상단을 **18px 파고들어** 손 모양이 슬롯 테두리에 얹혀 파란 얼룩으로
 * 보였다(1:1 캡처로 확인). 6칸(지름 92.5)에서는 4.8px 남아 겨우 걸쳐 있었다 —
 * 즉 같은 상수가 칸 수에 따라 다른 뜻이 됐다.
 */
export const FINGER_TIP_DY = -34;
export const FINGER_PALM_CY = 2;
export const FINGER_PALM_R = 17;
/** 검지 캡슐의 길이 — 위끝(손끝)부터 손바닥 원 중심까지 */
export const FINGER_STEM_H = FINGER_PALM_CY - FINGER_TIP_DY;
/** 손바닥 원의 아래끝 (로컬 y) */
export const FINGER_BOTTOM_DY = FINGER_PALM_CY + FINGER_PALM_R;
/** 손 전체가 차지하는 세로 길이 (흔들림 제외) */
export const FINGER_H = FINGER_BOTTOM_DY - FINGER_TIP_DY;

/**
 * 손 그림을 감싸는 사각(로컬 좌표) — 손바닥 원의 좌우까지 포함한다.
 *
 * 캡슐은 폭 18(±9)이지만 손바닥 원이 ±17로 더 넓다. 세로는 흔들림
 * (`fingerOffset`, ±`FINGER_AMP_PX`)까지 넣는다 — 흔들리는 순간에 삐져나오면
 * 정지 프레임 캡처로는 안 잡히는 결함이 된다.
 */
export const FINGER_HALF_W = FINGER_PALM_R;
export const FINGER_BOX_TOP = FINGER_TIP_DY - FINGER_AMP_PX;
export const FINGER_BOX_BOTTOM = FINGER_BOTTOM_DY + FINGER_AMP_PX;
/** 사각의 세로 중심 — 손끝이 위로 길어서 앵커(0)보다 위에 있다 */
export const FINGER_BOX_CY = (FINGER_BOX_TOP + FINGER_BOX_BOTTOM) / 2;
/** 사각을 감싸는 원의 반지름 — 손이 슬롯 원 안에 드는지 이걸로 판정한다 */
export const FINGER_BOX_R = Math.hypot(
  FINGER_HALF_W,
  (FINGER_BOX_BOTTOM - FINGER_BOX_TOP) / 2,
);

/**
 * 슬롯 중심·지름을 받아 손가락을 놓을 자리를 돌려준다.
 *
 * **왜 슬롯 위가 아니라 슬롯 안인가 (2026-08-07):** 첫 수정안은 손을 슬롯 위
 * 빈 줄에 세우는 것이었다(`슬롯상단 - 여백 - 진폭 - 손높이`). 4칸 바에서는
 * **그 빈 줄이 없다** — 1:1 캡처를 재보면 강화 줄 버튼 아래끝(design y 1037)과
 * 슬롯 상단(1081.6) 사이가 44.6px인데 손은 흔들림까지 81px을 쓴다. 그래서 손이
 * 슬롯을 비켜난 대신 `공격력 60 G`의 가격을 덮었다(캡처로 확인 — 침범 대상만
 * 슬롯에서 강화 버튼으로 옮겼을 뿐이다). 옆도 안 된다: 4칸 바의 원 사이 틈은
 * 30.5px이고 손은 34px 넓다.
 *
 * **그래서 슬롯 원 안에 넣는다.** 튜토리얼 손은 원래 버튼을 덮는다 — 한 번
 * 누르면 사라지므로(§C10) 아이콘을 잠깐 가리는 건 비용이 아니다. 대신 **테두리를
 * 걸치지 않는 것**이 조건이다: 걸치면 손 아웃라인과 슬롯 아웃라인이 이어 붙어
 * 파란 얼룩 하나로 읽힌다(원래 결함이 그것이었다).
 *
 * 치우는 거리를 비율로 적지 않는다 — 슬롯 반지름에서 **손 자신의 크기를 빼고**
 * 남는 만큼만 대각선으로 민다. 그러면 어떤 칸 수에서도 원 안에 드는 것이
 * 산술로 보장된다(비율 상수는 4칸에서 맞으면 6칸에서 새는 값이었다).
 * 오른쪽 아래로 미는 이유: 손끝이 슬롯 중심을 향하고 아이콘 위쪽이 드러난다.
 *
 * 손보다 작은 슬롯이면 0으로 접어 중심에 놓는다 — 그때는 손이 원보다 커서
 * 어디에 둬도 삐져나온다. 지금 쓰는 두 바(4칸·6칸)는 다 여유가 있다.
 */
export function fingerAnchor(
  slotCenterX: number,
  slotCenterY: number,
  slotDiameter: number,
): { x: number; y: number } {
  const r = Math.max(0, slotDiameter) / 2;
  const slack = Math.max(0, r - FINGER_BOX_R);
  const d = slack / Math.SQRT2;
  // 앵커는 사각의 중심이 아니다 — 사각 중심을 (d, d)에 놓으려면 그만큼 되민다
  return { x: slotCenterX + d, y: slotCenterY + d - FINGER_BOX_CY };
}

export function fingerOffset(elapsedMs: number): number {
  if (!(elapsedMs >= 0)) return 0;
  const t = (elapsedMs % FINGER_PERIOD_MS) / FINGER_PERIOD_MS;
  return Math.sin(t * Math.PI * 2) * FINGER_AMP_PX;
}

export function fingerAlpha(elapsedMs: number): number {
  if (!(elapsedMs >= 0)) return 0;
  const t = (elapsedMs % FINGER_PERIOD_MS) / FINGER_PERIOD_MS;
  // 0.55~1.0 사이로 깜빡인다. 완전히 사라지면 "무엇을 가리켰는지"를 놓친다
  return 0.55 + 0.45 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
}

/** 손 커서 색 — 레퍼런스의 파란 손 (§C10) */
export const FINGER_COLOR = 0x4a9ce8;

/**
 * 힌트를 봤다는 사실을 저장하는 키.
 *
 * **첫 대전에서만** 띄우고 한 번 탭하면 영구 해제한다 (§C10). 매 판 손가락이
 * 뜨면 "게임이 나를 초보로 본다"가 되고, 슬롯을 가려 조작을 방해한다.
 */
export const HINT_SEEN_KEY = "abyss-dive.hint.skill-slot";

/**
 * `localStorage` 접근을 감싼다. 사파리 프라이빗 모드는 `localStorage` 접근
 * 자체가 던지므로(quota 0) 힌트 하나 때문에 부팅이 죽지 않게 한다.
 */
export function readSeen(store: Pick<Storage, "getItem"> | null): boolean {
  if (!store) return false;
  try {
    return store.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSeen(store: Pick<Storage, "setItem"> | null): void {
  if (!store) return;
  try {
    store.setItem(HINT_SEEN_KEY, "1");
  } catch {
    // 저장에 실패하면 다음 판에 다시 뜬다 — 기능이 죽는 것보다 낫다
  }
}
