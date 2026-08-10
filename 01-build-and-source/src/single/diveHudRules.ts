/**
 * 싱글 HUD 배치·문구의 순수 규칙. `single/diveHud.ts`(Pixi)가 소비한다.
 *
 * PvP의 shared/hud.ts는 두 팀 플레이트·게이지가 전제라 재사용하지 않고
 * (SHARED-API·지도 문서의 권고) ui/ 위젯으로 싱글 HUD를 새로 조립한다.
 * 좌표는 디자인 좌표(720×1280), HUD 밴드는 위 12%(≈154px)다.
 */

import { DESIGN_W, DESIGN_H, HUD_RATIO } from "../shared/viewport";
import { BANNER_GAP_Y, bannerBottomY } from "../shared/ui/bannerRules";
import { HIT_SLACK_PX } from "../shared/ui/skillSlotRules";
import { formatGold } from "../shared/format";
import { STAGE_NAMES, stageOf } from "../core/corruption/corruption";
import { comboGoldMul } from "./sessionRules";

export const HUD_H = DESIGN_H * HUD_RATIO; // 153.6

/** 좌측 열 — 층 숫자(크게), 페이즈 이름, 타락도 줄 */
export const FLOOR_TEXT_X = 24;
export const FLOOR_TEXT_Y = 12;
export const PHASE_TEXT_Y = 76;
export const CORRUPTION_TEXT_Y = 112;

/** 우측 열 — 타이틀 버튼, 골드 필, 콤보 캡션 */
export const TITLE_BTN_W = 132;
export const TITLE_BTN_H = 48;
export const TITLE_BTN_X = DESIGN_W - 24 - TITLE_BTN_W;
export const TITLE_BTN_Y = 10;

export const GOLD_PILL_W = 188;
export const GOLD_PILL_X = DESIGN_W - 24 - GOLD_PILL_W;
export const GOLD_PILL_Y = 66;

/**
 * 타이틀 버튼의 탭 관용이 각 방향으로 쓸 수 있는 빈 거리 (`ui/button.tapRoom`).
 *
 * 이 버튼은 48px이라 §3-4의 최소 탭 타깃(88)에 40px 모자라고, 관용으로 메우면
 * 위아래 20px씩이 필요하다. **아래로는 못 준다** — 골드 필이 8px 아래에 있어서
 * (`GOLD_PILL_Y` 66 vs 버튼 아래 끝 58) 잔고를 누른 손가락이 하강을 끝낸다.
 * 위는 화면 끝(y 0)까지 10px이 비어 있으므로 그만큼만 얻는다.
 *
 * **숫자를 적지 않는다.** 필을 옮기거나 버튼을 키우면 이 값이 따라와야 하고,
 * 손으로 적으면 그때 조용히 이웃을 파고든다. 남는 관용(위 10 + 아래 0 = 10 <
 * 40)은 **여기서 얻을 수 있는 전부**이고, 그 사실을 테스트가 기록한다 — 더
 * 필요하면 답은 관용이 아니라 HUD 밴드의 재배치다.
 */
export const TITLE_BTN_TAP_ROOM = {
  top: TITLE_BTN_Y,
  bottom: GOLD_PILL_Y - (TITLE_BTN_Y + TITLE_BTN_H),
} as const;

/**
 * 심연석 필 (3단계). 골드 필 **왼쪽**에 같은 띠로 놓는다.
 *
 * 아래(콤보 줄)에 두는 안을 접었다 — 콤보 캡션은 콤보가 붙은 동안만 뜨는
 * 가변 요소라, 거기에 상시 표기를 겹치면 콤보가 뜰 때마다 잔고가 가려진다.
 * 아래로 더 내리는 것도 안 된다: 필 높이가 52px이라 y 118 아래는 HUD 밴드
 * (153.6)를 넘는다.
 *
 * **폭이 두 부등식 사이에 갇혀 있다.**
 *
 * 위: 골드 필이 x 508부터고, 왼쪽 열에서 가장 긴 줄(`corruptionLabel(100)` =
 * "타락도 100% · 완전타락", 24px 도트로 264px)의 오른쪽 끝이 288px이다 — 사이
 * 220px에서 간격 12를 빼면 208이 상한이다. 세로로 안 피할 수 있는 부등식이다:
 * 필(66~118)과 타락도 줄(112~136)이 6px 겹친다.
 *
 * 아래: 필의 **글자 자리는 폭이 아니다**(`pillRules.pillTextWidth`) — 왼쪽
 * 아이콘 48px과 라운드 코너 26px을 뺀 나머지다. 처음 152로 잡았더니 글자 자리가
 * 78px뿐이라 "심연석 2,300"(144px)이 `fitText`의 축소 하한(0.75)에도 안 들어가
 * **말줄임**됐다 — 잘린 잔고는 잔고를 못 읽는 것과 같다. 192면 118px이라
 * 축소(0.82)로 온전히 들어간다. 테스트가 이 두 부등식을 다 본다.
 */
export const ABYSS_PILL_W = 192;
export const ABYSS_PILL_GAP = 12;
export const ABYSS_PILL_X = GOLD_PILL_X - ABYSS_PILL_GAP - ABYSS_PILL_W;
export const ABYSS_PILL_Y = GOLD_PILL_Y;

export const COMBO_TEXT_X = DESIGN_W - 24;
export const COMBO_TEXT_Y = 126;

/**
 * 페이즈 이름이 쓸 수 있는 폭.
 *
 * **왜 필요했나 (2026-08-07):** 페이즈 이름은 폭 예산이 없는 맨 `Text`였고,
 * 심연석 필과 **같은 줄**을 쓴다(필 66~118, 이름 y 76). 30층에서 실제로
 * `표층 지각 & 달콤한 환청 지대`의 "지대"가 필 아래로 들어가 사라졌다 —
 * 10개 페이즈 이름 중 가장 긴 둘이 실측 330px인데 여기 예산은 268px이다.
 *
 * 위쪽 `ABYSS_PILL_W` 주석이 폭을 두 부등식으로 유도하면서 **타락도 줄만**
 * 봤다. 페이즈 이름도 같은 가로를 나눠 쓰는데 그 줄이 논증에 없었다 —
 * 그래서 필이 커질 때 아무 검사도 울리지 않았다.
 *
 * 필 자리에서 유도한다(숫자를 적지 않는다): 필이 왼쪽으로 오면 예산이 같이
 * 줄고, 그때 이름은 `fitText`가 축소한다. 330px은 하한(0.75)에서 247.5px이라
 * 말줄임 없이 들어간다.
 */
export const PHASE_TEXT_MAX_W =
  ABYSS_PILL_X - ABYSS_PILL_GAP - FLOOR_TEXT_X;

/**
 * 배너 띠의 위/아래 끝 (디자인 y). 간격 상수는 `shared/ui/bannerRules`가
 * 정본이다 — 씬이 `hudRect.h + 16`으로 들고 있던 16을 거기로 올렸다.
 * 씬은 `BANNER_TOP_Y`를 뷰 y로 쓰고, AUTO 배지는 `BANNER_BOTTOM_Y` 아래에 앉는다.
 */
export const BANNER_TOP_Y = HUD_H + BANNER_GAP_Y;
export const BANNER_BOTTOM_Y = bannerBottomY(HUD_H);

/* ── AUTO 배지 자리 (3단계)
 *
 * 배지가 스킬바 밖으로 나왔다 — 바 안 왼쪽 구역(101px)을 슬롯에 돌려주지
 * 않으면 6번째 칸이 들어갈 폭이 없었다(`skillBarRules.barLayout` 주석).
 * 그래서 **자리는 모드가 정한다.** 바의 기하는 자기 밴드 밖을 모른다.
 *
 * 왜 배너 띠 **아래** 오른쪽인가 — 후보를 하나씩 지운 결과다:
 * - **HUD 안(154px)은 꽉 찼다.** 왼쪽 열(층·페이즈·타락도)과 오른쪽 열(타이틀
 *   132px · 골드 필 188px · 콤보)이 가로를 다 쓴다. 가운데 틈은 있지만 타락도
 *   줄이 `타락도 100% · 완전타락`까지 늘어나는 가변 폭이라, 배지를 거기 놓으면
 *   문구가 길어지는 날 조용히 겹친다.
 * - **강화 줄(953.6~1049.6)도 꽉 찼다** — 4칸 버튼이 화면 폭을 다 쓴다.
 * - **HUD 바로 아래는 배너와 겹친다.** 배너는 전폭 72px이고 169.6~241.6에 뜬다.
 *   1.26초만 떠 있어서 캡처 한 장으로는 안 걸리는 겹침이라 더 위험하다 —
 *   그래서 배너 띠 **아래**로 내리고 그 부등식을 테스트가 잡는다.
 *
 * 남는 곳은 전장의 위쪽 하늘이다. 적은 바닥(`GROUND_RATIO` 0.88)에 서고 키가
 * 필드 높이의 22%라 머리끝이 y 681 — 배지(255.6~338.5)와 안 닿는다.
 *
 * 오른쪽 끝인 이유: 아군이 전장 왼쪽(`ALLY_SLOT_X` 0.13·0.37)에 선다. 왼쪽에
 * 두면 내 캐릭터 머리 위에 얹힌다. */

/** 화면 오른쪽 여백 */
export const AUTO_BADGE_MARGIN_X = 12;

/**
 * 배너 띠 아래와 배지 사이 간격.
 *
 * `HIT_SLACK_PX`에서 나온다 — 배지의 **탭 영역**은 원보다 그만큼 넓으므로
 * (`createCircleButton`의 `hitR`), 눈에 보이는 여백만 맞추면 손가락이 닿는
 * 영역이 배너 아래 끝을 파고든다. 여기에 4px을 더해 원과 띠 사이에 실제로 빈
 * 줄이 보이게 한다.
 */
export const AUTO_BADGE_GAP_Y = HIT_SLACK_PX + 4;

/**
 * AUTO 배지 **중심**의 디자인 좌표. 지름은 바가 정한다
 * (`skillBarRules.autoBadgeD` — 슬롯보다 작아야 하는 관계가 거기 있다).
 */
export function autoBadgePos(badgeD: number): { x: number; y: number } {
  const d = Number.isFinite(badgeD) ? Math.max(0, badgeD) : 0;
  return {
    x: DESIGN_W - AUTO_BADGE_MARGIN_X - d / 2,
    y: BANNER_BOTTOM_Y + AUTO_BADGE_GAP_Y + d / 2,
  };
}

/**
 * 두 배지 사이 간격 — **탭 영역** 사이에 이만큼 남는다.
 *
 * `AUTO_BADGE_GAP_Y`와 같은 유래고 같은 값이다(관용 + 4). 축이 다르다고 값이
 * 달라질 이유가 없으므로 그것을 그대로 쓰되, 이름을 따로 두어 "가로 간격을
 * 세로 상수로 쓰고 있다"는 오해를 없앤다.
 */
export const BADGE_GAP_X = AUTO_BADGE_GAP_Y;

/**
 * 소리 배지 **중심** — AUTO 배지 **왼쪽**, 같은 줄.
 *
 * ## 왜 여기인가 (2026-08-07)
 *
 * 위 AUTO 배지 주석이 후보를 이미 다 지웠다: HUD 안(154px)은 좌우 열이 꽉
 * 찼고, 강화 줄은 4칸 버튼이 폭을 다 쓰고, HUD 바로 아래는 배너와 겹친다.
 * 남은 곳이 전장 오른쪽 하늘이었고 AUTO가 거기 앉았다. 소리 배지도 같은
 * 제약을 받으므로 그 옆이다.
 *
 * 강화 시트에 행으로 넣는 것을 먼저 검토하고 버렸다 — `sheetFits`의 여유가
 * **4px**이라(5행 + 닫기가 예산을 거의 다 쓴다) 행 하나를 얹으면 닫기 버튼이
 * 패널 밖으로 나간다. 그건 "시트를 열면 닫을 수 없다"다
 * (`upgradePanelRules.SHEET_H` 주석). 시트는 또 하강 중에만 열리므로 타이틀·
 * 대전에서는 소리를 못 줄인다.
 *
 * ## 왜 아래가 아니라 옆인가 — 테스트가 뒤집었다
 *
 * 처음 **AUTO 아래**로 잡았다. 싱글에서는 통과한다(적 머리끝 681.6까지
 * 216px 남았다). **대전에서 깨졌다** — `autoBadgePos.test.ts`가 게이지를 다
 * 돌면서 물었고, 게이지 −1(가장 지는 판)에서 우리 필드 아래 끝이 388.8인데
 * 쌓은 배지의 탭 아래 끝이 465.5였다. **상대 필드를 76.7px 파고든다.**
 *
 * 그 자리를 유도할 때 여유를 게이지 0에서 재서(573.6) 108px이 남는다고 적었던
 * 것이 원인이다 — 게이지 0은 최악이 아니라 **중립**이다. AUTO 자신도 그 판에서
 * 40.3px밖에 안 남으므로(348.5 vs 388.8) 아래에는 애초에 배지 한 칸이 안
 * 들어간다. 세로가 막혔으니 가로로 간다: AUTO의 세로 여유를 **그대로 물려받고**
 * (같은 y) 오른쪽 하늘의 남은 폭을 쓴다. 두 모드가 같은 형태다.
 *
 * ## 간격의 유래
 *
 * 두 배지 **탭 영역** 사이에 `BADGE_GAP_X`가 남게 잡는다. 눈에 보이는 원
 * 사이만 맞추면 손가락이 닿는 영역이 겹쳐서, 경계 픽셀의 주인이 그리는 순서로
 * 정해진다 — AUTO를 눌렀는데 소리가 줄어든다
 * (`upgradePanelRules.ROW_BUTTON_TAP_ROOM`이 같은 이유로 간격을 반씩 나눈다).
 * 그래서 `d/2 + 관용 + 간격 + 관용 + d/2`다.
 *
 * ## 왼쪽으로 안 넘치는가
 *
 * 실측: 탭 왼쪽 끝이 x 498.1이다. 아군은 전장 왼쪽(`ALLY_SLOT_X` 0.13·0.37 =
 * x 93.6·266.4)에 서고 적은 지면(머리끝 y 681.6)이라 세로로 갈린다.
 */
export function volumeBadgePos(badgeD: number): { x: number; y: number } {
  const d = Number.isFinite(badgeD) ? Math.max(0, badgeD) : 0;
  const auto = autoBadgePos(d);
  return {
    x: auto.x - (d / 2 + HIT_SLACK_PX + BADGE_GAP_X + HIT_SLACK_PX + d / 2),
    y: auto.y,
  };
}

/** 타락도 줄: "타락도 12% · 일반". 단계 이름은 core가 정본이다 */
export function corruptionLabel(corruption: number): string {
  const c = Math.max(0, Math.min(100, Math.floor(corruption)));
  return `타락도 ${c}% · ${STAGE_NAMES[stageOf(c)]}`;
}

/** 콤보 캡션: 콤보가 없으면 빈 문자열(숨김) */
export function comboLabel(combo: number): string {
  const c = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
  if (c <= 0) return "";
  return `콤보 x${c} · 골드 ${comboGoldMul(c).toFixed(2).replace(/\.?0+$/, "")}배`;
}

/**
 * 골드 필 문구 — 잔고 읽기 실패는 0으로 위장하지 않는다 (SAVE-SCHEMA §4-3).
 *
 * **"잔고 확인 불가"에서 "확인 불가"로 줄였다 (2026-08-07).** 골드 필의 글자
 * 자리는 114px인데(`pillTextWidth(188, 48, 26)`) 그 문구는 실측 164px이라
 * 축소 하한(0.75 = 123px)에도 안 들어가 **`잔고 확인 …`으로 말줄임됐다** —
 * 하필 null과 0을 구분하려고 일부러 만든 문구가 잘려서, 유저에게는 로딩
 * 중처럼 보이고 §4-3의 구분이 화면에서 사라졌다.
 *
 * 심연석 쪽이 이미 같은 이유로 짧은 문구를 쓰고 있었다(`abyssLabel`) —
 * 두 필이 같은 실패를 같은 말로 쓰게 맞춘다. "무엇의" 잔고인지는 필의
 * 아이콘 색이 말한다(금색/자색). 폭을 넓히는 쪽은 못 쓴다: 필 폭은 왼쪽
 * 타락도 줄과의 부등식에 갇혀 있다(`ABYSS_PILL_W` 주석).
 *
 * **수 자체도 잘렸다 (2026-08-07).** 같은 114px에 `3,299,03…`이 찍혔다 —
 * 실패 문구가 아니라 **정상 잔고**가 잘린 것이다. 자리수를 줄이는 것 말고
 * 방법이 없어서 `shared/format.formatGold`(7자리부터 축약)로 넘겼다. 임계값이
 * 왜 100만인지는 그 함수 주석이 이 필의 114px에서 유도한다.
 */
export function goldLabel(gold: number | null): string {
  if (gold === null) return "확인 불가";
  return formatGold(gold);
}

/**
 * 심연석 필 문구.
 *
 * **골드와 같은 실패 표기를 쓰지 않는다** — 두 필이 나란히 있는데 둘 다
 * "잔고 확인 불가"면 어느 재화가 왜 안 읽히는지 알 수 없다(둘은 같은 키에
 * 살므로 실제로 늘 동시에 실패한다). 이쪽은 짧게 "확인 불가"만 적어 폭
 * (152px)에 들어가게 한다.
 *
 * **골드와 달리 수는 축약하지 않는다.** 심연석은 보스 층에서만 나오고 한 번에
 * 3(미니보스)·20(네임드)이라 300층 누적이 141이다 — 세 자리를 안 넘는다.
 * 여기에 축약을 걸면 `10 심연석`짜리 뽑기 비용과 견주는 뺄셈만 흐려진다.
 */
export function abyssLabel(abyss: number | null): string {
  if (abyss === null) return "확인 불가";
  return `심연석 ${Math.max(0, Math.floor(abyss)).toLocaleString("en-US")}`;
}
