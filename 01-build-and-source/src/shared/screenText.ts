/**
 * 화면 문구의 순수 규칙 — **모드와 무관한 것만** 남았다.
 *
 * 매칭·승패 문구는 `pvp/matchText.ts`로 나갔다. 그것들은 `SessionResult`
 * (= PvP 세션의 결과 모양)를 인자로 받는데, 공용 모듈이 `pvp/session`을
 * 타입으로라도 import하면 싱글이 PvP를 통째로 물려받는다. 싱글의 "결과"는
 * 승/패가 아니라 도달 층·타락도이므로 문구를 공유할 것도 없다.
 *
 * `screens.ts`가 pixi를 import하므로 순수 문구는 여기 있다 —
 * node 테스트가 이 파일을 그대로 불러온다.
 */

/** 층 이름 (§06-3 / §08-2). 테마 2종만 있다 (§01-1-3) */
export function floorName(themeId: "surface" | "abyss"): string {
  return themeId === "abyss" ? "심연 균열" : "지상 숲";
}

/** VS 인트로·결과의 층 표기 — 웨이브 번호는 1-based로 받는다 */
export function floorLabel(
  waveNumber: number,
  themeId: "surface" | "abyss",
): string {
  const n = Number.isFinite(waveNumber)
    ? Math.max(1, Math.floor(waveNumber))
    : 1;
  return `제 ${n} 층 · ${floorName(themeId)}`;
}

/** 상태 스트립 (§05-2). 연결 여부를 숨기지 않는다 — 키 만료(2026-08-25) 대비 */
export function serverStatusText(
  connected: boolean,
  humanCount: number,
): string {
  if (!connected) return "오프라인 — AI 대전으로 진행";
  const n = Math.max(
    0,
    Number.isFinite(humanCount) ? Math.floor(humanCount) : 0,
  );
  return `대전 서버 연결됨 · ${n}명`;
}
