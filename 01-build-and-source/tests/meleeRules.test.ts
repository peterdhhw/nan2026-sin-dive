import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOSS_SLUGS,
  CHAR_MANIFEST_URL,
  HERO_SLUGS,
  MINION_SLUGS,
  type CharManifest,
} from "../src/shared/charManifest";
import { MAX_VISIBLE_ENEMIES } from "../src/shared/battleFieldRules";
import {
  ENEMY_ATTACK_GAP_MS,
  ENEMY_WALK_IN_MS,
  ENEMY_WALK_IN_OFFSET,
  ENEMY_WALK_IN_STAGGER_MS,
  MELEE_MIN_REST_MS,
  PENDING_HARD_MS,
  PENDING_MAX_HOLD_MS,
  approachCurve,
  approachCurveInverse,
  clipDurationMs,
  enemyAttackPeriodMs,
  cutToReturnMs,
  impactDelayMs,
  meleePose,
  meleeSpan,
  mergePending,
  pendingIsStale,
  pickClip,
  releaseOrder,
  restAfterMs,
  returnCurve,
  returnCurveInverse,
  walkInPose,
  type MeleeStyle,
  type MeleeTimelineOpts,
} from "../src/shared/meleeRules";
import { ATTACK_ROLES, PresetLoadoutProvider, attackSkillId } from "../src/loadout/preset";
import { skillMelee, skillStyle } from "../src/shared/skillMeleeRules";

/** 우리 고정 타임스텝. 임팩트 판정이 이 격자와 어긋나면 안 된다 */
const STEP = 1000 / 60;

const RUN: MeleeStyle = {
  approach: "run",
  approachMs: 200,
  returnMs: 300,
  reach: 0.2,
  clips: ["attack1", "attack2"],
};

const opts = (over: Partial<MeleeTimelineOpts> = {}): MeleeTimelineOpts => ({
  style: RUN,
  strikeMs: 857,
  impactAtMs: 500,
  clip: "attack1",
  ...over,
});

/** 타임라인을 고정 스텝으로 끝까지 돌린다 — 실제 루프와 같은 방식으로 검증한다 */
function runTimeline(o: MeleeTimelineOpts, steps = 400) {
  const impacts: number[] = [];
  const phases: string[] = [];
  const clips: string[] = [];
  const advances: number[] = [];
  /** 임팩트 프레임의 진행도·국면 — "때린 자리"가 대기 자리가 아니어야 한다 */
  const impactAdvances: number[] = [];
  const impactPhases: string[] = [];
  let t = 0;
  let done = false;
  for (let i = 0; i < steps && !done; i++) {
    const prev = t;
    t += STEP;
    const pose = meleePose(t, prev, o);
    if (pose.impact) {
      impacts.push(t);
      impactAdvances.push(pose.advance);
      impactPhases.push(pose.phase);
    }
    if (phases[phases.length - 1] !== pose.phase) phases.push(pose.phase);
    if (pose.restart) clips.push(pose.clip);
    advances.push(pose.advance);
    done = pose.done;
  }
  return {
    impacts,
    phases,
    clips,
    advances,
    impactAdvances,
    impactPhases,
    endMs: t,
  };
}

describe("clipDurationMs / impactDelayMs", () => {
  it("프레임 수 ÷ fps다", () => {
    expect(clipDurationMs(12, 12)).toBe(1000);
    expect(clipDurationMs(12, 14)).toBeCloseTo(857.14, 1);
  });

  it("fps가 0이나 NaN이면 12로 떨어진다 — 0으로 나눠 Infinity가 나오면 임팩트가 영원히 안 온다", () => {
    expect(clipDurationMs(12, 0)).toBe(1000);
    expect(clipDurationMs(12, NaN)).toBe(1000);
    expect(Number.isFinite(impactDelayMs(3, 12, 0))).toBe(true);
  });

  it("임팩트 지연은 항상 클립 길이보다 짧다 — 같거나 크면 클립이 끝난 뒤에 맞는다", () => {
    for (const frames of [8, 9, 12]) {
      for (let i = 0; i < frames + 3; i++) {
        expect(impactDelayMs(i, frames, 14)).toBeLessThan(
          clipDurationMs(frames, 14),
        );
      }
    }
  });

  it("0번 프레임 임팩트는 0ms다 — 첫 프레임에 때리는 클립도 있다", () => {
    expect(impactDelayMs(0, 12, 14)).toBe(0);
  });
});

describe("approachCurve", () => {
  it("0에서 0, 1에서 1 — 끝점이 어긋나면 캐릭터가 순간이동한다", () => {
    for (const k of ["run", "roll"] as const) {
      expect(approachCurve(0, k)).toBe(0);
      expect(approachCurve(1, k)).toBe(1);
    }
  });

  it("단조 증가다 — 접근 중에 뒤로 물러나면 안 된다", () => {
    for (const k of ["run", "roll"] as const) {
      let prev = -1;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = approachCurve(t, k);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  /**
   * 넷을 구별하는 것이 이 필드의 목적이다. 곡선이 같으면 클립만 다르고
   * 움직임은 똑같아서 "색이 다른 같은 사람"으로 돌아간다.
   */
  it("roll이 run보다 앞이 빠르다 — 굴르기는 튕겨 나가고 달리기는 발을 딛는다", () => {
    for (const t of [0.15, 0.25, 0.35]) {
      expect(approachCurve(t, "roll")).toBeGreaterThan(
        approachCurve(t, "run") + 0.05,
      );
    }
  });

  it("범위를 벗어난 입력은 물린다", () => {
    expect(approachCurve(-3, "run")).toBe(0);
    expect(approachCurve(9, "roll")).toBe(1);
    expect(approachCurve(NaN, "run")).toBe(0);
  });

  /**
   * 역함수의 존재 이유: 스킬 시전이 진행 중인 사이클을 끊고 갈아탈 때
   * **지금 서 있는 자리에서** 이어 붙어야 한다. 경과를 0으로 되돌리면 적 앞에
   * 있던 아군이 대기 자리로 순간이동하고, 비율을 그대로 시각으로 쓰면(선형
   * 가정) 다음 프레임에 위치가 한 번 튄다.
   */
  it("역함수가 곡선을 정확히 되돌린다 — 갈아타는 프레임에 위치가 튀면 안 된다", () => {
    for (const k of ["run", "roll"] as const) {
      for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        const a = approachCurve(t, k);
        expect(approachCurveInverse(a, k), `${k}@${t}`).toBeCloseTo(t, 6);
      }
    }
  });

  it("역함수도 범위를 물린다 — 진행도는 0..1 밖으로 안 나간다", () => {
    for (const k of ["run", "roll"] as const) {
      expect(approachCurveInverse(-1, k)).toBe(0);
      expect(approachCurveInverse(2, k)).toBe(1);
      expect(approachCurveInverse(NaN, k)).toBe(0);
    }
  });

  it("이미 붙어 있으면 접근을 통째로 건너뛴다", () => {
    // 1이 1로 돌아와야 남은 접근 시간이 0이 된다 — 아니면 붙어 선 채로
    // 달리기 루프를 몇 프레임 더 돌고 나서야 칼이 나간다
    expect(approachCurveInverse(1, "run")).toBe(1);
    expect(approachCurveInverse(1, "roll")).toBe(1);
  });

  it("복귀 곡선은 감속이다 — 절반 시간에 절반 넘게 온다", () => {
    expect(returnCurve(0.5)).toBeGreaterThan(0.5);
    expect(returnCurve(0)).toBe(0);
    expect(returnCurve(1)).toBe(1);
  });
});

describe("meleeSpan", () => {
  it("국면이 순서대로 쌓인다", () => {
    const s = meleeSpan(opts());
    expect(s.approachEndMs).toBe(200);
    expect(s.strikeEndMs).toBeCloseTo(1057, 0);
    expect(s.totalMs).toBeCloseTo(1357, 0);
  });

  it("임팩트가 접근 시간만큼 밀린다 — 클립 안의 시각이므로", () => {
    expect(meleeSpan(opts()).impactAtMs).toBe(700);
  });

  it("임팩트가 클립보다 길다고 주어져도 클립 안에 갇힌다", () => {
    const s = meleeSpan(opts({ strikeMs: 400, impactAtMs: 9999 }));
    expect(s.impactAtMs).toBeLessThanOrEqual(s.strikeEndMs);
  });

  it("임팩트는 항상 접근이 끝난 뒤다 — 앞이면 붙기 전에 HP가 깎인다", () => {
    for (const i of [-100, 0, 50, 5000]) {
      const s = meleeSpan(opts({ impactAtMs: i }));
      expect(s.impactAtMs).toBeGreaterThanOrEqual(s.approachEndMs);
    }
  });
});

describe("meleePose", () => {
  it("한 사이클에 임팩트가 정확히 한 번이다 — 두 번이면 HP가 두 번 깎인다", () => {
    const r = runTimeline(opts());
    expect(r.impacts).toHaveLength(1);
  });

  /**
   * 이 종류의 버그는 화면에서 "가끔 안 아프다"로만 드러나 원인을 못 찾는다.
   * 고정 스텝이 임팩트 시각을 정확히 밟는 경우가 없으므로 크로싱으로 판정한다.
   */
  it("어떤 임팩트 시각이든 스텝 격자에서 빠지지 않는다", () => {
    for (let imp = 0; imp < 900; imp += 7) {
      const r = runTimeline(opts({ impactAtMs: imp }));
      expect(r.impacts, `impact=${imp}`).toHaveLength(1);
    }
  });

  it("임팩트는 공격 국면 안에서 터진다 — 달려가는 중이나 물러난 뒤가 아니다", () => {
    const o = opts();
    const s = meleeSpan(o);
    const at = runTimeline(o).impacts[0]!;
    expect(at).toBeGreaterThanOrEqual(s.approachEndMs);
    expect(at).toBeLessThanOrEqual(s.strikeEndMs + STEP);
  });

  it("국면이 접근 → 공격 → 복귀 → 대기 순서로만 간다", () => {
    expect(runTimeline(opts()).phases).toEqual([
      "approach",
      "strike",
      "return",
      "idle",
    ]);
  });

  it("접근·복귀는 이동 클립, 공격만 공격 클립이다", () => {
    const r = runTimeline(opts({ clip: "special" }));
    expect(r.clips).toEqual(["run", "special", "run", "idle"]);
  });

  it("advance는 0에서 시작해 1에 닿고 0으로 돌아온다 — 적 앞에 안 닿으면 접촉이 아니다", () => {
    const r = runTimeline(opts());
    expect(Math.max(...r.advances)).toBe(1);
    expect(r.advances[r.advances.length - 1]).toBe(0);
    for (const v of r.advances) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("done은 마지막 프레임에 한 번만 뜬다 — 계속 뜨면 사이클이 매 프레임 재시작한다", () => {
    const o = opts();
    const total = meleeSpan(o).totalMs;
    expect(meleePose(total, total - STEP, o).done).toBe(true);
    // 이미 끝난 뒤를 또 물어보면 restart는 내려간다
    expect(meleePose(total + 999, total + 900, o).restart).toBe(false);
  });

  it("접근 시간이 0이어도 죽지 않는다 — 0으로 나누면 advance가 NaN이 되어 캐릭터가 사라진다", () => {
    const zero = { ...RUN, approachMs: 0 };
    const r = runTimeline(opts({ style: zero }));
    for (const v of r.advances) expect(Number.isFinite(v)).toBe(true);
    expect(r.impacts).toHaveLength(1);
  });

  it("음수·NaN 시간에도 대기 자리에 있다", () => {
    for (const t of [-50, NaN]) {
      const p = meleePose(t, t, opts());
      expect(p.advance).toBe(0);
      expect(p.phase).toBe("approach");
    }
  });
});

/**
 * 목표가 도중에 죽었을 때(다른 아군이 먼저 죽였다) 어떻게 물러나는가.
 *
 * 예전 구현은 진행분을 **0으로 눌렀다**. 그러면 적 앞까지 달려간 아군이 한
 * 프레임에 대기 자리로 순간이동하고, `phase`는 여전히 `strike`라 공격 클립이
 * 거기서 계속 재생된다 — 실측으로 530ms 동안 대기 자리에서 허공을 휘둘렀다.
 * 화면에는 "공격액션이 먼저 되고 나중에 앞으로 간다"로 보였다.
 */
describe("cutToReturnMs — 목표가 죽으면 그 자리에서 물러난다", () => {
  it("복귀 곡선의 역함수가 곡선을 되돌린다", () => {
    for (const t of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      // 복귀는 1 → 0이므로 진행도는 `1 - returnCurve(t)`다
      const a = 1 - returnCurve(t);
      expect(returnCurveInverse(a), `@${t}`).toBeCloseTo(t, 6);
    }
  });

  it("역함수도 범위를 물린다", () => {
    expect(returnCurveInverse(-1)).toBe(1);
    expect(returnCurveInverse(2)).toBe(0);
    expect(returnCurveInverse(NaN)).toBe(1);
  });

  it("갈아탄 프레임의 진행도가 지금 서 있던 자리와 같다 — 좌표가 튀면 순간이동이다", () => {
    const o = opts();
    for (const at of [0.2, 0.5, 0.85, 1]) {
      const cut = cutToReturnMs(at, o);
      // 호출자는 elapsedMs를 cut으로 바꾼다. 그 시각의 자세를 그대로 물어본다
      const p = meleePose(cut, cut, o);
      expect(p.advance, `@${at}`).toBeCloseTo(at, 6);
    }
  });

  it("갈아탄 직후는 복귀 국면이다 — strike로 남으면 그 자리에서 계속 휘두른다", () => {
    const o = opts();
    for (const at of [0.2, 0.5, 1]) {
      const cut = cutToReturnMs(at, o);
      expect(meleePose(cut, cut - STEP, o).phase, `@${at}`).toBe("return");
    }
  });

  it("붙어 있던(1) 쪽이 대기 자리(0)보다 늦게 끝난다 — 멀리 있으면 더 걸어야 한다", () => {
    const o = opts();
    expect(cutToReturnMs(1, o)).toBeLessThan(cutToReturnMs(0.2, o));
    // 진행도 0이면 이미 자리다 — 복귀를 다 쓴 시각, 즉 사이클이 끝난다
    expect(cutToReturnMs(0, o)).toBeCloseTo(meleeSpan(o).totalMs, 6);
  });

  it("갈아탄 뒤에도 사이클은 끝까지 흐른다 — done이 안 오면 슬롯이 영원히 안 빈다", () => {
    const o = opts();
    let t = cutToReturnMs(0.7, o);
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      const prev = t;
      t += STEP;
      const p = meleePose(t, prev, o);
      // 물러나는 도중에 앞으로 다시 나가면 안 된다
      expect(p.advance).toBeLessThanOrEqual(0.7 + 1e-6);
      done = p.done;
    }
    expect(done).toBe(true);
  });

  it("복귀 도중에 목표가 죽어도 시각이 뒤로 가지 않는다 — 되감으면 물러나기가 늘어난다", () => {
    const o = opts();
    const span = meleeSpan(o);
    // 복귀 절반쯤 지난 시각의 진행도로 다시 계산하면 같은 시각이 나와야 한다
    const mid = span.strikeEndMs + o.style.returnMs * 0.5;
    const p = meleePose(mid, mid, o);
    expect(cutToReturnMs(p.advance, o)).toBeCloseTo(mid, 6);
  });
});

describe("pickClip", () => {
  it("순환한다 — 무작위면 같은 클립이 연달아 나와 동작이 하나로 보인다", () => {
    const got = [0, 1, 2, 3, 4].map((i) => pickClip(RUN, i));
    expect(got).toEqual([
      "attack1",
      "attack2",
      "attack1",
      "attack2",
      "attack1",
    ]);
  });

  it("모든 클립이 반드시 나온다", () => {
    const three: MeleeStyle = {
      ...RUN,
      clips: ["attack2", "attack1", "special"],
    };
    const seen = new Set([0, 1, 2].map((i) => pickClip(three, i)));
    expect(seen.size).toBe(3);
  });

  it("음수·NaN·빈 목록에도 유효한 클립을 준다", () => {
    expect(pickClip(RUN, -3)).toBe("attack2");
    expect(pickClip(RUN, NaN)).toBe("attack1");
    expect(pickClip({ ...RUN, clips: [] }, 5)).toBe("attack1");
  });
});

describe("restAfterMs", () => {
  it("공격 간격이 모션보다 길면 남는 시간만큼 쉰다", () => {
    expect(restAfterMs(600, 950)).toBe(350);
  });

  /**
   * 간격에 맞춰 모션을 자르면 복귀 도중에 다시 뛰어나가 **계속 적에게 붙어
   * 있는** 그림이 된다. 최소한의 숨은 남긴다.
   */
  it("모션이 간격보다 길어도 최소 대기는 남는다", () => {
    expect(restAfterMs(1357, 700)).toBe(MELEE_MIN_REST_MS);
    expect(restAfterMs(1357, 0)).toBe(MELEE_MIN_REST_MS);
    expect(restAfterMs(1357, NaN)).toBe(MELEE_MIN_REST_MS);
  });
});

describe("mergePending", () => {
  it("딜은 합치고 HP 비율은 마지막 값을 쓴다 — 비율을 더하면 1을 넘는다", () => {
    let p = mergePending(undefined, { dealt: 3, hpRatio: 0.9, killed: false });
    p = mergePending(p, { dealt: 4, hpRatio: 0.7, killed: false });
    expect(p.dealt).toBe(7);
    expect(p.hpRatio).toBe(0.7);
  });

  it("killed는 한 번 서면 내려가지 않는다 — 넘친 딜이 0으로 들어와 죽은 적이 안 죽는다", () => {
    let p = mergePending(undefined, { dealt: 9, hpRatio: 0, killed: true });
    p = mergePending(p, { dealt: 0, hpRatio: 0, killed: false });
    expect(p.killed).toBe(true);
  });

  it("묵은 시간은 합칠 때 리셋되지 않는다 — 매 틱 들어오면 영원히 안 터진다", () => {
    const first = mergePending(undefined, {
      dealt: 1,
      hpRatio: 0.5,
      killed: false,
    });
    first.heldMs = 400;
    const merged = mergePending(first, {
      dealt: 1,
      hpRatio: 0.4,
      killed: false,
    });
    expect(merged.heldMs).toBe(400);
  });

  /**
   * 실제로 겪은 버그다: 헤드리스 로그에 `hp=0.46 killed=true`가 찍혔다 —
   * 죽은 적의 `killed`와 다음 무리 적의 `hpRatio`가 한 버퍼에 섞였다.
   */
  it("결정타가 밀려 있으면 그 버퍼는 세대가 지난 것이다", () => {
    const lethal = mergePending(undefined, {
      dealt: 50,
      hpRatio: 0,
      killed: true,
    });
    expect(pendingIsStale(lethal)).toBe(true);
    expect(pendingIsStale(undefined)).toBe(false);
    expect(
      pendingIsStale(
        mergePending(undefined, { dealt: 5, hpRatio: 0.5, killed: false }),
      ),
    ).toBe(false);
  });

  it("음수·NaN 딜은 0으로 본다", () => {
    const p = mergePending(undefined, {
      dealt: NaN,
      hpRatio: 0.5,
      killed: false,
    });
    expect(p.dealt).toBe(0);
  });
});

describe("releaseOrder", () => {
  it("때린 슬롯은 묵은 시간과 무관하게 나온다", () => {
    expect(releaseOrder(1, new Map([[1, 0]]))).toEqual([1]);
  });

  it("밀린 것이 없는 슬롯을 때리면 아무것도 내지 않는다", () => {
    expect(releaseOrder(2, new Map([[0, 10]]))).toEqual([]);
  });

  it("한계까지 묵은 다른 슬롯도 같이 낸다 — 넘친 딜을 받은 뒤쪽이 영원히 기다린다", () => {
    const held = new Map([
      [0, 20],
      [2, PENDING_MAX_HOLD_MS + 10],
      [3, 100],
    ]);
    expect(releaseOrder(0, held)).toEqual([0, 2]);
  });

  it("앞 슬롯부터 낸다 — 뒤가 먼저 쓰러지면 딜이 뒤에서 들어온 것처럼 보인다", () => {
    const held = new Map([
      [3, PENDING_MAX_HOLD_MS],
      [1, PENDING_MAX_HOLD_MS],
      [2, 0],
    ]);
    expect(releaseOrder(2, held)).toEqual([1, 2, 3]);
  });

  it("강제 방출 한계가 묵힘 한계보다 늦다 — 앞이면 임팩트가 무의미해진다", () => {
    expect(PENDING_HARD_MS).toBeGreaterThan(PENDING_MAX_HOLD_MS);
  });
});

/**
 * 두 한계를 **실제 사이클로 다시 유도한다.**
 *
 * `PENDING_HARD_MS`는 "임팩트를 아예 기대할 수 없을 때"의 안전장치다. 그런데
 * 그 값이 사이클보다 짧으면 진짜 임팩트를 앞질러서 **평시 경로**가 된다 —
 * 그때 화면은 임팩트 프레임에 HP가 안 줄고(`dealt=0.0`) 엉뚱한 때 준다.
 * 옛 1400은 2인 리듬(아군 둘이 번갈아 → 임팩트 간격이 사이클의 절반)에서
 * 유도한 값이라 `SINGLE_TEAM_SIZE = 1`에서 최장 사이클 2084ms에 밀렸다:
 * 헤드리스 실측 방출 14회 중 4회가 `why=hard`였다.
 *
 * 그래서 상수를 베끼지 않고 `chars.json` + 프리셋에서 사이클을 매번 계산한다
 * (`derived-constants-need-their-derivation`). 클립을 길게 바꾸거나 공격
 * 간격을 늘린 날, 그 변경이 이 부등식을 깨면 여기서 걸린다.
 */
describe("밀린 피격 한계 × 실제 1인 사이클", () => {
  const manifest = JSON.parse(
    readFileSync(`public/${CHAR_MANIFEST_URL}`, "utf-8"),
  ) as CharManifest;

  /**
   * 캐릭터 하나가 한 번 때리고 다음에 때릴 때까지(ms). 자동 공격 순환은
   * 클립마다 길이가 다르므로 클립별로 잰다.
   *
   * **`SINGLE_TEAM_SIZE = 1`이라 이것이 곧 임팩트 간격이다.** 아군이 둘이면
   * 번갈아 때려 간격이 절반이 되지만, 1인에서는 나눌 상대가 없다.
   */
  const cycles = (): { label: string; ms: number }[] => {
    const out: { label: string; ms: number }[] = [];
    for (const slug of HERO_SLUGS) {
      const c = new PresetLoadoutProvider(slug).load(4).characters[0]!;
      const actions = manifest.chars[slug]!.actions;
      /**
       * 자동 공격이 순환하는 클립과 스킬이 지정하는 클립을 **둘 다** 센다 —
       * 스킬만 쓰는 `special`이 가장 긴 캐릭터가 있어서(fire_knight) 자동
       * 공격만 보면 최장을 놓친다.
       *
       * **스타일도 클립마다 다르다.** 프로덕션은 스킬 돌진에 `a.dashStyle`
       * (= `skillStyle`)을 쓴다 — 여기서 `c.melee`로 통일하면 접근·복귀가
       * 프로덕션과 갈려 최장이 2260ms로 과소평가된다(실제 2462ms).
       * 기준선은 프로덕션과 같아야 한다(`probe-baseline-must-equal-production`).
       */
      const styles = new Map<string, MeleeStyle>();
      for (const clip of c.melee.clips) styles.set(clip, c.melee);
      for (const role of ATTACK_ROLES) {
        const sk = skillMelee(attackSkillId(slug, role))!;
        styles.set(sk.clip, skillStyle(c.melee, sk));
      }
      for (const [clip, style] of styles) {
        const a = actions[clip];
        if (!a) continue;
        const span = meleeSpan({
          style,
          strikeMs: clipDurationMs(a.frames, a.fps),
          impactAtMs: impactDelayMs(a.impact!, a.frames, a.fps),
          clip: clip as MeleeTimelineOpts["clip"],
        });
        // 사이클 = 모션 전체 + 그 뒤 휴식. `restAfterMs`가 공격 간격까지 본다
        out.push({
          label: `${slug}/${clip}`,
          ms: span.totalMs + restAfterMs(span.totalMs, c.stats.attackIntervalMs),
        });
      }
    }
    return out;
  };

  test("강제 방출이 최장 사이클보다 늦다 — 빠르면 안전장치가 평시 경로가 된다", () => {
    const worst = cycles().reduce((m, c) => (c.ms > m.ms ? c : m));
    // 옛 값 1400은 여기서 죽는다 (최장 2084ms)
    expect(PENDING_HARD_MS, `최장 사이클 ${worst.label} = ${worst.ms.toFixed(0)}ms`)
      .toBeGreaterThan(worst.ms);
  });

  test("묵힘 한계가 최단 사이클보다 짧다 — 길면 다음 임팩트를 그냥 지나친다", () => {
    const best = cycles().reduce((m, c) => (c.ms < m.ms ? c : m));
    expect(PENDING_MAX_HOLD_MS, `최단 사이클 ${best.label} = ${best.ms.toFixed(0)}ms`)
      .toBeLessThan(best.ms);
  });
});

describe("walkInPose", () => {
  it("0에서 화면 밖, 끝에서 자기 슬롯이다", () => {
    expect(walkInPose(0, 0).arrive).toBe(0);
    expect(walkInPose(ENEMY_WALK_IN_MS, 0).arrive).toBe(1);
  });

  it("도착하면 걷기가 멈춘다 — 안 멈추면 제자리 걸음이 된다", () => {
    expect(walkInPose(0, 0).walking).toBe(true);
    expect(walkInPose(ENEMY_WALK_IN_MS + 1, 0).walking).toBe(false);
  });

  it("뒤 슬롯이 늦게 도착한다 — 동시에 들어오면 한 덩어리로 보인다", () => {
    const t = ENEMY_WALK_IN_MS * 0.6;
    expect(walkInPose(t, 0).arrive).toBeGreaterThan(walkInPose(t, 3).arrive);
  });

  it("스태거를 더해도 모두 결국 도착한다 — 못 도착하면 적이 화면 밖에 남는다", () => {
    for (let i = 0; i < 4; i++) {
      const end = ENEMY_WALK_IN_MS + ENEMY_WALK_IN_STAGGER_MS * i;
      expect(walkInPose(end, i).arrive, `slot=${i}`).toBe(1);
      expect(walkInPose(end, i).walking, `slot=${i}`).toBe(false);
    }
  });

  it("단조 증가다 — 걸어 들어오다 뒤로 밀리면 안 된다", () => {
    let prev = -1;
    for (let t = 0; t <= ENEMY_WALK_IN_MS; t += 20) {
      const v = walkInPose(t, 1).arrive;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("이상한 입력에도 0..1 안이다", () => {
    for (const [t, i] of [
      [NaN, 0],
      [-500, 2],
      [1e9, NaN],
    ] as const) {
      const v = walkInPose(t, i).arrive;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("등장 거리가 필드 폭 안이다 — 넘으면 상대 필드에서 걸어온다", () => {
    expect(ENEMY_WALK_IN_OFFSET).toBeGreaterThan(0.05);
    expect(ENEMY_WALK_IN_OFFSET).toBeLessThan(0.4);
  });
});

/**
 * 프리셋과 실제 에셋이 맞물리는지 본다. 스타일만 갈라 놓고 클립이 없으면
 * 대체 사슬을 타서 넷이 같은 동작을 한다 — 이 필드의 목적과 정반대다.
 */
describe("프리셋 근접 스타일 × 실제 에셋", () => {
  const manifest = JSON.parse(
    readFileSync(`public/${CHAR_MANIFEST_URL}`, "utf-8"),
  ) as CharManifest;
  const chars = new PresetLoadoutProvider().load(4).characters;

  test("네 캐릭터가 서로 다른 슬러그·스타일을 쓴다", () => {
    expect(new Set(chars.map((c) => c.charSlug)).size).toBe(4);
    const sigs = chars.map(
      (c) =>
        `${c.melee.approach}|${c.melee.approachMs}|${c.melee.reach}|${c.melee.clips.join(",")}`,
    );
    expect(new Set(sigs).size).toBe(4);
  });

  test("접근 동작이 한 종류로 몰려 있지 않다", () => {
    const kinds = chars.map((c) => c.melee.approach);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });

  test("프리셋이 쓰는 클립이 스프라이트에 실제로 있다", () => {
    for (const c of chars) {
      const actions = manifest.chars[c.charSlug]!.actions;
      expect(
        actions[c.melee.approach],
        `${c.charSlug}/${c.melee.approach}`,
      ).toBeDefined();
      for (const clip of c.melee.clips) {
        expect(actions[clip], `${c.charSlug}/${clip}`).toBeDefined();
      }
    }
  });

  test("공격 클립마다 임팩트 프레임이 있고 클립 안을 가리킨다", () => {
    for (const c of chars) {
      const actions = manifest.chars[c.charSlug]!.actions;
      for (const clip of c.melee.clips) {
        const a = actions[clip]!;
        expect(a.impact, `${c.charSlug}/${clip}`).toBeDefined();
        expect(a.impact!, `${c.charSlug}/${clip}`).toBeGreaterThanOrEqual(0);
        expect(a.impact!, `${c.charSlug}/${clip}`).toBeLessThan(a.frames);
      }
    }
  });

  /**
   * 임팩트가 첫 프레임이면 "칼을 뽑기 전에 HP가 깎인다"가 된다 —
   * bbox 로 임팩트를 재던 시절의 실제 버그다(임포터 `impact_frame` 주석).
   */
  test("임팩트가 클립 첫 프레임이 아니다", () => {
    for (const s of HERO_SLUGS) {
      for (const [name, a] of Object.entries(manifest.chars[s]!.actions)) {
        if (a.impact === undefined) continue;
        expect(a.impact, `${s}/${name}`).toBeGreaterThan(0);
      }
    }
  });

  test("실제 클립 길이로 타임라인을 돌려도 임팩트가 한 번이다", () => {
    for (const c of chars) {
      const actions = manifest.chars[c.charSlug]!.actions;
      for (const clip of c.melee.clips) {
        const a = actions[clip]!;
        const r = runTimeline({
          style: c.melee,
          strikeMs: clipDurationMs(a.frames, a.fps),
          impactAtMs: impactDelayMs(a.impact!, a.frames, a.fps),
          clip,
        });
        expect(r.impacts, `${c.charSlug}/${clip}`).toHaveLength(1);
      }
    }
  });

  /**
   * **스킬을 누르면 제자리에서 쓰지 않고 적까지 달려가서 때린다** (유저 요구).
   *
   * 21개 파생 스킬 전부를 실제 클립 길이로 돌려, 임팩트 프레임이 접근이 끝난
   * 뒤(`advance === 1`)에 오는지 본다. 접근 중에 임팩트가 오면 아군이 아직
   * 대기 자리 쪽에 있는데 적이 깎이는 그림이 된다 — 그게 "제자리에서 쓴다"다.
   *
   * 헤드리스로도 확인했다(`[strike] atRatio=1.00`). 다만 캡처는 그때 그 한
   * 판만 덮으므로, 스킬·캐릭터 조합 전체는 여기서 막는다.
   */
  test("21개 스킬 전부 임팩트가 접근 끝난 뒤에 온다 — 제자리에서 쓰지 않는다", () => {
    for (const slug of HERO_SLUGS) {
      const actions = manifest.chars[slug]!.actions;
      const provider = new PresetLoadoutProvider(slug);
      const lead = provider.load(4).characters[0]!;
      for (const role of ATTACK_ROLES) {
        const skill = skillMelee(attackSkillId(slug, role))!;
        const style = skillStyle(lead.melee, skill);
        const a = actions[skill.clip]!;
        const r = runTimeline({
          style,
          strikeMs: clipDurationMs(a.frames, a.fps),
          impactAtMs: impactDelayMs(a.impact!, a.frames, a.fps),
          clip: skill.clip,
        });
        const where = `${slug}/${role}(${skill.clip})`;
        expect(r.impacts, where).toHaveLength(1);
        // 딱 1이어야 한다. 0.9면 아직 달리는 중이고, 그건 접근이 안 끝난 것이다
        expect(r.impactAdvances[0], where).toBe(1);
        expect(r.impactPhases[0], where).toBe("strike");
      }
    }
  });

  /**
   * 위 테스트는 "끝까지 갔다"를 보지만 **얼마나 갔는지**는 안 본다. 사거리가
   * 1에 가까우면 `advance=1`이어도 대기 자리에서 몇 px 못 벗어나 눌러도
   * 달려가는 것이 안 보인다 — 헤드리스에서 실제로 `travel=233px`을 읽었다.
   * `1 - reach`가 이동 비율이므로 그것에 하한을 둔다.
   */
  test("돌진 거리가 눈에 보일 만큼 남는다 — 사거리가 이동을 다 먹지 않는다", () => {
    for (const slug of HERO_SLUGS) {
      const lead = new PresetLoadoutProvider(slug).load(4).characters[0]!;
      for (const role of ATTACK_ROLES) {
        const style = skillStyle(lead.melee, skillMelee(attackSkillId(slug, role))!);
        // 아군↔적 거리의 40% 이상은 실제로 이동한다
        expect(1 - style.reach, `${slug}/${role}`).toBeGreaterThan(0.4);
      }
    }
  });

  /**
   * 사거리 0이면 두 스프라이트가 한 덩어리로 뭉쳐 누가 때렸는지 안 보이고,
   * 1이면 대기 자리에서 안 움직여 돌진이 없다.
   */
  test("사거리가 0도 1도 아니다", () => {
    for (const c of chars) {
      expect(c.melee.reach, c.charSlug).toBeGreaterThan(0.05);
      expect(c.melee.reach, c.charSlug).toBeLessThan(0.6);
    }
  });

  test("모션 한 사이클이 지나치게 길지 않다 — 공격 간격의 배가 넘으면 딜이 화면과 무관해진다", () => {
    for (const c of chars) {
      const actions = manifest.chars[c.charSlug]!.actions;
      const worst = Math.max(
        ...c.melee.clips.map((clip) => {
          const a = actions[clip]!;
          return meleeSpan({
            style: c.melee,
            strikeMs: clipDurationMs(a.frames, a.fps),
            impactAtMs: 0,
            clip,
          }).totalMs;
        }),
      );
      expect(worst, c.charSlug).toBeLessThan(2200);
    }
  });
});

/**
 * 적 제자리 공격 연출의 박자.
 *
 * 유저 신고: "몬스터들이 공격 모션을 안 해. 이거 큰 문제야."
 *
 * 여기서 재는 것은 **딸꾹질이 없는가**다. 주기가 클립보다 짧으면 클립이 끝나기
 * 전에 다음 스윙이 들어와 첫 프레임으로 되돌아간다 — 화면에서는 "휘두르다가
 * 끊기는" 것으로 보이고, 그게 모션이 없는 것보다 나쁘다.
 */
describe("적 제자리 공격 박자", () => {
  const manifest = JSON.parse(
    readFileSync(`public/${CHAR_MANIFEST_URL}`, "utf-8"),
  ) as CharManifest;

  /** 적이 실제로 재생하는 클립 길이 — 잡몹·보스 전부. `attack1`만 있는 종이 대부분이다 */
  const enemyClipMs = (slug: string): number => {
    const a = manifest.chars[slug]!.actions["attack1"]!;
    return clipDurationMs(a.frames, a.fps);
  };

  test("모든 적 종족에서 주기가 자기 클립보다 길다 — 되감기 딸꾹질이 없다", () => {
    for (const slug of [...MINION_SLUGS, ...BOSS_SLUGS]) {
      const clip = enemyClipMs(slug);
      for (let i = 0; i < MAX_VISIBLE_ENEMIES; i++) {
        expect(
          enemyAttackPeriodMs(clip, i),
          `${slug}/slot${i}`,
        ).toBeGreaterThan(clip);
      }
    }
  });

  /**
   * **가장 긴 클립도 통과해야 의미가 있다.** 위 검사는 주기가 클립에서 유도되므로
   * 항상 통과한다 — 상수를 잘못 잡아도 조용히 초록불이다
   * (`no-absolute-thresholds-on-weights`). 실제 최장(slime 1357ms)을 이름으로
   * 확인해서, 유도식을 상수로 되돌리는 변경이 여기서 걸리게 한다.
   */
  test("최장 클립은 slime이고, 그 주기가 상수 하나(900ms)보다 크다", () => {
    const worst = [...MINION_SLUGS, ...BOSS_SLUGS]
      .map((s) => ({ s, ms: enemyClipMs(s) }))
      .sort((a, b) => b.ms - a.ms)[0]!;
    expect(worst.s).toBe("slime");
    expect(enemyAttackPeriodMs(worst.ms, 0)).toBeGreaterThan(
      ENEMY_ATTACK_GAP_MS,
    );
    expect(enemyAttackPeriodMs(worst.ms, 0)).toBeGreaterThan(worst.ms);
  });

  test("슬롯마다 주기가 다르다 — 넷이 같은 프레임에 휘두르지 않는다", () => {
    const clip = enemyClipMs("goblin");
    const periods = [0, 1, 2, 3].map((i) => enemyAttackPeriodMs(clip, i));
    expect(new Set(periods).size).toBe(4);
    // 어긋남이 한 프레임(60fps ≈ 17ms)보다 훨씬 크다 — 아니면 눈에 안 보인다
    expect(periods[1]! - periods[0]!).toBeGreaterThan(100);
  });

  /**
   * 주기가 너무 길면 "간간이 한 번 휘두르는 적"이라 위협이 안 된다. 층 하나가
   * 초반 페이싱에서 몇 초이므로, 한 층에 최소 한 번은 휘둘러야 한다.
   */
  test("가장 느린 적도 3초 안에 한 번은 휘두른다", () => {
    for (const slug of [...MINION_SLUGS, ...BOSS_SLUGS]) {
      for (let i = 0; i < MAX_VISIBLE_ENEMIES; i++) {
        expect(
          enemyAttackPeriodMs(enemyClipMs(slug), i),
          `${slug}/slot${i}`,
        ).toBeLessThan(3000);
      }
    }
  });

  test("이상한 입력에도 유한하다", () => {
    expect(enemyAttackPeriodMs(NaN, 0)).toBe(ENEMY_ATTACK_GAP_MS);
    expect(enemyAttackPeriodMs(-500, 0)).toBe(ENEMY_ATTACK_GAP_MS);
    expect(enemyAttackPeriodMs(100, -3)).toBe(ENEMY_ATTACK_GAP_MS + 100);
  });
});
