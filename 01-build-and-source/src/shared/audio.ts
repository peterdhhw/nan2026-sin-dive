/**
 * 효과음 재생 (WebAudio 직접 사용).
 *
 * 설계 문서: specs/2026-07-27-ux/01-art-direction.md §7
 *
 * 규약:
 *   - 추가 의존성 없음 (`pixi-sound` 같은 것을 쓰지 않는다).
 *   - **`playSfx()`는 절대 throw하지 않는다.** 음원 로딩이 실패해도 게임은
 *     무음으로 정상 동작해야 한다.
 *   - `AudioContext`는 **첫 사용자 탭 이후에** resume한다. 브라우저 자동재생
 *     정책상 부팅 시 만들면 영구 무음이 된다. 첫 진입이 매칭 씬 직행(§05-0)이라
 *     첫 탭이 스킬 슬롯일 수 있으므로, 그 시점에 resume하고 그 탭의 소리도 낸다.
 *   - 순수 규칙(스로틀·로테이션)은 `audioRules.ts`에 있다 — node 테스트 대상.
 */

import {
  type SfxId,
  SFX_VOLUME,
  allSfxNames,
  canPlay,
  sfxFileFor,
} from "./audioRules";
import {
  AUDIO_STORAGE_KEY,
  DEFAULT_VOLUME,
  nearestVolume,
  parseVolume,
  serializeVolume,
} from "./audioSettingsRules";
import {
  BGM_FADE_IN_MS,
  BGM_FADE_OUT_MS,
  BGM_TRACKS,
  type BgmTrack,
  bgmAudible,
} from "./bgmRules";
import { appStore } from "./store";

const BASE_PATH = "assets/sfx";
const BGM_PATH = "assets/bgm";

/**
 * 기준 마스터 볼륨 — 유저 설정(`state.volume`)이 여기에 **곱해진다.**
 *
 * 왜 이 상수를 남기는가: 이건 게임의 믹스 기준점이고(효과음끼리의 상대 음량은
 * `SFX_VOLUME`이 정한다) 유저 설정은 그 위의 배율이다. 설정이 이 값을 **덮어쓰게**
 * 하면 100%가 1.0이 되어 지금 출하된 소리보다 25% 커진다 — 소리를 줄이려고 만든
 * 변경이 조용히 소리를 키운다.
 */
const MASTER_VOLUME = 0.8;

interface AudioState {
  ctx: AudioContext | null;
  master: GainNode | null;
  buffers: Map<string, AudioBuffer>;
  lastPlayed: Map<SfxId, number>;
  playCount: Map<SfxId, number>;
  enabled: boolean;
  /** 로딩을 한 번만 하도록 */
  loading: Promise<void> | null;
  /** 첫 탭 resume이 끝났는지 */
  unlocked: boolean;
  /**
   * 유저 설정 배율 (`audioSettingsRules.VOLUME_STEPS`).
   *
   * **`AudioContext`가 없을 때도 값을 들고 있어야 한다.** 컨텍스트는 첫 탭에서
   * 생기므로(`unlockAudio`), 그 전에 설정을 바꾸면 적용할 노드가 없다. 여기
   * 저장해 두고 `unlockAudio`가 만든 마스터에 반영한다 — 안 그러면 첫 탭이
   * 설정을 되돌린다.
   */
  volume: number;
  /**
   * BGM 상태. **효과음과 노드를 공유하지 않는다** — BGM은 마스터 아래 자기
   * 게인 노드를 하나 갖는다(`bgmGain`). 그래야 두 가지가 동시에 성립한다:
   * 유저 설정(마스터)이 BGM에도 자동으로 걸리고, BGM만의 믹스 비율을
   * 효과음과 독립적으로 정할 수 있다(`BGM_TRACKS[…].gain`).
   *
   * 버퍼·로딩이 **트랙별 맵**이다. 하나만 들고 있으면 타이틀 ↔ 하강을
   * 왕복할 때마다 1MB를 다시 받는다 — 그 왕복이 이 게임의 주 동선이다.
   */
  bgmBuffers: Map<BgmTrack, AudioBuffer>;
  bgmLoading: Map<BgmTrack, Promise<void>>;
  bgmSource: AudioBufferSourceNode | null;
  bgmGain: GainNode | null;
  /**
   * 지금 **울려야 하는** 트랙. `null` = 무음이어야 한다.
   *
   * 옛 `bgmWanted: boolean`을 대신한다 — 불리언이면 "어느 곡"이 어디에도 없고,
   * 트랙이 둘이 되는 순간 `tryPlayBgm`이 무엇을 켤지 모른다.
   */
  bgmWanted: BgmTrack | null;
  /** 지금 **실제로** 울리는 트랙. `bgmWanted`와 다르면 전환 중이다 */
  bgmPlaying: BgmTrack | null;
}

let loggedFirstPlay = false;

const state: AudioState = {
  ctx: null,
  master: null,
  buffers: new Map(),
  lastPlayed: new Map(),
  playCount: new Map(),
  enabled: true,
  loading: null,
  unlocked: false,
  volume: DEFAULT_VOLUME,
  bgmBuffers: new Map(),
  bgmLoading: new Map(),
  bgmSource: null,
  bgmGain: null,
  bgmWanted: null,
  bgmPlaying: null,
};

/**
 * 재생 시각의 기준. `AudioContext.currentTime`(초)을 ms로 쓴다.
 * 컨텍스트가 없으면 `performance.now()`로 떨어진다 — 스로틀 판정만 하는 용도라
 * 절대 시각의 정확도는 중요하지 않다.
 */
function nowMs(): number {
  if (state.ctx) return state.ctx.currentTime * 1000;
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function ctor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== "undefined") return AudioContext;
  // Safari 구버전
  const w = globalThis as { webkitAudioContext?: typeof AudioContext };
  return w.webkitAudioContext;
}

/** ogg를 못 읽는 브라우저(Safari)를 위해 m4a로 떨어진다 */
function candidateUrls(name: string): string[] {
  return [`${BASE_PATH}/${name}.ogg`, `${BASE_PATH}/${name}.m4a`];
}

/** BGM도 같은 폴백 규약을 쓴다 (`fetch_bgm.sh`가 두 포맷을 굽는다) */
function bgmUrls(slug: string): string[] {
  return [`${BGM_PATH}/${slug}.ogg`, `${BGM_PATH}/${slug}.m4a`];
}

/**
 * 음원을 디코드해서 채운다. **`AudioContext`를 여기서 만들지 않는다** (§03-3):
 * 부팅 시점에 만들면 자동재생 정책으로 suspended가 되고, iOS에서는 그대로 죽는다.
 * 디코드에는 컨텍스트가 필요하므로 `OfflineAudioContext`를 임시로 쓴다.
 */
export async function loadSfx(): Promise<void> {
  if (state.loading) return state.loading;

  state.loading = (async () => {
    const Ctor = ctor();
    if (!Ctor) return; // WebAudio 미지원 — 무음으로 진행

    // 디코드 전용. 44.1kHz 모노 1프레임짜리 최소 컨텍스트로 충분하다.
    let decoder: BaseAudioContext;
    try {
      decoder = new OfflineAudioContext(1, 1, 44100);
    } catch {
      return;
    }

    await Promise.all(
      allSfxNames().map(async (name) => {
        for (const url of candidateUrls(name)) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const bytes = await res.arrayBuffer();
            const buf = await decoder.decodeAudioData(bytes);
            state.buffers.set(name, buf);
            return;
          } catch {
            // 다음 포맷으로. 전부 실패하면 이 음원만 무음이 된다.
          }
        }
      }),
    );
  })();

  return state.loading;
}

/**
 * 첫 사용자 입력에서 호출한다. 여기서 처음 `AudioContext`를 만든다.
 *
 * 실패해도 무시한다 — 소리가 안 나는 것이 게임이 멈추는 것보다 낫다.
 */
export function unlockAudio(): void {
  if (state.unlocked) return;
  state.unlocked = true;

  const Ctor = ctor();
  if (!Ctor) return;

  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    // 설정을 곱한다 — 첫 탭 전에 소리를 줄여 뒀으면 그 탭부터 적용돼야 한다
    master.gain.value = MASTER_VOLUME * state.volume;
    master.connect(ctx.destination);
    state.ctx = ctx;
    state.master = master;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    // 컨텍스트가 마지막으로 갖춰진 조건일 수 있다 — 하강이 첫 탭보다 먼저
    // 시작하면(`startBgm`이 노드를 못 만들고 돌아간다) 여기가 재생을 켠다.
    tryPlayBgm();
  } catch {
    state.ctx = null;
    state.master = null;
  }
}

/** 설정(§04-6)의 효과음 ON/OFF */
export function setSfxEnabled(on: boolean): void {
  state.enabled = on;
}

export function isSfxEnabled(): boolean {
  return state.enabled;
}

/**
 * 저장된 소리 크기를 읽어 적용한다. 부팅에서 한 번 부른다.
 *
 * **`unlockAudio`보다 먼저 불러도 된다** — 컨텍스트가 없으면 `state.volume`에만
 * 남고 첫 탭이 그것을 반영한다(`unlockAudio`의 곱셈). 순서 의존을 만들지 않는
 * 것이 요점이다: 부팅 순서가 바뀌는 날 소리가 조용히 기본값으로 돌아간다.
 */
export function loadVolume(): number {
  const store = appStore();
  let raw: string | null = null;
  try {
    raw = store?.getItem(AUDIO_STORAGE_KEY) ?? null;
  } catch {
    // 사파리 프라이빗 모드 — 기본값으로 굴러간다 (docs/SAVE-SCHEMA.md §2-1)
  }
  const v = parseVolume(raw);
  applyVolume(v);
  return v;
}

/**
 * 소리 크기를 바꾸고 **저장한다.**
 *
 * 저장 실패를 삼키는 것은 규약이다(docs/SAVE-SCHEMA.md §2-1) — 설정 저장이
 * 던지면 배지를 누른 것만으로 게임이 죽는다. 대가는 "다음 실행에서 기본값"이고
 * 그게 크래시보다 낫다.
 */
export function setVolume(v: number): number {
  const step = applyVolume(v);
  const store = appStore();
  try {
    store?.setItem(AUDIO_STORAGE_KEY, serializeVolume(step));
  } catch {
    /* 저장 실패는 무시한다 */
  }
  return step;
}

export function getVolume(): number {
  return state.volume;
}

/**
 * 게인에 반영만 한다(저장 없음). 단계로 접어서 넣는다.
 *
 * **BGM은 마스터를 타므로 배율이 자동으로 걸린다** — 여기서 따로 곱하지
 * 않는다. 다만 무음은 다르다: `tryPlayBgm`이 무음에서 노드를 아예 만들지
 * 않으므로(1MB 버퍼를 4시간 헛돌리지 않기 위해), 무음으로 갔다가 돌아오면
 * **다시 켜 줘야 한다.** 안 하면 배지로 음소거한 유저가 소리를 되돌렸을 때
 * 효과음만 돌아오고 음악은 그 세션 내내 사라진다 — 화면이 안 죽는 실패다.
 */
function applyVolume(v: number): number {
  const step = nearestVolume(v);
  const wasAudible = bgmAudible(state.volume);
  state.volume = step;
  const master = state.master;
  if (master) master.gain.value = MASTER_VOLUME * step;

  if (!bgmAudible(step)) {
    if (wasAudible && state.bgmSource) {
      // 의사(`bgmWanted`)는 남겨 두고 소리만 끊는다 — 그래야 되돌릴 때
      // "하강 중이었다"를 다시 판단하지 않아도 된다.
      const wanted = state.bgmWanted;
      stopBgm();
      state.bgmWanted = wanted;
    }
  } else {
    tryPlayBgm(); // 무음에서 돌아온 경우. 이미 돌고 있으면 아무것도 안 한다.
  }
  return step;
}

/* ── BGM ────────────────────────────────────────────────────────────────
 *
 * 왜 효과음 로딩(`loadSfx`)에 끼워 넣지 않는가: BGM은 **1.0MB 한 덩이**고
 * 효과음 24개를 다 합친 것(236KB)의 네 배다. 부팅 로딩에 넣으면 첫 화면이
 * 그만큼 늦는데, 첫 진입에는 BGM이 필요하지도 않다(매칭·타이틀 씬이다).
 * 그래서 **하강에 들어갈 때** 받는다.
 *
 * 왜 대전에는 안 넣는가: 스펙 §01-7의 논거가 그쪽에서는 아직 맞다 —
 * 120초 판에 163초 루프는 한 바퀴도 못 돈다(`bgmRules` 머리말).
 */

/**
 * BGM을 받아 디코드한다. 멱등하다 — 두 번 불러도 한 번만 받는다.
 *
 * `loadSfx`와 같은 이유로 `OfflineAudioContext`로 디코드한다: 여기서
 * `AudioContext`를 만들면 자동재생 정책에 걸린다(§03-3).
 */
async function loadBgm(track: BgmTrack): Promise<void> {
  const running = state.bgmLoading.get(track);
  if (running) return running;

  const p = (async () => {
    if (!ctor()) return; // WebAudio 미지원 — 무음으로 진행

    let decoder: BaseAudioContext;
    try {
      decoder = new OfflineAudioContext(1, 1, 44100);
    } catch {
      return;
    }

    for (const url of bgmUrls(BGM_TRACKS[track].slug)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        state.bgmBuffers.set(track, await decoder.decodeAudioData(bytes));
        return;
      } catch {
        // 다음 포맷으로. 전부 실패하면 그 트랙만 무음이 된다.
      }
    }
  })();

  state.bgmLoading.set(track, p);
  return p;
}

/**
 * 지금 상태로 실제 재생을 시작한다. 조건이 안 맞으면 조용히 아무것도 안 한다.
 *
 * 조건이 세 가지고 **셋 다 나중에 갖춰질 수 있다**: 컨텍스트(첫 탭), 버퍼
 * (다운로드), 유저 의사(`startBgm`). 그래서 이 함수는 세 곳에서 불린다
 * (`startBgm`·로딩 완료·`applyVolume`) — 어느 순서로 갖춰지든 마지막 하나가
 * 재생을 켠다. 순서 의존을 만들면 "탭이 먼저면 소리가 나고 로딩이 먼저면
 * 안 나는" 조용한 버그가 된다.
 */
function tryPlayBgm(): void {
  const want = state.bgmWanted;
  if (!want) return;
  if (state.bgmSource) return; // 이미 돌고 있다 (전환은 stopBgm이 비운 뒤에 온다)
  if (!bgmAudible(state.volume)) return; // 무음이면 노드를 만들지 않는다

  const ctx = state.ctx;
  const master = state.master;
  const buf = state.bgmBuffers.get(want);
  if (!ctx || !master || !buf) return;

  try {
    const gain = ctx.createGain();
    // 0에서 올린다 — 루프 앞머리는 크로스페이드로 소리가 실려 있어서
    // 즉시 최대로 넣으면 그 진폭이 클릭이 된다(`bgmRules.BGM_FADE_IN_MS`).
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(
      // **트랙의 게인이다.** 상수 하나를 쓰면 타이틀이 마스킹 한계를 넘는다
      BGM_TRACKS[want].gain,
      ctx.currentTime + BGM_FADE_IN_MS / 1000,
    );
    gain.connect(master);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true; // 이음새는 `fetch_bgm.sh`가 만들어 뒀다
    src.connect(gain);
    src.start();

    state.bgmSource = src;
    state.bgmGain = gain;
    state.bgmPlaying = want;
    if (import.meta.env.DEV) {
      // 어느 곡이 울리는지는 화면에도 캡처에도 안 나온다. 헤드리스가 이 줄로
      // 읽는다 — 불리언(`isBgmPlaying`)은 "타이틀에서 하강 음악"을 통과시킨다.
      // 게인을 같이 찍는 이유: 전환은 됐는데 게인이 한 값이면 마스킹 한계를
      // 넘고, 그건 소리로만 드러난다(0.22 사건의 형태).
      console.log(`[bgm] play track=${want} gain=${BGM_TRACKS[want].gain}`);
    }
  } catch {
    /* 재생 실패는 무시한다 — 게임은 계속 굴러가야 한다 */
  }
}

/**
 * BGM을 켠다. 타이틀 씬 진입·하강 시작에서 부른다.
 *
 * **절대 throw하지 않고 await도 필요 없다** — 다운로드를 기다리지 않으므로
 * 화면 전환이 네트워크에 묶이지 않는다. 받아지면 그때 소리가 붙는다.
 *
 * **전환은 크로스페이드가 아니라 순차다.** 나가는 곡의 페이드아웃(600ms)이
 * 끝나고 들어오는 곡의 페이드인(1200ms)이 시작한다. 겹치면 두 곡의 조성이
 * 부딪히는데 그건 진폭 지표에 안 걸린다 — 사람 귀에만 나타난다.
 *
 * 같은 트랙을 다시 부르면 **아무것도 하지 않는다.** 이 함수는 씬 진입에서
 * 불리고, 씬은 다시 들어올 수 있다 — 매번 끊고 다시 켜면 페이드가 재시작해서
 * 음악이 "웅" 하고 내려앉는다.
 */
export function startBgm(track: BgmTrack): void {
  if (state.bgmWanted === track && state.bgmSource) return;

  if (state.bgmSource && state.bgmPlaying !== track) {
    // 나가는 곡을 페이드아웃으로 끊는다. `stopBgm`이 노드를 비우므로 그 뒤에
    // 켜야 `tryPlayBgm`의 "이미 돌고 있다" 가드를 통과한다.
    stopBgm();
  }
  state.bgmWanted = track;
  tryPlayBgm(); // 이미 받아 뒀으면(재입장·왕복) 즉시 시작한다
  void loadBgm(track)
    .then(tryPlayBgm)
    .catch(() => {});
}

/**
 * BGM을 끈다. 하강을 나갈 때 부른다.
 *
 * 버퍼는 **버리지 않는다** — 재입장에서 1MB를 다시 받게 된다. 노드만 끊는다.
 */
export function stopBgm(): void {
  state.bgmWanted = null;
  // 지금 울리는 트랙도 비운다 — 남겨 두면 `currentBgmTrack()`이 멈춘 곡을
  // 계속 말하고, 전환 검증이 그 거짓말을 통과시킨다.
  state.bgmPlaying = null;
  const ctx = state.ctx;
  const src = state.bgmSource;
  const gain = state.bgmGain;
  state.bgmSource = null;
  state.bgmGain = null;
  if (!src) return;

  try {
    if (ctx && gain) {
      // 페이드아웃 뒤에 멈춘다. 즉시 끊으면 파형 중간이 잘려 "툭" 소리가 난다.
      const end = ctx.currentTime + BGM_FADE_OUT_MS / 1000;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, end);
      src.stop(end);
    } else {
      src.stop();
    }
    src.onended = () => {
      try {
        src.disconnect();
        gain?.disconnect();
      } catch {
        /* 이미 끊긴 경우 */
      }
    };
  } catch {
    /* 이미 멈춘 경우 */
  }
}

/** BGM이 실제로 돌고 있는가 (헤드리스 검증·디버깅용) */
export function isBgmPlaying(): boolean {
  return state.bgmSource !== null;
}

/**
 * 지금 울리는 트랙 (헤드리스 검증용).
 *
 * `isBgmPlaying()`만으로는 **어느 곡인지 못 묻는다** — 타이틀에서 하강 음악이
 * 흐르는 것이 이 회차가 막으려는 실패이고, 불리언은 그것을 통과시킨다.
 */
export function currentBgmTrack(): BgmTrack | null {
  return state.bgmPlaying;
}

/**
 * 효과음 재생.
 *
 * @param volumeScale 상황별 감쇠. 예: 몰수 승리의 `win`은 0.6 (§08-7)
 *
 * **절대 throw하지 않는다.** 컨텍스트가 없거나(첫 탭 전), 버퍼가 없거나,
 * 스로틀에 걸리면 조용히 아무것도 하지 않는다.
 */
export function playSfx(id: SfxId, volumeScale = 1): void {
  if (!state.enabled) return;

  const t = nowMs();
  if (!canPlay(id, t, state.lastPlayed.get(id))) return;

  const count = state.playCount.get(id) ?? 0;
  const file = sfxFileFor(id, count);
  const buf = state.buffers.get(file);

  // 스로틀·카운트는 실제 재생 여부와 무관하게 갱신한다. 그래야 버퍼가 없는
  // 음원도 로테이션 위치가 밀리지 않고, 로딩이 늦게 끝나도 상태가 일관된다.
  state.lastPlayed.set(id, t);
  state.playCount.set(id, count + 1);

  // 무음이면 노드를 만들지 않는다. 게인 0으로도 들리지는 않지만, 4시간 하강에서
  // 분당 200회 가까이 버퍼 소스를 만들어 즉시 버리는 것은 순수한 낭비다.
  // 스로틀·로테이션 갱신 **뒤에** 둔다 — 무음 동안 로테이션이 멈추면 소리를 켠
  // 순간 타격음 세 종이 한 종으로 뭉친다.
  if (state.volume <= 0) return;

  const ctx = state.ctx;
  const master = state.master;
  if (!ctx || !master || !buf) return;

  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = SFX_VOLUME[id] * volumeScale;
    src.connect(gain);
    gain.connect(master);
    src.start();
    if (import.meta.env.DEV && !loggedFirstPlay) {
      loggedFirstPlay = true;
      // 버퍼가 디코드된 것과 실제로 그래프를 타는 것은 다른 문제다.
      // 첫 재생이 성공했다는 증거를 한 번만 남긴다 (헤드리스 검증용).
      console.log(`[audio] first playback ok: ${file} ctx=${ctx.state}`);
    }
    // 재생이 끝나면 노드를 끊는다. 판당 수백 번 울리므로 누적되면 GC 압력이 된다.
    src.onended = () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        /* 이미 끊긴 경우 */
      }
    };
  } catch {
    /* 재생 실패는 무시한다 — 게임은 계속 굴러가야 한다 */
  }
}

/** 씬·세션이 끝날 때 스로틀 상태를 비운다 (재대전에서 첫 소리가 씹히지 않게) */
export function resetSfxThrottle(): void {
  state.lastPlayed.clear();
}

/** 로딩된 음원 수. 부팅 로딩 가중(§03-3)과 디버깅용 */
export function loadedSfxCount(): number {
  return state.buffers.size;
}

export type { SfxId };
