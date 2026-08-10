/**
 * 대전 화면의 AUTO 배지 자리 — 순수 규칙. `pvp/session.ts`가 소비한다.
 *
 * ## 왜 모드마다 파일이 하나씩 있는가 (3단계 결정 기록)
 *
 * 배지가 스킬바 **밖으로** 나왔다. 바 안 왼쪽 구역(101px)을 슬롯에 돌려주지
 * 않으면 6번째 칸이 들어갈 폭이 없었다(`shared/skillBarRules.barLayout` 주석).
 * 나온 뒤의 자리는 바가 정할 수 없다 — 바의 기하는 자기 밴드 밖에 무엇이
 * 있는지 모른다. 그래서 `barLayout`은 지름(`autoBadgeD`)만 주고 **자리는 모드가
 * 정한다.** 싱글은 `single/diveHudRules.autoBadgePos`, 대전은 이 파일이다.
 *
 * 씬에 좌표를 인라인으로 적지 않는 이유도 같다: 이웃 위젯과 겹치는지를 node
 * 테스트가 물어야 한다. 겹침은 화면이 안 죽으므로 캡처를 열기 전까지 조용하다.
 *
 * ## 왜 이 자리인가 — 후보를 하나씩 지운 결과다
 *
 * 대전 HUD 밴드(높이 h×0.12 = 153.6)는 가로가 이미 꽉 차 있다:
 * 팀 플레이트 200px 두 장이 좌우 끝(12, 508)에 붙고, 가운데는 타이머
 * (`T_NUM_L` 36px, 중앙 정렬)와 그 아래 게이지 수치가 쓰고, 밴드 아래쪽에는
 * 웨이브 레일(폭 w×0.62, 높이 60)이 중앙에 앉는다. `?debug=1`의 dps 표기는
 * 오른쪽 끝(w−12, y 78)이다.
 *
 * - **HUD 안은 못 쓴다** — 위 넷 중 어디에 놓아도 하나를 덮는다.
 * - **스킬바 위(하단)는 게이지 바가 움직인다.** 게이지 위치에 따라 상/하 필드
 *   경계가 `RATIO_MIN 0.28 ~ RATIO_MAX 0.72` 사이를 오간다 — 고정 y를 잡으면
 *   이기는 판과 지는 판에서 배지가 다른 것 위에 얹힌다.
 * - **상대 필드(하단)에는 절대 못 놓는다.** 배지는 내 것이다.
 * - **HUD 바로 아래도 못 쓴다** — 전폭 배너(72px)가 거기 뜬다. 1.26초만 떠
 *   있으므로 그 겹침은 캡처 한 장으로 안 잡힌다. 그래서 배너 띠
 *   (`bannerBottomY`) **아래**로 내리고 부등식을 테스트가 잡는다.
 *
 * 남는 곳은 **우리 필드(상단)의 오른쪽 위 구석**이다. 우리 캐릭터는 필드 왼쪽
 * (`ALLY_SLOT_X` 0.13·0.37)에 서고 적은 오른쪽 바닥에 선다 — 오른쪽 위는
 * 하늘이다. 그리고 이 자리는 **HUD 높이에서만** 나오므로 게이지가 어디에 있어도
 * (HUD는 고정 높이다) 배지가 움직이지 않는다.
 */

import { DESIGN_W } from "../shared/viewport";
import type { SplitRect } from "../shared/viewport";
import { bannerBottomY } from "../shared/ui/bannerRules";
import { HIT_SLACK_PX } from "../shared/ui/skillSlotRules";

/** 화면 오른쪽 여백 — 싱글과 같은 값을 쓴다(두 모드에서 같은 위젯으로 읽혀야 한다) */
export const AUTO_BADGE_MARGIN_X = 12;

/** 배너 띠 아래와 배지 사이 간격 — 싱글과 같은 유래(탭 관용 + 4px) */
export const AUTO_BADGE_GAP_Y = HIT_SLACK_PX + 4;

/**
 * AUTO 배지 **중심**의 디자인 좌표.
 *
 * `hud`를 인자로 받는다 — HUD 높이는 `computeSplit`이 정하고(h×0.12) 이 파일이
 * 그 값을 다시 계산하면 두 곳이 갈린다. 지름은 바가 정한다
 * (`shared/skillBarRules.autoBadgeD`).
 */
export function autoBadgePos(
  hud: SplitRect,
  badgeD: number,
): { x: number; y: number } {
  const d = Number.isFinite(badgeD) ? Math.max(0, badgeD) : 0;
  const hudBottom = hud.y + hud.h;
  return {
    x: DESIGN_W - AUTO_BADGE_MARGIN_X - d / 2,
    y: bannerBottomY(Number.isFinite(hudBottom) ? hudBottom : 0) +
      AUTO_BADGE_GAP_Y +
      d / 2,
  };
}

/**
 * 소리 배지 **중심** — AUTO 배지 **왼쪽**, 같은 줄 (2026-08-07).
 *
 * 위 "후보를 하나씩 지운 결과"가 그대로 적용된다: HUD 안은 넷 중 하나를 덮고,
 * 스킬바 위는 게이지가 움직이고, 상대 필드는 내 것이 아니고, HUD 바로 아래는
 * 배너다. 남은 곳이 우리 필드 오른쪽 위 하늘이고 AUTO가 거기 있으므로 그 옆이다.
 * 싱글도 같은 형태다(`single/diveHudRules.volumeBadgePos`).
 *
 * ## 아래로 쌓는 안을 테스트가 죽였다
 *
 * AUTO 아래에 세로로 쌓는 것이 첫 안이었고 **이 모드에서 깨졌다.** 상단 필드는
 * 게이지에 따라 줄어드는데, 그 여유를 게이지 0에서 재서 "108px 남는다"고 적어
 * 뒀다 — 게이지 0은 최악이 아니라 **중립**이다. 진짜 최악은 −1(가장 지는 판)로
 * 상단 필드 아래 끝이 **388.8**이고, 쌓은 배지의 탭 아래 끝은 465.5였다:
 * 상대 필드를 76.7px 파고든다. 배지는 내 것이므로 그건 못 쓴다.
 *
 * AUTO 자신도 그 판에서 40.3px만 남기므로(348.5 vs 388.8) 아래에는 배지 한
 * 칸이 애초에 안 들어간다. 그래서 가로로 간다 — **y를 AUTO와 같게 두면**
 * AUTO가 이미 증명한 세로 여유(모든 게이지에서 우리 필드 안)를 그대로 물려받고,
 * 게이지가 움직여도 안 움직이는 성질도 같이 온다.
 *
 * 가로 폭은 남는다: 오른쪽 여백 12 + 배지 두 개(82.94×2) + 간격이 260px이라
 * 화면 720px 안에서 왼쪽에 458px이 비고, 우리 캐릭터는 그쪽 끝
 * (`ALLY_SLOT_X` 0.13·0.37 = x 93.6·266.4)에 선다.
 *
 * 간격의 유래는 싱글과 같다 — 두 **탭 영역** 사이가 `AUTO_BADGE_GAP_Y`다.
 * 원 사이만 맞추면 탭 영역이 겹쳐서 AUTO를 눌렀는데 소리가 줄어든다.
 */
export function volumeBadgePos(
  hud: SplitRect,
  badgeD: number,
): { x: number; y: number } {
  const d = Number.isFinite(badgeD) ? Math.max(0, badgeD) : 0;
  const auto = autoBadgePos(hud, d);
  return {
    x: auto.x - (d / 2 + HIT_SLACK_PX + AUTO_BADGE_GAP_Y + HIT_SLACK_PX + d / 2),
    y: auto.y,
  };
}
