import type { SkillDef } from "../core/types";
import { HERO_SLUGS, type HeroSlug } from "../shared/charManifest";
import type { AttackClip, MeleeStyle } from "../shared/meleeRules";
import type { CharacterLoadout, Loadout, LoadoutProvider } from "./types";

/**
 * 스킬 6슬롯 = **내 공격 4 + 상대 방해 2** (싱글은 공격 4칸만 쓴다).
 *
 * 버프 칸의 역사가 이 파일의 결정 기록이다:
 *
 * 1. 처음 4슬롯(공격 2 / 방해 1 / 버프 1). 버프를 뺀 것은 튜닝이 아니라
 *    결정이었다 — 누른 뒤 화면에 아무 일도 일어나지 않고 숫자만 커져서
 *    "내가 무엇을 했는가"가 인과 사슬에 남지 않았다.
 * 2. 타락 버프로 되돌아왔다. 그 사유를 반박한 것이 아니라 **조건이 달라진**
 *    것이었다 — 타락도로 잠긴 칸이라 열리는 순간이 사건이 된다.
 * 3. 다시 지웠다(2026-08-10). 2번의 전제인 "열리는 순간"이 데모에서 거의
 *    오지 않는다는 것을 수치로 확인했다 — 근거는 `presetSkillsFor`에 있다.
 *
 * 남은 네 칸은 전부 공격이고 각각 **다른 클립**을 쓴다. 누른 것이 몸의 동작으로
 * 남는다는 1번의 사유가 네 칸 모두에 걸린다.
 */

/** 공격 슬롯 네 칸의 역할. id 접미사·아이콘 등급이 이 이름에 붙는다 */
export const ATTACK_ROLES = ["quick", "combo", "burst", "ult"] as const;
export type AttackRole = (typeof ATTACK_ROLES)[number];

/**
 * 역할별 쿨다운·딜. **캐릭터가 아니라 역할이 숫자를 갖는다** — 캐릭터마다
 * 따로 적으면 28개를 손으로 맞춰야 하고, 한 캐릭터만 세면 그게 정답인 줄 알게
 * 된다. 캐릭터가 바꾸는 것은 **클립**(=화면의 동작)이고 밸런스는 공통이다.
 *
 * 쿨다운이 아이콘 등급을 정한다(`iconRegionFor`) — 네 칸이 같은 아이콘이면
 * 라벨을 읽어야 무엇인지 알게 되고, 그건 아이콘의 존재 이유와 반대다.
 *
 * ## 왜 쿨이 2.5/5/9초에서 1.8/2.5/3.4초로 내려왔나 (2026-08-10)
 *
 * 유저 지시: "오토는 좀 천천히하고, 실제 스킬 쿨을 줄여서 수동도 빠르게 스킬들
 * 누르면 오토랑 동일한 속도로 공격하도록." 괴리의 원인은 튜닝이 아니라 **딜
 * 경로가 둘**이라는 것이다:
 *
 * - 평타 `team.autoAttackDamage`는 `field.auto`만 보고 dt에 비례해 계속 흐른다.
 *   **쿨다운 시스템을 지나지 않는다** — 화면 아래 쿨 파이는 이 경로를 설명하지
 *   않는다. 오토에서 보이는 난타가 이것이다(캐릭터별 0.64~0.90회/s).
 * - 스킬은 `core/cooldown` → `castQueue`로만 흐른다. 오토가 꺼지면 평타는 딜도
 *   모션도 0이므로(그건 유저가 정한 것이다: "Auto를 안 키면 캐릭터가 움직이면
 *   안 된다") 수동은 스킬 사이에 아무것도 없다.
 *
 * 그래서 예전 세 칸의 합은 0.711회/s인데 오토는 1.35~1.61회/s였다 — 2배 차다.
 * 네 칸의 `1000/쿨` 합이 **1.47회/s**가 되게 잡아 그 실측 대역 안에 넣었다.
 *
 * ## 왜 이보다 더 줄이지 않는가 (하한의 근거)
 *
 * 유저 지시는 "모션 안 끊기면서 제일 짧은 수치"다. 끊김의 하한은 **클립 길이가
 * 아니라 임팩트까지의 시간**이다 — `onAllyAttack`은 진행 중인 사이클을 끊고
 * 갈아타므로, 임팩트 프레임 전에 다음 입력이 오면 그 타격이 사라진다.
 * `chars.json` 실측으로 역할별 최악 임팩트를 재면 quick 615 / combo 997 /
 * burst 1392 / ult 1643ms다(전부 접근 배율을 곱한 뒤의 값). 여기 적은 쿨은 전부
 * 그 위에 있고, **한 사이클 전체**(접근+클립+복귀)도 자기 쿨 안에 든다 —
 * 가장 긴 실비아 ult가 3643ms로 4500 안이다.
 *
 * 그래도 쿨만으로는 끊김을 못 막는다: 쿨은 칸마다 따로 도므로 1번을 누른 직후
 * 2번을 누르면 값과 무관하게 끊긴다. 그 자리는 `castGateRules`의 공용 게이트가
 * 막는다 — 쿨은 **한 칸의 연타**를, 게이트는 **칸 사이의 연타**를 막는다.
 *
 * ## 딜을 같이 내린 이유
 *
 * 시전 횟수가 2.07배가 되므로 `power`를 그대로 두면 1인 dps가 240 → 497로 뛴다.
 * 층 예산(`FLOOR_TARGET_MS`·`TEAM_DPS_REF`)은 그대로 두는 것이 옳다 — 유저가
 * 고치라고 한 것은 **박자**이고 진행 속도는 아니다. 그래서 합 dps를 241.4로
 * 맞췄다(현재 239.8). 여는 딜은 735로 1,300보다 오히려 낮아져서
 * `openingDelayMs` 없이도 1층 예산(2,808) 안에 든다.
 */
const ROLE_NUMBERS: Readonly<Record<AttackRole, { cooldownMs: number; power: number }>> = {
  quick: { cooldownMs: 1800, power: 110 },
  combo: { cooldownMs: 2500, power: 150 },
  burst: { cooldownMs: 3400, power: 205 },
  ult: { cooldownMs: 4500, power: 270 },
};

/**
 * 캐릭터별 공격 세 칸 — **자기 클립으로** 채운다.
 *
 * 배정 기준은 클립의 실측값이다(`chars.json`: 프레임 수·임팩트 프레임):
 * - `quick` = 짧고 임팩트가 이른 클립. 붙는 즉시 칼이 나간다
 * - `combo` = 중간 길이
 * - `burst` = 가장 길고 **임팩트가 늦은** 클립. 치기 전의 뜸이 무게가 된다
 *
 * - `ult` = **남은 한 클립**. 아래 §네 번째 칸 참고
 *
 * ## 네 번째 칸이 `ult`인 것과 클립 배정이 강제인 것 (2026-08-10)
 *
 * 유저 지시로 6번째 칸(하강 광기)을 지우고 그 자리에 **공격 모션**을 넣었다.
 * 모든 캐릭터가 `attack1`/`attack2`/`attack3`/`special` 넷을 갖고 있으므로
 * (`chars.json` 실측, 일곱 전부 정확히 4개다) 세 칸이 쓰던 클립을 빼면 **남는
 * 것이 하나**다 — 즉 이 칸의 클립은 고를 여지가 없다. 다섯 번째 칸을 검토했다가
 * 버린 이유가 그것이다: 다섯 번째에 넣을 다른 모션이 없고, 같은 클립을 두 칸에
 * 쓰면 두 슬롯이 화면에서 구별되지 않는다.
 *
 * 예전 주석은 "`special`은 1.6초 안에 드는 캐릭터만 쓴다 — 실비아(2.7초)·
 * 클로에(2.5초)·셀린(2.1초)은 한 사이클이 3.5초를 넘어 누른 것과 화면이
 * 어긋난다"였다. 그 조건은 **접근 배율 1.45의 burst 자리**에 넣을 때의 것이다.
 * 이 칸은 접근을 0.62로 당기므로(`ROLE_MOTIONS.ult`) 셋의 사이클이 3643·3240·
 * 2872ms가 되어 자기 쿨(4500) 안에 든다 — 실측으로 확인한 값이다.
 *
 * 이름은 28개가 **전부 다르다**. `tests/loadout.test.ts`가 그것을 못 박는 이유는
 * 미학이 아니다: id가 `<슬러그>_<역할>`이므로 이름이 겹치면 캐릭터를 바꿨는데
 * 같은 스킬이 나오는 결함이 화면에서 구별되지 않는다.
 */
const HERO_ATTACKS: Readonly<
  Record<HeroSlug, Readonly<Record<AttackRole, { name: string; clip: AttackClip }>>>
> = {
  water_priestess: {
    // attack3은 임팩트가 1프레임(71ms)이라 가장 이르지만 클립이 786ms다 —
    // 이른 임팩트가 필요한 자리는 attack1(500ms, 5/7)이 맞다
    quick: { name: "물살 베기", clip: "attack1" },
    combo: { name: "조류 가르기", clip: "attack3" },
    burst: { name: "심해 세례", clip: "attack2" },
    ult: { name: "심연의 조종", clip: "special" },
  },
  leaf_ranger: {
    quick: { name: "잎날 사격", clip: "attack1" },
    combo: { name: "관통 화살", clip: "attack3" },
    burst: { name: "숲의 심판", clip: "special" },
    ult: { name: "꿰뚫는 폭풍", clip: "attack2" },
  },
  metal_bladekeeper: {
    // attack2가 4프레임(286ms)으로 로스터 최단이다 — 연타 자리에 그대로 맞는다
    quick: { name: "쇠날 연격", clip: "attack2" },
    combo: { name: "강철 발도", clip: "attack1" },
    burst: { name: "파쇄 삼연참", clip: "attack3" },
    ult: { name: "절단의 극의", clip: "special" },
  },
  wind_hashashin: {
    quick: { name: "바람 찌르기", clip: "attack1" },
    combo: { name: "질풍 난무", clip: "attack2" },
    burst: { name: "그림자 처형", clip: "attack3" },
    ult: { name: "무음 참수", clip: "special" },
  },
  fire_knight: {
    quick: { name: "화염 베기", clip: "attack1" },
    combo: { name: "불꽃 상승참", clip: "attack3" },
    burst: { name: "용광로 낙하", clip: "special" },
    ult: { name: "작열 연참", clip: "attack2" },
  },
  crystal_mauler: {
    // attack1과 attack2가 둘 다 7프레임·임팩트 3이다(누적 콤보를 안 그린 캐릭터).
    // 같은 값을 두 칸에 넣으면 화면에서 두 슬롯이 구별되지 않으므로 special을 쓴다
    quick: { name: "수정 강타", clip: "attack1" },
    combo: { name: "결정 분쇄", clip: "special" },
    burst: { name: "대지 파쇄", clip: "attack3" },
    ult: { name: "결정 붕괴", clip: "attack2" },
  },
  ground_monk: {
    quick: { name: "반석 주먹", clip: "attack1" },
    combo: { name: "흙 회전각", clip: "attack2" },
    burst: { name: "지룡 승천", clip: "attack3" },
    // 로스터에서 임팩트가 가장 늦은 클립이다(18프레임 12fps = 1500ms) — `ult`
    // 역할의 최악 임팩트 1643ms가 여기서 나오고, 그 값이 쿨 4500의 하한 근거다
    ult: { name: "반석 진각", clip: "special" },
  },
};

/**
 * 상대에게 쏘는 두 칸. **캐릭터와 무관하다** — 상대 필드에 걸리는 방해는
 * 내 캐릭터의 몸이 아니라 광선으로 나가므로(`castBeamShown`), 캐릭터마다
 * 갈라 놓아도 화면에 차이가 없다. 대신 두 칸이 서로 달라야 한다.
 *
 * 둘 다 코어 수치를 바꾸지만 **서로 다른 축**이다(`core/battle.ts`):
 * `slow`는 상대의 **딜**을 깎고(`SLOW_DAMAGE_MULT`), `blind`는 상대의 **시전**을
 * 막는다(`BattleState.blindUntilMs`). 쿨다운은 실명 중에도 돌기 때문에 실명은
 * 시전을 빼앗는 게 아니라 미룬다.
 *
 * ── `blind`가 "연출 전용"이었던 동안 (2026-08-06 수정)
 *
 * 예전 주석은 여기에 "`blind`는 연출 전용이다(설계 스펙 §2-2) — 사람 대전에서는
 * 상대가 화면을 못 읽는 것이 실제 방해다"라고 적혀 있었다. 그 전제가 틀렸다:
 * `LocalMatchmaking`이 내가 아닌 칸을 전부 AI로 채우므로 **사람이 실제로 하는
 * 모든 판**에서 상대는 화면을 읽지 않는다. 즉 방해 두 칸 중 하나가 어떤 수치도
 * 바꾸지 않았다. 그래서 `blind`에 시전 차단을 줬다 — 딜 배율로 주지 않은 이유는
 * 그러면 `slow`의 약한 복제가 되어 두 칸이 같은 축을 밀기 때문이다.
 */
export const INTERFERENCE_SKILLS: readonly SkillDef[] = [
  {
    id: "corrupt_chains",
    name: "타락의 사슬",
    kind: "interference",
    cooldownMs: 12000,
    power: 0.4,
    interferenceKind: "slow",
    durationMs: 3000,
  },
  {
    id: "abyss_veil",
    name: "심연의 장막",
    kind: "interference",
    cooldownMs: 16000,
    power: 0.6,
    interferenceKind: "blind",
    durationMs: 2500,
  },
];

/**
 * 이 캐릭터의 슬롯. 순서 = 화면의 슬롯 순서다(공격 넷, 방해 둘).
 *
 * 매번 새 객체를 만든다 — 쿨다운 추적기가 배열을 들고 있으므로 공유하면
 * 다음 판의 쿨다운이 이전 판에서 이어진다.
 *
 * ## 6번째 칸(타락 버프 `abyss_madness`)을 지웠다 (2026-08-10)
 *
 * 유저 지시: "하강광기 빼고, 그냥 공격 모션 4개 넣는게 더 좋을거 같은데".
 * 검토 결과 지우는 것이 맞았고, 근거는 취향이 아니라 **도달 불가**다:
 *
 * 그 칸은 타락도 각성(30)에서 열렸다. 깊이 성분은 `sqrt(층) × 1.2`라서 30에
 * 닿으려면 **625층**인데 데모의 목표는 100층이다(≈12). 나머지는 '심연의 선택'
 * 뿐이고 50층마다 제안되므로 100층까지 두 번(+20) — 즉 **두 번을 다 받아들인
 * 판에서만** 마지막 몇 층에 열렸다. 그 밖의 모든 판에서 6번째 칸은 100층 내내
 * 회색 원으로 앉아 있었고, 화면에서 잠금인지 결함인지 구별되지 않는다.
 *
 * 지운 자리에 공격 네 번째 칸을 넣었다 — 슬롯 수는 그대로다(싱글 3+1 → 4,
 * 대전 3+2+1=6 → 4+2=6). `barLayout`이 칸 폭을 슬롯 수로 나누므로 폭·탭
 * 크기·라벨 폭이 하나도 안 움직인다.
 *
 * 같이 지운 것들: `skillsForCorruption`(대전에서 잠긴 칸을 빼던 게이트 — 잠기는
 * 칸이 없으므로 걸 것이 없다), `SkillDef.openingDelayMs`(그 버프가 유일한
 * 소비자였다. 여는 딜이 1,300 → 735로 내려가 1층 예산 2,808에 여유가 커졌다).
 *
 * **타락도 자체는 그대로다** — 단계별 ATK 배율(`corruptionAtkMul`)·엔딩 분기가
 * 계속 쓴다. 지운 것은 스킬 칸 하나이고 타락 시스템이 아니다.
 */
export function presetSkillsFor(slug: string): SkillDef[] {
  const table = HERO_ATTACKS[slug as HeroSlug] ?? HERO_ATTACKS[HERO_SLUGS[0]];
  const attacks: SkillDef[] = ATTACK_ROLES.map((role) => ({
    id: attackSkillId(slug, role),
    name: table[role].name,
    kind: "attack" as const,
    ...ROLE_NUMBERS[role],
  }));
  return [...attacks, ...INTERFERENCE_SKILLS.map((s) => ({ ...s }))];
}

/**
 * 공격 스킬 id — `<슬러그>_<역할>`.
 *
 * **캐릭터마다 다른 id인 것이 의도다.** 일곱이 `quick`이라는 같은 id를 쓰면
 * 쿨다운 추적기·AI 룰렛·`SKILL_MELEE` 표가 전부 한 캐릭터의 값으로 합쳐져서,
 * 캐릭터를 바꿨는데 나오는 동작이 그대로인 것을 아무 검사도 잡지 못한다.
 *
 * 문자열을 손으로 조립하는 곳이 두 곳(여기와 `skillMeleeRules`) 이상 생기면
 * 한쪽 오타가 `skillMelee() === null`로 조용히 떨어진다 — 그러면 돌진이 자동
 * 순환으로 되돌아가고 화면에는 "스킬을 눌렀는데 평타가 나온다"로만 보인다.
 */
export function attackSkillId(slug: string, role: AttackRole): string {
  return `${slug}_${role}`;
}

/** 이 캐릭터가 이 역할에 쓰는 클립. `skillMeleeRules`가 표를 세울 때 쓴다 */
export function presetAttackClip(slug: string, role: AttackRole): AttackClip {
  const table = HERO_ATTACKS[slug as HeroSlug] ?? HERO_ATTACKS[HERO_SLUGS[0]];
  return table[role].clip;
}

/**
 * 기본 6슬롯 — 선택 화면이 없을 때(갤러리·아이콘 검사) 쓰는 대표값이다.
 *
 * **캐릭터를 고르면 이게 아니라 그 캐릭터의 것이 실린다**(`load`). 예전에는
 * 이 배열이 유일한 스킬 목록이었다.
 */
export const PRESET_SKILLS: readonly SkillDef[] = presetSkillsFor(HERO_SLUGS[0]);

/**
 * 캐릭터 역할 템플릿. teamSize가 이 길이를 넘으면 순환한다.
 *
 * **chierit Elementals 7종**(CC-BY 4.0). 자체 생성 4종(리제·노라·실비아·클로에)에서
 * 교체했다 — 그쪽은 공격 클립이 `attack1/attack2/special` 셋뿐이라 공격 3슬롯을
 * 각 캐릭터의 자기 클립으로 채울 수 없었다(`charManifest.HERO_SLUGS` 주석).
 *
 * 스프라이트만 다르면 "색이 다른 같은 사람"으로 보이므로 **움직임까지 갈라
 * 둔다** — 접근 동작(`run`/`roll`/`walk`), 접근 속도, 사거리, 자동 공격 클립
 * 조합이 일곱 다 다르다. 표시 이름은 `chars.json`의 `displayName`과 같게
 * 유지한다(임포터가 박아 둔다).
 *
 * **이제 검사가 대조한다**(`loadout.test.ts`의 "표시 이름은 두 곳에 있고…").
 * 주석만으로는 안 지켜졌다 — 격자 4인 이름을 바꾸는 이 회차까지 대조가 없었다.
 *
 * `clips`(자동 공격 순환)에는 **`special`을 넣지 않는다.** 순환은 조작 없이
 * 계속 돌아가는 것이라, 2.7초짜리 마무리 모션이 섞이면 한 사이클이 공격
 * 간격의 세 배가 되어 딜과 화면이 어긋난다. `special`은 스킬이 지정해서만 나온다.
 */
const ROLE_TEMPLATES: readonly {
  displayName: string;
  role: CharacterLoadout["role"];
  charSlug: HeroSlug;
  tintHex: number;
  stats: { attack: number; attackIntervalMs: number };
  melee: MeleeStyle;
}[] = [
  {
    displayName: "실비아",
    role: "guardian",
    charSlug: "water_priestess",
    tintHex: 0x7fd0ff, // 물빛 — HUD 카드 톤 (스프라이트는 원본색으로 둔다)
    stats: { attack: 40, attackIntervalMs: 900 },
    /**
     * **달리기 시트가 없다** — 7종 중 이 캐릭터만 `walk`(10프레임)뿐이다.
     * 여기에 `run`을 적으면 `spriteChar`의 대체 사슬이 조용히 `walk`를 재생해서,
     * 프리셋이 없는 클립을 가리키고 있다는 사실이 화면에서 안 드러난다.
     * 긴 지팡이라 가장 멀리서 때린다.
     */
    melee: {
      approach: "walk",
      approachMs: 340,
      returnMs: 430,
      reach: 0.3,
      clips: ["attack1", "attack3"],
    },
  },
  {
    displayName: "노라",
    role: "attacker",
    charSlug: "leaf_ranger",
    // 순백 — 시트를 리톤해서 녹청 망토가 흰색이 됐다(`female-recolor/tools/spec.py`).
    // **`tintHex`는 HUD 카드 색이다**(필드의 주인공은 `battleField`가 흰색으로
    // 세운다). 잎빛으로 두면 카드만 초록으로 남아 카드와 몸이 다른 사람이 된다
    tintHex: 0xeef2f7,
    stats: { attack: 44, attackIntervalMs: 820 },
    // 활이다 — 로스터에서 가장 멀리서 쏘고 가장 먼저 빠진다
    melee: {
      approach: "run",
      approachMs: 300,
      returnMs: 380,
      reach: 0.42,
      clips: ["attack1", "attack3"],
    },
  },
  {
    displayName: "리제",
    role: "attacker",
    charSlug: "metal_bladekeeper",
    tintHex: 0xff6b5a, // 적색 — 흉갑을 적색으로 리톤했다(강철빛에서 옮겼다)
    stats: { attack: 58, attackIntervalMs: 700 },
    // 쌍검. 가장 빠르게 붙고 가장 깊이 파고든다 — 0으로 두면 실루엣이
    // 뭉쳐서 누가 때렸는지 안 보이므로 0.16은 남긴다
    melee: {
      approach: "run",
      approachMs: 200,
      returnMs: 300,
      reach: 0.16,
      clips: ["attack1", "attack2", "attack3"],
    },
  },
  {
    displayName: "클로에",
    role: "attacker",
    charSlug: "wind_hashashin",
    tintHex: 0xff8ab8, // 핑크 — 황갈 밴드를 335°로 돌렸다(바람빛에서 옮겼다)
    stats: { attack: 54, attackIntervalMs: 730 },
    // 굴러 들어간다(다이브). 접근 동작이 화면에서 가장 먼저 읽히는 차이다
    melee: {
      approach: "roll",
      approachMs: 180,
      returnMs: 280,
      reach: 0.12,
      clips: ["attack1", "attack2"],
    },
  },
  {
    displayName: "이리스",
    role: "guardian",
    charSlug: "fire_knight",
    tintHex: 0xff8a5a, // 불빛
    stats: { attack: 46, attackIntervalMs: 860 },
    // 대검. 느리고 무겁게 — 멀찍이서 크게 휘두르고 천천히 돌아온다
    melee: {
      approach: "run",
      approachMs: 270,
      returnMs: 400,
      reach: 0.22,
      clips: ["attack1", "attack3"],
    },
  },
  {
    displayName: "미라",
    role: "guardian",
    charSlug: "crystal_mauler",
    tintHex: 0x8fb6ff, // 수정빛
    stats: { attack: 36, attackIntervalMs: 980 },
    // 거대 망치. 로스터에서 가장 느리다 — attack3이 1.2초라 복귀까지 2초다
    melee: {
      approach: "run",
      approachMs: 330,
      returnMs: 450,
      reach: 0.26,
      clips: ["attack1", "attack3"],
    },
  },
  {
    displayName: "셀린",
    role: "attacker",
    charSlug: "ground_monk",
    tintHex: 0xe0c48a, // 흙빛
    stats: { attack: 50, attackIntervalMs: 760 },
    // 맨손이다 — 붙어야 때릴 수 있으므로 굴러 들어가 가장 가까이 선다
    melee: {
      approach: "roll",
      approachMs: 230,
      returnMs: 320,
      reach: 0.14,
      clips: ["attack1", "attack2", "attack3"],
    },
  },
];

/** 템플릿 하나 → 로드아웃 항목. 매번 새 객체를 만든다 */
function toLoadout(
  t: (typeof ROLE_TEMPLATES)[number],
  memberId: string,
): CharacterLoadout {
  return {
    memberId,
    displayName: t.displayName,
    role: t.role,
    charSlug: t.charSlug,
    tintHex: t.tintHex,
    level: 1,
    stats: { ...t.stats },
    // clips까지 복사한다 — 배열을 공유하면 호출자가 밀어 넣은 클립이
    // 프리셋에 남아 다음 판의 다른 캐릭터가 그 동작을 한다
    melee: { ...t.melee, clips: [...t.melee.clips] },
  };
}

/**
 * 이 슬러그의 캐릭터를 그대로 세운다. 없는 슬러그면 null.
 *
 * **왜 필요한가**: 상대 팀은 시드로 다른 슬러그를 뽑는데(`session.ts theirSlugs`),
 * 예전에는 내 캐릭터 객체의 `charSlug`만 바꿔 끼웠다. 그러면 다른 스프라이트가
 * 앞 캐릭터의 접근 곡선·클립으로 움직여서, 캐릭터별로 동작을 갈라 둔 것이 화면
 * 절반에서 지워진다 — 스프라이트만 다른 "같은 사람"으로 되돌아간다.
 */
export function presetCharacterBySlug(
  slug: string,
  memberId: string,
): CharacterLoadout | null {
  const t = ROLE_TEMPLATES.find((x) => x.charSlug === slug);
  return t ? toLoadout(t, memberId) : null;
}

/**
 * 슬러그 → 한글 표시 이름. 없는 슬러그면 슬러그를 그대로 돌려준다.
 *
 * **캐릭터 선택 화면이 쓴다.** 이름을 씬에 따로 적지 않기 위한 함수다 —
 * 두 벌이면 이름을 고칠 때 선택 화면과 전투 HUD가 다른 이름을 말한다.
 * 로드아웃 객체를 만들지 않고 이름만 필요한 자리(격자 7칸)가 있어서
 * `presetCharacterBySlug(...).displayName`으로 대신할 수 없다 — 7개를
 * 만들었다 버리면 `melee.clips` 배열까지 매 프레임 복사된다.
 *
 * 슬러그를 그대로 돌려주는 이유: 빈 문자열이면 격자 칸이 이름 없이 그려져
 * 무엇을 고르는지 모르게 된다. 슬러그라도 보이면 어긋났다는 게 화면에 드러난다.
 */
export function heroDisplayName(slug: string): string {
  return ROLE_TEMPLATES.find((x) => x.charSlug === slug)?.displayName ?? slug;
}

export class PresetLoadoutProvider implements LoadoutProvider {
  /**
   * @param leadSlug 1번 자리(=내가 조작하는 캐릭터). 스킬 6슬롯이 이 캐릭터의
   *   것으로 실린다. 캐릭터 선택 화면이 이 값을 넘긴다 — 안 넘기면 목록 순서다.
   */
  constructor(private readonly leadSlug?: HeroSlug) {}

  load(teamSize: number): Loadout {
    if (teamSize < 1) {
      throw new Error(`teamSize must be >= 1, got ${teamSize}`);
    }
    /**
     * 고른 캐릭터를 **1번 자리로** 옮긴다. 뒤에 두면 내가 누른 스킬이 내가 보고
     * 있는 캐릭터가 아니라 옆의 팀원 몸에서 나간다 (`session.castSkill`은
     * `characters[0]`을 쓴다).
     */
    const order =
      this.leadSlug === undefined
        ? ROLE_TEMPLATES
        : [
            ...ROLE_TEMPLATES.filter((t) => t.charSlug === this.leadSlug),
            ...ROLE_TEMPLATES.filter((t) => t.charSlug !== this.leadSlug),
          ];
    const characters: CharacterLoadout[] = [];
    for (let i = 0; i < teamSize; i++) {
      characters.push(toLoadout(order[i % order.length]!, `m${i}`));
    }
    // 매 호출마다 새 배열·새 객체 — 호출자가 변형해도 프리셋이 오염되지 않는다
    return {
      characters,
      // 스킬은 **내가 조작하는 캐릭터**의 것이다. 공통 목록을 실으면 캐릭터를
      // 골라도 나오는 동작이 같아서 고른 것이 화면에 남지 않는다
      skills: presetSkillsFor(characters[0]!.charSlug),
    };
  }
}
