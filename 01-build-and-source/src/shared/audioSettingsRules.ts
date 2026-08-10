/**
 * 소리 크기 설정의 순수 규칙 — 단계·저장 형식·라벨.
 *
 * 설계 문서: specs/2026-07-27-ux/04-scene-title.md §6 (설정 팝업)
 *
 * ## 왜 필요했나 (2026-08-07)
 *
 * **소리를 줄일 방법이 하나도 없었다.** `audio.setSfxEnabled()`가 있지만
 * **호출부가 0개**다 — 설정 팝업(§04-6)이 9단계 몫으로 남아 미구현이고,
 * 그 팝업이 유일하게 예정된 입구였다. 마스터 볼륨은 `audio.ts`에 상수로
 * 박혀 있었다(`MASTER_VOLUME = 0.8`).
 *
 * 대전이라면 참을 수 있다. 120초 뒤에 끝나니까. **하강 모드는 4시간을 켜 둔다**
 * (방치형 페이싱 실측: 240분에 518층). 그 사이 `skill_cast`가 분당 47회,
 * `hit`이 분당 140~254회 울리는데 유저가 쓸 수 있는 수단은 탭 음소거뿐이다 —
 * 그건 게임 소리를 끄는 것이 아니라 게임을 무음으로 만드는 것이고, 그러면
 * 층 돌파·보스 등장의 신호도 같이 사라진다.
 *
 * ## 왜 슬라이더가 아닌가
 *
 * §01-7이 "볼륨 슬라이더는 만들지 않는다(YAGNI)"라고 적었고 그 판단은
 * **유지한다** — 슬라이더는 드래그 위젯이 필요하고, 이 게임에 드래그는
 * 강화 시트 하나뿐이라(`SHEET_DRAG_OPEN_PX`) 위젯 하나를 볼륨 때문에 만들게
 * 된다. 대신 **탭마다 도는 단계**로 둔다. 배지 하나에 상태가 보이고
 * (`volumeLabel`) 조작이 한 번의 탭이다 — AUTO 배지와 같은 물건이다.
 *
 * ## 왜 ON/OFF가 아니라 3단계인가
 *
 * §04-6의 그림은 `효과음 [ON]` 토글이다. 껐다/켰다만 있으면 "조금 시끄럽다"의
 * 답이 **완전 무음**이 된다 — 위에 적은 대로 무음은 층 돌파·보스 신호를 같이
 * 잃는다. 중간 단계가 그 손실 없이 피로를 반으로 줄인다. 상태 셋은 배지
 * 라벨로 다 보이므로(`100% / 50% / 무음`) 슬라이더의 복잡도는 오지 않는다.
 *
 * Pixi를 import하지 않는다 — node 테스트에서 그대로 로드된다.
 */

/**
 * 저장 키.
 *
 * 접두사가 `sin.shared.`인 이유: 두 모드가 같은 설정을 본다
 * (docs/SAVE-SCHEMA.md §3 규칙 1 — "두 모드가 공유하는 것을 새로 만들면
 * `sin.shared.`"). 하강에서 소리를 줄이고 대전에 들어갔을 때 다시 커지면
 * 그건 설정이 아니라 모드별 상태다.
 *
 * 기존 `abyss.*` / `abyss-dive.*` 접두사를 쓰지 않는 것도 같은 문서의 규칙이다
 * (그 둘이 갈린 것은 사고로 기록돼 있고, 배포된 값이 있어 통일할 수 없다).
 */
export const AUDIO_STORAGE_KEY = "sin.shared.audio";

/**
 * 소리 크기 단계. **내림차순이 아니라 오름차순으로 적지 않는다** —
 * 탭이 도는 순서 그대로다: 100% → 50% → 무음 → 100%.
 *
 * 왜 이 순서인가: 배지를 누르는 동기는 "시끄럽다"다. 첫 탭이 소리를 **줄여야**
 * 한다. 오름차순이면 첫 탭이 무음(가장 먼 상태)이나 증가로 가서, 줄이려고
 * 누른 사람이 두세 번 더 눌러야 한다.
 *
 * `1`이 첫 항목인 것도 의도다 — 기본값이 지금 출하된 소리와 **같아야** 한다
 * (`audio.MASTER_VOLUME`에 곱해진다). 기본을 0.5로 두면 이 커밋이 조용히
 * 모든 소리를 반으로 줄이는 변경이 된다.
 */
export const VOLUME_STEPS = [1, 0.5, 0] as const;

export type VolumeStep = (typeof VOLUME_STEPS)[number];

/** 기본 단계 — 지금 출하된 소리 크기 */
export const DEFAULT_VOLUME: VolumeStep = 1;

/**
 * 다음 단계 (탭 한 번).
 *
 * 모르는 값이 들어오면 **기본이 아니라 첫 단계**로 간다. 기본으로 접으면
 * 이상한 저장값이 있는 브라우저에서 탭이 제자리를 돌 수 있다(기본 → 기본).
 */
export function nextVolume(current: number): VolumeStep {
  const i = VOLUME_STEPS.findIndex((v) => v === current);
  if (i < 0) return VOLUME_STEPS[0];
  return VOLUME_STEPS[(i + 1) % VOLUME_STEPS.length] ?? VOLUME_STEPS[0];
}

/**
 * 저장값 → 단계.
 *
 * **모르는 값은 기본으로 버린다** (docs/SAVE-SCHEMA.md §2-2). 소리 크기는
 * 취향 데이터라 버려도 게임이 안 깨진다 — 잔고(§4-3)와 다르다.
 *
 * 문자열 비교가 아니라 수로 파싱한 뒤 **단계 목록에 있는지** 묻는다:
 * `"0.7"`처럼 목록에 없는 값이 저장돼 있으면(옛 버전이나 손으로 고친 경우)
 * 배지 라벨이 표시할 수 없는 상태가 된다.
 */
export function parseVolume(raw: string | null | undefined): VolumeStep {
  if (typeof raw !== "string") return DEFAULT_VOLUME;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return DEFAULT_VOLUME;
  const hit = VOLUME_STEPS.find((v) => v === n);
  return hit ?? DEFAULT_VOLUME;
}

export function serializeVolume(v: number): string {
  return String(nearestVolume(v));
}

/**
 * 임의의 수 → 가장 가까운 단계.
 *
 * `parseVolume`과 다르다: 저장값 파싱은 모르는 값을 **버리고**(기본으로),
 * 이쪽은 **접는다**(가장 가까운 단계로). 부르는 곳이 다르다 — 파싱은
 * 남의 데이터를 읽는 것이고, 이쪽은 우리 코드가 만든 값을 정규화한다.
 */
export function nearestVolume(v: number): VolumeStep {
  if (!Number.isFinite(v)) return DEFAULT_VOLUME;
  let best: VolumeStep = VOLUME_STEPS[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const step of VOLUME_STEPS) {
    const d = Math.abs(step - v);
    if (d < bestD) {
      bestD = d;
      best = step;
    }
  }
  return best;
}

/**
 * 배지 라벨 두 줄 — `["소리", "100%"]`.
 *
 * `skillBarRules.autoLabel`과 같은 형태를 쓴다(위 줄 이름 · 아래 줄 상태).
 * 같은 위젯(`createCircleButton`)으로 그려지므로 형태가 갈리면 두 배지가
 * 다른 물건처럼 보인다.
 *
 * 무음을 `0%`가 아니라 `무음`으로 적는 이유: `0%`는 "소리가 0만큼 난다"로
 * 읽혀서 고장인지 설정인지 구별되지 않는다.
 */
export function volumeLabel(v: number): readonly [string, string] {
  const step = nearestVolume(v);
  if (step === 0) return ["소리", "무음"];
  return ["소리", `${Math.round(step * 100)}%`];
}

/**
 * 바뀐 뒤 띄우는 토스트 문구.
 *
 * **무음일 때 이 문구가 특히 필요하다.** 탭 소리는 바뀐 뒤에 나므로
 * (`ui/volumeBadge`) 무음으로 간 탭은 아무 소리도 내지 않는다 — 그게 맞지만,
 * 배지 라벨 두 글자 말고는 반응이 없으면 "배지가 안 먹는다"로 읽힌다.
 * 그래서 화면이 대신 말한다. `autoScopeNotice`와 같은 형태다
 * (`상태 — 그 상태가 무엇을 하는지`).
 *
 * 무음 문구가 **무엇이 남는지** 적는 이유: 층 돌파·보스 신호도 같이 사라진다는
 * 것이 3단계를 만든 이유다(위 "왜 ON/OFF가 아니라 3단계인가"). 끄는 사람이
 * 그 손실을 모르고 끄면 안 된다.
 */
export function volumeNotice(v: number): string {
  const step = nearestVolume(v);
  if (step === 0) return "무음 — 층 돌파·보스 신호도 들리지 않는다";
  return `소리 ${Math.round(step * 100)}%`;
}

/** 무음인가 — 배지 색을 가르는 판정 (AUTO의 `STATE_OFF`와 같은 용도) */
export function isMuted(v: number): boolean {
  return nearestVolume(v) === 0;
}
