/**
 * 근접 돌진 타임라인 — 아군이 적에게 붙어서 때리고 돌아오는 규칙.
 *
 * **왜 필요한가**: 지금까지 아군은 좌측에 서서 제자리에서 칼을 휘두르고, 적은
 * 우측 슬롯에 **처음부터 놓인 채로** HP만 깎였다. 둘 사이에 필드 폭의 40%가
 * 비어 있어서 무엇이 무엇을 때리는지 그림에 없었다 — 딜은 코어에서 계산되고
 * 화면은 그것을 통보만 했다.
 *
 * 이 모듈은 접근 → 접촉 → 타격 → 임팩트 → 복귀를 **시간축 하나**로 만든다.
 * Pixi를 import하지 않는다 — 타이밍이 곧 "맞았다"의 근거라서 눈대중으로
 * 고치면 안 되고, node 테스트가 그대로 검증해야 한다.
 *
 * 좌표 규약: `0` = 아군의 대기 자리, `1` = 사거리만큼 떨어진 적 앞.
 * 실제 px 변환은 `battleField`가 한다(필드 폭이 게이지에 따라 바뀐다).
 */

/**
 * 접근 방식. 캐릭터마다 다르게 줘서 일곱이 같은 사람으로 안 보이게 한다.
 *
 * **`walk`는 취향이 아니라 에셋 사실이다.** chierit 7종 중 water_priestess만
 * 달리기 시트가 없다(`walk` 10프레임뿐). 여기에 `run`을 적으면 `spriteChar`의
 * 대체 사슬이 조용히 `walk`를 재생해서, 매니페스트에 없는 클립을 프리셋이
 * 가리키고 있다는 사실이 화면에서 안 드러난다.
 */
export type ApproachKind = "run" | "roll" | "walk";

/**
 * 공격 클립 이름. `special`은 마무리 기술로 섞어 쓴다.
 *
 * `attack3`이 있는 이유: 스킬 6슬롯(내 공격 3 + 상대 방해 2 + 타락 버프 1)의
 * **공격 세 칸**을 **각 캐릭터의
 * 자기 클립**으로 채운다. chierit는 캐릭터마다 `attack1/2/3 + special` 네 벌을
 * 갖고 있어서, 세 공격 슬롯이 서로 다른 동작으로 보인다.
 */
export type AttackClip = "attack1" | "attack2" | "attack3" | "special";

/**
 * 한 캐릭터의 근접 스타일.
 *
 * **`reach`가 0이면 안 된다.** 적 몸에 겹쳐 서면 두 스프라이트가 하나의 덩어리로
 * 뭉쳐서 누가 때렸는지 안 보인다. 사거리는 적 앞에서 멈추는 거리다.
 */
export interface MeleeStyle {
  /** 접근 동작 */
  approach: ApproachKind;
  /** 접근에 쓰는 시간(ms). 짧으면 순간이동으로 보인다 */
  approachMs: number;
  /** 복귀에 쓰는 시간(ms). 접근보다 느긋해야 "돌아간다"로 읽힌다 */
  returnMs: number;
  /**
   * 적 앞에서 멈추는 거리 — 아군↔적 거리에 대한 비율 0..1.
   * 0.18이면 82%까지 다가간다. 창은 멀리서, 단검은 붙어서 때린다.
   */
  reach: number;
  /** 이 캐릭터가 돌아가며 쓰는 공격 클립 */
  clips: readonly AttackClip[];
}

/** 타임라인의 현재 국면 */
export type MeleePhase = "idle" | "approach" | "strike" | "return";

export interface MeleePose {
  phase: MeleePhase;
  /** 대기 자리(0) → 적 앞(1) 사이의 위치 */
  advance: number;
  /** 지금 재생해야 하는 클립 이름 (`idle`이면 대기 루프) */
  clip: string;
  /** 클립을 처음부터 다시 재생해야 하는 프레임인가 (전환 순간에만 true) */
  restart: boolean;
  /** 이 프레임에 임팩트가 터졌는가 — HP·이펙트를 여기서만 낸다 */
  impact: boolean;
  /** 타임라인이 끝났는가 (호출자가 슬롯을 비운다) */
  done: boolean;
}

/**
 * 공격 모션 길이(ms) — 프레임 수 ÷ fps.
 *
 * 클립마다 프레임 수·fps가 달라서 상수로 박으면 임팩트가 어긋난다. 매니페스트
 * 값을 그대로 쓴다.
 */
export function clipDurationMs(frames: number, fps: number): number {
  const f = Math.max(1, Math.floor(frames));
  const r = Number.isFinite(fps) && fps > 0 ? fps : 12;
  return (f / r) * 1000;
}

/**
 * 클립 시작부터 임팩트 프레임까지의 시간(ms).
 *
 * `impact`는 임포터가 픽셀에서 뽑은 프레임 번호다(`tools/import_chars.py`
 * `impact_frame`). 프레임 번호 그대로 곱하면 그 프레임이 **뜨는 순간**이고,
 * 우리가 원하는 것은 그 프레임이 화면에 있는 동안이므로 그대로 쓴다 —
 * 반 프레임을 더하면 다음 프레임과 걸쳐 한 프레임 늦게 보인다.
 */
export function impactDelayMs(
  impactFrame: number,
  frames: number,
  fps: number,
): number {
  const n = Math.max(1, Math.floor(frames));
  const i = Number.isFinite(impactFrame)
    ? Math.min(n - 1, Math.max(0, Math.floor(impactFrame)))
    : 0;
  const r = Number.isFinite(fps) && fps > 0 ? fps : 12;
  return (i / r) * 1000;
}

/**
 * 접근 곡선. 0 → 1.
 *
 * **`run`과 `roll`이 달라야 한다.** 달리기는 가속해서 붙고(뒤가 빠르다),
 * 굴르기는 튕겨 나가듯 초반이 빠르고 끝에서 일어선다(앞이 빠르다). 같은
 * 곡선을 쓰면 클립만 다르고 움직임은 똑같아서 "다른 캐릭터"로 안 읽힌다.
 */
export function approachCurve(t: number, kind: ApproachKind): number {
  const x = clamp01(t);
  if (kind === "roll") {
    // 감속(ease-out) — 초반에 튕겨 나가고 끝에서 멈춘다
    return 1 - (1 - x) * (1 - x);
  }
  if (kind === "walk") {
    // 등속 — 걷기는 가속하지 않는다. 달리기와 같은 곡선을 주면 접근 클립만
    // 다르고 움직임은 똑같아서 "달리기 대신 걷는다"가 화면에 안 남는다
    return x;
  }
  // 가속 후 감속(ease-in-out) — 발을 딛고 뛰어 붙는다
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
}

/**
 * `approachCurve`의 역함수 — 이 진행도에 도달하는 시각 비율 0..1.
 *
 * **왜 필요한가**: 스킬 시전은 진행 중인 사이클을 끊고 자기 모션으로 갈아탄다.
 * 그때 경과를 0으로 되돌리면 적 앞에 서 있던 아군이 대기 자리로 **순간이동**한다
 * (진행도 0 = 대기 자리). 지금 서 있는 진행도에 해당하는 시각에서 시작하면
 * 그 자리에서 이어서 파고든다 — 이미 붙어 있으면(1) 접근을 건너뛰고 바로 휘두른다.
 */
export function approachCurveInverse(
  advance: number,
  kind: ApproachKind,
): number {
  const a = clamp01(advance);
  if (kind === "roll") return 1 - Math.sqrt(1 - a);
  // 등속의 역함수는 자기 자신이다
  if (kind === "walk") return a;
  // ease-in-out의 두 구간을 각각 되돌린다. 경계는 진행도 0.5다
  return a < 0.5 ? Math.sqrt(a / 2) : 1 - Math.sqrt((1 - a) / 2);
}

/** 복귀 곡선 — 항상 감속. 뒷걸음질은 급할 이유가 없다 */
export function returnCurve(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

/**
 * `returnCurve`의 역함수 — 이 진행도에서 물러나기 시작하는 시각 비율 0..1.
 *
 * **왜 필요한가**: 접근·타격 도중에 목표가 죽으면(다른 아군이 먼저 죽였다)
 * 그 자리에서 물러나야 한다. 예전에는 진행분을 **0으로 눌렀는데**, 그러면
 * 적 앞까지 달려간 아군이 대기 자리로 순간이동하고 공격 클립은 거기서 계속
 * 재생된다 — 실측에서 `phase=strike`인 채로 530ms 동안 `x=homeX`에서 허공을
 * 휘둘렀다("공격액션이 먼저 되고 나중에 앞으로 간다"의 정체다).
 *
 * `approachCurveInverse`와 같은 처방이다: 좌표를 되돌리는 대신 **지금 서 있는
 * 진행도에 해당하는 시각으로 들어간다.** 진행도 1이면 복귀를 처음부터(0),
 * 0이면 이미 끝난 지점(1)이다 — 복귀는 1 → 0이라 방향이 뒤집혀 있다.
 */
export function returnCurveInverse(advance: number): number {
  const a = clamp01(advance);
  // returnCurve의 출력은 advance = 1 - curve(t)이므로 curve(t) = 1 - a다.
  // 1 - (1-t)² = 1 - a  →  t = 1 - √a
  return 1 - Math.sqrt(a);
}

export interface MeleeTimelineOpts {
  style: MeleeStyle;
  /** 이번에 쓸 클립의 길이(ms) */
  strikeMs: number;
  /** 클립 시작부터 임팩트까지(ms) */
  impactAtMs: number;
  /** 이번에 재생할 클립 이름 */
  clip: AttackClip;
}

/** 국면 경계 시각(ms). 테스트와 `battleField`가 같은 값을 봐야 한다 */
export interface MeleeSpan {
  approachEndMs: number;
  strikeEndMs: number;
  totalMs: number;
  impactAtMs: number;
}

export function meleeSpan(o: MeleeTimelineOpts): MeleeSpan {
  const approachEndMs = Math.max(0, o.style.approachMs);
  const strikeMs = Math.max(1, o.strikeMs);
  const strikeEndMs = approachEndMs + strikeMs;
  return {
    approachEndMs,
    strikeEndMs,
    totalMs: strikeEndMs + Math.max(0, o.style.returnMs),
    // 임팩트는 클립 안의 시각이므로 접근 시간만큼 밀린다.
    // 클립 길이를 넘지 않게 잡는다 — 넘으면 임팩트가 영원히 안 온다
    impactAtMs: approachEndMs + Math.min(strikeMs, Math.max(0, o.impactAtMs)),
  };
}

/**
 * 경과 시간 → 자세.
 *
 * `prevMs`는 지난 프레임의 경과 시간이다. 임팩트는 **구간을 넘어섰는가**로
 * 판정한다 — 특정 ms와 같은지 보면 고정 타임스텝(16.67ms)이 그 값을 정확히
 * 밟지 않아 영원히 안 터진다. 이 종류의 버그는 화면에서 "가끔 안 아프다"로만
 * 드러나서 원인을 찾을 수 없다.
 */
export function meleePose(
  elapsedMs: number,
  prevMs: number,
  o: MeleeTimelineOpts,
): MeleePose {
  const span = meleeSpan(o);
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const p = Number.isFinite(prevMs) ? Math.max(0, prevMs) : 0;
  // 지난 프레임엔 안 지났고 이번엔 지났다 = 이 프레임이 임팩트다
  const impact = p < span.impactAtMs && t >= span.impactAtMs;

  if (t >= span.totalMs) {
    return {
      phase: "idle",
      advance: 0,
      clip: "idle",
      restart: p < span.totalMs,
      impact,
      done: true,
    };
  }
  if (t >= span.strikeEndMs) {
    const k = (t - span.strikeEndMs) / Math.max(1, o.style.returnMs);
    return {
      phase: "return",
      // 복귀는 1 → 0이다. 접근 클립을 뒤로 재생할 수는 없으므로 같은 클립을
      // 그대로 쓰고 좌우 반전은 `battleField`가 하지 않는다 — 뒤로 걷는 것이
      // 아니라 "물러난다"로 보이면 충분하다
      advance: 1 - returnCurve(k),
      clip: o.style.approach,
      restart: p < span.strikeEndMs,
      impact,
      done: false,
    };
  }
  if (t >= span.approachEndMs) {
    return {
      phase: "strike",
      advance: 1,
      clip: o.clip,
      restart: p < span.approachEndMs,
      impact,
      done: false,
    };
  }
  const k = t / Math.max(1, o.style.approachMs);
  return {
    phase: "approach",
    advance: approachCurve(k, o.style.approach),
    clip: o.style.approach,
    restart: p <= 0,
    impact,
    done: false,
  };
}

/**
 * 목표가 사라졌을 때 **지금 자리에서** 복귀로 갈아타는 경과 시각(ms).
 *
 * 호출자는 `elapsedMs`를 이 값으로 바꾼다. 그러면 다음 프레임의 `meleePose`가
 * `phase: "return"`을 내고, 그 프레임의 진행도는 **넘겨준 진행도와 같다** —
 * 좌표가 안 튄다. 이후는 평소 복귀와 완전히 같은 경로로 흘러 `done`까지 간다.
 *
 * 진행분을 0으로 눌러도 "복귀"처럼 보이긴 한다. 다만 그건 **한 프레임에**
 * 대기 자리로 순간이동하는 것이고, 공격 클립은 거기서 계속 재생된다.
 */
export function cutToReturnMs(advance: number, o: MeleeTimelineOpts): number {
  const span = meleeSpan(o);
  return (
    span.strikeEndMs +
    returnCurveInverse(advance) * Math.max(0, o.style.returnMs)
  );
}

/**
 * 한 사이클이 끝나고 다음 돌진까지 서 있는 시간(ms).
 *
 * 자동 공격 간격(`attackIntervalMs`)이 모션보다 짧다 — 리제는 700ms 간격인데
 * 접근+공격+복귀가 1.3초다. 간격에 맞춰 자르면 복귀 도중에 다시 뛰어나가
 * 제자리로 돌아오는 프레임이 없어져서 **계속 적에게 붙어 있는** 그림이 된다.
 * 그래서 모션이 끝난 뒤의 여유로만 간격을 반영하고, 최소한의 숨은 남긴다.
 */
export const MELEE_MIN_REST_MS = 90;

/** 아군마다 사이클 시작을 늦춘다 — 동시에 뛰면 둘이 한 덩어리로 보인다 */
export const MELEE_STAGGER_MS = 180;

export function restAfterMs(totalMs: number, attackIntervalMs: number): number {
  const gap =
    (Number.isFinite(attackIntervalMs) ? attackIntervalMs : 0) - totalMs;
  return Math.max(MELEE_MIN_REST_MS, gap);
}

/**
 * 밀린 피격 하나 — 코어가 확정했지만 아직 화면에 내지 않은 양.
 *
 * **왜 미루는가**: 코어의 딜은 초당 계약이라 매 틱(16.67ms) 조금씩 들어온다.
 * 그대로 반영하면 아군이 칼을 뽑기도 전에 HP가 줄어 있어서, 무엇이 적을 깎는지
 * 화면에 없다. 임팩트 프레임까지 모아 두고 그 순간에 한꺼번에 낸다.
 */
export interface PendingHit {
  /** 아직 숫자로 안 띄운 누적 딜 */
  dealt: number;
  /** 가장 최근에 통보된 남은 HP 비율. **합치지 않고 마지막 값을 쓴다** */
  hpRatio: number;
  killed: boolean;
  /** 버퍼에 들어온 뒤 지난 시간 */
  heldMs: number;
}

/**
 * 이 밀린 피격이 **이미 죽은 적의 것**인가.
 *
 * 코어는 전진 연출(1.2초)을 기다리지 않는다 — 마지막 적이 죽는 틱에 바로 다음
 * 웨이브를 로드하고, 그 뒤로 들어오는 피격은 같은 슬롯 번호를 쓰지만 **다른
 * 개체**다. 그걸 그냥 합치면 `killed`는 죽은 적에서 남고 `hpRatio`는 새 적에서
 * 와서 `hp=0.46 killed=true` 같은 값이 나온다 = 만피인 적이 쓰러진다.
 * (헤드리스 로그에서 이 조합을 보고 잡았다.)
 *
 * 새 개체의 HP는 `spawnWave`가 코어 값으로 스냅하므로, 여기서 할 일은
 * 묵은 결정타를 먼저 내보내고 새 피격을 **버리는** 것이다.
 */
export function pendingIsStale(prev: PendingHit | undefined): boolean {
  return prev?.killed === true;
}

/**
 * 이 슬롯의 밀린 피격에 새 피격을 합친다.
 *
 * `killed`는 한 번 서면 내려가지 않는다 — 처치 후 같은 슬롯에 넘친 딜이
 * 0으로 다시 들어오면 죽은 적이 안 죽는다. 세대가 바뀐 경우는 합치기 전에
 * `pendingIsStale`로 걸러야 한다.
 */
export function mergePending(
  prev: PendingHit | undefined,
  hit: { dealt: number; hpRatio: number; killed: boolean },
): PendingHit {
  const dealt = Number.isFinite(hit.dealt) && hit.dealt > 0 ? hit.dealt : 0;
  return {
    dealt: (prev?.dealt ?? 0) + dealt,
    hpRatio: Number.isFinite(hit.hpRatio) ? hit.hpRatio : (prev?.hpRatio ?? 0),
    killed: (prev?.killed ?? false) || hit.killed,
    heldMs: prev?.heldMs ?? 0,
  };
}

/**
 * 임팩트가 오지 않아도 이만큼 묵으면 다음 임팩트에 **같이** 터뜨린다.
 *
 * 앞 적이 죽는 틱에 넘친 딜이 뒤 적에게 들어가는데, 아군은 앞 적부터 차례로
 * 때리므로 뒤쪽 슬롯은 여러 사이클을 기다린다. 그 사이 HP바가 멈춰 있으면
 * "딜이 안 들어간다"로 읽힌다. 터지는 시점은 여전히 임팩트 프레임이다 —
 * 임팩트 밖에서 HP가 줄어드는 일은 없어야 한다.
 *
 * **상한은 가장 짧은 사이클보다 작아야 한다.** 다음 임팩트가 올 때 묵은 시간이
 * 이 값을 넘어 있어야 같이 터지는데, 사이클보다 크면 그 임팩트를 그냥 지나쳐
 * 뒤쪽 슬롯이 한 사이클 더 기다린다. 실측 최단 사이클이 755ms
 * (`metal_bladekeeper/attack2`)이므로 700은 55ms 여유로 통과한다 —
 * 1인 리듬으로 다시 유도해도 이 값은 살아남았다(고친 것은 아래 `HARD`다).
 * 아래 검사가 그 부등식을 `chars.json`·프리셋에서 매번 다시 계산한다
 * (`meleeRules.test.ts`).
 */
export const PENDING_MAX_HOLD_MS = 700;

/**
 * 임팩트를 아예 기대할 수 없을 때의 강제 방출 시각(ms).
 *
 * 전진 연출 중이거나 아군이 전부 사거리 밖에 묶여 있으면 임팩트가 오지 않는다.
 * 그러면 코어는 이미 죽인 적이 화면에 서 있고, 다음 웨이브 스폰과 어긋난다 —
 * 연출을 위해 상태를 잃는 것은 연출보다 나쁘다. 이쪽은 마지막 안전장치다.
 *
 * **그래서 가장 긴 사이클보다 커야 한다.** 이 값이 사이클보다 작으면 안전장치가
 * 진짜 임팩트를 앞질러서, 안전장치이기를 그만두고 **평시 경로**가 된다.
 *
 * 옛 값 1400은 2인 리듬에서 유도한 것이다: 아군 둘이 번갈아 때리면 임팩트가
 * 캐릭터 사이클의 절반 간격으로 와서 1400ms가 두 사이클 여유였다. 1인
 * (`SINGLE_TEAM_SIZE = 1`)이 되자 간격이 그대로 캐릭터 사이클이 됐고, 실측
 * 최장 사이클은 **2462ms**다(`fire_knight/special` — 스킬 돌진 스타일로 잰
 * 모션 전체 + 최소 휴식). 1400 < 2462이므로 안전장치가 먼저 열렸다: 헤드리스
 * 실측에서 방출 14회 중 **4회가 `why=hard`**였고, 그 뒤에 온 진짜 임팩트는
 * `dealt=0.0`으로 찍혔다 — 낼 딜을 안전장치가 이미 써 버린 것이다. 화면에서는
 * 임팩트 프레임에 HP가 안 줄고 엉뚱한 때 줄어드는 것으로 보인다 ("공격해도
 * 몬스터 체력이 안 단다").
 *
 * 여유를 두는 이유는 사이클이 dt 경계에 딱 떨어지지 않기 때문이다(한 프레임
 * 16.7ms가 밀리면 다시 안전장치가 이긴다). 진짜로 임팩트가 안 오는 경우는 이
 * 값을 기다리기 전에 명시적 플러시가 받는다 (`flushPending` — 웨이브 전환·하강
 * 시작). 부등식은 아래 검사가 지킨다 — 최장은 자동 공격 클립이 아니라
 * **스킬 클립**에 있으므로 손으로 세지 말 것.
 *
 * ## 2800 → 3800 (2026-08-10)
 *
 * 네 번째 공격 칸(`ATTACK_ROLES.ult`)이 캐릭터마다 **남은 한 클립**을 받으면서
 * 실비아·클로에·셀린의 `special`이 스킬 돌진에 처음 실렸다. 그 셋은 클립 자체가
 * 2.1~2.7초라 최장 사이클이 2462 → **3506ms**로 뛴다(`water_priestess/special`).
 * 즉 이 상수는 그 칸을 추가하자 조용히 부등식을 잃었고, 2800으로 두면 위에 적힌
 * 그 결함("공격해도 몬스터 체력이 안 단다")이 그 캐릭터에서 되돌아온다.
 *
 * 3800 = 3506 + 294(여유는 옛 비율 2800/2462과 같은 12%다). 그 칸의 쿨(4500)
 * 보다 작다 — 커지면 안전장치가 다음 시전 뒤로 밀려 두 사이클을 묵는다.
 */
export const PENDING_HARD_MS = 3800;

/**
 * 이번 임팩트에 함께 낼 슬롯 목록.
 *
 * @param target 지금 때린 슬롯
 * @param held 슬롯 → 묵은 시간(ms)
 */
export function releaseOrder(
  target: number,
  held: ReadonlyMap<number, number>,
): number[] {
  const out = held.has(target) ? [target] : [];
  for (const [i, ms] of held) {
    if (i !== target && ms >= PENDING_MAX_HOLD_MS) out.push(i);
  }
  // 앞 슬롯이 먼저 죽어야 한다 — 뒤가 먼저 쓰러지면 딜이 뒤에서 들어온 것처럼 보인다
  return out.sort((a, b) => a - b);
}

/**
 * 이번 공격에 쓸 클립. 캐릭터의 `clips`를 순환한다.
 *
 * 무작위로 고르면 같은 클립이 연달아 두세 번 나와서 "한 동작만 있다"로 보인다.
 * 순환은 지루하지만 **모든 클립이 반드시 보인다** — 넷을 구별하는 것이 목적이다.
 */
export function pickClip(style: MeleeStyle, attackCount: number): AttackClip {
  const n = style.clips.length;
  if (n === 0) return "attack1";
  const i = Number.isFinite(attackCount) ? Math.floor(attackCount) : 0;
  return style.clips[((i % n) + n) % n] as AttackClip;
}

/**
 * 적을 향해 걸어 들어오는 규칙 (§적 등장).
 *
 * 적도 처음부터 슬롯에 서 있으면 "배치된 그림"이지 "다가온 적"이 아니다.
 * 화면 오른쪽 밖에서 자기 슬롯까지 걸어 들어온다.
 *
 * @returns 0 = 화면 밖 시작 위치, 1 = 자기 슬롯
 */
export const ENEMY_WALK_IN_MS = 620;
/** 화면 밖 시작 거리 — 필드 폭 대비. 슬롯에서 이만큼 오른쪽에서 출발한다 */
export const ENEMY_WALK_IN_OFFSET = 0.22;
/** 슬롯마다 조금씩 늦게 출발한다 — 동시에 들어오면 한 덩어리로 보인다 */
export const ENEMY_WALK_IN_STAGGER_MS = 90;

export interface WalkInPose {
  /** 슬롯 위치까지의 진행 0..1 */
  arrive: number;
  /** 아직 걷는 중인가 (`walk` 클립을 재생해야 한다) */
  walking: boolean;
}

export function walkInPose(elapsedMs: number, slotIndex: number): WalkInPose {
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const i = Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
  // 뒤쪽 슬롯이 먼저 출발한다 — 앞사람이 뒷사람을 가리므로, 뒤가 먼저 자리를
  // 잡으면 들어오는 줄이 앞에서 뒤로 채워지는 것으로 보인다
  const delay = i * ENEMY_WALK_IN_STAGGER_MS;
  const k = (t - delay) / ENEMY_WALK_IN_MS;
  if (k >= 1) return { arrive: 1, walking: false };
  if (k <= 0) return { arrive: 0, walking: true };
  // 감속 — 슬롯에 미끄러져 들어오지 않고 멈춰 선다
  return { arrive: 1 - (1 - k) * (1 - k), walking: true };
}

/**
 * 적 제자리 공격 연출의 박자 (유저 신고: "몬스터들이 공격 모션을 안 해").
 *
 * **왜 연출만인가.** 적의 피해량은 이 게임에 없다 — 승패는 "내가 적을 얼마나
 * 빨리 녹이는가"다(대전은 속도 경쟁). 그래서 여기서 데미지를 만들지 않는다.
 * 그런데 적이 영원히 `run`만 돌리면 **맞고만 있는 허수아비**로 보인다.
 * 때리는 동작이 없으면 플레이어는 위협을 못 느끼고, 위협이 없으면 강화를
 * 왜 사는지도 안 보인다.
 *
 * **주기를 상수로 박지 않는다.** 잡몹 클립 길이가 286ms(medieval_king)에서
 * 1357ms(slime)까지 4.7배 벌어져 있다. 하나의 숫자로 정하면 slime은 클립이
 * 끝나기도 전에 다음 스윙이 들어와 **첫 프레임으로 되돌아가는 딸꾹질**이
 * 되고, medieval_king은 1초 넘게 굳어 있다. 실제 클립 길이에서 유도한다
 * (`derived-constants-need-their-derivation`).
 */
export const ENEMY_ATTACK_GAP_MS = 900;
/**
 * 슬롯마다 주기를 어긋나게 한다. 넷이 같은 프레임에 휘두르면 네 마리가 아니라
 * **한 덩어리**로 읽힌다 (`layered-fx-need-time-spread`와 같은 이유).
 */
export const ENEMY_ATTACK_STAGGER_MS = 210;

/**
 * 이 슬롯이 다음 스윙까지 기다리는 시간(ms).
 *
 * @param clipMs 실제 재생될 공격 클립 길이. 0이면(클립을 못 찾으면) 쉬는 시간만 남는다
 * @param slotIndex 적 슬롯 번호 — 뒤 슬롯일수록 늦게 휘두른다
 */
export function enemyAttackPeriodMs(
  clipMs: number,
  slotIndex: number,
): number {
  const clip = Number.isFinite(clipMs) ? Math.max(0, clipMs) : 0;
  const i = Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
  return clip + ENEMY_ATTACK_GAP_MS + i * ENEMY_ATTACK_STAGGER_MS;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
