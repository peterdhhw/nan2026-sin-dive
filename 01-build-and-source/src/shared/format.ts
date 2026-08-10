/**
 * 화면에 찍는 수치의 문자열 변환.
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §2 (숫자 표기)
 *
 * **알파벳 축약(`1.15A`)은 만들지 않는다.** 레퍼런스가 축약하는 이유는 방치형
 * 인플레인데 우리 수치는 네 자리를 넘지 않는다(데미지 40~650, 게이지 −1~1,
 * 타이머 0:00~2:00). ~~경제 시스템이 붙는 날 다시 넣는다.~~
 *
 * **그 날이 왔다 (2026-08-07).** 위 문장이 센 것은 *전투* 수치이고, 싱글 경제의
 * 골드는 그 전제 밖이다 — 페이싱 시뮬(`tests/singlePacing.test.ts`의
 * `simulate`)로 재 보면 **3분 잔고가 8자리(21,725,377), 10분이 12자리**다.
 * 방치 8시간 복귀만으로도 7자리(100층·골드 Lv.20 → +3,867,900)다.
 * 캡처에서 골드 필이 `3,299,03…`으로 잘렸다 — HUD에서 제일 많이 읽는 숫자다.
 *
 * **폭으로는 못 푼다.** 골드 필의 글자 자리는 114px이고(`pillTextWidth(188, 48, 26)`)
 * 필 폭 188은 왼쪽 타락도 줄과의 부등식에 갇혀 있다(`ABYSS_PILL_W` 주석).
 * 12자리 `755,109,956,697 G`는 24px 도트 폰트로 ~280px다 — 축소 하한(0.75)을
 * 두 배 넘게 뚫는다. 자리수를 줄이는 것 말고 방법이 없다.
 *
 * 그래서 `formatCompact`가 아래에 있다. **`toLocaleString`을 쓰는 자리 전부가
 * 이 함수를 쓴다** — 한 자리만 축약하면 같은 잔고가 화면 두 곳에서 다른 수로
 * 보이고, 그건 잘린 것보다 나쁘다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

/**
 * 남은 시간을 `m:ss`로. HUD 타이머와 결과 화면의 경과 시간이 같은 함수를 쓴다.
 *
 * `ceil`을 쓰는 이유: 남은 시간 표기에서 `floor`면 120000ms가 `1:59`로 보인다.
 * 음수·NaN은 `0:00`으로 접는다 — 타이머가 `NaN:NaN`을 띄우는 사고를 막는다.
 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 게이지 위치를 부호 포함 소수 2자리로.
 *
 * 부호를 항상 붙인다 — `0.42`와 `-0.42`가 나란히 뜨면 자리수가 흔들려서
 * 어느 쪽이 이기고 있는지 순간적으로 안 읽힌다. `+0.42` / `-0.42`로 통일한다.
 * `0`은 `±0.00`이 아니라 `+0.00`으로 쓴다(±는 폰트에 따라 폭이 다르다).
 */
export function formatGauge(pos: number): string {
  const v = Number.isFinite(pos) ? pos : 0;
  const clamped = Math.max(-1, Math.min(1, v));
  // 부호를 뗀 절대값을 먼저 반올림한다. -0.004를 그냥 toFixed하면 "-0.00"이 나온다.
  const abs = Math.abs(clamped).toFixed(2);
  const sign = abs === "0.00" ? "+" : clamped < 0 ? "-" : "+";
  return `${sign}${abs}`;
}

/**
 * 데미지·HP 등 정수 표기. 축약 없이 자리수만 정리한다.
 * 소수점이 뜨면 데미지 숫자의 폭이 흔들리므로 반드시 정수로 접는다.
 */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.round(n)));
}

/**
 * 축약 단위 — 1,000배씩 오른다. 빈 문자열이 1의 자리다.
 *
 * **한글 단위(만·억·조)를 안 쓴다.** 우리 단위는 1,000배 계단이고 한글은
 * 10,000배 계단이라 섞으면 `1234만`처럼 네 자리가 다시 나온다(축약의 목적이
 * 사라진다). K/M/B/T는 방치형 레퍼런스가 공유하는 표기이기도 하다.
 */
export const COMPACT_UNITS = ["", "K", "M", "B", "T", "Q"] as const;

/** 축약을 시작하는 자리 — 이 값 미만은 콤마 표기가 더 정확하고 폭도 든다 */
export const COMPACT_MIN = 1_000_000;

/**
 * 큰 수를 폭 안에 넣는 표기. **6자리까지는 콤마, 7자리부터 축약**한다.
 *
 * `123,456` → `123,456` / `1,234,567` → `1.23M` / `755,109,956,697` → `755B`
 *
 * ## 왜 임계값이 100만인가
 *
 * 폭에서 나온다. 골드 필의 글자 자리는 **114px**이고(`pillTextWidth(188, 48, 26)`),
 * 24px 도트 폰트에서 `999,999 G`는 그 안에 들어간다(캡처 확인: `944,084 G`가
 * 온전히 읽혔다). `3,299,036 G`는 안 들어가 말줄임됐다. 그 사이가 임계값이다.
 *
 * 축약을 더 이르게 걸지 않는 이유: 강화 비용은 `1.14^레벨`로 오르는데 초반
 * 비용이 60~수천 G라, 5자리를 `12.3K`로 쓰면 **비용과 잔고를 견주는 뺄셈이
 * 안 된다**(강화 화면이 하는 일의 전부다). 정확한 수를 최대한 오래 남긴다.
 *
 * ## 유효자리는 3자리로 고정한다
 *
 * `1.23M` / `12.3M` / `123M` — 폭이 5~6글자로 고정되고, 앞자리 셋이 남으므로
 * "지금 뭘 살 수 있나"가 여전히 읽힌다. 소수 자리수를 안 고정하면 `1.2M`과
 * `123.456M`이 같은 필에 번갈아 들어와 글자 폭이 흔들린다.
 *
 * 소수부 꼬리 0은 지운다(`1.00M` → `1M`) — 자리수 흔들림보다 거짓 정밀도가
 * 더 나쁘다.
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Math.max(0, Math.floor(n));
  if (v < COMPACT_MIN) return v.toLocaleString("en-US");

  // 1,000배 계단에서 몇 번째 단위인가. 마지막 단위를 넘으면 그 단위에 눌러둔다
  // (`Q`를 넘는 값은 자리수가 다시 늘지만, 거기까지 가는 경로가 없다 —
  //  9,999층 최종 층의 잡몹 골드로도 15자리다).
  let tier = Math.floor(Math.log10(v) / 3);
  tier = Math.min(tier, COMPACT_UNITS.length - 1);
  const unit = COMPACT_UNITS[tier] as string;
  const scaled = v / Math.pow(1000, tier);

  // 유효자리 3 — 정수부 자리수만큼 소수 자리를 뺀다
  const intDigits = Math.floor(Math.log10(scaled)) + 1;
  const decimals = Math.max(0, 3 - intDigits);
  const text = scaled.toFixed(decimals).replace(/\.?0+$/, "");
  return `${text}${unit}`;
}

/** 골드 표기 — 수와 단위를 한 곳에서 붙인다 (`1.23M G`) */
export function formatGold(n: number): string {
  return `${formatCompact(n)} G`;
}
