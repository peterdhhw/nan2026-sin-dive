/**
 * 덱(카드함) → 전투 효과. 순수 결정론 계산만 담는다 (3단계).
 *
 * 설계 문서: docs/WORLD.md §5, game-spec §10-2(카드 보상)
 *
 * ## 왜 카드가 ATK를 올려야 하는가
 *
 * 카드는 이기면 한 장씩 늘어나는데(`shared/scenes/cardRules.rewardFor`)
 * 지금까지 그 수가 **화면에만** 있었다 — 카드함 `12/35`가 늘어나는 것 말고는
 * 판에 아무 것도 바뀌지 않았다. 모으는 것이 세지는 것으로 이어지지 않으면
 * 카드는 수집 트로피고, 그러면 대전을 한 판 더 하는 이유가 사라진다.
 *
 * ## 왜 `core/`인가
 *
 * 카드 **id 규칙**은 `shared/cardManifest`가 갖고 카드함 **저장**은
 * `shared/scenes/cardRules`가 갖는다. 하지만 "몇 장이면 얼마나 세지는가"는
 * 밸런스이고, 밸런스는 두 모드가 공유한다 — 여기 두면 싱글 세션과 PvP 세션이
 * 같은 곡선을 본다. 이 파일이 **장수(number)만** 받는 것이 그 경계다:
 * `Set<string>`을 받으면 카드 id 규칙이 코어로 새어 들어온다.
 */

/**
 * 카드 한 장당 ATK 증가분 (2%).
 *
 * 35장 만재에 +70%다. 강화(`economyRules.atkMulOf`)와 **곱해지므로** 크게
 * 잡으면 안 된다 — 이 값을 5%로 두면 만재가 ×2.75가 되어, 카드를 다 모은
 * 사람의 판이 층 예산 곡선(`core/waves.ts`)에서 벗어난다.
 *
 * 반대로 1%면 만재가 +35%인데, 한 장 딴 순간의 차이가 0.35%라 화면에서
 * 읽히지 않는다. 2%는 "한 판 이기면 다음 판이 조금 빨라진다"가 층 시간
 * (평균 5.4초)에서 0.1초 단위로 나타나는 값이다.
 */
export const CARD_ATK_STEP = 0.02;

/**
 * 카드 ATK 배율의 상한.
 *
 * **35장 만재의 값(1.7)보다 높게 잡는다.** 상한이 만재보다 낮으면 마지막 몇
 * 장이 아무 것도 하지 않게 되고, 그건 "모아도 안 세진다"를 카드함 끝에서
 * 다시 만든다. 상한이 있는 이유는 카드 총수가 늘어나는 확장(본선 로스터
 * 확대)에서 곡선이 무한히 자라지 않게 막는 것이다.
 */
export const CARD_ATK_CAP = 2;

/**
 * 보유 카드 수 → ATK 배율. 0장이면 정확히 1(=효과 없음).
 *
 * @param ownedCount 보유 카드 장수. 음수·비유한·소수는 접는다 — 저장이 깨진
 *   값이 배율을 NaN으로 만들면 팀 딜 전체가 NaN이 되어 게이지가 멈춘다.
 *   실패는 "효과 없음"(1) 쪽으로 간다.
 */
export function cardAtkMul(ownedCount: number): number {
  const n = Number.isFinite(ownedCount)
    ? Math.max(0, Math.floor(ownedCount))
    : 0;
  return Math.min(CARD_ATK_CAP, 1 + n * CARD_ATK_STEP);
}

/* ── 심연석 (카드 뽑기 재화, 3단계)
 *
 * ## 왜 카드에 두 번째 입구가 필요한가
 *
 * 지금까지 카드는 **대전 승리로만** 늘었다(§10-2). 그런데 대전은 100층에서
 * 열리고(2단계) 상대를 기다려야 한다 — 하강만 하는 사람에게는 카드가 영구히
 * 0장이고, 그러면 위의 `cardAtkMul`이 그 사람에게는 존재하지 않는 곡선이 된다.
 * 하강에서 얻는 재화로 뽑을 수 있어야 두 모드가 같은 덱을 키운다.
 *
 * ## 왜 골드가 아니라 새 재화인가
 *
 * 골드는 강화(`economyRules`)의 재료다. 카드 뽑기를 골드로 두면 **뽑을 때마다
 * 강화가 늦어진다** — 하강의 성장과 덱의 성장이 같은 지갑을 다투므로, 카드를
 * 모으는 것이 층을 못 내려가는 이유가 된다. 기획서 §2의 재화 3종 중
 * 심연석(거래소 기반, `docs/WORLD.md` §5)이 이 자리다.
 */

/** 카드 한 장 뽑는 비용(심연석) */
export const DRAW_COST = 10;

/**
 * 보스 층을 깨서 나오는 심연석. 잡몹 층은 0이다.
 *
 * **잡몹 층에 0을 준 이유**: 매 층 1개씩 주면 100층에서 10장이 뽑히는데
 * 그건 카드 35장의 3분의 1이라 수집이 하강 한 판에 끝난다. 보스 층으로 묶으면
 * 미니보스 10층마다 3개 = 100층에서 심연석 30개(카드 3장)이고, 네임드 보스
 * (100층)의 20개가 그 위에 얹혀 "깊이가 곧 덱"이 된다.
 *
 * 여기서 `floorKindOf`를 부르지 않고 **종류를 받는다** — 이 파일은 층 규칙
 * (phase/floors)을 모른다. 곱하는 곳이 하나여야 밸런스가 한 곳에 남는다.
 */
export const ABYSS_PER_MINIBOSS = 3;
export const ABYSS_PER_NAMED_BOSS = 20;

export function abyssForFloorClear(
  kind: "minions" | "miniboss" | "boss",
): number {
  if (kind === "boss") return ABYSS_PER_NAMED_BOSS;
  return kind === "miniboss" ? ABYSS_PER_MINIBOSS : 0;
}

/**
 * 보스 층을 깨서 **바로 들어오는** 카드 장수. 잡몹 층은 0이다.
 *
 * ## 왜 심연석 위에 이걸 얹는가
 *
 * 심연석만으로도 카드는 늘어난다 — 단 **뽑기 버튼을 눌러야** 늘어나고, 그
 * 버튼은 강화 시트 안에 있다(`upgradePanel`). 시트를 한 번도 열지 않고
 * 내려가는 사람에게 하강은 카드가 0장인 모드고, 유저 신고가 정확히 그것이었다:
 * "카드, 싱글에서도 모으는 거 맞아? 왜 내려가는데 카드가 안 생겨? PvP에서는
 * 생기던데." 대전은 이기면 **자동으로** 한 장 주므로(`rewardFor`) 두 모드의
 * 체감이 갈렸다.
 *
 * ## 왜 1장이고, 왜 잡몹 층은 0인가
 *
 * `ABYSS_PER_MINIBOSS`의 근거를 그대로 쓴다: 매 층 1장이면 100층에서 100장
 * 이라 35장 카드함이 하강 한 판에 끝난다. 보스 층으로 묶으면 10층마다 1장 =
 * 100층에서 10장이고, 그건 심연석 30개(=뽑기 3장) 위에 얹혀 총 13장이다 —
 * 수집이 진행되지만 끝나지 않는다.
 *
 * **네임드 보스(100층)도 1장이다.** `floorKindOf`가 100층을 `"boss"`로
 * 돌려주므로 `"miniboss"`만 세면 그 층이 조용히 0장이 된다 — "10층마다"라는
 * 약속이 딱 열 번째에서 깨지는 형태다. 심연석은 그 층에서 20개로 뛰지만
 * (`ABYSS_PER_NAMED_BOSS`) 카드는 뛰지 않는다: 뽑기와 달리 이 지급은 재화를
 * 거치지 않아서 장수를 늘리면 위 곡선이 바로 흔들린다.
 */
export const CARDS_PER_BOSS_FLOOR = 1;

export function cardsForFloorClear(
  kind: "minions" | "miniboss" | "boss",
): number {
  return kind === "minions" ? 0 : CARDS_PER_BOSS_FLOOR;
}

/**
 * 뽑을 수 있는가. **`null`(잔고 읽기 실패)은 항상 false** — 모르는 잔고에서
 * 차감하지 않는다(`economyRules.canBuy`와 같은 계약, SAVE-SCHEMA §4-3).
 */
export function canDraw(abyss: number | null): boolean {
  return abyss !== null && Number.isFinite(abyss) && abyss >= DRAW_COST;
}
