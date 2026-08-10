/**
 * 캐릭터 스프라이트시트 매니페스트 타입 + 종족 선택 규칙.
 *
 * 원본은 `~/asset-research/sidescroll`의 CC0 픽셀아트이고,
 * `tools/import_chars.py`가 `public/assets/chars/`로 팩한다.
 *
 * **Pixi를 import하지 않는다** — node 테스트가 이 규칙들을 그대로 검증한다.
 * (좌표·프레임 계산은 `spriteChar.ts`가, 웨이브별 편성은 여기가 담당한다.)
 */

/** `chars.json`의 경로. 시트 PNG는 같은 폴더의 `<slug>.png` */
export const CHAR_MANIFEST_URL = "assets/chars/chars.json";

export interface CharAction {
  /** 시트 안에서 이 액션 스트립이 시작하는 y (액션마다 셀 크기가 다르다) */
  y: number;
  cols: number;
  cellW: number;
  cellH: number;
  frames: number;
  fps: number;
  loop: boolean;
  /** 기준 액션 대비 발밑 편차(원본 px). 안 더하면 액션 전환에서 캐릭터가 튄다 */
  dy: number;
  /** 알파 박스 합집합 [x, y, w, h] — 그림자·HP바 정렬용 */
  box: readonly [number, number, number, number];
  /**
   * 공격 액션만: **때리는 순간**의 프레임 번호. HP·이펙트를 이 프레임에 낸다.
   *
   * 임포터가 픽셀에서 뽑는다(`tools/import_chars.py impact_frame`) — 손으로
   * 적으면 리그를 다시 렌더할 때마다 12개가 어긋나고, 어긋나면 "맞았는데 안
   * 아파 보인다"가 된다. 공격이 아닌 액션에는 없다.
   */
  impact?: number;
  /**
   * 콤보 2·3타만: 앞 타의 재생분으로 **잘라낸** 프레임 수.
   *
   * **런타임은 안 쓴다 — 테스트가 쓴다.** chierit는 `attack2`를 "1타+2타",
   * `attack3`를 "1·2타+3타"로 그려 놨다(누적 콤보). 우리는 세 공격을 독립 슬롯으로
   * 쓰므로 그대로 넣으면 attack3을 눌렀을 때 남의 공격을 1.3초 재생한 뒤에야 3타가
   * 나오고, `impact`의 전역 argmax가 그 앞 타에 걸려 칼을 휘두르기 전에 HP가 깎인다.
   *
   * **0이 기록되어 있다는 것이 "쟀다"는 증거다.** 필드가 아예 없으면 재고 0이
   * 나온 것과 임포터가 검사를 건너뛴 것이 구별되지 않는다 — 실제로 판정을 프레임
   * 해시로 하던 동안 5종이 조용히 안 잘린 채 통과했다(chierit가 앞 타를 다시
   * 그리면서 몇 픽셀을 손봐서 해시만 어긋났다).
   */
  comboTrim?: number;
  /**
   * 대기 자세만: **몸통 폭**(원본 px) = 행 폭의 중앙값.
   *
   * `box[2]`(알파 bbox 폭)와 다르다: fire_knight는 대검을 등 뒤로 늘어뜨려서
   * bbox가 표시 195px인데 몸통은 75px다. bbox로 간격을 검사하면 "무기를 든
   * 캐릭터는 전부 겹친다"가 되어, 진짜 겹침(몸이 서로 관통하는 것)과 칼끝이
   * 옆칸에 걸치는 것을 구별할 수 없다.
   *
   * **런타임도 쓴다** (2026-08-07부터). 같은 적을 노리는 아군들이 줄을 서는
   * 거리(`allyBodyWPx` → `allyLaneX`)의 유일한 입력이다. 처음에는
   * `visualExtent()`로 재려 했는데 그건 재생 중인 클립의 bbox라서 공격
   * 프레임에서 무기 궤적을 삼켰다 — 뒤 아군이 화면 밖으로 물러났다.
   * **클립과 무관하게 고정된 폭은 이 값뿐이다.**
   */
  bodyW?: number;
}

export interface CharDef {
  kind: "hero" | "minion" | "boss";
  name: string;
  author: string;
  license: string;
  url: string;
  female: boolean;
  /**
   * 우리가 만든 에셋인지 (기획서 원화 → SD3.5 → TRELLIS → UAL 리그 → 옆모습 렌더).
   * CC0가 아니지만 소유권이 우리에게 있어 판매에 걸리지 않는다 — 임포터의
   * 라이선스 검사는 이 표시가 있는 것만 통과시킨다.
   */
  generated: boolean;
  /**
   * 시트 불투명 픽셀의 **중앙** 명도(0~1). 임포터가 재서 남긴다.
   *
   * **런타임은 안 쓴다 — 테스트가 쓴다.** 캐릭터가 배경보다 어두우면 실루엣이
   * 배경에 녹아 구멍처럼 보이는데, 그건 코드를 읽어서 안 잡히고 스크린샷에서도
   * "어둡네" 정도로만 보인다. 리제 0.063·실비아 0.057이 그렇게 들어와서
   * 배경을 삽화로 바꿔 밝아질 때까지 아무도 몰랐다. 숫자를 매니페스트에 남겨야
   * 어두운 재렌더가 조용히 돌아오는 것을 테스트가 막을 수 있다.
   *
   * 평균이 아니라 중앙값이다 — 머리카락 하이라이트 몇 픽셀이 평균을 끌어올려
   * "괜찮은데?"로 보이게 만든다(노라는 평균 0.348 < 중앙 0.403으로 방향까지
   * 반대다).
   */
  medLum: number;
  /** 기준 액션의 발밑과 셀 하단 사이 여백(원본 px). 최대 83px까지 벌어진다 */
  baseGap: number;
  /** 기준 액션 피사체 높이(원본 px). 표시 배율 정규화의 분모 */
  refSubjH: number;
  /**
   * 시트에 그려진 **원본 방향**. 없으면 오른쪽(+1)으로 본다.
   *
   * 에셋마다 다르다 — 우리 4인은 옆모습 렌더를 **왼쪽 보게** 뽑았고(자체 생성),
   * CC0 잡몹은 오른쪽을 본다. 이걸 기록하지 않으면 `setFacing(1)`이 "오른쪽을
   * 보라"는 뜻인데 왼쪽 보는 시트에는 아무 일도 안 일어난다 — 주인공이 등을
   * 보인 채 뒷걸음질로 적에게 다가가고, 달리기 애니메이션은 진행 방향과 반대로
   * 다리를 젓는다. 화면에서는 "왜 왼쪽으로 가지?"로 보인다.
   */
  faces?: 1 | -1;
  w: number;
  h: number;
  actions: Record<string, CharAction>;
  /** 잡몹/보스: 슬롯 기준 높이에 곱하는 종별 배율 */
  hMul?: number;
  /** 잡몹: 지면에서 띄우는 비율 (박쥐·눈알) */
  lift?: number;
  /** 주인공: 한글 표시 이름 */
  displayName?: string;
}

export interface CharManifest {
  chars: Record<string, CharDef>;
}

/**
 * 주인공 후보 — `tools/import_chars.py`의 HEROES와 순서가 같아야 한다.
 * 두 벌을 손으로 맞추는 것은 위험하지만, 매니페스트를 런타임에 읽는 시점보다
 * 로드아웃이 먼저 필요해서(=매칭 화면) 목록만 여기 둔다. 테스트가 대조한다.
 *
 * **chierit Elementals 7종**(CC-BY 4.0, 크레딧에 `chierit` 표기).
 * 자체 생성 4종(리제·노라·실비아·클로에)에서 **에셋만** 교체했다 — 그쪽은 UAL
 * 리그의 공격 클립이 `attack1/attack2/special` 셋뿐이라 공격 슬롯을 각 캐릭터의
 * 자기 클립으로 채울 수 없었다. chierit는 캐릭터마다 `attack1/2/3 + special`
 * 네 벌을 갖고 있다. 공격 칸이 셋에서 **넷**이 된 지금(`ATTACK_ROLES`) 그 근거는
 * 더 강해졌다 — 네 칸이 정확히 네 벌을 하나씩 받는다.
 *
 * 이름·직업·색은 기획서의 4인이 그대로다(`ROSTER_SLUGS`). 바뀐 것은 그 4인이
 * 입는 몸이고, 로스터가 아니다.
 *
 * **7종인 것에 의미가 있다.** 4종이던 시절에는 내 팀 둘을 뽑으면 상대 팀이 남은
 * 둘로 강제되어 매판 같은 네 명이 섰다. 7종이면 내가 하나를 고르고 나머지 셋을
 * 시드가 뽑아도 겹치지 않는다(`pickHeroSlugs`).
 *
 * 순서는 카드 상자·PvP 추첨이 읽는 순서다. 선택 화면이 보여 주는 넷은
 * `PICK_SLUGS`다.
 *
 * **성별에 대해 이 파일은 아무것도 재지 않는다.** `chars.json`의 `female`은 7종
 * 전부 `true`지만 그 값은 손으로 적은 것이다 — 출처가 저장소 밖의
 * `~/asset-research/sidescroll/catalog.json`이고, 임포터는 그것을
 * `bool(a.get("female"))`로 옮겨 적을 뿐 픽셀을 보지 않는다
 * (`import_chars.py`). 즉 "실측 7/7"이라고 쓸 수 있는 근거가 없다. 앞선 주석이
 * 그렇게 적고 있었고, 그 전 주석은 반대로 "앞 넷이 여성, 뒤 셋이 남성"이라고
 * 적고 있었다 — 두 주장 모두 아무도 재지 않았다.
 *
 * **재는 방법은 캡처뿐이다**(`judge-by-capture-not-metrics`). 실제로 게임 크기
 * 캡처가 배정을 뒤집었다: 옛 배정의 리제(`fire_knight`, 붉은 판금 + 대검)와
 * 클로에(`crystal_mauler`, 거대 망치)가 "여자 캐릭터로 안 읽힌다"고 기각됐다.
 * 플래그는 둘 다 `true`였다 — 플래그는 **실루엣이 어떻게 읽히는지**를 묻지
 * 않는다. 그래서 이 파일에 성별 게이트를 만들지 않았다: 코드로 물을 수 있는
 * 형태가 아니고, 물을 수 있는 형태로 위장하면 다음에 또 통과한다.
 */
export const HERO_SLUGS = [
  "water_priestess",
  "leaf_ranger",
  "metal_bladekeeper",
  "wind_hashashin",
  "fire_knight",
  "crystal_mauler",
  "ground_monk",
] as const;
export type HeroSlug = (typeof HERO_SLUGS)[number];

/**
 * 선택 화면이 보여 주는 것 — 기획서(`prototype/peter/NAN2026_planning_Peter.md`)의
 * 4인이다. `HERO_SLUGS`의 **부분집합**이고 순서는 독립이다.
 *
 * **왜 `HERO_SLUGS`를 줄이지 않는가.** 줄이면 셋이 동시에 깨진다:
 * `chars.json` 키 집합 대조, CREDITS 표 대조, 그리고 `HERO_SLUGS.length >= 7`.
 * 셋째가 구조적이다 — PvP는 2:2로 네 명이 서고 내가 하나를 고르면 나머지 셋을
 * `pickHeroSlugs`가 뽑는다. 4종이면 남은 셋으로 **강제되어 매판 같은 넷**이 서고,
 * 그것이 4종이던 시절을 버린 이유다(위 주석).
 *
 * 순서가 기획서 표 순서다(A 리제 → B 노라 → C 실비아 → D 클로에). `HERO_SLUGS`에서
 * 이 넷이 놓인 순서와 어긋나므로 여기서 자기 순서를 갖는다 — 어긋나 있어야 격자와
 * 기획서를 대조할 수 있다.
 *
 * **배정이 바뀌었다: 겉모습 우선.** 앞선 회차는 `preset.ts`의 능력치·무기로
 * 배정했고(리제=`fire_knight` 대검, 노라=`metal_bladekeeper` 탱커), 그래서
 * 노라의 **순백 갑옷에 마룬 시트**가 걸려 리톤 4회 시도 4회 캡처 기각으로
 * "미해결"로 남았다 — 옮길 수 없는 색을 옮기려 한 것이다. 지금은 기획서 외형
 * 키워드에 가까운 시트를 먼저 고른다(녹청 망토는 흰색으로 갈 수 있다).
 *
 * 대가는 무기가 기획서와 갈리는 것이다(노라=랜스인데 활, 클로에=사제인데 쌍단검).
 * 색과 실루엣은 화면에 보이고 무기 이름은 안 보이므로 보이는 쪽을 맞췄다.
 */
export const PICK_SLUGS: readonly HeroSlug[] = [
  "metal_bladekeeper", // 리제 — 회색 흉갑을 적색으로 (무채색 선택 + 채도 지정)
  "leaf_ranger", // 노라 — 녹청 망토를 순백으로 (휘도 재사상)
  "water_priestess", // 실비아 — 청 → 보라로 회전
  "wind_hashashin", // 클로에 — 황갈 → 핑크로 회전
];

/**
 * 잡몹 — 웨이브 깊이가 깊어질수록 뒤쪽이 나온다.
 *
 * 순서에 의미가 있다: 앞쪽이 약하고 작은 몹, 뒤쪽이 위협적인 몹이다.
 * 999층 하강이라는 설정에서 "내려갈수록 다른 것이 나온다"가 유일하게
 * 눈에 보이는 진행 표시다 — 같은 적이 계속 나오면 층이 안 내려간 것처럼 보인다.
 */
export const MINION_SLUGS = [
  "rat",
  "slime",
  "mushroom",
  "bat",
  "goblin",
  "flying_eye",
  "skeleton",
  "fire_worm",
  "mimic",
] as const;
export type MinionSlug = (typeof MINION_SLUGS)[number];

/** 보스 — 5웨이브마다 하나. 순환한다 */
export const BOSS_SLUGS = [
  "medieval_king",
  "evil_wizard3",
  "wizard_pack",
  "evil_wizard",
] as const;
export type BossSlug = (typeof BOSS_SLUGS)[number];

/**
 * 원하는 **월드** 방향(+1 = 오른쪽)을 내려면 스프라이트를 뒤집어야 하는가.
 *
 * 시트의 원본 방향과 원하는 방향이 다를 때만 -1이다. `spriteChar`가 pixi를
 * import해서 node 테스트가 못 부르므로 규칙만 여기로 뺀다 — 방향 버그는
 * 코드를 읽어서 안 잡힌다(주인공이 등을 보이고 뒷걸음질해도 좌표는 맞다).
 *
 * @param nativeFacing 시트에 그려진 방향. 매니페스트에 없으면 오른쪽(+1)
 */
export function facingFlip(want: 1 | -1, nativeFacing: 1 | -1 = 1): 1 | -1 {
  return want === nativeFacing ? 1 : -1;
}

/**
 * 이 웨이브에서 뽑을 수 있는 잡몹 풀.
 *
 * 웨이브 1은 앞 3종만, 이후 두 웨이브마다 한 종이 열린다. 처음부터 9종을
 * 다 열면 1층에서 미믹이 나와 난이도 곡선과 그림이 어긋난다.
 */
export function minionPool(waveIndex: number): readonly MinionSlug[] {
  const i = Number.isFinite(waveIndex) ? Math.max(0, Math.floor(waveIndex)) : 0;
  const n = Math.min(MINION_SLUGS.length, 3 + Math.floor(i / 2));
  return MINION_SLUGS.slice(0, n);
}

/**
 * 적 정의 → 슬러그. **결정론이어야 한다** — 양 팀이 같은 seed로 같은 적을
 * 봐야 하고(AC-4), 재대전에서 같은 판이 재현되어야 한다.
 *
 * `enemyId`는 `w<웨이브>-m<번호>` 또는 `w<웨이브>-boss` 형식이다(core/waves.ts).
 * 문자열 해시를 쓰는 이유: 코어가 RNG를 이미 다 소비했고, 여기서 RNG를 새로
 * 돌리면 스폰 순서에 의존하게 된다 — 사망한 슬롯을 다시 채울 때 어긋난다.
 */
export function pickEnemySlug(
  enemyId: string,
  waveIndex: number,
  isBoss: boolean,
): string {
  const h = hashString(enemyId);
  if (isBoss) {
    return BOSS_SLUGS[h % BOSS_SLUGS.length] as string;
  }
  const pool = minionPool(waveIndex);
  return pool[h % pool.length] as string;
}

/** FNV-1a 32비트. 짧은 ID에서 충분히 흩어지고 플랫폼 간 동일하다 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 한 팀의 주인공 슬러그. 팀마다 다른 조합이 나와야 "내 팀"이 구별된다.
 *
 * @param teamSeed 매치 시드 + 팀 번호
 * @param exclude 이미 다른 팀이 쓰는 슬러그. 겹치면 좌우 반전 거울처럼 보인다.
 *   후보가 모자라면(팀 크기가 커지면) 제외를 포기한다 — 빈 슬롯이 더 나쁘다.
 */
export function pickHeroSlugs(
  teamSeed: number,
  count: number,
  exclude: readonly string[] = [],
): HeroSlug[] {
  const n = Math.max(0, Math.floor(count));
  const avail = HERO_SLUGS.filter((s) => !exclude.includes(s));
  const pool: HeroSlug[] = avail.length >= n ? [...avail] : [...HERO_SLUGS];
  const out: HeroSlug[] = [];
  // 중복 없이 뽑는다 — 같은 리그가 둘이면 캐릭터가 하나로 보인다
  let h = hashString(`team${Math.floor(teamSeed)}`);
  for (let i = 0; i < n && pool.length > 0; i++) {
    h = Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0] as HeroSlug);
  }
  return out;
}
