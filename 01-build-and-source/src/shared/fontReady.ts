import { CanvasTextMetrics } from "pixi.js";
import { FONT_PX_GRID } from "./theme";

/**
 * 도트 폰트가 도착할 때까지 막는 문 — **첫 `Text`보다 먼저 지나야 한다.**
 *
 * ## 왜 이게 필요한가 (실측한 버그)
 *
 * HUD의 `우리 팀`이 `누리 팀`으로 찍혔다 — 글리프마다 **첫 픽셀 행이 없었다**.
 * 폰트 파일도, 브라우저도 멀쩡했다(맨 캔버스에 그리면 온전하다). 범인은 Pixi의
 * 폰트 메트릭 캐시다:
 *
 * `CanvasTextMetrics.measureFont()`는 `_fonts[fontString]`에 어센트·디센트를
 * 캐시한다. 웹폰트가 도착하기 **전에** `Text`를 하나라도 만들면 그 순간의
 * **폴백 폰트**(monospace) 수치가 `"...Galmuri11..."` 키로 캐시되고, 폰트가
 * 나중에 도착해도 그 값이 계속 쓰인다. 글자를 그리는 캔버스 높이는 그 캐시된
 * 수치로 잡히므로, 실제 Galmuri 글리프가 캔버스보다 크면 위가 잘려 나간다.
 *
 * 24px/weight 800에서 잰 값:
 *
 * | 시점 | ascent | descent | fontSize | 결과 |
 * | --- | --- | --- | --- | --- |
 * | 폰트 도착 전 (폴백) | 20 | 7 | 27 | `누리 팀` — 첫 행 잘림 |
 * | 도착 후, 캐시 그대로 | 20 | 7 | 27 | `누리 팀` — 여전히 잘림 |
 * | 캐시 비운 뒤 (진짜 Galmuri) | 28 | 4 | 32 | `우리 팀` — 온전 |
 *
 * 잘린 쪽은 픽셀 행이 홀수로 섞이고(리샘플됨), 온전한 쪽은 모든 행이 2개씩
 * 짝을 이룬다 — 12px 격자를 24px로 띄운 정확한 2배다. 즉 이 버그는 글자 하나가
 * 깨지는 문제가 아니라 **도트 격자 자체가 무너지는** 문제였다.
 *
 * ## 왜 나중에 `clearMetrics()`로 고치지 않는가
 *
 * `clearMetrics()`는 `_fonts`만 비우고 `_measurementCache`(문자열별 측정
 * 결과, LRU 1000개)는 **일부러 남긴다**. 이미 측정된 문자열은 낡은 수치를 계속
 * 들고 있으므로, 사후 비우기는 그때까지 찍힌 텍스트만 우연히 고친다. 애초에
 * 폴백으로 재지 않게 막는 것이 유일하게 확실한 방법이다.
 */

/** 파일로 싣는 굵기 — 도트 폰트라 합성 볼드를 쓰지 않는다 (index.html 참조) */
const WEIGHTS = [400, 700] as const;

/** 한 번만 돈다. 여러 진입점(부팅 씬·갤러리)이 같은 약속을 기다린다 */
let pending: Promise<void> | null = null;

async function loadAll(): Promise<void> {
  if (typeof document.fonts?.load !== "function") return;
  await Promise.all(
    // 크기는 어느 얼굴을 받을지에 영향이 없다(Galmuri에 size range가 없다).
    // 그래도 격자 크기를 쓴다 — 다음 사람이 복사하는 예시가 되므로
    WEIGHTS.map((w) =>
      document.fonts.load(`${w} ${FONT_PX_GRID * 2}px "Galmuri11"`),
    ),
  );
  // `load()`가 끝나도 폰트셋 전체가 정착했는지는 별개다 — 여기까지 기다려야
  // 첫 측정이 진짜 Galmuri를 본다
  await document.fonts.ready;
}

/**
 * 폰트를 받고, 혹시 이미 오염된 메트릭 캐시가 있으면 비운다.
 *
 * 캐시 비우기는 **보험이다** — 이 함수가 첫 `Text`보다 먼저 불렸다면 비울 것이
 * 없다. 그래도 지우는 이유는 진입점이 여러 개라(디버그 직행·갤러리·부팅) 어느
 * 경로가 먼저 텍스트를 만드는지가 앞으로 바뀔 수 있기 때문이다.
 */
export function ensureFontsReady(): Promise<void> {
  pending ??= loadAll().then(
    () => {
      CanvasTextMetrics.clearMetrics();
    },
    (err: unknown) => {
      // 폰트 없이도 게임은 굴러가야 한다 (§03-3) — 폴백으로 찍히고 끝이다
      console.warn("[font] Galmuri11 로드 실패, 폴백으로 진행한다", err);
    },
  );
  return pending;
}
