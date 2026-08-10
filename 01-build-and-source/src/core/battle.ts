import {
  applyPush,
  createGauge,
  dpsToPush,
  gaugeWinner,
  DEFAULT_WIN_THRESHOLD,
  type GaugeState,
} from "./gauge";
import { createDpsWindow, type DpsWindow } from "./dpsWindow";
import { sumTeamRawDamage, type MemberDamage } from "./team";
import { generateWaves } from "./waves";
import type { InterferenceEvent, WaveDef } from "./types";

export type BattlePhase = "running" | "finished";

/** 상대 팀의 딜 스냅샷 (200ms 주기로 도착 — 설계 스펙 §3-6) */
export interface OpponentSnapshot {
  /** 이 구간에 상대 팀이 낸 원시 딜 합 */
  rawDamage: number;
  atMs: number;
  /**
   * `rawDamage`가 몇 ms 구간의 합인지. 게이지는 초당 딜로 계산하므로 이 값이
   * 없으면 단위가 어긋난다 — 200ms를 모아 보내는 사람 상대는 틱당 딜을 보내는
   * AI보다 12배 강해 보이고, 양쪽이 서로에게 지는 대전이 된다.
   * 생략하면 "이미 초당 값"으로 본다 (스크립트 상대·테스트 편의).
   */
  windowMs?: number;
}

export interface OpponentUpdate {
  /** 이번 poll에 새 스냅샷이 없으면 null → 직전 값을 유지한다 */
  snapshot: OpponentSnapshot | null;
  events: InterferenceEvent[];
}

/**
 * 상대가 사람인지 AI인지 전투 엔진은 모른다 (설계 스펙 §3-3).
 * 인터페이스를 코어가 소유해야 코어가 L3를 import하지 않는다.
 */
export interface OpponentSource {
  poll(nowMs: number): OpponentUpdate;
}

export interface BattleConfig {
  /** 양 팀이 같은 웨이브를 보기 위한 공유 seed */
  seed: number;
  teamSize: number;
  winThreshold?: number;
  timeLimitMs?: number;
  waveCount?: number;
  opponent: OpponentSource;
  /**
   * 게이지 시작 위치 (-1..1). 기본 0.
   *
   * **디버그 진입 전용이다** (`?gauge=-0.72`, 설계 문서 09-3). 밀리는 화면·이기는
   * 화면은 실제 플레이로 40~60초를 기다려야 도달하고 도달 시점을 예측할 수 없어서
   * 스크린샷 회귀가 성립하지 않았다. 로직은 건드리지 않는다 — 초기값만 옮긴다.
   * 승패 임계치를 넘는 값을 넣으면 첫 틱에 즉시 끝나는 게 정상 동작이다.
   */
  startGaugePos?: number;
}

export interface BattleState {
  phase: BattlePhase;
  elapsedMs: number;
  gauge: GaugeState;
  winner: 0 | 1 | null;
  /** 이번 틱에 우리 팀이 실제 반영한 딜 (슬로우 적용 후) */
  myTeamRawDamage: number;
  /** 마지막으로 알고 있는 상대 팀 딜 (틱 단위 비교용 원본 값) */
  theirTeamRawDamage: number;
  /**
   * 게이지 계산에 쓴 초당 딜. HUD·전략 판단이 양 팀을 같은 단위로 비교한다.
   *
   * **`DPS_WINDOW_MS` 창으로 평균한 값이다.** 프레임 단위 값을 쓰면 `sqrt`가
   * 스파이크를 깎아서 스킬 딜이 게이지에 20% 덜 실린다 (`dpsWindow.ts` 참조).
   */
  myDps: number;
  theirDps: number;
  /** 이번 틱에 새로 도착한 방해 이벤트 — 렌더러가 즉시 연출한다 */
  pendingEvents: InterferenceEvent[];
  /** 이 시각(elapsedMs 기준)까지 우리 팀은 감속 상태 */
  slowUntilMs: number;
  /**
   * 이 시각(elapsedMs 기준)까지 우리 팀은 **실명** 상태 — 새 스킬을 시전할 수 없다.
   *
   * ── 왜 딜 배율이 아니라 시전 봉인인가 (2026-08-06)
   *
   * `blind`는 여기까지 **연출 전용**이었다(수치를 하나도 안 바꿨다). 사람 대전에서는
   * 화면을 못 읽는 것이 실제 방해라는 근거였는데, 상대 슬롯이 전부 AI로 채워지는
   * 로컬 대전에서는 그 근거가 성립하지 않는다 — AI는 화면을 안 본다. 그래서
   * 두 방해 칸 중 **하나가 실제로 플레이 가능한 모든 판에서 무효**였다.
   *
   * 딜 배율로 만들지 않은 이유: 그러면 `slow`의 약한 복제품이 되고 방해 칸 두 개가
   * 같은 축을 민다 — 고를 이유가 없으면 전략이 아니다. 실명은 **행동을 막는** 축이라
   * `slow`(딜을 깎는 축)와 겹치지 않고, 화면을 못 읽는다는 연출과도 같은 뜻이다.
   *
   * 쿨다운은 실명 중에도 계속 돈다(`createCooldownTracker`가 시각 기반이다) —
   * 실명은 시전을 **미루게** 하고 영구히 빼앗지 않는다. 그래서 최악의 경우도
   * "2.5초 동안 눌러도 안 나간다"이고, 잠금 표시는 세션이 슬롯에 준다.
   */
  blindUntilMs: number;
}

export const DEFAULT_TIME_LIMIT_MS = 120_000;
export const DEFAULT_WAVE_COUNT = 40;
/** 감속 중 딜 배율 */
export const SLOW_DAMAGE_MULT = 0.6;

export class Battle {
  private readonly cfg: Required<Omit<BattleConfig, "opponent">> & {
    opponent: OpponentSource;
  };
  private readonly _waves: WaveDef[];
  private readonly seenEventIds = new Set<string>();
  /**
   * 양 팀 dps 평활 창. **둘 다 있어야 대칭이다** — 우리만 평활하면 스파이크가
   * 큰 쪽(스킬을 쓰는 쪽)이 계속 손해를 본다 (`dpsWindow.ts` 참조).
   */
  private readonly myWindow: DpsWindow = createDpsWindow();
  private readonly theirWindow: DpsWindow = createDpsWindow();
  private _state: BattleState;

  constructor(cfg: BattleConfig) {
    this.cfg = {
      seed: cfg.seed,
      teamSize: cfg.teamSize,
      winThreshold: cfg.winThreshold ?? DEFAULT_WIN_THRESHOLD,
      timeLimitMs: cfg.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS,
      waveCount: cfg.waveCount ?? DEFAULT_WAVE_COUNT,
      opponent: cfg.opponent,
      startGaugePos: cfg.startGaugePos ?? 0,
    };
    this._waves = generateWaves(this.cfg.seed, this.cfg.waveCount);
    this._state = {
      phase: "running",
      elapsedMs: 0,
      gauge: createGauge(this.cfg.startGaugePos),
      winner: null,
      myTeamRawDamage: 0,
      theirTeamRawDamage: 0,
      myDps: 0,
      theirDps: 0,
      pendingEvents: [],
      slowUntilMs: 0,
      blindUntilMs: 0,
    };
  }

  get state(): BattleState {
    return this._state;
  }

  get waves(): WaveDef[] {
    return this._waves;
  }

  /**
   * L2가 L1에 하는 유일한 호출.
   * @param myMembers 이번 틱에 우리 팀 각 멤버가 낸 원시 딜
   * @param dtMs 고정 타임스텝
   */
  tick(myMembers: readonly MemberDamage[], dtMs: number): BattleState {
    if (this._state.phase === "finished") return this._state;

    const elapsedMs = this._state.elapsedMs + dtMs;

    // 1) 상대 업데이트 수신 + 중복 이벤트 제거
    const update = this.cfg.opponent.poll(elapsedMs);
    const fresh: InterferenceEvent[] = [];
    for (const e of update.events) {
      if (this.seenEventIds.has(e.eventId)) continue;
      this.seenEventIds.add(e.eventId);
      fresh.push(e);
    }

    // 2) 방해 효과를 코어 수치에 반영 (slow=딜 / blind=시전 / gauge_drain=게이지)
    let slowUntilMs = this._state.slowUntilMs;
    let blindUntilMs = this._state.blindUntilMs;
    let drain = 0;
    for (const e of fresh) {
      if (e.kind === "slow") {
        slowUntilMs = Math.max(slowUntilMs, elapsedMs + e.magnitude);
      } else if (e.kind === "blind") {
        blindUntilMs = Math.max(blindUntilMs, elapsedMs + e.magnitude);
      } else if (e.kind === "gauge_drain") {
        drain += e.magnitude;
      }
      // spawn_adds 는 연출 전용 — pendingEvents로만 전달 (설계 스펙 §2-2)
    }

    // 3) 우리 딜 계산 (감속 적용)
    const slowed = elapsedMs <= slowUntilMs;
    const rawSum = sumTeamRawDamage(myMembers);
    const myTeamRawDamage = slowed ? rawSum * SLOW_DAMAGE_MULT : rawSum;

    // 4) 게이지 이동. 양 팀 딜을 **초당 값**으로 맞춘 뒤 push로 환산한다.
    //    (틱당 값을 그대로 넣으면 dt가 다른 상대와 비교가 성립하지 않는다)
    //
    //    초당 값은 프레임이 아니라 **창으로** 잰다. `dpsToPush`가 `sqrt`라서
    //    프레임 단위로 재면 몰아서 낸 딜이 20% 깎인다 — 스킬을 쓸수록 손해였다
    //    (실측 근거는 `dpsWindow.ts`). 양 팀 모두 같은 창을 쓴다.
    const myDps = this.myWindow.push(myTeamRawDamage, dtMs);
    const snapshot = update.snapshot;
    let theirTeamRawDamage = this._state.theirTeamRawDamage;
    if (snapshot !== undefined && snapshot !== null) {
      theirTeamRawDamage = snapshot.rawDamage;
      // 스냅샷이 덮은 구간. 없으면 "이미 초당 값"이라는 계약이므로 이 틱만큼의
      // 딜로 환산해 넣는다 — 창의 단위(원시 딜 + 구간)를 맞춰야 한다
      const win = snapshot.windowMs;
      const covered = win !== undefined && win > 0 ? win : dtMs;
      const raw =
        win !== undefined && win > 0
          ? snapshot.rawDamage
          : (snapshot.rawDamage * dtMs) / 1000;
      this.theirWindow.push(raw, covered);
    }
    /**
     * 스냅샷이 없는 틱에는 **창을 건드리지 않는다.**
     *
     * 0딜을 흘려 넣어 봤는데 그게 틀렸다: 스냅샷이 안 왔다는 것은 "딜이 없었다"가
     * 아니라 "소식이 없다"다. 사람 상대는 200ms마다 보내므로(`SNAPSHOT_INTERVAL_MS`)
     * 그 사이 12프레임에 0을 넣으면 창의 절반이 0으로 채워져 상대 dps가 반토막
     * 났다가 다시 튀는 톱니가 된다. 직전 값을 유지하는 것이 원래 계약이다
     * (`OpponentUpdate.snapshot` 주석).
     */
    const theirDps = this.theirWindow.value();

    let gauge = applyPush(
      this._state.gauge,
      dpsToPush(myDps),
      dpsToPush(theirDps),
      dtMs,
    );
    if (drain > 0) {
      // 즉시 게이지를 상대 쪽으로 끌어당긴다 (dt와 무관한 일회성 충격)
      gauge = { pos: Math.max(-1, Math.min(1, gauge.pos - drain)) };
    }

    // 5) 종료 판정 — 임계치 우선, 그다음 시간 백스톱
    let winner = gaugeWinner(gauge, this.cfg.winThreshold);
    let phase: BattlePhase = winner === null ? "running" : "finished";
    if (phase === "running" && elapsedMs >= this.cfg.timeLimitMs) {
      phase = "finished";
      winner = gauge.pos > 0 ? 0 : gauge.pos < 0 ? 1 : null;
    }

    this._state = {
      phase,
      elapsedMs,
      gauge,
      winner,
      myTeamRawDamage,
      theirTeamRawDamage,
      myDps,
      theirDps,
      pendingEvents: fresh,
      slowUntilMs,
      blindUntilMs,
    };
    return this._state;
  }

  /** 이탈·항복 처리. 상대 팀이 승자가 된다 (설계 스펙 §7-1). */
  forfeit(team: 0 | 1): BattleState {
    if (this._state.phase === "finished") return this._state;
    this._state = {
      ...this._state,
      phase: "finished",
      winner: team === 0 ? 1 : 0,
      pendingEvents: [],
    };
    return this._state;
  }
}
