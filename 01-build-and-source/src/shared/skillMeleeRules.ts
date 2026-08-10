/**
 * 스킬 전용 근접 모션 — 어느 스킬을 눌렀는지가 화면의 동작으로 남는다.
 *
 * **왜 필요한가**: 공격 스킬 두 개가 `onAllyAttack` 하나로 들어와서, 눌렀을 때
 * 나오는 것이 자동 공격과 똑같은 순환 클립 + 똑같은 미사일이었다. 쿨다운
 * 6초짜리 마무리기(공허 폭발)와 2.5초짜리 연타기(심연 베기)가 화면에서 구별이
 * 안 되면 스킬을 고른 의미가 사라진다 — 게이지만 다르게 줄어드는 버튼 두 개다.
 *
 * 여기서 정하는 것은 **스킬 → (클립, 접근 속도, 이펙트)** 하나뿐이다.
 * `meleeRules`의 타임라인·`meleeFx`의 캐릭터별 갈래는 그대로 둔다 — 스킬은
 * 그 위에 덮는 층이고, 캐릭터 넷의 차이(접근 동작 `run`/`roll`, 사거리)를
 * 지우지 않는다. 그래서 접근 시간을 **상수가 아니라 배율**로 적는다 — 리제는
 * 스킬을 써도 노라보다 빠르다(상수로 박으면 넷을 갈라 놓은 축이 사라진다).
 *
 * Pixi를 import하지 않는다 — `meleeFx`와 같은 이유다(타이밍·크기가 곧 근거).
 */
import { FX_SHEETS } from "./fxManifest";
import type { MeleeFxSpec, FxSheetName } from "./meleeFx";
import type { ApproachKind, AttackClip, MeleeStyle } from "./meleeRules";
// pixi를 import하지 않는 규칙 모듈이다 — 캐릭터 표시 크기가 여기 있다
import { FX_COVER_RATIO, allyDisplayPx } from "./battleFieldRules";
import { HERO_SLUGS, type HeroSlug } from "./charManifest";
import { buildImpactTable, type ImpactRow } from "./castGateRules";
/**
 * 로스터를 읽는다 — **어느 스킬이 어느 클립을 쓰는지는 캐릭터 데이터다.**
 * 여기에 21개를 다시 적으면 두 벌이 어긋나고, 어긋나면 화면에서는 "누른 것과
 * 다른 동작이 나온다"로만 보인다.
 */
import {
  ATTACK_ROLES,
  attackSkillId,
  presetAttackClip,
  type AttackRole,
} from "../loadout/preset";

/** 이펙트 층 하나 — 캐릭터 키 대비 비율로 적고 시트 크기로 나눠 배율을 만든다 */
interface FxLayer {
  sheet: FxSheetName;
  /**
   * 화면에 나올 폭 — **캐릭터 키 대비 비율**.
   *
   * 예전에는 px 상수였다. 캐릭터를 줄이자(`ALLY_H_RATIO` 0.55 → 0.40) 같은
   * px가 상대적으로 훨씬 커져서 이펙트가 캐릭터를 삼켰다 — 상수는 기준이
   * 바뀌면 조용히 의미가 달라진다.
   */
  ratio: number;
  /** 아군 기준 앞으로 밀 거리 — 필드 폭 대비 */
  offsetRatio: number;
  /**
   * 궤적 기울기(rad). 접근 동작마다 다르다 — `roll`로 들어온 캐릭터는 아래에서
   * 위로 올려 베고, `walk`은 서서 휘두르므로 거의 수평이다. 점에서 터지는 층은
   * 전부 0으로 둔다(`FLAT`) — 회전을 주면 프레임마다 흔들려 보인다.
   *
   * **세 접근을 다 적어야 한다.** 선택형으로 두면 `walk`가 빠진 층이 조용히
   * 0(수평)으로 떨어져서, 궤적이 없는 것과 궤적이 수평인 것이 구별되지 않는다.
   */
  rotation: Readonly<Record<ApproachKind, number>>;
  /**
   * 임팩트 프레임 기준 몇 ms 뒤에 뜨는가. 0이면 같은 프레임이다.
   *
   * **층을 다 같은 프레임에 깔면 한 덩어리로 뭉쳐 한 장으로 읽힌다.** 던전앤
   * 파이터 계열의 타격감은 층의 개수가 아니라 층이 **시간에 걸쳐 번지는 것**에서
   * 나온다 — 궤적이 먼저 그어지고, 폭발이 뒤따르고, 잔재가 마지막에 흩어진다.
   * 이 지연이 없으면 이펙트를 세 장 겹쳐도 화면에는 큰 얼룩 하나만 남는다.
   */
  delayMs: number;
  /**
   * 아군 쪽으로 되돌린 y 오프셋 — 캐릭터 키 대비 비율. 양수면 위로 올라간다.
   *
   * 층을 전부 같은 높이에 두면 가로줄 하나가 된다. 발밑·몸통·머리 위로
   * 흩어 놓으면 한 번의 타격이 **몸 전체를 통과한 것**으로 읽힌다.
   */
  liftRatio: number;
}

/** 점에서 터지는 층 — 어느 접근이든 회전이 없다 */
const FLAT: Readonly<Record<ApproachKind, number>> = { run: 0, roll: 0, walk: 0 };

/**
 * 스킬 하나의 근접 연출.
 *
 * **`clip`이 이 구조의 핵심이다.** 이펙트만 갈라 놓으면 캐릭터는 같은 동작을
 * 하면서 앞에서 다른 색이 터지는 그림이 된다 — "스킬을 썼다"가 아니라
 * "이펙트가 바뀌었다"로 읽힌다.
 */
export interface SkillMelee {
  /**
   * 스킬 id. 표의 키와 같아야 한다(테스트로 강제).
   *
   * 값 안에 id를 둔 이유는 **로그다**: 헤드리스 검증이 `why=impact:m0:attack1`만
   * 보면 그 `attack1`이 스킬인지 자동 공격 순환인지 구별할 수 없다.
   */
  id: string;
  /** 이번 돌진에 강제할 공격 클립 (순환을 건너뛴다) */
  clip: AttackClip;
  /** 캐릭터의 `approachMs`에 곱할 값. <1이면 더 빠르게 붙는다 */
  approachScale: number;
  /** 캐릭터의 `returnMs`에 곱할 값 */
  returnScale: number;
  /** 시전 순간 아군 몸에 뜨는 층들 (자동 공격의 `missile` 자리) */
  cast: readonly FxLayer[];
  /** 임팩트 프레임에 무기 끝에서 터지는 층들. 앞에서부터 겹쳐 깐다 */
  hit: readonly FxLayer[];
}

/**
 * 이펙트 한 층의 상한 — 캐릭터 키 대비 비율.
 *
 * `battleFieldRules.FX_COVER_RATIO`를 그대로 쓴다. 예전에는 여기에 72px이라는
 * 상수가 따로 있었는데, 아군 표시 높이(231px)에서 유도한 값이라 캐릭터 크기를
 * 바꾸는 순간 근거가 끊겼다 — 상한이 두 곳에 다른 단위로 있으면 한쪽만 고친다.
 *
 * **마무리기라고 이 선을 넘기지 않는다.** 무게는 한 층의 크기가 아니라 느린
 * 접근·늦은 임팩트·층의 개수와 **시각차**(`delayMs`)로 만든다.
 */
export const SKILL_FX_MAX_RATIO = FX_COVER_RATIO;

/**
 * 상한을 적용한 px 상한 — 테스트가 화면 크기로 읽을 수 있게 노출한다.
 *
 * **상수가 아니라 함수다 (2026-08-07).** 상수였을 때는 `allyDisplayPx()`를
 * 인자 없이 불러 기준 필드(512)에 고정돼 있었고, 싱글 필드(800)에서는 실제
 * 상한과 달랐다 — 상한이 화면과 어긋나면 상한이 아니다. 필드 높이는 모드가
 * 정하므로 이 파일이 알 수 없다.
 */
export function skillFxMaxPx(fieldH: number): number {
  return allyDisplayPx(fieldH) * SKILL_FX_MAX_RATIO;
}

/** 접근 시간의 하한(ms) — 이보다 짧으면 먼지만 남고 순간이동으로 보인다 */
export const SKILL_MIN_APPROACH_MS = 120;

/** 클립을 뺀 연출 — 역할이 갖는 부분. 클립은 캐릭터가 준다 */
type RoleMotion = Omit<SkillMelee, "id" | "clip">;

/**
 * 공격 네 역할의 연출. **캐릭터가 아니라 역할이 이펙트를 갖는다.**
 *
 * 캐릭터마다 28벌을 적으면 손으로 맞출 수 없고, 무엇보다 **비교 대상이 사라진다** —
 * `quick`이 `burst`보다 빨라야 한다는 것은 28개를 눈으로 훑어서는 확인되지 않는다.
 * 캐릭터가 주는 것은 **클립**(자기 몸의 동작)이고, 역할이 주는 것은 **박자와 층**이다.
 *
 * 네 역할이 화면에서 갈라지는 축:
 * - 시간: 접근 배율 0.62 → 1.0 → 1.45, 임팩트 번짐 110ms → 175ms → 250ms
 * - 층수: 3 → 4 → 5
 * `ult`는 이 사다리의 연장이 아니다 — 접근은 quick으로 되돌리고 층·번짐·복귀만
 * 넘긴다(6층 / 330ms / 1.25). 근거는 그 항목의 결정 기록에 있다.
 * 크기로 가르지 않는다 — 한 층의 상한(`SKILL_FX_MAX_RATIO`)은 역할과 무관하다.
 */
const ROLE_MOTIONS: Readonly<Record<AttackRole, RoleMotion>> = {
  /**
   * 연타 — 빠르게 파고들어 한 번 긋고 빠진다.
   *
   * 접근을 0.62배로 줄여서 "달려가 베고 빠진다"가 한 박자에 끝난다. 쿨다운이
   * 2.5초라 이 연출을 가장 많이 본다 — 길면 화면이 계속 이펙트로 덮인다.
   */
  quick: {
    approachScale: 0.62,
    returnScale: 0.85,
    cast: [
      // 앞으로 쏘는 궤적 — 자동 공격과 같은 시트지만 아군에서 출발한다
      {
        sheet: "missile",
        ratio: 0.46,
        offsetRatio: 0.04,
        rotation: FLAT,
        delayMs: 0,
        liftRatio: 0.5,
      },
      // 칼을 뽑는 순간 발밑을 긁는다 — 파고드는 스킬의 출발을 지면에 남긴다
      {
        sheet: "dust",
        ratio: 0.38,
        offsetRatio: 0.02,
        rotation: FLAT,
        delayMs: 40,
        liftRatio: 0.02,
      },
    ],
    /**
     * 세 겹을 **55ms씩 어긋나게** 깐다. 궤적이 먼저 그어지고(0ms), 칼끝에
     * 불꽃이 튀고(55ms), 되돌아오는 두 번째 획이 반대로 눕는다(110ms) —
     * 한 프레임에 다 깔면 세 장이 뭉쳐서 얼룩 하나로 읽힌다.
     */
    hit: [
      // 자동 공격의 궤적(0.25/−0.5)보다 깊게 눕힌다 — 더 크게 그은 한 획
      {
        sheet: "slash",
        ratio: 0.58,
        offsetRatio: 0.05,
        // 걷는 캐릭터는 서서 휘두른다 — 뛰어들 때보다 궤적이 눕는다
        rotation: { run: 0.5, roll: -0.75, walk: 0.28 },
        delayMs: 0,
        liftRatio: 0.45,
      },
      {
        sheet: "spark",
        ratio: 0.36,
        offsetRatio: 0.08,
        rotation: FLAT,
        delayMs: 55,
        liftRatio: 0.5,
      },
      /**
       * 되돌아오는 두 번째 획. 부호를 뒤집었으므로 첫 획과 X를 그린다 —
       * 같은 방향으로 두 번 그으면 한 획이 두꺼워진 것으로만 보인다.
       * 위치도 위로 올려서 첫 획과 겹치지 않게 둔다.
       */
      {
        sheet: "slash",
        ratio: 0.5,
        offsetRatio: 0.03,
        rotation: { run: -0.62, roll: 0.66, walk: -0.4 },
        delayMs: 110,
        liftRatio: 0.66,
      },
    ],
  },
  /**
   * 연격 — 붙어서 두 번 그어 낸다. 연타와 마무리기의 가운데 박자다.
   *
   * 접근 배율 1.0 = 캐릭터의 기본 속도 그대로다. **세 역할 중 하나는 캐릭터의
   * 원래 박자여야 한다** — 셋 다 배율을 걸면 캐릭터의 접근 시간이 화면에
   * 한 번도 그대로 나오지 않아서, 일곱을 갈라 놓은 축이 스킬에 덮인다.
   */
  combo: {
    approachScale: 1.0,
    returnScale: 1.0,
    cast: [
      {
        sheet: "missile",
        ratio: 0.5,
        offsetRatio: 0.03,
        rotation: FLAT,
        delayMs: 0,
        liftRatio: 0.48,
      },
      {
        sheet: "spark",
        ratio: 0.34,
        offsetRatio: 0.05,
        rotation: FLAT,
        delayMs: 70,
        liftRatio: 0.6,
      },
      {
        sheet: "dust",
        ratio: 0.4,
        offsetRatio: 0.02,
        rotation: FLAT,
        delayMs: 130,
        liftRatio: 0.03,
      },
    ],
    /**
     * 네 겹이 175ms에 걸친다. 두 획이 **엇갈려** 그어지고(0ms/95ms) 그 사이에
     * 불꽃이 끼고, 마지막에 발밑이 갈린다 — 두 번 그었다는 것이 궤적 두 장의
     * 방향 차이로만 읽힌다(같은 방향이면 한 획이 두꺼워진 것이다).
     */
    hit: [
      {
        sheet: "slash",
        ratio: 0.54,
        offsetRatio: 0.04,
        rotation: { run: 0.34, roll: -0.6, walk: 0.18 },
        delayMs: 0,
        liftRatio: 0.38,
      },
      {
        sheet: "spark",
        ratio: 0.38,
        offsetRatio: 0.07,
        rotation: FLAT,
        delayMs: 60,
        liftRatio: 0.52,
      },
      {
        sheet: "slash",
        ratio: 0.56,
        offsetRatio: 0.06,
        rotation: { run: -0.48, roll: 0.72, walk: -0.3 },
        delayMs: 95,
        liftRatio: 0.62,
      },
      {
        sheet: "dust",
        ratio: 0.44,
        offsetRatio: 0.05,
        rotation: FLAT,
        delayMs: 175,
        liftRatio: 0.03,
      },
    ],
  },
  /**
   * 마무리기 — 무겁게 다가가 내리찍고, 터진 자리가 남는다.
   *
   * 접근을 1.45배로 늘려서 연타와 **박자 자체가** 다르게 읽힌다. 캐릭터마다
   * 이 자리에 임팩트가 가장 늦은 클립을 배정했으므로(`HERO_ATTACKS`) 치기
   * 전의 뜸이 실제로 길다 — 그 뜸을 시전 층 셋이 채운다.
   */
  burst: {
    approachScale: 1.45,
    returnScale: 1.2,
    cast: [
      // 몸에서 차오르는 기운 — 늦은 임팩트까지의 뜸을 이것이 채운다
      {
        sheet: "aura",
        ratio: 0.55,
        offsetRatio: 0.0,
        rotation: FLAT,
        delayMs: 0,
        liftRatio: 0.45,
      },
      // 발밑에서 빨려 올라가는 잔재. 기운이 "차오른다"를 아래에서 받쳐 준다
      {
        sheet: "dust",
        ratio: 0.46,
        offsetRatio: 0.0,
        rotation: FLAT,
        delayMs: 90,
        liftRatio: 0.05,
      },
      // 발광이 한 번 더 겹친다 — 마무리기라는 예고다
      {
        sheet: "spark",
        ratio: 0.34,
        offsetRatio: 0.02,
        rotation: FLAT,
        delayMs: 200,
        liftRatio: 0.72,
      },
    ],
    /**
     * 다섯 겹이 **250ms에 걸쳐** 번진다. 임팩트 → 기운 → 잔재 → 두 번째 폭발
     * → 흩어지는 불꽃. 마무리기의 무게는 한 장의 크기가 아니라 이 길이다 —
     * 궤적 하나(227ms)로 끝나는 연타와 화면에서 시간 자체가 다르다.
     */
    hit: [
      // 내리찍은 자리. 폭발이 먼저 터지고 그 다음에 기운이 퍼진다
      {
        sheet: "impact",
        ratio: 0.6,
        offsetRatio: 0.05,
        rotation: FLAT,
        delayMs: 0,
        liftRatio: 0.4,
      },
      // 8프레임 12fps = 667ms. 궤적(5프레임 22fps = 227ms)보다 3배 길게 남는다
      {
        sheet: "aura",
        ratio: 0.62,
        offsetRatio: 0.03,
        rotation: FLAT,
        delayMs: 60,
        liftRatio: 0.5,
      },
      // 지면이 갈린다 — 내리찍은 것이 땅까지 갔다는 증거
      {
        sheet: "dust",
        ratio: 0.52,
        offsetRatio: 0.06,
        rotation: FLAT,
        delayMs: 115,
        liftRatio: 0.03,
      },
      // 두 번째 폭발. 한 번 더 터지는 것이 "마무리기"의 유일한 문법이다
      {
        sheet: "impact",
        ratio: 0.48,
        offsetRatio: 0.09,
        rotation: FLAT,
        delayMs: 175,
        liftRatio: 0.62,
      },
      {
        sheet: "spark",
        ratio: 0.42,
        offsetRatio: 0.11,
        rotation: FLAT,
        delayMs: 250,
        liftRatio: 0.55,
      },
    ],
  },
  /**
   * 네 번째 칸 — **파고들어 몰아친다** (2026-08-10).
   *
   * ## 왜 burst의 복제가 아닌가
   *
   * 이 칸은 캐릭터마다 **남은 한 클립**을 받는다(`HERO_ATTACKS`의 결정 기록).
   * 그 중 셋(실비아·클로에·셀린)은 `special`이라 클립 자체가 2.1~2.7초로 가장
   * 길다. 여기에 burst의 접근 배율 1.45를 쓰면 한 사이클이 3.6~4.2초가 되어
   * 자기 쿨(4.5초)을 거의 다 먹고, 임팩트도 1.8초까지 밀린다 — 유저가 고치라고
   * 한 "수동이 느리다"가 이 칸에서 되돌아온다.
   *
   * 그래서 **접근은 quick과 같은 0.62로 당긴다.** 무게는 접근이 아니라 층의
   * 개수와 번지는 시간으로 만든다(`SKILL_FX_MAX_RATIO` 주석의 원칙 — 크기로
   * 가르지 않는다):
   *
   * | | 접근 | 임팩트 번짐 | 층수 |
   * |---|---|---|---|
   * | quick | 0.62 | 110ms | 3 |
   * | combo | 1.0 | 175ms | 4 |
   * | burst | 1.45 | 250ms | 5 |
   * | ult | 0.62 | **330ms** | **6** |
   *
   * 즉 ult는 시간 축에서 quick과 같은 자리에 서고 층 축에서 burst를 넘는다 —
   * "빠르게 파고들어 가장 많이 터뜨린다"가 이 칸의 문법이다. burst와 접근이
   * 같지 않으므로 두 칸이 화면에서 겹치지 않는다.
   *
   * ## 복귀 배율이 0.85에서 1.25로 올라간 이유
   *
   * 처음에는 quick과 같은 0.85로 적었고 근거를 "늦게 돌아오면 다음 칸을 누를 때
   * 아직 복귀 중이고 그 끊김은 게이트가 못 막는다"로 달았다. **그 근거가
   * 틀렸다** — `castGateRules`의 결정 기록이 반대를 말한다: 임팩트가 지난 뒤의
   * 끊김은 타격을 지우지 않고, 되돌아오다 말고 다시 뛰어나가는 것은 오히려
   * 연격으로 읽힌다. 게이트가 복귀를 안 세는 것이 설계다.
   *
   * 실제 하한은 다른 데 있었고 테스트가 그것을 잡았다: **층은 복귀 안에 끝나야
   * 한다.** 0.85로는 로스터 최단 복귀가 클로에 0.85 × 280 = 238ms여서 330ms
   * 번짐이 복귀보다 길었다 — 아군이 이미 제자리에 선 뒤에 이펙트가 터진다.
   * 처음 주석은 이 값을 실비아(0.85 × 430 = 366ms)로 적었는데, 그건 **이 역할을
   * 쓰는 일곱 중 한 명**일 뿐이다. 역할이 갖는 값의 하한은 최악의 캐릭터가 정한다.
   *
   * 1.25는 그 하한(330/280 = 1.179)을 넘는 값이고, burst의 1.2보다 크므로 가장
   * 무겁게 돌아온다 — 층이 여섯인 칸의 복귀로 읽힌다. 사이클이 길어지는 것은
   * 이 칸의 쿨(4500)이 흡수한다(가장 긴 실비아가 3815ms).
   */
  ult: {
    approachScale: 0.62,
    returnScale: 1.25,
    cast: [
      // 파고드는 궤적 — quick과 같은 출발이다. 접근이 같으므로 시작도 같다
      {
        sheet: "missile",
        ratio: 0.5,
        offsetRatio: 0.04,
        rotation: FLAT,
        delayMs: 0,
        liftRatio: 0.5,
      },
      // 몸에서 차오르는 기운. burst의 예고를 **접근이 짧은 만큼 앞당겨** 깐다
      {
        sheet: "aura",
        ratio: 0.58,
        offsetRatio: 0.0,
        rotation: FLAT,
        delayMs: 30,
        liftRatio: 0.45,
      },
      {
        sheet: "dust",
        ratio: 0.42,
        offsetRatio: 0.02,
        rotation: FLAT,
        delayMs: 70,
        liftRatio: 0.03,
      },
    ],
    /**
     * 여섯 겹이 **330ms에 걸쳐** 번진다 — 로스터에서 가장 길고 가장 많다.
     * 궤적 → 폭발 → 기운 → 지면 → 두 번째 폭발 → 흩어지는 불꽃.
     *
     * 층은 복귀 안에 끝나야 한다 — 넘으면 캐릭터가 이미 제자리에 선 뒤에
     * 이펙트가 터져서 타격이 몸에서 떨어진다. 그 하한을 정하는 것은 **로스터
     * 최단 복귀**(클로에 280ms)이고, 그래서 `returnScale`이 1.25다(위 결정
     * 기록). 330 < 1.25 × 280 = 350 — 여유가 20ms뿐이라 이 두 값은 같이 움직인다.
     */
    hit: [
      {
        sheet: "slash",
        ratio: 0.6,
        offsetRatio: 0.05,
        rotation: { run: 0.55, roll: -0.8, walk: 0.3 },
        delayMs: 0,
        liftRatio: 0.48,
      },
      {
        sheet: "impact",
        ratio: 0.62,
        offsetRatio: 0.06,
        rotation: FLAT,
        delayMs: 70,
        liftRatio: 0.42,
      },
      {
        sheet: "aura",
        ratio: 0.6,
        offsetRatio: 0.03,
        rotation: FLAT,
        delayMs: 130,
        liftRatio: 0.52,
      },
      {
        sheet: "dust",
        ratio: 0.5,
        offsetRatio: 0.07,
        rotation: FLAT,
        delayMs: 190,
        liftRatio: 0.03,
      },
      {
        sheet: "impact",
        ratio: 0.5,
        offsetRatio: 0.1,
        rotation: FLAT,
        delayMs: 260,
        liftRatio: 0.6,
      },
      {
        sheet: "spark",
        ratio: 0.44,
        offsetRatio: 0.12,
        rotation: FLAT,
        delayMs: 330,
        liftRatio: 0.56,
      },
    ],
  },
};

/**
 * 스킬 id → 근접 연출. 7종 × 공격 4역할 = 28개를 **표에서 만든다.**
 *
 * 손으로 적지 않는 이유는 누락이 조용하기 때문이다 — 한 항목이 빠지면
 * `skillMelee()`가 `null`을 주고, 호출자는 그것을 "돌진하지 않는 스킬"로
 * 읽어서 자동 공격 순환으로 되돌아간다. 화면에는 "스킬을 눌렀는데 평타가
 * 나온다"로만 보이고, 로그에도 `auto`로 찍혀서 스킬 이름이 남지 않는다.
 *
 * 방해 2종은 여기 없다 — 돌진하지 않고 광선으로 나가므로(`castBeamShown`)
 * `null`이 정상이다. "공격이면 돌진하고, 방해면 광선이다"라는 상보 관계는
 * `castBeamRules.test.ts`가 프리셋 전체를 돌며 강제한다.
 */
const SKILL_MELEE: Readonly<Record<string, SkillMelee>> = Object.fromEntries(
  HERO_SLUGS.flatMap((slug: HeroSlug) =>
    ATTACK_ROLES.map((role) => {
      const id = attackSkillId(slug, role);
      return [
        id,
        { id, clip: presetAttackClip(slug, role), ...ROLE_MOTIONS[role] },
      ] as const;
    }),
  ),
);

/** 이 스킬의 임팩트 연출이 끝까지 몇 ms 걸리는가 — 가장 늦은 층의 시각 */
export function skillHitSpanMs(skill: SkillMelee | null): number {
  if (!skill) return 0;
  return skill.hit.reduce((m, l) => Math.max(m, l.delayMs), 0);
}

/** 이 스킬의 근접 연출. 돌진하지 않는 스킬이면 `null` */
export function skillMelee(skillId: string): SkillMelee | null {
  return SKILL_MELEE[skillId] ?? null;
}

/**
 * 스킬이 덮은 접근 시간을 반영한 스타일.
 *
 * `reach`·`approach`·`clips`는 건드리지 않는다 — 그것이 캐릭터의 정체성이고,
 * 스킬이 바꾸는 것은 **박자**다. 새 객체를 돌려준다: 로드아웃의 스타일을
 * 제자리에서 고치면 스킬 한 번이 그 캐릭터를 영구히 빠르게 만든다.
 */
export function skillStyle(
  style: MeleeStyle,
  skill: SkillMelee | null,
): MeleeStyle {
  if (!skill) return style;
  return {
    ...style,
    approachMs: Math.max(
      SKILL_MIN_APPROACH_MS,
      Math.round(style.approachMs * skill.approachScale),
    ),
    returnMs: Math.max(1, Math.round(style.returnMs * skill.returnScale)),
  };
}

/**
 * 이 로드아웃의 **모션 게이트 표** — `스킬 id → 임팩트까지 걸리는 시간(ms)`.
 *
 * 왜 세션이 아니라 여기서 만드는가: 세 재료가 서로 다른 곳에 있다. 접근 시간은
 * 로드아웃(`melee.approachMs`), 접근 배율은 역할(`ROLE_MOTIONS`), 임팩트
 * 프레임과 fps는 스프라이트 매니페스트(`chars.json`)다. 세션에서 조립하면 두
 * 모드가 각자 조립하게 되고, 한쪽이 배율을 빼먹으면 그 모드에서만 게이트가
 * 짧아진다 — 화면에서는 "가끔 모션이 씹힌다"로만 보인다.
 *
 * `impactOf`를 인자로 받는 이유는 이 파일이 Pixi를 안 부르기 때문이다
 * (`spriteChar.charDef`는 Pixi 쪽 모듈이다). 테스트는 자기 값을 넣어 부른다.
 */
export function buildSkillImpactTable(
  members: readonly { charSlug: string; melee: MeleeStyle }[],
  impactOf: (slug: string, clip: AttackClip) => { impactFrame: number; fps: number } | null,
): Map<string, number> {
  const rows: ImpactRow[] = [];
  for (const m of members) {
    for (const role of ATTACK_ROLES) {
      const clip = presetAttackClip(m.charSlug, role);
      const a = impactOf(m.charSlug, clip);
      if (!a) continue;
      rows.push({
        skillId: attackSkillId(m.charSlug, role),
        clip,
        approachMs: m.melee.approachMs,
        approachScale: ROLE_MOTIONS[role].approachScale,
        impactFrame: a.impactFrame,
        fps: a.fps,
      });
    }
  }
  return buildImpactTable(rows, SKILL_MIN_APPROACH_MS);
}

/**
 * 캐릭터 키 대비 비율 → 시트 배율.
 *
 * 상한을 **비율에서** 물린다 — px로 물리면 캐릭터 크기가 바뀔 때 상한만
 * 그대로 남아 조용히 의미가 달라진다 (`SKILL_FX_MAX_RATIO` 주석 참고).
 */
function toScale(sheet: FxSheetName, ratio: number, fieldH: number): number {
  const px = allyDisplayPx(fieldH) * Math.min(ratio, SKILL_FX_MAX_RATIO);
  return px / FX_SHEETS[sheet].frameW;
}

/** 한 층 → 호출자가 그대로 쓰는 명세 */
function toSpec(
  l: FxLayer,
  approach: ApproachKind,
  fieldH: number,
): SkillFxSpec {
  return {
    sheet: l.sheet,
    scale: toScale(l.sheet, l.ratio, fieldH),
    offsetRatio: l.offsetRatio,
    rotation: l.rotation[approach],
    delayMs: l.delayMs,
    liftRatio: l.liftRatio,
  };
}

/**
 * 시각·높이가 붙은 이펙트 명세. `MeleeFxSpec`을 넓힌다 — 자동 공격의 한 장
 * 연출도 같은 모양으로 다룰 수 있게 두 필드를 선택형으로 남긴다.
 */
export interface SkillFxSpec extends MeleeFxSpec {
  /** 임팩트/시전 프레임 기준 지연(ms) */
  delayMs: number;
  /** 아군 발 기준 위로 올릴 거리 — 캐릭터 키 대비 비율 */
  liftRatio: number;
}

/**
 * 임팩트에 겹쳐 깔 층들. `meleeFx`와 같은 모양이라 호출자는 하나로 다룬다.
 *
 * 스킬이 없으면 빈 배열이다 — 호출자가 `meleeFx`로 되돌아가는 신호다.
 */
export function skillHitFx(
  skill: SkillMelee | null,
  approach: ApproachKind,
  /** 필드 높이(px, 디자인 좌표). 기본값을 두지 않는다 — `skillFxMaxPx` 주석 */
  fieldH: number,
): readonly SkillFxSpec[] {
  if (!skill) return [];
  return skill.hit.map((l) => toSpec(l, approach, fieldH));
}

/**
 * 시전 순간의 층들. 스킬이 없으면 자동 공격과 같은 미사일 한 장이다.
 *
 * 배열을 돌려준다 — 시전도 층을 어긋나게 깔아야 "기운이 차오른다"가 한 장의
 * 정지 이미지가 아니라 과정으로 읽힌다.
 */
export function skillCastFx(
  skill: SkillMelee | null,
  approach: ApproachKind,
  /** 필드 높이(px, 디자인 좌표). 기본값을 두지 않는다 — `skillFxMaxPx` 주석 */
  fieldH: number,
): readonly SkillFxSpec[] {
  if (!skill) {
    return [
      toSpec(
        {
          sheet: "missile",
          ratio: 0.5,
          offsetRatio: 0.0,
          rotation: FLAT,
          delayMs: 0,
          liftRatio: 0.5,
        },
        approach,
        fieldH,
      ),
    ];
  }
  return skill.cast.map((l) => toSpec(l, approach, fieldH));
}
