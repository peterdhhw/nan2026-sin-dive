/**
 * BGM의 순수 규칙 — 게인 상한·페이드·가청 판정.
 *
 * ## 왜 이 파일이 있는가
 *
 * 이 규칙의 실패는 **전부 소리로만 나타난다.** 게인이 상한을 넘으면 타격음이
 * 음악에 묻히고(층 돌파·보스 신호가 사라진다), 페이드가 0이면 루프마다 클릭이
 * 나고, 가청 판정이 뒤집히면 무음 설정에서 음악이 흐른다 — 셋 다 화면이 안
 * 죽고 테스트도 안 울린다. 그래서 **값 자체**를 node가 묻는다.
 *
 * 게인의 유래는 실측이다 (`src/shared/bgmRules.ts`의 표, `tools/measure_bgm_gain.py`가
 * 만든다). 그 실측을 여기서 다시 하지는 않는다(ffmpeg·numpy가 필요하다) — 대신
 * **결론이 코드에 남아 있는지**를 지킨다.
 *
 * ## 이 파일이 한 번 통과하면서 틀렸다 (2026-08-07)
 *
 * 처음 버전은 상한만 물었다: "게인이 상한 아래", "상한에서 20% 여유". 게인
 * 0.22가 그 둘을 다 통과했고 **배포본에서 BGM이 안 들렸다**(−35.4 LUFS).
 * 상한만 있는 조건은 **0도 통과시킨다** — 무음이 가장 안전한 답이 된다.
 *
 * 그래서 지금은 하한(`bgmGainFloor`)을 같이 묻는다. 교훈은 게인에 국한되지
 * 않는다: **한쪽만 조이는 부등식은 반대쪽 극단을 정답으로 만든다.**
 *
 * ## 트랙이 둘이 된 뒤 (2026-08-08)
 *
 * 상한·하한이 **트랙마다 다르다.** 그래서 검사도 트랙마다 돈다 — 두 곡을 한
 * 테스트로 묶거나 평균을 재면 한쪽의 위반이 가려진다
 * (`symmetric-metrics-never-average`). `it.each`라 실패 메시지에 어느 트랙인지 남는다.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BGM_BED_MIN_LUFS,
  BGM_FADE_IN_MS,
  BGM_FADE_OUT_MS,
  BGM_MASK_BED_DBFS,
  BGM_TRACKS,
  type BgmTrack,
  bedDbfs,
  bedLufs,
  bgmAudible,
  bgmGainCeiling,
  bgmGainFloor,
} from "../src/shared/bgmRules";
import { SFX_VOLUME } from "../src/shared/audioRules";

const TRACK_IDS = Object.keys(BGM_TRACKS) as BgmTrack[];

describe("게인 — 양쪽에서 조인다", () => {
  /**
   * **상한을 넘으면 신호 효과음이 묻힌다.** 트랙마다 자기 상한으로 묻는다 —
   * 실측으로 dive의 0.44를 타이틀에 쓰면 마스킹 한계를 2.27dB 넘는데, 상한을
   * 상수 하나로 묻던 옛 형태에서는 그 상태가 **전부 통과했다**.
   */
  it.each(TRACK_IDS)("[%s] 게인이 자기 상한 아래다", (id) => {
    const t = BGM_TRACKS[id];
    expect(t.gain).toBeLessThanOrEqual(bgmGainCeiling(t.bedUnityDbfs));
  });

  /**
   * ★ **하한을 밑돌면 안 들린다.** 이 테스트가 없어서 0.22가 통과했고 배포본에서
   * BGM이 −35.4 LUFS로 사라졌다. 상한만 묻는 조건은 0도 통과시킨다.
   */
  it.each(TRACK_IDS)("[%s] 게인이 자기 하한 위다 — 들려야 넣은 값을 한다", (id) => {
    const t = BGM_TRACKS[id];
    expect(t.gain).toBeGreaterThanOrEqual(bgmGainFloor(t.sourceLufs));
  });

  /**
   * **두 경계가 뒤집히면 게인으로 풀 수 없다.** 곡을 바꾸면 실제로 그럴 수 있고
   * (후보였던 `Ossuary 6 - Air`에서 일어났다 — 그래서 탈락했다), 그때 필요한 것은
   * 상수 조정이 아니라 곡·믹스 교체다. 조용히 "상한 < 하한"인 상태로 남으면
   * 어느 값을 넣어도 한쪽을 위반하면서 테스트만 통과한다.
   */
  it.each(TRACK_IDS)("[%s] 겹치는 구간이 존재한다", (id) => {
    const t = BGM_TRACKS[id];
    expect(bgmGainFloor(t.sourceLufs)).toBeLessThan(bgmGainCeiling(t.bedUnityDbfs));
  });

  /**
   * ★ **하한이 실측에서 유도된 값인지 다시 계산한다.**
   *
   * 하한 함수가 상수를 돌려주게 바꿔도(예: 항상 0) 앞의 검사들은 통과한다 —
   * 그래서 유래에서 다시 풀어 대조한다: 하한에서 베드가 목표를 만족하고,
   * **그보다 한 스텝 아래에서는 만족하지 않아야** 한다.
   */
  it.each(TRACK_IDS)("[%s] 하한이 −30 LUFS 목표에서 유도된 값이다", (id) => {
    const { sourceLufs } = BGM_TRACKS[id];
    const floor = bgmGainFloor(sourceLufs);
    expect(bedLufs(floor, sourceLufs)).toBeGreaterThanOrEqual(BGM_BED_MIN_LUFS);
    expect(bedLufs(floor - 0.01, sourceLufs)).toBeLessThan(BGM_BED_MIN_LUFS);
  });

  /**
   * ★ **상한도 유도를 다시 푼다.** 상한이 곡별로 달라진 것이 이 회차의 변경이고,
   * 그 유도가 무력화되면(예: 항상 1을 돌려준다) "게인이 상한 아래" 검사가 아무
   * 값이나 통과시킨다.
   */
  it.each(TRACK_IDS)("[%s] 상한이 마스킹 한계에서 유도된 값이다", (id) => {
    const { bedUnityDbfs } = BGM_TRACKS[id];
    const ceil = bgmGainCeiling(bedUnityDbfs);
    expect(bedDbfs(ceil, bedUnityDbfs)).toBeCloseTo(BGM_MASK_BED_DBFS, 6);
    expect(bedDbfs(ceil + 0.01, bedUnityDbfs)).toBeGreaterThan(BGM_MASK_BED_DBFS);
  });

  /**
   * ★ **상한을 라우드니스로 풀면 헐거워진다.** 두 경계가 서로 다른 자로 재진다는
   * 것이 이 파일의 새 규칙이고(`bgmRules.ts` 머리말), 그것을 섞는 것이 가장
   * 자연스러운 실수다 — `sourceLufs`와 `bedUnityDbfs`가 나란히 있으므로 인자를
   * 바꿔 넣어도 타입이 통과한다.
   *
   * 실측: dive에서 라우드니스로 풀면 0.518이고 실측 경계는 0.460이다. 그 상태는
   * **1.2dB 헐거운 게이트**이면서 모든 검사를 통과한다.
   */
  it.each(TRACK_IDS)("[%s] 라우드니스로 푼 상한이 더 헐겁다 — 자를 섞으면 안 된다", (id) => {
    const t = BGM_TRACKS[id];
    expect(bgmGainCeiling(t.sourceLufs)).toBeGreaterThan(bgmGainCeiling(t.bedUnityDbfs));
  });

  it.each(TRACK_IDS)("[%s] 베드가 가청 목표를 넘는다", (id) => {
    const t = BGM_TRACKS[id];
    expect(bedLufs(t.gain, t.sourceLufs)).toBeGreaterThanOrEqual(BGM_BED_MIN_LUFS);
  });

  it.each(TRACK_IDS)("[%s] 베드가 마스킹 한계 아래다", (id) => {
    const t = BGM_TRACKS[id];
    expect(bedDbfs(t.gain, t.bedUnityDbfs)).toBeLessThanOrEqual(BGM_MASK_BED_DBFS);
  });

  /**
   * ★ **트랙이 서로의 게인을 쓰면 안 된다.** 이것이 이 회차의 새 실패 모드다:
   * 슬러그만 바꾸고 게인을 복사하는 것이 가장 자연스러운 실수이고, 위의 모든
   * 검사가 **트랙마다 자기 상한을 쓰므로** 그 상태는 실제로 걸린다. 그것을
   * 명시적으로 한 번 더 묻는다 — 실측으로 dive의 0.44는 타이틀에서 2.27dB 초과다.
   */
  it("한 트랙의 게인을 다른 트랙에 쓰면 상한을 넘는다 (게인 복사 금지의 근거)", () => {
    const title = BGM_TRACKS.title;
    const dive = BGM_TRACKS.dive;
    expect(dive.gain).toBeGreaterThan(bgmGainCeiling(title.bedUnityDbfs));
    expect(bedDbfs(dive.gain, title.bedUnityDbfs)).toBeGreaterThan(BGM_MASK_BED_DBFS);
  });

  /** 문제였던 0.22 회귀 고정 — dive 기준으로 남긴다(그 사건이 dive에서 났다) */
  it("옛 값 0.22는 가청 목표에 못 미친다 (회귀 고정)", () => {
    expect(bedLufs(0.22, BGM_TRACKS.dive.sourceLufs)).toBeLessThan(BGM_BED_MIN_LUFS);
  });

  /**
   * ★ **음수에서 `NaN`이 나오면 가청 검사가 조용히 통과한다.**
   *
   * `Math.log10(음수)`는 `NaN`이고 `NaN >= 목표`도 `NaN < 목표`도 전부 거짓이라,
   * "안 들린다"를 묻는 어떤 부등식도 울리지 않는다. 0은 `log10`이 스스로
   * `-Infinity`를 주므로 **0만 테스트하면 이 구멍이 남는다** — 돌연변이로
   * 확인했다(가드 삭제가 0 케이스만으로는 살아남았다).
   *
   * **두 함수를 다 묻는다** — 상한을 푸는 자(`bedDbfs`)가 이 회차에 새로 생겼고,
   * 거기에 가드가 없으면 상한 검사가 `NaN`으로 조용히 통과한다.
   */
  it("게인 0·음수·마스터 0에서 NaN이 아니라 -Infinity다", () => {
    const src = BGM_TRACKS.dive.sourceLufs;
    const bed = BGM_TRACKS.dive.bedUnityDbfs;
    for (const [g, m] of [
      [0, 0.8],
      [-0.1, 0.8],
      [0.44, -0.8],
      [-1, -1],
      [0.44, 0],
    ] as const) {
      for (const [fn, ref, label] of [
        [bedLufs, src, "bedLufs"],
        [bedDbfs, bed, "bedDbfs"],
      ] as const) {
        const v = fn(g, ref, m);
        expect(Number.isNaN(v), `${label}(${g}, ${ref}, ${m})`).toBe(false);
        expect(v, `${label}(${g}, ${ref}, ${m})`).toBe(Number.NEGATIVE_INFINITY);
      }
    }
  });

  /**
   * **절반 설정에서도 살아 있어야 한다.** 마스터(0.8)와 유저 설정 50%가 겹치면
   * 실효 게인이 `gain × 0.4`다. 하한이 베드 −30 LUFS 기준이므로 절반에서는
   * 8dB 더 내려가는데, 그건 "조금 시끄럽다"에 대한 답으로 의도된 것이다 —
   * 여기서 묻는 것은 그때도 0이 아니라는 것이다.
   */
  it.each(TRACK_IDS)("[%s] 절반 설정에서도 들릴 크기다", (id) => {
    expect(BGM_TRACKS[id].gain * 0.8 * 0.5).toBeGreaterThan(0.05);
  });

  /**
   * **BGM은 어떤 효과음보다 작아야 한다.** 이건 상한과 다른 질문이다 — 상한은
   * 신호 마스킹이고, 이건 믹스의 순서다. 가장 작은 효과음(`ui_tap` 0.6)보다
   * 음악이 크면 UI 소리가 음악의 일부처럼 들린다.
   */
  it.each(TRACK_IDS)("[%s] 가장 작은 효과음보다도 작다", (id) => {
    expect(BGM_TRACKS[id].gain).toBeLessThan(Math.min(...Object.values(SFX_VOLUME)));
  });
});

describe("페이드 — 이음새와 전환에서 클릭이 나지 않게", () => {
  /**
   * **0이면 시작에 "툭" 소리가 난다.** 루프 앞머리는 크로스페이드로 이미
   * 소리가 실려 있어서(무음에서 시작하지 않는다) 게인을 즉시 올리면 그 진폭이
   * 그대로 클릭이 된다.
   */
  it("페이드 인이 0이 아니다", () => {
    expect(BGM_FADE_IN_MS).toBeGreaterThan(0);
  });

  it("페이드 아웃이 0이 아니다", () => {
    expect(BGM_FADE_OUT_MS).toBeGreaterThan(0);
  });

  /**
   * 나가는 쪽이 **더 짧다.** 이제 그것이 실제 경로가 된다: 하강을 나가면 타이틀
   * 음악이 들어오므로, 나가는 쪽이 길면 두 곡이 겹친다. 겹치면 두 곡의 조성이
   * 부딪히는데 그건 진폭 지표에 안 걸린다.
   */
  it("페이드 아웃이 인보다 짧다", () => {
    expect(BGM_FADE_OUT_MS).toBeLessThan(BGM_FADE_IN_MS);
  });

  /** 페이드가 어느 트랙의 루프보다도 훨씬 짧아야 한다 — 짧은 곡이 기준이 된다 */
  it("페이드가 가장 짧은 루프보다 훨씬 짧다", () => {
    const shortest = Math.min(...TRACK_IDS.map((id) => BGM_TRACKS[id].loopS));
    expect(BGM_FADE_IN_MS / 1000).toBeLessThan(shortest / 10);
  });
});

describe("루프 — 되감길 때 리듬이 삐끗하지 않게", () => {
  /**
   * **프레이즈(2마디)의 정수배여야 한다.** 마디에만 맞추면 부족했다: dive에서
   * 마디 수 36·38·40이 좋고 37·39가 나쁜 교대 패턴이 실측에서 나왔고
   * (이음새 도약 0.06~0.08 대 0.41~0.48), 그것이 진짜 단위가 2마디임을
   * 드러냈다. 어긋나면 되감길 때 **리듬이 삐끗**하는데, 그건 진폭 지표에
   * 안 걸리고 4시간에 88번 난다.
   *
   * 박을 테스트에 상수로 박지 않는다 — 곡마다 다르고(dive 1.0200s, title
   * 0.7430s), 박으면 트랙을 늘린 날 이 검사가 옛 곡의 박으로 새 곡을 잰다
   * (`derived-constants-need-their-derivation`).
   */
  it.each(TRACK_IDS)("[%s] 루프가 프레이즈(2마디)의 정수배다", (id) => {
    const t = BGM_TRACKS[id];
    const n = t.loopS / (t.beatS * 4 * 2);
    expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
  });

  /**
   * **너무 짧으면 반복이 드러난다.** 기준이 트랙마다 다르다: dive는 4시간
   * 하강(실측 240분에 518층)이라 100번 아래로 두고, 타이틀은 사람이 오래 머무는
   * 화면이 아니다 — 5분 안에 4번 아래면 반복이 안 드러난다(89.16s면 3.4번).
   */
  it("dive는 4시간에 100번 미만 돈다", () => {
    expect((4 * 60 * 60) / BGM_TRACKS.dive.loopS).toBeLessThan(100);
  });

  it("title은 5분에 4번 미만 돈다", () => {
    expect((5 * 60) / BGM_TRACKS.title.loopS).toBeLessThan(4);
  });

  /**
   * **두 곡이 같은 곡이면 분리한 값을 안 한다**(설계 §4-4: "톤이 dive와 달라야
   * 한다"). 톤은 코드가 못 재지만 **같은 파일인지**는 물을 수 있다 — 슬러그를
   * 복사하는 실수가 정확히 그 형태다.
   */
  it("트랙 슬러그가 서로 다르고 경로에 쓸 수 있는 꼴이다", () => {
    const slugs = TRACK_IDS.map((id) => BGM_TRACKS[id].slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9_]+$/);
  });
});

/**
 * **상수만 보는 검사는 파일을 못 본다**(`mocks-hide-the-mocked-function`).
 * 슬러그가 실물과 갈리면 404이고, `loadBgm`이 그것을 폴백으로 삼키므로 화면이
 * 안 죽는다 — 무음만 남는다. 그래서 매니페스트를 실제로 읽어 대조한다.
 *
 * 경로가 리포 루트 상대인 것은 `charManifest.test.ts`의 관례다(vitest가 CWD를
 * `submission/`으로 둔다).
 */
describe("bgm.json과 상수가 갈리지 않는다", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/bgm/bgm.json", "utf8"),
  ) as {
    tracks: {
      slug: string;
      loopSeconds: number;
      beatSeconds: number;
      files: string[];
      attribution: string;
      modifications: string;
    }[];
  };

  it.each(TRACK_IDS)("[%s] 슬러그가 매니페스트에 있다", (id) => {
    const hit = manifest.tracks.find((t) => t.slug === BGM_TRACKS[id].slug);
    expect(hit, `${BGM_TRACKS[id].slug} 가 bgm.json에 없다`).toBeTruthy();
  });

  /**
   * 루프 길이·박이 매니페스트와 같아야 한다. 스크립트가 만든 것이 실물이고
   * 상수는 그 사본이므로, 사본이 갈리면 프레이즈 검사가 **없는 파일**을 검증한다.
   */
  it.each(TRACK_IDS)("[%s] 루프 길이·박이 매니페스트와 같다", (id) => {
    const t = BGM_TRACKS[id];
    const m = manifest.tracks.find((x) => x.slug === t.slug)!;
    expect(m.loopSeconds).toBeCloseTo(t.loopS, 3);
    expect(m.beatSeconds).toBeCloseTo(t.beatS, 4);
  });

  /** 매니페스트에만 있고 코드가 안 쓰는 트랙 = 받아 놓고 안 쓰는 1MB다 */
  it("매니페스트의 트랙이 전부 코드에서 쓰인다", () => {
    const used = new Set(TRACK_IDS.map((id) => BGM_TRACKS[id].slug));
    expect(manifest.tracks.map((t) => t.slug).filter((s) => !used.has(s))).toEqual([]);
  });

  /** CC-BY 4항목 — 트랙마다 묻는다(스크립트도 묻지만 여기는 실물을 본다) */
  it("모든 트랙이 표기 4항목을 갖고 있다", () => {
    expect(manifest.tracks.length).toBeGreaterThanOrEqual(2);
    for (const t of manifest.tracks) {
      expect(t.attribution, t.slug).toContain("creativecommons.org/licenses/by/4.0");
      expect(t.attribution, t.slug).toContain("Kevin MacLeod");
      expect(t.modifications.length, t.slug).toBeGreaterThan(20);
      expect(t.files.length, t.slug).toBe(2); // ogg + m4a 폴백
    }
  });
});

describe("bgmAudible — 무음에서 노드를 만들지 않기 위한 판정", () => {
  /**
   * **`0`은 falsy다.** 이 함수를 `!!volume`로 줄이면 우연히 맞지만, 그때
   * `NaN`도 같이 걸러진다는 보장이 사라진다 — 아래 테스트가 둘을 나눠 묻는다.
   */
  it("무음(0)에서 거짓이다", () => {
    expect(bgmAudible(0)).toBe(false);
  });

  it("소리가 있으면 참이다", () => {
    expect(bgmAudible(1)).toBe(true);
    expect(bgmAudible(0.5)).toBe(true);
  });

  /**
   * 깨진 값에서 **참이면 안 된다.** `NaN > 0`이 거짓이라 우연히 통과하지만,
   * 비교 방향을 뒤집는 변경(`>= 0`)에서 무음이 참이 되고 `NaN`도 참이 된다.
   */
  it("깨진 값·음수에서 거짓이다", () => {
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, -1]) {
      expect(bgmAudible(bad), String(bad)).toBe(false);
    }
  });

  /**
   * `Infinity`는 **참이 아니어야 한다** — 게인에 그대로 들어가면 WebAudio가
   * 던지거나 클리핑된다. `Number.isFinite` 검사가 그것을 막는데, 그 검사를
   * 지워도 `> 0`이 참이라 이 케이스만이 잡는다.
   */
  it("Infinity는 거짓이다 — 게인에 넣을 수 없는 값이다", () => {
    expect(bgmAudible(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
