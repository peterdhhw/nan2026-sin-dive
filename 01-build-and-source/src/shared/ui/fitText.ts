import type { Text } from "pixi.js";
import { FIT_MIN_SCALE } from "./fitTextRules";

// 하한은 순수 쌍둥이가 정본이다 — 폭 예산 테스트가 그 값을 읽어야 한다
export { FIT_MIN_SCALE } from "./fitTextRules";

/**
 * 칸 안에 **이름을 온전히** 남긴다 — 줄바꿈 먼저, 안 되면 축소, 최후에 말줄임.
 *
 * `fitText`와 갈라놓은 이유: 카드 이름은 한 줄이 자연스럽지만 스킬 이름은
 * `조류 가르기`·`타락의 사슬`처럼 두 단어라 접으면 그냥 다 읽힌다. 폭만 줄이면
 * 24px 두 단어가 축소 하한(0.75)에 걸려 5칸 중 3개가 `조류 가…`로 잘렸다
 * (캡처로 확인). 순서가 뒤바뀌면 안 된다 — 잘린 이름은 어떤 스킬인지 모른다.
 *
 * 높이를 받는 이유는 접을 자리가 있을 때만 접어야 하기 때문이다. 두 줄이
 * 바 밖으로 나가면 아랫줄이 화면에서 사라져 잘린 것과 똑같아진다.
 */
export function fitLabel(
  t: Text,
  maxW: number,
  maxH: number,
  minScale = FIT_MIN_SCALE,
): void {
  t.scale.set(1);
  t.style.wordWrap = true;
  t.style.wordWrapWidth = maxW;
  t.style.align = "center";
  // 접기만으로 들어가면 축소도 자르기도 하지 않는다
  if (t.width <= maxW && t.height <= maxH) return;
  // 한 단어가 칸보다 넓거나 줄 수가 너무 많다 — 폭·높이 둘 다 맞는 배율로 줄인다
  const k = Math.min(maxW / Math.max(1, t.width), maxH / Math.max(1, t.height));
  if (k >= minScale) {
    t.scale.set(k);
    return;
  }
  // 그래도 안 들어간다 — 한 줄로 되돌려 말줄임한다. 두 줄로 잘린 이름보다
  // 한 줄 말줄임이 읽기 쉽다(아랫줄이 반쯤 보이는 상태가 가장 나쁘다)
  t.style.wordWrap = false;
  fitText(t, maxW, minScale);
}

/**
 * 정해진 폭에 글자를 맞춘다 — 축소 먼저, 그래도 넘치면 말줄임 (§05-7-1).
 *
 * **왜 `ui/`에 있나**: 원래 `scenes/common.ts`에 있었고 매칭·결과 씬만 썼다.
 * 그런데 위젯(`ui/skillSlot`)도 같은 규칙이 필요해졌고, 위젯이 씬을 import하면
 * 방향이 거꾸로다(씬이 위젯을 쓴다). 위젯 쪽으로 내리고 `scenes/common.ts`가
 * 다시 export한다 — 복사하면 한쪽만 고쳐질 것이고, 그건 "어떤 화면에서는
 * 이름이 잘리고 어떤 화면에서는 안 잘린다"로 나타난다.
 *
 * **축소를 먼저 하는 이유**: 먼저 자르면 `플레이어 B`가 `플레…`가 되어 누구인지
 * 알 수 없다. 도트 폰트라 축소가 반 픽셀을 만들지만, 이름이 안 읽히는 것보다
 * 낫다 — 실제 잘림 사고는 5슬롯 스킬바에서 났다(라벨 다섯 개가 이어 붙어
 * `물살 베기조류 가르기심해 세례…` 한 줄로 읽혔다).
 *
 * **폰트가 도착한 뒤에 불러야 한다.** `t.width`를 재는 함수라, 폴백 폰트로
 * 측정하면 잘못된 배율이 그대로 굳는다 (`fontReady.ts`의 게이트가 `main.ts`에서
 * 모든 `Text` 생성보다 앞에 있다).
 */
export function fitText(t: Text, maxW: number, minScale = FIT_MIN_SCALE): void {
  t.scale.set(1);
  if (t.width <= maxW || t.width === 0) return;
  const k = maxW / t.width;
  if (k >= minScale) {
    t.scale.set(k);
    return;
  }
  t.scale.set(minScale);
  const raw = t.text;
  let cut = raw.length;
  while (cut > 1 && t.width > maxW) {
    cut -= 1;
    t.text = `${raw.slice(0, cut)}…`;
  }
}
