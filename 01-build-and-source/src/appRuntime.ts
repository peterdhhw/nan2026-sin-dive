import { AIOpponentSource } from "./ai/aiOpponentSource";
import { createStrategyAdapter, type StrategyAdapter } from "./ai/bedrock";
import { createSession } from "./pvp/session";
import type {
  BattleHandle,
  MatchProgress,
  MatchSearch,
  Runtime,
} from "./pvp/runtime";
import { PresetLoadoutProvider } from "./loadout/preset";
import type { HeroSlug } from "./shared/charManifest";
import {
  LocalMatchmaking,
  type MatchResult,
  type MatchmakingService,
} from "./net/matchmaking";
import { readAppSyncEnv } from "./net/appsync/config";
import { AppSyncMatchmaking } from "./net/appsync/matchmaking";
import { AppSyncOpponentSource } from "./net/appsync/opponentSource";
import { opponentClientIds } from "./net/appsync/protocol";
import { createPublisher, type Publisher } from "./net/publisher";
import type { BattleState, OpponentSource } from "./core/battle";
import { interferenceMagnitude } from "./core/types";
import type { Loadout } from "./loadout/types";

/**
 * `Runtime`의 실제 배선 — 매칭·상대 소스·발행·AI 전략.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §1 (모듈 지도)
 *
 * **씬(L2)이 L3·L4를 import하지 않기 위한 파일이다.** 여기가 유일하게
 * `src/net/`·`src/ai/`와 `src/shared/`을 동시에 아는 곳이고, 씬은 `Runtime`
 * 인터페이스만 본다.
 */

export const TEAM_SIZE = 2;

/**
 * 사람 대전 실측용 로그 (§09-4).
 *
 * 두 클라이언트를 붙여 놓고 **매칭 합의·방해 왕복·이탈 몰수**를 확인하려면
 * 화면만으로는 부족하다 — 방해는 1.26초 배너로 지나가고, 몰수는 3초 침묵
 * 뒤에야 뜬다. 헤드리스 하네스가 콘솔로 읽을 수 있게 여기서 한 줄씩 남긴다.
 * **DEV에서만** 찍는다 — 프로덕션 콘솔에 clientId를 흘릴 이유가 없다.
 */
function netLog(msg: string): void {
  if (!import.meta.env.DEV) return;
  console.log(`[net] ${msg}`);
}

export interface AppRuntimeOpts {
  /** `?seed=`로 고정된 시드. null이면 판마다 새로 만든다 */
  fixedSeed: number | null;
}

/** 판마다 시드를 바꾼다. `?seed=`가 있으면 항상 같은 값을 준다 (§08-5) */
function makeSeeder(fixedSeed: number | null): () => number {
  if (fixedSeed !== null) return (): number => fixedSeed;
  // Date.now는 L2 밖에서만 쓴다 (L1 결정론 불변식 유지)
  return (): number => Date.now() % 1_000_000;
}

export function createAppRuntime(opts: AppRuntimeOpts): Runtime {
  const nextSeed = makeSeeder(opts.fixedSeed);
  const env = readAppSyncEnv();
  if (env === null) {
    console.info("[pvp] AppSync 설정이 없어 로컬 AI 대전으로 시작한다");
  }

  /**
   * 직전 `findMatch`가 쓴 매칭 서비스. `startBattle`이 여기서 로비 채널과
   * 상대 clientId를 꺼낸다 — 매칭과 전투가 **같은 채널**을 써야 방해 왕복이
   * 성립한다(재연결하면 상대의 구독이 끊긴다).
   */
  let lastMm: MatchmakingService | null = null;

  return {
    online: env !== null,
    nextSeed,

    findMatch(o: {
      onProgress?: (p: MatchProgress) => void;
      skipWait: boolean;
    }): MatchSearch {
      const seed = nextSeed();
      const onStatus = (waitedMs: number, humanCount: number): void => {
        o.onProgress?.({ waitedMs, humanCount });
      };
      // 디버그 진입은 전투 상태를 보러 온 것이다. 사람을 5초 찾는 동안
      // 스크린샷 대기시간을 다 써버리면 검증이 성립하지 않는다 (§09-3)
      const mm: MatchmakingService =
        o.skipWait || env === null
          ? new LocalMatchmaking({ seed })
          : new AppSyncMatchmaking({ env, fallbackSeed: seed, onStatus });
      lastMm = mm;
      const result = mm.findMatch({ teamSize: TEAM_SIZE, levelBracket: 0 });
      void result.then((m) => {
        const humans = m.slots.filter((s) => s.kind === "human").length;
        netLog(
          `match id=${m.matchId} seed=${m.seed} mySlot=${m.mySlotId} humans=${humans} waited=${m.waitedMs}ms`,
        );
      });
      return {
        result,
        skip(): void {
          // 로컬 매칭은 애초에 기다리지 않으므로 끊을 대기가 없다
          if (mm instanceof AppSyncMatchmaking) mm.cancelWait();
        },
      };
    },

    async startBattle(o): Promise<BattleHandle> {
      const { app, loadout, match, debug } = o;
      const mm = lastMm;
      const { source: opponent, peer } = makeOpponent(match, loadout, mm);
      const channel = mm instanceof AppSyncMatchmaking ? mm.lobby : null;
      const clientId = mm instanceof AppSyncMatchmaking ? mm.clientId : "local";
      // 채널이 null이면 publisher 전체가 no-op이다 — 호출부는 분기하지 않는다
      const publisher: Publisher = createPublisher({
        channel,
        clientId,
        myTeam: 0,
      });

      // Bedrock 전략은 dev 서버에서만 켠다 (브라우저에서 직접 호출하면 자격증명 노출).
      // 상대가 사람이면 조종할 AI가 없으므로 아예 만들지 않는다.
      const aiSource = opponent instanceof AIOpponentSource ? opponent : null;
      const strategy: StrategyAdapter | null =
        aiSource === null
          ? null
          : createStrategyAdapter({
              apply: (s) => aiSource.setStrategy(s),
              enabled: import.meta.env.DEV,
            });

      const session = await createSession({
        app,
        loadout,
        match,
        opponent,
        debug,
        onFinish: (r) => {
          // 세션은 멈추지 않는다 — 결과 화면 뒤에서 전장이 계속 숨을 쉰다 (§08-1).
          // 발행·전략만 끊는다. 채널은 재대전에서 다시 열린다
          strategy?.stop();
          publisher.bye();
          netLog(
            `finish winner=${String(r.winner)} reason=${r.reason} gauge=${r.gaugePos.toFixed(3)} at=${r.elapsedMs}ms`,
          );
          o.onFinish(r);
        },
        onInterferenceCast: (skill, nowMs) => {
          publisher.publishInterference(skill, nowMs);
          if (skill.interferenceKind) {
            netLog(`intf send kind=${skill.interferenceKind} at=${nowMs}ms`);
          }
          // AI 상대에게도 같은 방해를 먹인다 — 사람 대전에서는 상대 Battle이
          // 이 이벤트를 받으므로, AI전에서만 한쪽으로 흐르면 밸런스가 깨진다
          if (aiSource !== null && skill.interferenceKind) {
            // magnitude 규칙은 코어가 갖는다 (`interferenceMagnitude`) — 여기서
            // 손으로 다시 적었더니 사람 대전(publisher)과 조용히 갈라졌다
            aiSource.receiveInterference(
              skill.interferenceKind,
              interferenceMagnitude(skill),
              nowMs,
            );
          }
        },
        onTick: (st: BattleState) => {
          publisher.recordDamage(st.myTeamRawDamage);
          publisher.tick(st.elapsedMs);
          strategy?.report({
            gaugePos: st.gauge.pos,
            elapsedMs: st.elapsedMs,
            myDps: st.myTeamRawDamage,
            theirDps: st.theirTeamRawDamage,
          });
        },
      });

      // 상대가 3초 침묵하면 우리 승리로 끝낸다 (스펙 §7-1)
      peer?.onDisconnect(() => {
        netLog("peer disconnected → forfeit(team 1)");
        session.forfeit(1);
      });
      strategy?.start();

      return {
        session,
        match,
        dispose(): void {
          strategy?.stop();
          publisher.bye();
          channel?.close();
          session.destroy();
        },
      };
    },
  };
}

/** 상대 팀에 사람이 있으면 채널을, 없으면 로컬 AI를 상대로 쓴다 */
function makeOpponent(
  match: MatchResult,
  loadout: Loadout,
  mm: MatchmakingService | null,
): { source: OpponentSource; peer: AppSyncOpponentSource | null } {
  const theirHumans = match.slots.some(
    (s) => s.team === 1 && s.kind === "human",
  );
  if (theirHumans && mm instanceof AppSyncMatchmaking) {
    const global = mm.globalMatch;
    if (global !== null) {
      const peerIds = opponentClientIds(global, mm.clientId);
      netLog(`opponent=human me=${mm.clientId} peers=${peerIds.join(",")}`);
      const peer = new AppSyncOpponentSource({ peerIds });
      mm.route((msg) => {
        if (msg.t === "intf") {
          netLog(`intf recv kind=${msg.event.kind} from=${msg.clientId}`);
        }
        peer.accept(msg);
      });
      return { source: peer, peer };
    }
  }
  netLog("opponent=ai");
  return {
    source: new AIOpponentSource({
      seed: match.seed,
      teamSize: TEAM_SIZE,
      characters: loadout.characters,
      skills: loadout.skills,
    }),
    peer: null,
  };
}

/**
 * 씬들이 공유하는 로드아웃. 매 씬이 따로 만들면 캐릭터가 화면마다 달라진다.
 *
 * @param leadSlug 내가 고른 캐릭터(대기 화면의 선택 격자). 1번 자리로 들어가고
 *   스킬 6슬롯이 그 캐릭터의 것으로 실린다. 안 넘기면 목록 순서다.
 *
 * **매번 새로 만들어야 한다.** 캐릭터를 바꾸면 `skills`까지 바뀌므로
 * (`PresetLoadoutProvider.load`가 `characters[0]`에서 뽑는다) 기존 객체를
 * 고쳐 쓰면 스킬은 옛 캐릭터의 것으로 남는다 — 누른 스킬과 나오는 동작이
 * 갈리는 그 실패는 화면에서 "가끔 다른 기술이 나온다"로만 보인다.
 */
export function loadPresetLoadout(leadSlug?: HeroSlug): Loadout {
  return new PresetLoadoutProvider(leadSlug).load(TEAM_SIZE);
}
