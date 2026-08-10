import { createAppRuntime, loadPresetLoadout } from "./appRuntime";
import { createGameApp, type GameApp } from "./shared/app";
import {
  isBgmPlaying,
  loadSfx,
  loadVolume,
  loadedSfxCount,
  unlockAudio,
} from "./shared/audio";
import { allSfxNames } from "./shared/audioRules";
import { parseDebugEntry, type DebugEntry } from "./shared/debugEntry";
import { ensureFontsReady } from "./shared/fontReady";
import { parseJudgeEntry, type JudgeEntry } from "./shared/judgeEntry";
import { createGallery } from "./shared/gallery";
import { showFatalError } from "./shared/screens";
import { liveCharCount } from "./shared/spriteChar";
import { createSceneManager, type SceneCtx } from "./shared/sceneManager";
import { createBootScene } from "./shared/scenes/bootScene";
import {
  PVP_UNLOCK_FLOOR,
  createTitleScene,
} from "./shared/scenes/titleScene";
import { createPickScene } from "./shared/scenes/pickScene";
import {
  pickStore,
  readPick,
  writePick,
  type PickMode,
} from "./shared/scenes/pickRules";
import { loadPortraits } from "./shared/portraits";
import { createDiveScene } from "./single/diveScene";
import { readSingleSave, singleStore } from "./single/saveRules";
import {
  atkMulOf,
  attackIntervalMulOf,
  skillMulOf,
} from "./single/economyRules";
import { computeIdleReward } from "./single/idleRules";
import { scaleLoadout } from "./loadout/scale";
import { createMatchScene } from "./pvp/matchScene";
import { createVsScene } from "./pvp/vsScene";
import { createBattleScene } from "./pvp/battleScene";
import { createResultScene } from "./pvp/resultScene";
import { debugMatch, debugSessionResult } from "./pvp/debugPreview";
import { appStore } from "./shared/store";
import {
  drawReward,
  ownedCount,
  readOwned,
  rewardFor,
  writeOwned,
  type CardReward,
} from "./shared/scenes/cardRules";
import { showsVictory } from "./pvp/resultRules";
import { resultText } from "./pvp/matchText";
import { HERO_SLUGS, type HeroSlug } from "./shared/charManifest";
import type { Loadout } from "./loadout/types";
import type { BattleHandle, Runtime } from "./pvp/runtime";
import type { SessionResult } from "./pvp/session";
import type { MatchResult } from "./net/matchmaking";
import { TEAM_SIZE } from "./appRuntime";

/** 로딩 검증용 총 음원 파일 수 */
const SFX_TOTAL = allSfxNames().length;

/**
 * JS 힙 사용량(MB) — Chromium에서만 값이 나온다.
 *
 * 캐릭터 셈(`liveCharCount`)이 0으로 돌아와도 텍스처·필터가 남으면 힙은
 * 계속 자란다. 재대전 5회 검증(§09-4)에서 두 수를 같이 읽는다.
 */
function heapMb(): string {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? (m.usedJSHeapSize / 1e6).toFixed(1) : "n/a";
}

/** URL `?seed=123`으로 웨이브를 고정할 수 있다 — 디버깅·재현용 */
function seedFromUrl(): number | null {
  const raw = new URLSearchParams(location.search).get("seed");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * 씬 흐름의 배선.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §2 6단계
 *
 * **`location.reload()`가 없다** (§08-5). 재대전은 세션을 파괴하고 S2로 돌아가며,
 * 에셋은 이미 메모리에 있으므로 매칭 5초 + VS 1.6초 안에 다음 판이 시작된다.
 * 리로드는 부팅 실패 화면(§03-5)에만 남아 있다.
 *
 * `BattleHandle`의 수명도 여기가 갖는다 — 결과 씬(S5)이 전장을 뒤에 남긴 채
 * 뜨기 때문에 씬이 스스로 파괴할 수 없다 (§09-4 누수 위험 항목).
 */
async function run(
  app: GameApp,
  debug: DebugEntry,
  judge: JudgeEntry,
): Promise<void> {
  /** 카드함(`abyss.*`)과 싱글 저장(`sin.single.*`)이 같은 저장소를 쓴다 */
  const store = appStore();
  /**
   * 내가 조작하는 캐릭터. **선택 화면이 정한다**(요구사항 1) — 저장된 선택을
   * 기본값으로 들고 시작하고, 선택 화면이 확정하면 여기가 바뀐다.
   *
   * 예전에는 상수(`HERO_SLUGS[0]`)였고 그 근거는 "싱글에서 강화를 산 팀과 대전에
   * 나가는 팀이 다르면 10분 키운 것이 대전에서 의미가 없다 — 고를 여지가 아니라
   * 이어짐"이었다. 사용자 지시로 뒤집혔다: 접속하면 캐릭터를 고르는 것이 첫
   * 화면이다. **이어짐은 잠금으로 지킨다** — PvP에서는 싱글에서 키운 캐릭터만
   * 고를 수 있다(`pickSelectable`). 그래서 버린 논거가 여전히 지켜진다.
   */
  let leadSlug: HeroSlug = readPick(pickStore());
  /**
   * **성장 전** 로드아웃을 캐릭터마다 만든다.
   *
   * 상수로 한 번 만들지 않는 이유: 고른 캐릭터가 1번 자리에 안 오면 내가 누른
   * 스킬이 옆 팀원 몸에서 나간다(`PresetLoadoutProvider.load`가 `characters[0]`에서
   * 스킬을 뽑는다).
   *
   * 여기서 강화를 먹이지 않는다 — 강화는 싱글 세션이 5초마다 저장하므로
   * `goto` 시점에 읽어야 최신이다(`grownLoadout`).
   */
  const baseLoadoutOf = (slug: HeroSlug): Loadout => loadPresetLoadout(slug);
  const runtime: Runtime = createAppRuntime({ fixedSeed: seedFromUrl() });
  const manager = await createSceneManager({ app, debug });
  const ctx: SceneCtx = { app, debug, manager };

  /** 살아 있는 전투. 다음 판을 시작하기 전에 여기서 파괴한다 */
  let battle: BattleHandle | null = null;
  /** 직전 결과 — 타이틀 재진입 배지에 쓴다 (§04-7) */
  let lastWinner: 0 | 1 | null | undefined;

  /** 재대전 회차 — 누수 로그를 회차별로 읽는다 (§09-4) */
  let matchCount = 0;

  const disposeBattle = (): void => {
    const had = battle !== null;
    battle?.dispose();
    battle = null;
    // 파괴 직후 살아 있는 스켈레톤 수. 판마다 같은 값(0)이어야 한다 —
    // 재대전 5회를 돌려도 늘지 않는다는 것을 이 한 줄로 확인한다 (§09-4)
    if (had && import.meta.env.DEV) {
      console.log(
        `[leak] match#${matchCount} disposed chars=${liveCharCount()} heap=${heapMb()}`,
      );
    }
  };

  /**
   * 대전 잠금에 쓰는 도달 층.
   *
   * **`goto` 시점에 읽는다.** 씬 밖에 스냅샷을 들고 있으면 방금 100층을 찍고
   * 타이틀로 돌아온 플레이어가 여전히 잠긴 버튼을 본다 — 저장은 싱글 세션이
   * 5초마다 하므로 여기서 읽으면 항상 최신이다.
   *
   * 심사자 해제 링크(`?unlock=pvp`)는 **입구만** 연다 — 층수를 조작하지 않고
   * 잠금 판정만 통과시킨다(`judgeEntry`). 그래서 해제로 들어간 대전도 실제
   * 저장값(1층 캐릭터)으로 싸운다.
   */
  const unlockFloor = (): number =>
    judge.pvp ? PVP_UNLOCK_FLOOR : readSingleSave(singleStore()).floor;

  /**
   * 싱글에서 키운 강화가 먹은 로드아웃.
   *
   * **`goto` 시점에 읽는다** — `unlockFloor`와 같은 근거다. 씬 밖에 스냅샷을
   * 들고 있으면 방금 강화를 사고 대전에 들어간 사람이 옛 스탯으로 싸운다.
   *
   * 배율을 뽑는 것이 여기인 이유: `atkMulOf`는 `single/`에 있고 로드아웃을
   * 곱하는 `scaleLoadout`은 `loadout/`에 있다. 둘을 다 볼 수 있는 것은 배선층뿐이다
   * (`scale.ts`의 "왜 배율을 받는가").
   *
   * 상대 팀도 이 로드아웃에서 나온다(`appRuntime.makeOpponent`가 내 것을 쓴다) —
   * **그게 층 스케일링이다.** 100층에서 들어오면 양쪽이 100층 스탯으로 붙고,
   * 1000층이면 양쪽이 같이 세진다. 난이도 스칼라(`damageScale`)를 새로
   * 만들지 않는 이유: 두 팀이 같은 곱을 받으므로 게이지 균형이 안 움직인다.
   */
  const grownLoadout = (): Loadout => {
    const save = readSingleSave(singleStore());
    const grown = scaleLoadout(baseLoadoutOf(leadSlug), {
      atkMul: atkMulOf(save.upgrades),
      intervalMul: attackIntervalMulOf(save.upgrades),
      skillMul: skillMulOf(save.upgrades),
    });
    /**
     * **강화가 실제로 대전에 실렸는지는 화면으로 알 수 없다.** 성장은 양쪽에
     * 대칭으로 걸리므로(위 문단) 게이지 균형이 안 변하고, HUD에는 공격력 숫자가
     * 없다 — 배율을 통째로 빼먹어도 캡처가 똑같이 나온다. 그래서 여기서 한 줄
     * 남긴다: 이 로그가 2단계를 검증한 유일한 수단이다.
     */
    if (import.meta.env.DEV) {
      const u = save.upgrades;
      console.log(
        `[growth] floor=${save.floor} atk=${u.atk} spd=${u.spd} skill=${u.skill}` +
          ` → attack=${grown.characters[0]?.stats.attack.toFixed(1)}` +
          ` interval=${grown.characters[0]?.stats.attackIntervalMs.toFixed(0)}ms` +
          ` skill0=${grown.skills[0]?.power.toFixed(1)}`,
      );
    }
    return grown;
  };

  const gotoTitle = (): void => {
    disposeBattle();
    void manager.goto(() =>
      createTitleScene({
        ctx,
        // 프리뷰는 서 있는 그림뿐이다 — 강화 배율은 스탯만 바꾸므로 여기서는
        // 곱해도 화면이 같다. 안 곱한 것을 넘겨 "성장은 전투에만"을 지킨다
        loadout: baseLoadoutOf(leadSlug),
        online: runtime.online,
        ...(lastWinner === undefined ? {} : { lastWinner }),
        singleFloor: unlockFloor(),
        /**
         * 카드함 입구(우상단)가 이 값으로 `12/35`를 적고 격자의 실루엣을 정한다.
         *
         * **`goto` 시점에 읽는다** — 대기 화면·하강 세션과 같은 근거다: 방금
         * 하강에서 보스 층으로 받은 카드나 대전 승리 보상이 타이틀로 돌아왔을 때
         * 이미 세어져 있어야 한다. 밖에 스냅샷을 두면 한 판 늦게 오른다.
         */
        owned: readOwned(store),
        // 모드를 고르면 **캐릭터 선택이 다음**이다 (요구사항 1)
        onStart: () => gotoPick("pvp", () => gotoMatch()),
        onSingle: () => gotoPick("single", () => gotoDive()),
      }),
    );
  };

  /**
   * 캐릭터 선택. **싱글·PvP 양쪽이 지난다** — 같은 화면이 모드만 달리 잠긴다
   * (`pickSelectable`). 두 벌로 만들면 잠금 규칙이 갈린다.
   *
   * `grown`은 **`goto` 시점에 읽는다**(`unlockFloor`와 같은 근거) — 방금 싱글에서
   * 키우고 대전 선택으로 온 사람에게 그 캐릭터가 잠겨 보이면 안 된다.
   *
   * 삽화는 두 variant를 함께 받는다: 격자 칸이 `card`(7장 0.25MB), 미리보기가
   * `select`(7장 692KB)를 쓴다. 이 화면은 둘을 같이 그리므로 나눠 받을 이유가 없다.
   */
  const gotoPick = (mode: PickMode, onDone: () => void): void => {
    disposeBattle();
    void manager.goto(async () =>
      createPickScene({
        ctx,
        mode,
        grown: readSingleSave(singleStore()).grown,
        portraits: await loadPortraits(["card", "select"], HERO_SLUGS),
        initial: leadSlug,
        onConfirm: (slug) => {
          leadSlug = slug;
          // 선택을 기억한다 — 매판 다시 고르게 하면 선택이 귀찮은 일이 된다
          writePick(pickStore(), slug);
          onDone();
        },
        onBack: () => gotoTitle(),
      }),
    );
  };

  /**
   * 싱글(하강 모드) 진입. 저장·방치 보상은 goto **시점**에 읽는다 —
   * 팩토리 클로저가 실행될 때의 최신 저장값이어야 재진입에서 진행이 이어진다.
   * `Date.now()`는 여기(배선 계층)서만 읽고 세션에는 기준점으로 넘긴다.
   */
  const gotoDive = (): void => {
    disposeBattle();
    void manager.goto(() => {
      const diveStore = singleStore();
      const save = readSingleSave(diveStore);
      const baseEpochMs = Date.now();
      const idle = computeIdleReward({
        nowMs: baseEpochMs,
        lastTickMs: save.lastTickMs,
        floor: save.floor,
        upgrades: save.upgrades,
      });
      return createDiveScene({
        ctx,
        /**
         * **성장 전 로드아웃을 넘긴다.** 싱글 세션은 강화를 스스로 먹인다
         * (`single/session.buildDmgChars`, 시전 시점의 `skillMulOf`) — 여기서
         * 곱한 것을 주면 배율이 두 번 걸려 강화 하나가 제곱이 된다.
         *
         * 대전만 `grownLoadout()`을 쓰는 이유가 이것이다: PvP 세션에는 강화를
         * 먹이는 곳이 없다(있어서도 안 된다 — 코어는 두 모드가 공유한다).
         */
        loadout: baseLoadoutOf(leadSlug),
        save,
        idle,
        store: diveStore,
        seed: runtime.nextSeed(),
        /**
         * **`goto` 시점에 읽는다** — 대기 화면의 `owned`와 같은 근거다(§10-2).
         * 방금 대전에서 딴 카드가 이어지는 하강에 실려야 한다: 스냅샷을 이
         * 함수 밖에 두면 그 판의 배율이 한 판 늦게 오른다.
         *
         * 카드함(`abyss.cards.owned`)은 하강 저장(`sin.single.*`)과 다른
         * 저장소라 두 저장을 다 보는 이 배선층에서 합친다.
         */
        cardCount: ownedCount(readOwned(store)),
        /**
         * 심연석 뽑기. **여기서 뽑고 여기서 저장한다** — 대전 승리 보상
         * (`gotoResult`)과 같은 배선이다: 보유 목록을 한 번만 읽고, 뽑은 카드를
         * 그 목록에 넣어 바로 쓴다. 세션이 뽑으면 저장 키를 하나 더 알아야 한다.
         *
         * 대전 보상과 다른 점은 **로스터 전체**에서 뽑는다는 것뿐이다
         * (`drawReward` vs `rewardFor`) — 하강에는 캐릭터 선택이 없다.
         *
         * 심연석 차감은 세션 몫이다. 여기서 같이 하면 잔고의 정본이 둘이 된다
         * (세션의 `abyss`가 저장을 쓰는 쪽이다).
         */
        drawCard: () => {
          const owned = readOwned(store);
          const reward = drawReward(owned, runtime.nextSeed());
          if (reward.kind === "card") {
            owned.add(reward.id);
            writeOwned(store, owned);
          }
          return reward;
        },
        baseEpochMs,
        onExit: () => gotoTitle(),
      });
    });
  };

  const gotoResult = (result: SessionResult, match: MatchResult): void => {
    lastWinner = result.winner;
    // 전장은 결과 화면 뒤에 남아 있다 (§08-1) — 그 세션이 승리 포즈를 취한다.
    // 여기서 잡아 둬야 한다: `battle`은 재대전에서 null이 되므로 클로저가
    // 늦게 읽으면 이미 파괴된 세션을 부르게 된다
    const live = battle;
    /**
     * 카드 보상 (§10-2). **씬이 아니라 여기서 정하고 여기서 저장한다** —
     * 판정에 필요한 두 값(보유 목록·판 시드)이 여기 있고, 뽑는 곳과 저장하는
     * 곳이 갈리면 화면에 뜬 카드와 카드함의 카드가 달라질 수 있다.
     *
     * 게이트는 승리 오버레이와 **같은 소스**다(`showsVictory`) — 몰수 승리를
     * 빼는 근거가 그쪽에 적혀 있다. 여기서 조건을 다시 쓰면 두 판정이 갈려서
     * "축하는 안 뜨는데 카드는 늘어난다"가 생긴다.
     */
    let reward: CardReward | null = null;
    if (showsVictory(resultText(result).celebrate, result.winner)) {
      // 보유 목록은 **한 번만** 읽는다. 뽑을 때와 저장할 때 따로 읽으면 그
      // 사이에 바뀐 값(다른 탭)이 방금 딴 카드를 지운다
      const owned = readOwned(store);
      reward = rewardFor(leadSlug, owned, runtime.nextSeed());
      if (reward.kind === "card") {
        owned.add(reward.id);
        writeOwned(store, owned);
      }
    }
    void manager.goto(() =>
      createResultScene({
        ctx,
        result,
        match,
        mySlug: leadSlug,
        ...(reward ? { reward } : {}),
        celebrate:
          live === null ? undefined : (turn) => live.session.celebrate(turn),
        onRematch: () => {
          disposeBattle();
          gotoMatch();
        },
        onTitle: () => gotoTitle(),
      }),
    );
  };

  const gotoBattle = (handle: BattleHandle): void => {
    void manager.goto(() => createBattleScene({ ctx, handle }));
  };

  const gotoVs = (match: MatchResult): void => {
    void manager.goto(() => {
      /** VS가 화면을 가린 1.6초 동안 세션을 만든다 (§06-5) */
      let prepared: BattleHandle | null = null;
      /**
       * 강화가 먹은 로드아웃 — **한 번만 만들어 VS와 세션이 같은 객체를 본다.**
       * 두 번 부르면 두 객체가 되고, 그 사이에 싱글 저장이 바뀌면(다른 탭)
       * VS에 뜬 팀과 실제로 싸우는 팀의 스탯이 갈린다.
       */
      const loadout = grownLoadout();
      return createVsScene({
        ctx,
        match,
        loadout,
        prepare: async () => {
          const handle = await runtime.startBattle({
            app,
            loadout,
            match,
            debug,
            onFinish: (r) => gotoResult(r, match),
          });
          prepared = handle;
          battle = handle;
          matchCount += 1;
          if (import.meta.env.DEV) {
            console.log(
              `[leak] match#${matchCount} started chars=${liveCharCount()} heap=${heapMb()}`,
            );
          }
          // 사선 배경이 갈라지는 순간 전장이 이미 제자리에 있어야 한다 (§06-1)
          handle.session.prime();
        },
        onDone: () => {
          if (prepared === null) {
            // 준비가 끝나기 전에는 커튼이 열리지 않는다 (`wipeGate`) — 여기 오면
            // 세션 생성이 실패한 것이다. 검은 화면을 남기지 않고 매칭으로 되돌린다
            console.error("[main] 세션 준비 없이 전투로 넘어갈 수 없다");
            gotoMatch({ skipWait: true });
            return;
          }
          gotoBattle(prepared);
        },
      });
    });
  };

  function gotoMatch(o: { skipWait?: boolean } = {}): void {
    disposeBattle();
    void manager.goto(() =>
      createMatchScene({
        ctx,
        runtime,
        // 디버그 진입과 세션 준비 실패 복귀(§VS `onDone`)는 대기를 돌지 않는다 —
        // 실패해서 되돌아온 사람에게 5초 대기를 다시 보여줄 이유가 없다
        skipWait: o.skipWait === true || debug.skipMatch,
        leadSlug,
        // **`goto` 시점에 읽는다.** 씬 밖에 스냅샷을 들고 있으면 방금 이긴 판의
        // 카드가 다음 대기 화면의 `12/35`에 안 실린다 — 재대전은 이 함수를
        // 다시 지나므로 여기서 읽으면 항상 최신이다
        owned: readOwned(store),
        onMatched: (match) => gotoVs(match),
      }),
    );
  }

  manager.start();

  // ── 디버그 직행 (§09-3). DEV에서만 값이 채워진다
  const seed = runtime.nextSeed();
  switch (debug.scene) {
    case "title":
      gotoTitle();
      return;
    case "dive":
      gotoDive();
      return;
    case "pick": {
      /**
       * 선택 화면만 찍어 판정하기 위한 직행. `?scene=pick&mode=pvp`로 잠긴 판을
       * 본다 — **모드를 URL로 갈라야 잠금을 캡처할 수 있다.** 싱글은 전부 열려
       * 있으므로 싱글만 찍으면 잠긴 칸이 화면에 한 번도 안 나온다.
       *
       * `grown`은 여기서 채우지 않는다. 실제 저장값으로 판정해야 "안 키운
       * 캐릭터가 잠긴다"를 확인할 수 있다.
       */
      const pvp = new URLSearchParams(location.search).get("mode") === "pvp";
      gotoPick(pvp ? "pvp" : "single", () => (pvp ? gotoMatch() : gotoDive()));
      return;
    }
    case "match":
      gotoMatch();
      return;
    case "vs":
      gotoVs(debugMatch(seed, TEAM_SIZE));
      return;
    case "battle": {
      const match = debugMatch(seed, TEAM_SIZE);
      const handle = await runtime.startBattle({
        app,
        // 디버그 직행도 정상 진입과 같은 팀으로 싸운다 — 여기만 성장을 빼면
        // `?scene=battle`로 잡은 밸런스가 실제 대전과 다른 것을 재고 있게 된다
        loadout: grownLoadout(),
        match,
        debug,
        onFinish: (r) => gotoResult(r, match),
      });
      battle = handle;
      handle.session.prime();
      gotoBattle(handle);
      return;
    }
    case "result": {
      const match = debugMatch(seed, TEAM_SIZE);
      // `gotoResult`가 보상까지 정하므로 디버그 진입도 카드를 딴다 — 그게 맞다.
      // 승리 오버레이를 카드 줄까지 포함해서 캡처로 판정하려면 이 경로여야 한다
      gotoResult(debugSessionResult(debug.result ?? "win"), match);
      return;
    }
    default:
      break;
  }

  // 정상 흐름: S0 부팅 → 타이틀(모드 선택). §05-0의 "매칭 직행"은 PvP가
  // 유일한 모드일 때의 결정이었다 — 싱글(하강)이 붙은 지금은 타이틀이
  // 두 모드의 허브다 (2026-08-03 정호). PvP 직행이 필요하면 ?scene=match.
  void manager.goto(() => createBootScene({ ctx, onDone: () => gotoTitle() }));
}

/**
 * 첫 사용자 입력에서 `AudioContext`를 만든다 (설계 문서 01-7).
 *
 * 부팅 시점에 만들면 브라우저 자동재생 정책으로 suspended가 되어 영구 무음이 된다.
 * 첫 진입이 매칭 씬 직행(설계 문서 05-0)이라 첫 탭이 스킬 슬롯일 수 있으므로,
 * 창 전체에서 캡처 단계로 한 번만 받는다 — 게임 내부의 어떤 탭이든 여기를 먼저 지난다.
 */
function armAudioUnlock(): void {
  const unlock = (): void => {
    unlockAudio();
    for (const ev of ["pointerdown", "keydown", "touchstart"]) {
      window.removeEventListener(ev, unlock, true);
    }
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(ev, unlock, { capture: true, once: false });
  }
}

async function boot(): Promise<void> {
  const mount = document.getElementById("stage");
  if (!mount) throw new Error("#stage element is missing from index.html");
  armAudioUnlock();
  // 프로덕션에서는 전부 무시된다 — URL로 게이지를 옮기는 건 디버그가 아니라 치트다
  const debug = parseDebugEntry(location.search, import.meta.env.DEV);
  /**
   * 심사자 해제(`?unlock=pvp`)는 **프로덕션에서도 읽는다** — 그것이 이 파서가
   * `debugEntry`와 따로 있는 이유다(`judgeEntry` 주석). DEV 플래그를 넘기지
   * 않는 것이 의도된 것이니 여기에 조건을 덧붙이지 마라.
   */
  const judge = parseJudgeEntry(location.search);
  try {
    const app = await createGameApp(mount);

    /**
     * **어떤 `Text`보다도 먼저 기다린다.** 폰트가 도착하기 전에 텍스트를 하나라도
     * 만들면 Pixi가 폴백 폰트의 어센트를 Galmuri 키로 캐시해서, 이후 모든 글자가
     * 첫 픽셀 행이 잘린 채 찍힌다(`우리 팀` → `누리 팀`). 자세한 실측은
     * `fontReady.ts`에 있다.
     *
     * 여기가 유일하게 안전한 자리다 — 아래 갤러리·디버그 직행·부팅 씬이 모두
     * 텍스트를 만든다. 500KB 한글 폰트라 첫 진입에 그만큼 늦어지지만, 로딩 바가
     * 뜨기 전이므로 사용자에게는 검은 화면 대신 index.html의 배경이 보인다.
     */
    await ensureFontsReady();

    // 위젯 갤러리는 대전을 아예 시작하지 않는다 — 매칭·오디오·Spine 로드를
    // 기다리지 않으므로 형태 규칙 회귀 검증이 몇 초에 끝난다
    if (debug.gallery) {
      createGallery(app);
      return;
    }

    /**
     * 저장된 소리 크기를 먼저 읽는다 — **음원 로딩과 순서가 무관하다.**
     * 게인은 `unlockAudio`(첫 탭)가 만든 마스터에 반영되고, 그때까지는
     * `state.volume`에만 남는다(`audio.loadVolume` 주석). 그래서 로딩보다
     * 먼저 두어도 늦게 두어도 결과가 같고, 여기 두는 것은 "설정은 콘텐츠보다
     * 먼저"라는 읽기 순서 때문이다. 저장 실패는 함수가 삼킨다.
     */
    loadVolume();

    // BGM은 **소리를 캡처할 수 없다** — 헤드리스에 오디오 출력이 없으므로
    // 스크린샷으로는 재생 여부를 판정할 수 없다. `loadedSfxCount`를 콘솔에
    // 남기는 것과 같은 이유로, 실제 그래프 상태를 물을 창구를 dev에서만 낸다.
    if (import.meta.env.DEV) {
      (globalThis as { __audioDbg?: () => boolean }).__audioDbg = isBgmPlaying;
    }

    // 음원은 대전을 막지 않는다 — 실패해도 무음으로 굴러간다 (설계 문서 03-3).
    // 부팅 씬도 같은 것을 로드하지만 `loadSfx`가 멱등이라 두 번 받지 않는다
    void loadSfx().then(() => {
      // 무음 실패는 런타임에서 눈치챌 수 없으므로(playSfx가 throw하지 않는다)
      // 개발 중에는 몇 개가 디코드됐는지 남긴다. 헤드리스 검증에서도 이걸 본다
      if (import.meta.env.DEV) {
        console.log(`[audio] sfx loaded: ${loadedSfxCount()}/${SFX_TOTAL}`);
      }
    });
    await run(app, debug, judge);
  } catch (err) {
    showFatalError(mount, err);
  }
}

void boot();
