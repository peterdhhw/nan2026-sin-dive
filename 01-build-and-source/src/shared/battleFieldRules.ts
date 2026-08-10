/**
 * 필드 연출의 순수 규칙 — 그림자 치수, 히트 플래시, 넉백, 사망 곡선.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §4
 *
 * Pixi를 import하지 않는다 (`battleField.ts`가 재export한다). 이 숫자들은
 * "떠 보인다 / 안 아파 보인다"의 실제 원인이라 눈대중으로 고치면 안 된다.
 */

/** 지면 y = 필드 높이 × 이 비율. 0.92는 캐릭터가 화면 아래에 눌려 보였다 (§4-1) */
export const GROUND_RATIO = 0.88;

/**
 * 필드 높이에 대한 캐릭터 키 비율.
 *
 * 0.55 → 0.34. 0.55면 아군 하나가 **282px = 화면 높이의 22%**다(기준 필드
 * 512px). 필드가 "캐릭터 두 명이 꽉 찬 방"이라 이펙트를 얹을 자리가 없었고,
 * 그래서 상한을 계속 조여야 했고 타격이 작고 밋밋했다. 던전앤파이터 계열은
 * 반대 순서다: **캐릭터를 작게 두고 이펙트가 그 위를 덮는다.**
 *
 * 이 값을 내려도 이펙트가 같이 작아지지 않는다 — `FX_COVER_RATIO`가 키 대비
 * 비율이라 캐릭터가 작아진 만큼 이펙트는 **상대적으로 커진다**. 화면에서는
 * 오히려 커진다(궤적 48px → 73px).
 */
export const ALLY_H_RATIO = 0.34;
/**
 * 아군 대비 적 크기. 0.34 → 0.22로 같이 내렸다 (아군 대비 0.65배 유지).
 *
 * 예전 주석의 근거는 그대로다: 에일리언 리그는 폭이 키와 거의 같아서(368×385)
 * 크게 두면 한 마리가 필드 폭의 31%를 먹고 4마리가 물리적으로 안 들어간다.
 * 작아지면 그 압박이 풀려서 겹침이 줄고, 그 자리에 이펙트가 들어간다.
 *
 * **아군만 줄이면 안 된다.** 적이 상대적으로 커지면 "내가 작아진 것"이 아니라
 * "적이 보스인 것"으로 읽힌다 — 둘의 비를 유지해야 스케일이 안 무너진다.
 */
export const ENEMY_H_RATIO = 0.22;

/**
 * 기준 필드 높이(px, 디자인 좌표) — 게이지가 중앙일 때의 상단 필드다.
 *
 * `computeSplit(0.5, 720, 1280)`이 주는 값이다(테스트로 고정). 이펙트 크기를
 * px로 적으려면 캐릭터가 화면에서 몇 px인지 알아야 하는데, 필드 높이는 게이지에
 * 따라 매 프레임 바뀐다 — 눈대중으로 박은 숫자가 아니라 **기준 시점의 실제
 * 치수**를 하나 정해 두고 거기서 유도한다.
 *
 * 512다. 예전 테스트가 여기에 420을 쓰고 있어서 한 번 그 값으로 잡았는데,
 * 그러면 이펙트가 화면에서 18% 작아진다 — 근거가 아니라 다른 테스트의 편의값이었다.
 */
export const REF_FIELD_H = 512;

/** 기준 시점의 아군 표시 높이(px). 이펙트 크기의 유일한 근거다 */
export function allyDisplayPx(fieldH: number = REF_FIELD_H): number {
  return fieldH * ALLY_H_RATIO;
}

/** 기준 시점의 적 표시 높이(px) */
export function enemyDisplayPx(fieldH: number = REF_FIELD_H): number {
  return fieldH * ENEMY_H_RATIO;
}

/**
 * 이펙트 한 층이 캐릭터 키의 몇 배까지 커질 수 있는가.
 *
 * **예전에는 이 자리에 72px이라는 상수가 있었다.** 근거는 "아군이 231px이니
 * 그 1/3까지"였는데(소프트 글로우를 아군으로 오인한 실패), 그 상수는 캐릭터
 * 크기가 바뀌면 조용히 의미가 달라진다 — 캐릭터를 줄이면 이펙트가 상대적으로
 * 커져야 하는데 숫자는 그대로 남는다.
 *
 * 0.62는 "캐릭터보다 작지만 몸통은 확실히 덮는다"다. 1을 넘기면 이펙트가
 * 캐릭터를 완전히 삼켜서 누가 때렸는지 안 보인다 — 예전 실패의 교훈은 크기
 * 자체가 아니라 **덮임**이었다. 층을 여러 개 겹치고 시각을 어긋나게 해서
 * (`delayMs`) 무게를 만들되, 한 층이 캐릭터를 지우지는 않는다.
 */
export const FX_COVER_RATIO = 0.62;

/** 한 웨이브에 동시에 그리는 적 최대 수 (세로 화면 폭 한계) */
export const MAX_VISIBLE_ENEMIES = 4;

/**
 * 적 슬롯 x 위치 (필드 폭 비율).
 *
 * **설계 문서(§4-1)의 `0.62 + i×0.13`에서 벗어난다.** 그 식은 4번째 슬롯이
 * 1.01 — 화면 완전히 밖이다. 스크린샷으로 확인했다. 4마리 웨이브가 실제로
 * 생성되므로(`waves.ts`: 1~4마리) 넷째가 안 보이면 딜은 들어가는데 적이 없는
 * 상태가 된다. 오른쪽 여백 8%를 남기고 압축한다.
 */
export const ENEMY_SLOT_X = [0.52, 0.655, 0.79, 0.925] as const;

/**
 * 아군 대기 자리 x (필드 폭 비율). 좌측 정렬 — 적은 오른쪽에서 온다.
 *
 * 간격의 근거는 **실측 스프라이트 폭**이다. 예전 값(0.13 + i×0.19 = 137px
 * 간격)은 "리그 폭 ≈ 키의 0.9배"를 가정했는데, 우리 에셋은 몸이 옆으로 넓다.
 * 두 아군이 서로의 몸을 관통해서 한 덩어리로 보였다. 0.24 간격 = 173px이고,
 * 여기에 접근 타이밍 지연(`MELEE_STAGGER_MS`)이 겹쳐 둘이 동시에 눕는
 * 프레임이 드물어진다.
 *
 * **주석의 실측값을 2026-08-07에 고쳤다.** 예전에는 "노라 `run` 219px,
 * `roll` 243px"을 근거로 적어 뒀는데, 그 수치는 `ALLY_H_RATIO`가 0.55였을
 * 때의 것이다. 0.34로 내린 뒤 표시 몸폭은 싱글 필드(800px)에서 172~179px이다
 * (chars.json `bodyW` × 표시 배율). **간격 0.24(=173px)는 지금도 몸폭과
 * 거의 같다** — 그래서 대기 자리는 결함이 아니었다. 겹쳐 보인 원인은
 * 돌진의 수렴이고, 그건 `allyLaneX`가 맡는다.
 *
 * 세 명 이상은 마지막 간격을 반복한다 — 프리셋은 2인이지만 팀 크기는 데이터다.
 */
export const ALLY_SLOT_X = [0.13, 0.37] as const;
/** 4번째 이후에 쓸 간격 (필드 폭 비율) */
export const ALLY_SLOT_STEP = 0.24;

/** 아군 인덱스 → 대기 자리 x 비율 */
export function allySlotRatio(index: number): number {
  const i = Math.max(0, Math.floor(index));
  const known = ALLY_SLOT_X[i];
  if (known !== undefined) return known;
  const last = ALLY_SLOT_X[ALLY_SLOT_X.length - 1]!;
  return last + (i - (ALLY_SLOT_X.length - 1)) * ALLY_SLOT_STEP;
}

/**
 * 같은 적을 노리는 아군끼리 벌리는 거리 — **몸폭 대비 비율**이다.
 *
 * ## 왜 필요한가 (2026-08-07)
 *
 * 멈추는 지점은 `homeX + (적 앞면 - homeX) × (1 - reach)`다. 적이 **하나뿐인
 * 판**(보스·미니보스 층, 또는 잡몹이 하나 남은 순간)에서는 두 아군의
 * `targetFor`가 같은 슬롯을 주고, 앞면도 하나뿐이라 둘이 거의 같은 x에 선다 —
 * 10층 보스에서 x 301과 338, **37px**이었다. 표시 몸폭이 172~179px이므로 몸의
 * 5분의 1만 떨어진 것이고, 1:1 캡처에서 두 아군이 한 덩어리로 뭉쳤다.
 *
 * **대기 자리(`ALLY_SLOT_X`)의 문제가 아니다.** 대기 중 최악의 겹침은 44px에
 * 불과하다(간격 173px vs 몸폭 179px). 원인은 배치가 아니라 **수렴**이므로
 * 대기 간격을 넓히면 화면만 좁아지고 겹침은 그대로 남는다.
 *
 * ## 왜 몸폭 비율인가
 *
 * px 상한으로 적으면 캐릭터 크기(`ALLY_H_RATIO`)나 필드 높이가 바뀔 때 조용히
 * 의미가 달라진다 — `FX_COVER_RATIO`가 72px 상수를 버린 것과 같은 이유다.
 *
 * **1.0이다 — 몸폭만큼 온전히 벌린다.** 처음에는 0.55("몸의 절반보다 조금 더")로
 * 뒀는데, 근거는 "몸폭만큼 벌리면 뒤 아군이 적에게 못 닿는다"였다. 세 값(0.55 /
 * 0.8 / 1.0)을 실제로 돌려 보니 그 걱정은 **`allyLaneX`의 대기 자리 하한이
 * 대신 막는다** — 물러날 자리가 없으면 애초에 안 물러선다. 남는 것은 얻는
 * 쪽뿐이라(1층 실측 중앙값 간격 94px → 172px) 부분 분리를 고를 이유가 없다.
 * 대기 자리 간격도 173px이라 **줄에 선 아군 사이가 대기 중과 같아진다.**
 */
export const ALLY_LANE_GAP_RATIO = 1.0;

/**
 * 앞 아군의 멈춤 지점을 받아, 뒤 아군이 설 수 있는 **가장 앞선** x를 돌려준다.
 *
 * ## 왜 오프셋 뺄셈이 아닌가 (2026-08-07, 캡처로 두 번 고쳤다)
 *
 * 첫 판은 순번 × 몸폭 × 0.55를 **그냥 뺐다**. 그 식은 두 아군의 원래 멈춤
 * 지점이 같다고 가정하는데, 실제로는 사거리(`MeleeStyle.reach`)와 대기 자리가
 * 달라서 다르다 — 10층 보스에서 m0은 301, m1은 338이었다. 같은 값을 빼면
 * 차이 37px이 그대로 남는다. 실제로 `bodyW`로 고친 뒤에도 301 대 240 =
 * **61px**밖에 안 벌어졌다(로그 실측). **뺄셈은 간격을 만들지 못한다 —
 * 간격은 결과값 사이의 거리이므로 결과값으로 물어야 한다.**
 *
 * 그래서 **클램프**다: 뒤 아군은 자기 사거리가 주는 자리에 서되, 앞 아군보다
 * `몸폭 × ALLY_LANE_GAP_RATIO`만큼은 뒤여야 한다. 이미 그보다 뒤에 있으면
 * (사거리가 긴 캐릭터) 아무 일도 안 한다 — 필요할 때만 물러선다.
 *
 * `Math.min`인 이유: 아군은 왼쪽, 적은 오른쪽이라 **작은 x가 뒤**다.
 * 앞으로 밀어내는 일은 절대 없어야 한다 — 밀면 적 몸 속으로 걸어 들어간다.
 *
 * ## 대기 자리보다 뒤로는 안 간다
 *
 * `homeX` 하한이 없으면 물러서기가 **후퇴**가 된다. 1.0으로 올려 실측했더니
 * 뒤 아군이 x 88에 섰는데 그 아군의 대기 자리는 94다 — 적을 때리려고 자기
 * 자리보다 뒤로 걸어간 것이고, 화면에서는 겁먹고 물러나는 그림이다. 게다가
 * `advance`(0=대기 → 1=목표)의 부호가 뒤집혀서 "접근" 모션이 뒷걸음질이 된다.
 *
 * 하한이 이 자리에 있어야 하는 이유: 여유가 없다는 사실을 **아는 곳**이 여기다.
 * 벌릴 자리가 없으면 못 벌리는 것이 맞고, 그때 남는 겹침은 이 함수가 아니라
 * 대기 자리 간격(`ALLY_SLOT_X`)이나 팀 크기가 답이다.
 *
 * @param rawX 이 아군의 사거리가 주는 멈춤 지점(px)
 * @param aheadX 바로 앞줄 아군의 멈춤 지점(px). 앞줄이 없으면 null
 * @param bodyW 이 아군의 표시 몸폭(px) — 매니페스트 `bodyW` 환산값이다.
 *   `visualExtent()`로 재면 공격 클립의 무기 궤적까지 삼킨다
 * @param homeX 이 아군의 대기 자리(px). 여기보다 뒤로는 물러나지 않는다
 */
export function allyLaneX(
  rawX: number,
  aheadX: number | null,
  bodyW: number,
  homeX: number,
): number {
  if (!Number.isFinite(rawX)) return 0;
  if (aheadX === null || !Number.isFinite(aheadX)) return rawX;
  const w = Number.isFinite(bodyW) ? Math.max(0, bodyW) : 0;
  const home = Number.isFinite(homeX) ? homeX : rawX;
  // 앞 아군이 이미 대기 자리보다 뒤면 벌릴 자리가 없다 — 제자리를 지킨다.
  // `Math.max`를 `Math.min` 뒤에 두는 순서가 중요하다: 하한이 마지막이어야
  // "물러날 수 있는 만큼만 물러선다"가 된다
  return Math.max(home, Math.min(rawX, aheadX - w * ALLY_LANE_GAP_RATIO));
}

/**
 * 아군 스프라이트의 표시 배율 — 원본 px에 곱하면 화면 px이 된다.
 *
 * `spriteChar.ts`가 캐릭터를 만들 때 쓰는 식(`heightPx / refSubjH`)과 같은
 * 값이어야 한다. 두 벌로 적으면 조용히 갈라진다 — 배율이 어긋나면 몸폭이
 * 어긋나고, 그러면 줄 간격만 이상해지고 화면은 "그럴듯하게" 남는다.
 *
 * **몸폭을 이걸로 환산해서 쓴다.** 런타임의 `visualExtent()`는 *지금 재생 중인
 * 클립*의 알파 bbox라서 공격 프레임에서는 무기 궤적까지 들어간다 — 처음 그걸로
 * 몸폭을 재서 줄 간격이 400px 가까이 나왔고 뒤 아군이 화면 왼쪽 밖(x −22)으로
 * 걸어 나갔다(DEV `[strike]` 로그). 안정적인 몸폭은 매니페스트의 대기 자세
 * `bodyW`(행 폭의 중앙값)뿐이다.
 */
export function allyDisplayScale(
  refSubjH: number,
  fieldH: number = REF_FIELD_H,
): number {
  const h = Number.isFinite(refSubjH) ? refSubjH : 0;
  return allyDisplayPx(fieldH) / Math.max(1, h);
}

/**
 * 몸폭을 모를 때 쓰는 키 대비 비율. 지금 로스터 7종의 `bodyW / refSubjH`는
 * 0.27~0.66이고 중앙값이 0.60이다 — 그 중앙값이다.
 *
 * 언제 쓰이나: 에셋 로드가 실패해 자리표시자 사각형이 그려진 경우(`def`가 null)
 * 이거나 임포터가 `bodyW`를 안 남긴 경우다. **0으로 접지 않는다** — 0이면 줄이
 * 사라져 두 아군이 다시 한 덩어리로 뭉치고, 그건 화면에서 "겹침 버그가 돌아왔다"로
 * 보인다. 근사한 줄이 없는 줄보다 낫다.
 */
export const ALLY_BODY_W_RATIO_FALLBACK = 0.6;

/**
 * 아군의 표시 몸폭(px). 줄 간격(`allyLaneX`)의 유일한 입력이다.
 *
 * @param bodyW 매니페스트의 대기 자세 `bodyW`(원본 px). 없으면 비율로 근사한다
 * @param refSubjH 매니페스트의 `refSubjH`(원본 px) — 표시 배율의 분모
 */
export function allyBodyWPx(
  bodyW: number | undefined,
  refSubjH: number,
  fieldH: number = REF_FIELD_H,
): number {
  const px = allyDisplayPx(fieldH);
  if (bodyW === undefined || !Number.isFinite(bodyW) || bodyW <= 0) {
    return px * ALLY_BODY_W_RATIO_FALLBACK;
  }
  return bodyW * allyDisplayScale(refSubjH, fieldH);
}

/**
 * 슬롯별 깊이(원경도) 0..1. 0 = 앞, 1 = 뒤.
 *
 * 4마리가 폭에 안 들어가므로 겹침을 **깊이로 읽히게** 만든다 — 아이들 RPG의
 * 표준 해법이다. 뒤쪽은 살짝 작고(원근), 위로 올라가고(지면이 멀어짐),
 * 어두워지고(대기 원근), 앞 캐릭터 뒤로 그려진다.
 * 지그재그로 배치해서 인접 슬롯이 같은 깊이에 오지 않게 한다.
 */
export const ENEMY_SLOT_DEPTH = [0, 1, 0, 1] as const;

/** 가장 뒤쪽의 크기 배율 */
export const DEPTH_SCALE_BACK = 0.86;
/** 가장 뒤쪽이 지면에서 올라가는 거리 (캐릭터 키 대비) */
export const DEPTH_LIFT_RATIO = 0.14;
/** 가장 뒤쪽의 명도 배율 — 대기 원근 */
export const DEPTH_DIM_BACK = 0.72;

export interface DepthPose {
  scale: number;
  /** 지면 위로 올리는 px */
  lift: number;
  /** 곱셈 명도 0..1 */
  dim: number;
}

/** 깊이 → 크기·높이·명도. 세 신호를 같이 움직여야 거리로 읽힌다 */
export function depthPose(depth: number, heightPx: number): DepthPose {
  const d = Number.isFinite(depth) ? Math.max(0, Math.min(1, depth)) : 0;
  return {
    scale: 1 + (DEPTH_SCALE_BACK - 1) * d,
    lift: heightPx * DEPTH_LIFT_RATIO * d,
    dim: 1 + (DEPTH_DIM_BACK - 1) * d,
  };
}

/** 슬롯 인덱스 → 깊이 */
export function enemySlotDepth(index: number): number {
  return ENEMY_SLOT_DEPTH[index] ?? 0;
}

/** 명도 배율을 곱한 톤 색. 대기 원근을 skeleton.color로 넣는다 */
export function dimColor(hex: number, k: number): number {
  const f = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 1));
  const r = Math.round(((hex >> 16) & 0xff) * f);
  const g = Math.round(((hex >> 8) & 0xff) * f);
  const b = Math.round((hex & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * 슬라이드 연출 중 필드 컨테이너의 절대 y.
 *
 * **왜 함수인가 (2026-08-07):** 오프셋의 기준은 0이 아니라 `rect.y`다. 싱글
 * 하강 연출이 `field.view.y = offset`으로 직접 넣고 있었고, 첫 층을 깨는
 * 순간 전장이 화면 맨 위로 붙었다 — 필드 아래쪽 `rect.y`(=153.6px)만큼이
 * **배경 없는 검은 띠**로 남고 하늘이 HUD 밑으로 파고들었다(1:1 캡처 y
 * 800~953). 배경 에셋 문제로 보였지만 좌표 문제였다.
 *
 * 산수가 한 줄이라 규칙으로 올릴 가치가 없어 보이지만, 컨테이너에 직접 쓰는
 * 코드는 **검사가 물을 수 없다** — 그래서 두 번 같은 실수가 났다.
 */
export function fieldSlideY(rectY: number, offsetPx: number): number {
  const base = Number.isFinite(rectY) ? rectY : 0;
  return base + (Number.isFinite(offsetPx) ? offsetPx : 0);
}

/** 보스 스케일 (§4-1) */
export const BOSS_SCALE = 1.6;
/** 보스는 슬롯이 하나뿐이므로 중앙 쪽에 세운다 — 1.6배가 오른쪽으로 넘친다 */
export const BOSS_SLOT_X = 0.68;
/** 캐릭터가 이 비율 안쪽에 들어오도록 x를 당긴다 (폭 초과 방지) */
export const FIELD_EDGE_MARGIN = 0.02;

/**
 * 캐릭터가 화면 밖으로 나가지 않는 x를 돌려준다.
 *
 * **범위는 비대칭이다.** 에일리언 리그는 원점이 왼쪽으로 191px 치우쳐 있어서
 * `facing: -1`로 뒤집으면 덩치가 오른쪽으로 쏟아진다. 키의 절반을 반폭으로
 * 가정했더니 보스 머리가 화면 밖으로 나갔다 (스크린샷으로 확인).
 *
 * @param extent `view.position` 기준 좌/우 오프셋(px). left는 보통 음수.
 */
export function clampToField(
  x: number,
  extent: { left: number; right: number },
  fieldWidth: number,
): number {
  const margin = fieldWidth * FIELD_EDGE_MARGIN;
  const max = fieldWidth - margin - extent.right;
  const min = margin - extent.left;
  // 캐릭터가 필드보다 넓으면 중앙에 둔다 — 양쪽 클램프가 서로 모순되는 경우
  if (max < min) return fieldWidth / 2 - (extent.left + extent.right) / 2;
  return Math.max(min, Math.min(max, x));
}

/** 슬롯 인덱스 → x 비율. 보스는 전용 위치 */
export function enemySlotRatio(index: number, isBoss: boolean): number {
  if (isBoss) return BOSS_SLOT_X;
  return ENEMY_SLOT_X[index] ?? ENEMY_SLOT_X[ENEMY_SLOT_X.length - 1]!;
}

// ── 바닥 그림자 (§4-1)
export const SHADOW_ALPHA = 0.28;
/** 그림자 폭 = 캐릭터 키 × 이 값 */
export const SHADOW_W_RATIO = 0.42;
/** 그림자 높이 = 폭 × 이 값 */
export const SHADOW_H_RATIO = 0.3;

// ── 피격 (§4-2)
/** 흰 플래시 지속 */
export const HIT_FLASH_MS = 60;
/** 넉백 거리(px). 캐릭터가 바라보는 반대 방향으로 밀린다 */
export const KNOCKBACK_PX = 8;
export const KNOCKBACK_MS = 140;

// ── 사망 (§4-2)
export const DEATH_MS = 260;
/** 찌부러지는 최종 y 스케일 */
export const DEATH_SQUASH_Y = 0.85;
/** 기울어지는 최종 각도(도) */
export const DEATH_ROTATE_DEG = 12;

// ── 골드 팝 (§4-2: 재화 시스템이 없어도 연출은 넣는다)
export const GOLD_POP_MS = 520;
/** 튀어오르는 높이(px) */
export const GOLD_POP_RISE = 46;
export const GOLD_POP_SIZE = 9;
/** 동시에 뜰 수 있는 골드 개수. 적 4마리가 동시에 죽어도 남는다 */
export const GOLD_POOL = 8;

/**
 * 히트 플래시 강도 0..1. 60ms 안에 1 → 0으로 선형 감쇠한다.
 * 곡선을 쓰지 않는 이유: 60ms는 3~4프레임이라 곡선의 차이가 보이지 않는다.
 */
export function hitFlash(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= HIT_FLASH_MS) return 0;
  return 1 - elapsedMs / HIT_FLASH_MS;
}

/**
 * 넉백 오프셋(px, 부호 없음). 앞 25%에서 최대까지 튀고 나머지에서 돌아온다.
 * 즉시 최대로 가면 순간이동처럼 보인다.
 */
export function knockback(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= KNOCKBACK_MS) return 0;
  const t = elapsedMs / KNOCKBACK_MS;
  const shape = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
  return KNOCKBACK_PX * shape;
}

export interface DeathPose {
  scaleY: number;
  rotationDeg: number;
  alpha: number;
  /** 연출이 끝나 숨겨도 되는지 */
  done: boolean;
}

/** 사망 포즈. 알파는 뒤쪽 절반에서만 빠진다 — 처음부터 사라지면 죽는 게 안 보인다 */
export function deathPose(elapsedMs: number): DeathPose {
  const raw = DEATH_MS > 0 ? elapsedMs / DEATH_MS : 1;
  const t = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
  const ease = 1 - (1 - t) ** 2;
  return {
    scaleY: 1 + (DEATH_SQUASH_Y - 1) * ease,
    rotationDeg: DEATH_ROTATE_DEG * ease,
    alpha: t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5,
    done: t >= 1,
  };
}

/**
 * HP바를 보여 줄 슬롯 상태. 필드의 `EnemySlot`에서 **바가 보는 네 값만** 뽑았다.
 */
export interface HpBarSlotState {
  /** 이 슬롯에 적이 배치되어 있는가 (사망 연출 중에도 true) */
  occupied: boolean;
  /** 사망 연출이 끝나 완전히 숨겨졌는가 */
  buried: boolean;
  /** 사망 연출 경과(ms). **연출이 끝나면 -1로 돌아온다** */
  deathMs: number;
  /** 걸어 들어오는 중의 경과(ms). `null`이면 이미 자리에 섰다 */
  walkInMs: number | null;
}

/**
 * 이 슬롯의 HP바가 지금 보여야 하는가.
 *
 * ## 왜 함수로 뽑았는가 (유저 신고 1번)
 *
 * "몬스터가 안 죽었는데, 정확히는 몬스터의 HP 바가 계속 있는데, 밑으로
 * 내려가는 이슈가 있고."
 *
 * 바가 아래로 흐르는 것은 **정상 연출**이다 — 바는 `overlay`에 있고 그 부모가
 * 슬라이드하는 `view`다(`fieldSlideY`). 결함은 죽은 적의 바가 그 슬라이드에
 * 실려 남는 것이었고, 원인은 **켜는 곳이 셋인데 끄는 곳이 하나**였던 비대칭이다
 * (스폰·등장 도착·킬에서 켜고/끄고, 사망 연출 완료에서는 아무것도 안 했다).
 *
 * 그래서 조건을 흩어 적지 않고 여기 한 번 적는다. 각 자리에서 조건을
 * 다시 쓰면 다음에 상태가 하나 늘 때 또 한 곳이 빠진다.
 *
 * ## 왜 `deathMs < 0`으로 "살아 있다"를 물으면 안 되는가
 *
 * 사망 연출이 끝나면 `deathMs`가 **-1로 돌아온다**(`slot.deathMs = -1`). 즉
 * 죽기 전과 죽은 뒤가 같은 값이다 — 죽은 것을 아는 값은 `buried`뿐이다.
 * 등장(620ms) 중에 강제 방출로 죽을 수 있으므로(`PENDING_HARD_MS`) 도착 시점에
 * `deathMs`만 보면 이미 묻힌 적의 바가 되살아난다.
 */
export function showsHpBar(s: HpBarSlotState): boolean {
  // 걸어 들어오는 중에는 감춘다 — 바는 슬롯 좌표에 고정이고 스프라이트만
  // 화면 밖에서 걸어오므로, 켜 두면 아무도 없는 자리에 바가 떠 있다
  if (s.walkInMs !== null) return false;
  if (!s.occupied || s.buried) return false;
  // 사망 연출 중(deathMs >= 0)에는 바를 뺀다 — 0%인 바는 정보가 없고,
  // 쓰러지는 적 위에 남으면 "아직 살아 있다"로 읽힌다
  return s.deathMs < 0;
}

export interface GoldPose {
  dx: number;
  dy: number;
  alpha: number;
  done: boolean;
}

/** 골드가 튀어오르는 포물선. 위로 솟았다가 살짝 내려앉으며 사라진다 */
export function goldPose(elapsedMs: number, driftX: number): GoldPose {
  const raw = GOLD_POP_MS > 0 ? elapsedMs / GOLD_POP_MS : 1;
  const t = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 1));
  // 4t(1-t)는 t=0.5에서 1인 포물선 — 정확히 중간에 정점을 찍는다
  const arc = 4 * t * (1 - t);
  return {
    dx: driftX * t,
    dy: -GOLD_POP_RISE * (arc * 0.6 + t * 0.4),
    alpha: t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4,
    done: t >= 1,
  };
}
