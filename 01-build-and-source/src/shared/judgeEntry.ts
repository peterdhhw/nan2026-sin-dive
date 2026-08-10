/**
 * 심사자용 진입 해제 — **프로덕션에서도 동작하는** 유일한 URL 파라미터.
 *
 * **왜 `debugEntry`가 아닌가**: 그쪽은 `import.meta.env.DEV`가 아니면 전부
 * 무시한다("URL로 게이지를 조작할 수 있으면 그건 디버그가 아니라 치트다").
 * 그 판단은 지금도 맞다 — 그래서 게이지·웨이브·매칭 대기는 여기 없다.
 *
 * **왜 그런데도 필요한가**: 대전이 싱글 100층에 잠겨 있다(`pvpUnlocked`).
 * 심사자는 10분을 들여 100층을 내려간 뒤에야 PvP를 볼 수 있는데, 제출물
 * 심사에서 그 10분은 "대전을 못 봤다"로 끝날 수 있다. 잠금을 없애는 대신
 * **잠금을 여는 링크를 문서에 적는다**(소개서 §1 표 · §3-5 6번 · §4-5).
 *
 * **적는 것까지가 이 파일의 일이다 (2026-08-07).** 구현은 처음부터 있었는데
 * 소개서 어디에도 링크가 없었다 — 심사자가 알 방법이 없으면 없는 기능이다.
 * 위 세 자리는 심사자가 실제로 지나는 순서(요약표 → 첫 5분 → 실행 방법)다.
 *
 * 이것이 치트가 아닌 이유는 **주는 것이 진행도가 아니라 입구**라는 점이다.
 * 층수·강화·골드는 그대로 저장값을 쓴다 — 해제 링크로 들어간 심사자는 1층
 * 캐릭터로 대전에 들어가고, 그건 불리하지만 정직하다. 게이지를 옮기거나
 * 저장값을 조작하는 파라미터는 여기 두지 않는다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

/** 해제 파라미터 이름. 값은 `pvp` 하나뿐이다 */
export const JUDGE_UNLOCK_KEY = "unlock";
export const JUDGE_UNLOCK_PVP = "pvp";

export interface JudgeEntry {
  /**
   * 대전 잠금을 무시하는가 (`?unlock=pvp`).
   *
   * **`true`가 주는 것은 입구뿐이다** — 진행도는 그대로다.
   */
  pvp: boolean;
}

export const NO_JUDGE: JudgeEntry = { pvp: false };

/**
 * 쿼리 문자열 → 심사자 해제값. **`enabled` 인자가 없다** — 프로덕션에서도
 * 동작하는 것이 이 함수의 존재 이유다.
 *
 * 값 비교는 대소문자·공백을 접는다. 링크를 문서에서 복사해 올 때 흔한 실수로
 * 해제가 조용히 안 되면, 심사자는 잠긴 버튼을 보고 "버그"라고 적는다.
 */
export function parseJudgeEntry(search: string): JudgeEntry {
  const raw = new URLSearchParams(search).get(JUDGE_UNLOCK_KEY);
  if (raw === null) return NO_JUDGE;
  return { pvp: raw.trim().toLowerCase() === JUDGE_UNLOCK_PVP };
}
