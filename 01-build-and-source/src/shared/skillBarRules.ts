/**
 * 스킬바 배치의 순수 규칙 — 나무 스트립 3단 톤, AUTO/슬롯 좌표.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §7
 *
 * Pixi를 import하지 않는다 (`skillBar.ts`가 재export한다).
 */

import { darken, lighten } from "./color";

/** 나무 스트립 밑색 (§7: #504030) */
export const WOOD_BASE = 0x504030;

export interface WoodBands {
  readonly top: number;
  readonly mid: number;
  readonly bottom: number;
}

/** 세로 그라디언트 3단 (§7). 3단 셰이딩 규칙과 같은 혼합비를 쓴다 */
export function woodBands(base: number = WOOD_BASE): WoodBands {
  return {
    top: lighten(base, 0.22),
    mid: base,
    bottom: darken(base, 0.25),
  };
}

/** 상단 금색 라인 두께 (§7) */
export const GOLD_LINE_H = 2;

/**
 * AUTO 배지 지름 = 바 높이 × 이 비율. 슬롯보다 작게 — 스킬이 주인공이다.
 *
 * **0.44 → 0.36 (3단계).** §7의 0.44는 슬롯이 5칸까지이던 시절의 값이다. 6칸이
 * 되면 슬롯 지름이 칸 폭에 걸려 92.5px로 줄어드는데(`barLayout`) 배지를 101px에
 * 두면 **배지가 화면에서 가장 큰 원**이 된다 — "슬롯보다 작은 보조 위젯"이라는
 * 관계가 뒤집힌다. 배지가 바 밖으로 나가서 폭 경쟁이 없어졌으므로 줄이는 값은
 * 공짜다.
 *
 * 상한의 유래: 6칸 슬롯 지름 ÷ 바 높이 = 92.496 ÷ 230.4 ≈ 0.401. 0.36은 그
 * 아래로 10% 여유를 둔 값이고, 지름 82.9px은 탭 최소 크기(44px)의 두 배다.
 * 테스트는 이 숫자를 베끼지 않고 **6칸 슬롯 지름과 직접 비교한다** — 비율을
 * 눈대중으로 올리거나 칸 수를 늘리면 그쪽에서 잡힌다.
 */
export const AUTO_DIAMETER_RATIO = 0.36;

/**
 * AUTO 배지 지름. **바 높이에서 나온다** — 배지가 바 밖으로 나갔어도(아래
 * `barLayout` 주석) 슬롯과 같은 크기 기준을 써야 "슬롯보다 작은 보조 위젯"
 * 이라는 관계가 유지된다. 배지의 **자리**는 모드가 정한다(모드별 `*Rules.ts`).
 */
export function autoBadgeD(barH: number): number {
  const h = Number.isFinite(barH) ? Math.max(0, barH) : 0;
  return h * AUTO_DIAMETER_RATIO;
}

/** 좌우 여백 비율 */
export const BAR_PAD_RATIO = 0.03;

export interface BarLayout {
  /** 슬롯 지름 */
  readonly slotD: number;
  /** i번째 슬롯 중심 x */
  slotX(i: number): number;
  readonly slotY: number;
  /**
   * 슬롯 라벨(스킬 이름)이 쓸 수 있는 최대 폭.
   *
   * **지름이 아니라 칸 폭에서 나온다.** 이름은 슬롯 원보다 넓어도 되지만
   * 옆 칸을 침범하면 안 된다 — 5칸에서 실제로 그랬다: "물살 베기"·"조류 가르기"·
   * "심해 세례"·"타락의 사슬"·"심연의 장막"이 한 줄로 이어 붙어
   * `물살 베기조류 가르기심해 세례…`로 읽히고 양 끝이 화면 밖으로 잘렸다.
   * 4칸일 때는 칸이 넓어 우연히 안 겹쳤을 뿐이라 캡처로만 드러났다.
   */
  readonly labelMaxW: number;
  /**
   * 슬롯 아래 라벨이 쓸 수 있는 높이 — **줄바꿈 여부를 이 값이 결정한다.**
   *
   * 폭만 제한하면 `조류 가르기`는 축소 하한(0.75)에 걸려 `조류 가…`로 잘린다
   * (캡처에서 5칸 중 3개가 그랬다). 두 단어를 두 줄로 접으면 온전히 읽히는데,
   * 그건 바 아래에 두 줄이 들어갈 때만 맞는 처방이라 높이를 같이 내보낸다.
   */
  readonly labelMaxH: number;
}

/** 라벨 사이에 남기는 최소 간격 비율 — 붙으면 두 이름이 한 단어로 읽힌다 */
export const LABEL_GAP_RATIO = 0.12;

/** 슬롯 원 아래와 라벨 첫 줄 사이 간격(px). 위젯과 높이 계산이 같은 값을 봐야 한다 */
export const LABEL_GAP_PX = 10;

/**
 * 스킬바 내부 좌표를 한 번에 계산한다.
 *
 * 슬롯 지름은 §7의 62%지만 **칸 폭에도 걸린다** — 스킬이 5개로 늘면 62%
 * 지름이 서로 겹친다. 둘 중 작은 값을 쓴다.
 *
 * ## 슬롯 구역이 바 전체다 — AUTO는 더 이상 왼쪽을 먹지 않는다 (3단계)
 *
 * 예전에는 `zoneX = pad + autoD + pad`였다. AUTO 배지(101px)가 바 안 왼쪽에
 * 앉아 있었으므로 슬롯이 쓸 수 있는 폭이 그만큼 줄었고, 6번째 칸을 넣으면
 * 칸 폭이 92.5px로 떨어져 라벨이 옆 칸과 이어 붙었다. 배지를 바 밖으로
 * 내보내(모드별 `*Rules.ts`가 자리를 정한다) 그 폭을 슬롯에 돌려줬다 —
 * 6칸이 옛 5칸보다 넓은 칸을 갖는다(테스트가 이 부등식을 지킨다).
 *
 * 배지 좌표를 여기서 돌려주지 않는 것이 그 결정의 형태다: 자리가 바 안에
 * 없으므로 바의 기하가 알 수 있는 값이 아니다. 지름만 `autoBadgeD(h)`로
 * 남긴다 — 슬롯과의 크기 관계는 여전히 바가 정한다.
 */
export function barLayout(
  w: number,
  h: number,
  slotCount: number,
  slotDiameterRatio: number,
): BarLayout {
  const pad = w * BAR_PAD_RATIO;
  const zoneX = pad;
  const zoneW = Math.max(1, w - zoneX - pad);
  const n = Math.max(1, Math.floor(slotCount));
  const cell = zoneW / n;
  // 라벨 2줄이 슬롯 아래 들어가므로 지름을 조금 줄인다 (0.62 × h는 라벨 자리를 안 남긴다)
  const slotD = Math.min(h * slotDiameterRatio, cell * 0.82);
  return {
    slotD,
    slotX: (i: number) => zoneX + cell * (i + 0.5),
    // 라벨이 아래로 나가므로 중심을 위로 올린다
    slotY: h * 0.44,
    labelMaxW: cell * (1 - LABEL_GAP_RATIO),
    // 슬롯 아래 남는 세로 공간. 음수가 되지 않게 접는다 (h=0에서도 유한값)
    labelMaxH: Math.max(0, h - (h * 0.44 + slotD / 2 + LABEL_GAP_PX)),
  };
}

/**
 * AUTO 시전 최소 간격 — 매 프레임 난사를 막는다.
 *
 * ## 250 → 680 (2026-08-10)
 *
 * 유저 지시: "오토는 좀 천천히하고, 실제 스킬 쿨을 줄여서 수동도 빠르게 스킬들
 * 누르면 오토랑 동일한 속도로." 쿨 쪽은 `ROLE_NUMBERS`가 맞췄고, 이 값이 오토
 * 쪽이다. 250은 **유도된 값이 아니라 프레임보다 크기만 한 값**이었고, 그래서
 * 두 가지가 깨져 있었다:
 *
 * 1. **박자가 앞으로 몰린다.** 네 칸이 동시에 준비되는 순간(층 전환·휴식 뒤)
 *    오토는 250ms 간격으로 세 칸을 연달아 지르고 그 뒤에 길게 쉰다. 평균은
 *    쿨이 정하므로 지표로는 안 드러나지만 화면에서는 난타 → 정적이 된다.
 *    그게 유저가 본 "오토일 때 엄청 빨리 때린다"다.
 * 2. **모션 게이트에 걸려 조용히 버려진다.** `castGateRules`의 게이트는 최대
 *    380ms 잠근다(`CAST_GATE_MAX_MS`). 250ms 뒤의 시전 시도는 그 안에 들어와
 *    `castSkill`이 쿨을 태우기 전에 돌아가는데, 슬롯은 **이미 `pulseAuto()`를
 *    찍었다** — 링은 반짝이고 딜은 없다. 오토가 자기 지표를 속이는 형태다.
 *
 * 680의 유도: 네 칸의 쿨이 허용하는 **평균 간격**이다. Σ(1000/쿨) =
 * 1000/1800 + 1000/2500 + 1000/3400 + 1000/4500 = 1.4719회/s → 679.4ms.
 * 즉 오토는 쿨이 허락하는 것보다 빨리 지르려 하지 않고, 상한이 수동의 상한과
 * **같은 값**이 된다("오토랑 동일한 속도"). 그리고 680 > 380이므로 위 2번이
 * 구조적으로 사라진다 — 오토의 시전은 게이트를 통과하는 것이 보장된다.
 *
 * 두 부등식(쿨 합에서 나온 평균, 게이트 상한)은 `skillBarRules.test.ts`가
 * 프리셋과 `CAST_GATE_MAX_MS`에서 매번 다시 계산한다. 쿨을 다시 만지면 이 값도
 * 같이 움직여야 한다.
 */
export const AUTO_INTERVAL_MS = 680;

/**
 * 전장(`battleField`)의 자동 전투 기본값. **`true`** — 배선하지 않은 호출자에게
 * 정지를 물려주면 화면이 조용히 멈춘다(그쪽 `autoOn` 주석의 근거).
 *
 * 상수로 뽑은 이유는 배지가 **이 값을 읽어야** 하기 때문이다 — 아래
 * `initialAutoFor`가 유일한 소비자다.
 */
export const AUTO_DEFAULT_ON = true;

/** AUTO 배지 라벨 2줄 (§7) */
export function autoLabel(on: boolean): readonly [string, string] {
  return ["AUTO", on ? "ON" : "OFF"];
}

/**
 * 배지가 실제로 끄는 범위. **모드마다 다르다** — 그래서 인자로 받는다.
 *
 * - `"skill"` (PvP): 끄는 것은 **내 캐릭터**다 — 자동 공격의 동작과 딜
 *   (`pvp/sessionRules.myAutoDamage`), 그리고 내 스킬 자동 시전. AI 팀원과
 *   상대 필드는 배지를 보지 않는다.
 * - `"battle"` (싱글): 전투 전체가 멈춘다. 모션(`field.setAuto`)과 코어 딜
 *   (세션의 게이트)이 같은 값을 본다. 상대가 없으므로 승패 문제가 없다.
 *
 * 두 범위의 차이는 **팀원까지 멈추는가**다. 예전에는 여기에 "PvP는 자동 공격에
 * 배지를 걸지 않는다 — 상대도 같은 코어 식을 쓰므로 한쪽만 끄면 승패가 배지
 * 하나로 결정된다"고 적혀 있었다. 12시드 측정이 그 논거를 닫았다(내 칸만 끄면
 * 손을 쓰는 판은 12/12 승) — 표는 `myAutoDamage`에 있다.
 *
 * **`AutoScope`가 왜 필요한가.** 앞선 회차는 한 문구를 두 모드에 돌려 쓰면서
 * "모드별로 갈라 쓰면 한쪽이 낡는다"고 적었다. 그 근거는 두 모드의 범위가
 * **같을 때** 성립한다 — 싱글이 딜까지 끄기로 바뀌면서 무효가 됐다(유저 신고:
 * "Auto를 안 키면 캐릭터가 움직이면 안 된다고 생각하거든? 근데 계속 움직여").
 * 지금 한 문구로 합치면 어느 모드에서든 한쪽이 **거짓말**이다: 싱글에서 "팀은
 * 계속 싸운다"는 틀렸고, PvP에서 "전투가 멈춘다"는 틀렸다. 낡는 것보다 나쁘다.
 *
 * **라벨을 늘리는 대신 공지로 말한다.** 배지는 지름 101px에 짧은 두 줄이고
 * UX README §"한국어 우선"이 `AUTO`를 짧은 고정 토큰으로 못박았다 — 범위를 적을
 * 자리가 없다. 범위를 알고 싶어지는 순간은 배지를 누르는 순간이므로 거기서
 * 한 줄로 답한다.
 *
 * **기본값을 두지 않는다.** 기본이 있으면 새 호출자가 아무것도 안 적고 한쪽
 * 문구를 받는데, 틀린 쪽을 받아도 타입이 통과한다 — 거짓 문구는 화면에서만
 * 드러난다. 모드를 아는 것은 호출자뿐이므로 호출자가 말하게 한다.
 */
export type AutoScope = "skill" | "battle";

/**
 * 배지가 **처음 적어야 하는** 상태. 범위가 정한다.
 *
 * ## 왜 필요한가 — 유저 신고 2번의 남은 절반 (캡처로 잡았다)
 *
 * 배지는 `setAuto(false)`로 시작하는데 전장의 `autoOn`은 `true`다. 즉 씬에
 * 들어간 직후 **배지에 `AUTO OFF`가 적힌 채 캐릭터가 돌진하고 적을 죽인다** —
 * 1:1 캡처(`AUTO/OFF` 배지)와 같은 순간의 `[dash] ally=m0 skill=auto` 로그로
 * 동시에 확인했다. 유저가 본 것이 이 화면이다: "안 키면 캐릭터가 움직이면 안
 * 된다고 생각하거든? 근데 계속 움직여, 오토하던 안 하던."
 *
 * 딜 게이트(`autoTeamDamage`)와 모션 게이트(`stepAlly`)는 둘 다 `field.auto`를
 * 읽으므로 서로 갈릴 수 없다. 갈린 것은 **표시와 실제**였다. 게이트를 한 값으로
 * 모아도 배지가 다른 값에서 출발하면 화면은 계속 거짓말을 한다.
 *
 * ## 왜 전역 기본값 하나가 아닌가
 *
 * 처음 `AUTO_DEFAULT_ON`을 두 곳(배지·전장)에 그냥 읽혔는데, 그러면 **PvP의
 * 배지가 ON으로 켜진 채 시작한다**. PvP에서 `OFF`는 거짓말이 아니다 — 판에
 * 들어가서 손을 안 댄 상태가 "내 캐릭터는 내가 움직인다"이고, 전장은 그 값을
 * 매 프레임 받는다(`pvp/session`의 `setAuto(skillBar.auto, [내 memberId])`).
 * 전역 기본값은 그 시작 상태를 뒤집는다.
 *
 * (예전 근거는 "PvP는 `setAuto`를 부르지 않으므로 배지 OFF + 전투 진행이
 * 정상이다"였다. 지금은 부른다 — 유저 신고가 그 조합 자체를 결함으로 짚었다:
 * "auto off여도 내 캐릭터가 공격하는 이슈 있어." 결론은 같고 근거가 바뀌었다.)
 *
 * 그래서 범위를 묻는다. `"battle"`(싱글)은 배지가 전장을 통째로 쥐고 있으니
 * 전장의 기본값(`AUTO_DEFAULT_ON`)을 그대로 물려받아야 하고, `"skill"`(PvP)은
 * 내 칸만 말하므로 손을 안 댄 상태 = `false`에서 시작한다.
 */
export function initialAutoFor(scope: AutoScope): boolean {
  return scope === "battle" ? AUTO_DEFAULT_ON : false;
}

export function autoScopeNotice(on: boolean, scope: AutoScope): string {
  if (scope === "battle") {
    return on
      ? "AUTO ON — 알아서 싸운다"
      : "AUTO OFF — 전투가 멈춘다. 스킬은 직접 누른다";
  }
  /**
   * PvP `OFF`는 **내 캐릭터가 멈춘다**를 먼저 말한다 — 그것이 배지를 껐을 때
   * 화면에서 실제로 달라지는 것이다(내 아군이 대기 자리에 선다). 뒤 절은 그
   * 범위의 경계다: 팀원과 상대는 계속 싸우므로 판은 계속 흐른다.
   */
  return on
    ? "AUTO ON — 내 캐릭터가 알아서 싸운다"
    : "AUTO OFF — 내 캐릭터가 멈춘다. 팀은 계속 싸운다";
}
