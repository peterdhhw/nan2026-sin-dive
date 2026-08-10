/**
 * 싱글 스토리 연출의 순수 규칙 — 문구·발화 시점·분기 판정.
 * `single/storyOverlay.ts`(Pixi)와 세션이 소비한다.
 *
 * 원전: 기획서(SIN DIVE 마스터 명세) §5 — 프롤로그 3씬, NPC(알베르트),
 * 100층 단위 보스, 듀얼 엔딩. 사전과제 범위는 그중 "화면에 보이는 최소한":
 * 프롤로그 1회, 보스 등장 배너, 심연의 선택, 엔딩 분기.
 *
 * ## 기획서와 다른 결정 (2026-08-03 정호)
 *
 * - 기획서는 '심연의 선택' 첫 등장을 300층으로 두지만, 데모 페이스(심사자
 *   플레이 5~10분)에서는 300층 전에 세션이 끝난다. **매 50층 보스 클리어마다
 *   제안**하는 것으로 당긴다(`sessionRules.CHOICE_EVERY`) — 튜토리얼 서사는
 *   첫 제안에 붙는다.
 *   - 처음엔 100층(네임드 보스)마다였다. 그러면 대전 해금 층(100)까지 제안이 한
 *     번이라 6번째 스킬 칸이 대전에 도달 불가였다 — 유도는 `sessionRules.ts`의
 *     `CHOICE_EVERY` 주석에 있다 (2026-08-06).
 * - 엔딩 분기 조건(기획서 미정): **타락도 70%(타락 단계) 이상 = B(심연의
 *   여신), 미만 = A(성녀의 속죄)**로 정한다. 깊이만으로는 60%가 상한이라
 *   (corruption.ts), B 엔딩은 반드시 유저의 '수용' 선택이 쌓여야 나온다.
 */

import { phaseInfoOf } from "../core/phase/floors";
import { formatGold } from "../shared/format";

/** localStorage(sin.single.story)에 남는 "한 번 보면 끝" 연출 id */
export const STORY_PROLOGUE_ID = "prologue";
export const STORY_ENDING_ID = "ending";

/** 프롤로그 — 알베르트 브리핑 3줄 (기획서 §5.1 요약) */
export const PROLOGUE_LINES: readonly string[] = [
  "[알베르트] 지하 9,999층 '제로 프론티어'.\n인류가 남긴 마지막 봉인이 흔들리고 있다.",
  "[알베르트] 내려가라. 제1코어를 회수하면\n지상은 구원받는다… 공식적으로는 그렇다.",
  "[알베르트] 명심해라. 심연은 내려가는 자를 바꾼다.\n강해질수록, 너는 네가 아니게 된다.",
];

/** 네임드 보스 이름 — 기획서 §5.4의 고정 4수문장 + 페이즈 이름 기반의 나머지 */
export function bossNameOf(floor: number): string {
  const named: Record<number, string> = {
    100: "녹슨 파수꾼 코어",
    1000: "표층 수문장 가르간튜아",
    5000: "몽마의 군주 아스모데우스",
    9900: "제로 수호사도 메타트론",
  };
  const exact = named[floor];
  if (exact !== undefined) return exact;
  return `${phaseInfoOf(floor).name}의 수문장`;
}

/** 보스 등장 배너 문구 (배너는 매번 — 보스가 나오는 것 자체가 정보다) */
export function bossIntroLine(floor: number): string {
  return `${floor}F — ${bossNameOf(floor)}`;
}

/** 미니보스 등장 배너 문구 */
export function minibossIntroLine(floor: number): string {
  return `${floor}F — 심연의 파수병`;
}

/** '심연의 선택' 모달 문구 */
export const CHOICE_TITLE = "심연의 선택";
export const CHOICE_BODY =
  "보스가 남긴 심연의 마력이 스며든다.\n받아들이면 강해지지만, 타락도가 오른다.";
/** 첫 제안에만 붙는 튜토리얼 한 줄 (기획서 §5.1 Scene 3의 이식) */
export const CHOICE_TUTORIAL_HINT = "타락도가 오르면 공격력이 함께 오른다 — 대가는 나중에 온다.";
export const CHOICE_ACCEPT_LABEL = "수용한다 (+10 타락)";
export const CHOICE_REFUSE_LABEL = "거부한다";
export const CHOICE_ACCEPT_TOAST = "심연의 마력을 받아들였다";
export const CHOICE_REFUSE_TOAST = "정신을 지켜냈다";

/** 엔딩 분기 — 타락도 70%(타락 단계) 이상이면 B(심연의 여신) */
export const ENDING_B_CORRUPTION = 70;

export type EndingId = "A" | "B";

export function endingOf(corruption: number): EndingId {
  return corruption >= ENDING_B_CORRUPTION ? "B" : "A";
}

export function endingTitle(ending: EndingId): string {
  return ending === "A" ? "엔딩 A — 성녀의 속죄" : "엔딩 B — 심연의 여신";
}

export function endingBody(ending: EndingId): string {
  return ending === "A"
    ? "타락의 마력을 극한까지 제어한 그녀는\n제1코어의 폭주를 정화하고,\n스스로를 심연 깊은 곳에 봉인했다.\n\n지상은 그녀의 이름을 기억하지 못한다."
    : "그녀는 제1코어와 융합했다.\n심연도, 지상도, 이제 그녀의 것이다.\n\n구원은 왔다 — 그녀가 정의한 방식으로.";
}

/**
 * 방치 보상 토스트: "자리 비운 사이 — 37층 하강 · 12,400 G"
 *
 * **골드 필과 같은 표기를 쓴다 (2026-08-07).** 이 토스트가 말하는 수는 곧
 * 필에 더해질 그 수다 — 여기서 `3,867,900`, 필에서 `3.86M`이면 유저가 두 수를
 * 맞춰 볼 방법이 없다. 8시간 방치 보상은 실측 7자리라(100층·골드 Lv.20)
 * 축약 임계값을 실제로 넘는 몇 안 되는 자리다.
 */
export function idleRewardToast(fromFloor: number, toFloor: number, gold: number): string {
  const floors = Math.max(0, toFloor - fromFloor);
  const goldText = formatGold(gold);
  if (floors <= 0) return `자리 비운 사이 — ${goldText} 획득`;
  return `자리 비운 사이 — ${floors}층 하강 · ${goldText}`;
}
