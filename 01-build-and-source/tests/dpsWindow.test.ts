import { expect, test } from "vitest";
import { Battle } from "../src/core/battle";
import { createCastQueue } from "../src/core/castQueue";
import { createCooldownTracker } from "../src/core/cooldown";
import { DPS_WINDOW_MS, createDpsWindow } from "../src/core/dpsWindow";
import { dpsToPush } from "../src/core/gauge";
import { autoAttackDamage } from "../src/core/team";
import { SNAPSHOT_INTERVAL_MS } from "../src/net/publisher";
import { AIOpponentSource } from "../src/ai/aiOpponentSource";
import { PresetLoadoutProvider } from "../src/loadout/preset";

const STEP = 1000 / 60;

/**
 * 창 크기는 사람 상대의 스냅샷 주기와 **같아야** 한다. 다르면 두 경로(AI전·사람전)의
 * 평활도가 달라져서, 같은 실력이 상대가 누구인지에 따라 다른 결과를 낸다.
 * L1은 `src/net`을 import할 수 없으므로 이 테스트가 두 값을 잇는다.
 */
test("창 크기는 스냅샷 주기와 같다", () => {
  expect(DPS_WINDOW_MS).toBe(SNAPSHOT_INTERVAL_MS);
});

test("평평한 입력은 그대로 초당 값이 된다", () => {
  const w = createDpsWindow();
  // dps 600 = 16.7ms에 10딜
  let last = 0;
  for (let i = 0; i < 30; i++) last = w.push(10, STEP);
  expect(last).toBeCloseTo(600, 6);
});

test("빈 창은 0이다", () => {
  expect(createDpsWindow().value()).toBe(0);
});

test("창을 넘긴 오래된 표본은 빠진다", () => {
  const w = createDpsWindow(100);
  // 100ms 동안 dps 1000
  for (let i = 0; i < 10; i++) w.push(10, 10);
  expect(w.value()).toBeCloseTo(1000, 6);
  // 그 뒤 100ms를 조용히 보내면 옛 딜은 창에서 사라진다
  for (let i = 0; i < 10; i++) w.push(0, 10);
  expect(w.value()).toBe(0);
});

/**
 * 창보다 긴 한 방(탭 복귀·저사양 프레임 드롭)이 사라지면 그 딜은 게이지에
 * 영원히 반영되지 않는다. 마지막 표본은 항상 남아야 한다.
 */
test("창보다 긴 한 방도 사라지지 않는다", () => {
  const w = createDpsWindow(200);
  expect(w.push(100, 1000)).toBeCloseTo(100, 6);
  expect(w.value()).toBeCloseTo(100, 6);
});

test("망가진 입력은 창을 오염시키지 않는다", () => {
  const w = createDpsWindow();
  w.push(10, STEP);
  const before = w.value();
  // dt가 0/음수/비유한이면 표본이 아니다 — 현재 값을 그대로 준다
  expect(w.push(999, 0)).toBe(before);
  expect(w.push(999, -5)).toBe(before);
  expect(w.push(999, Number.NaN)).toBe(before);
  // 딜이 망가진 것은 0으로 접는다 (구간은 흘렀으므로 표본은 들어간다)
  w.push(Number.NaN, STEP);
  expect(Number.isFinite(w.value())).toBe(true);
  w.push(-100, STEP);
  expect(w.value()).toBeGreaterThanOrEqual(0);
});

/**
 * **이 테스트가 #12의 회귀 가드다.**
 *
 * `dpsToPush`는 `sqrt`이므로 프레임 단위로 재면 몰아서 낸 딜이 깎인다
 * (Jensen: `mean(sqrt(x)) ≤ sqrt(mean(x))`). 실측으로 20.0% 손실이었다 —
 * 스킬을 쓸수록 손해라는 뜻이고, 유저에게는 "큰 숫자가 뜨는데 바가 안 움직인다"로
 * 보인다. 창으로 평활하면 그 손실이 줄어야 한다.
 */
test("창은 스파이크 딜의 push 손실을 줄인다", () => {
  // 같은 총딜을 (a) 몰아서 (b) 고르게 낸 두 경우
  const burst = (win: number | null): number => {
    const w = win === null ? null : createDpsWindow(win);
    let pushSum = 0;
    const frames = 60; // 1초
    for (let i = 0; i < frames; i++) {
      // 400ms(24프레임)에 600딜을 몰아 낸다 = SKILL_SPREAD_MS와 같은 모양
      const raw = i < 24 ? 600 / 24 : 0;
      const dps = w === null ? (raw / STEP) * 1000 : w.push(raw, STEP);
      pushSum += dpsToPush(dps);
    }
    return pushSum / frames;
  };
  const framewise = burst(null);
  const windowed = burst(DPS_WINDOW_MS);
  expect(windowed).toBeGreaterThan(framewise);
  // 손실이 절반 이상 회복돼야 의미가 있다. 이상적(고르게 낸) push는 sqrt(600)
  const ideal = dpsToPush(600);
  const lossBefore = ideal - framewise;
  const lossAfter = ideal - windowed;
  expect(lossAfter).toBeLessThan(lossBefore * 0.5);
});

/**
 * 창이 있어도 **총딜의 순서**는 보존돼야 한다 — 더 많이 때린 쪽이 더 많이 밀어야
 * 한다. 평활이 이 순서를 뒤집으면 게이지가 거짓말을 한다.
 */
test("더 많이 때린 쪽이 더 많이 민다", () => {
  const run = (perFrame: number): number => {
    const w = createDpsWindow();
    let sum = 0;
    for (let i = 0; i < 120; i++) sum += dpsToPush(w.push(perFrame, STEP));
    return sum;
  };
  expect(run(10)).toBeGreaterThan(run(5));
  expect(run(5)).toBeGreaterThan(run(1));
});

/**
 * 상대 스냅샷이 없는 틱에 창을 0으로 채우면 사람 상대(200ms 배치)의 dps가
 * 톱니가 된다 — 12프레임 조용 → 창 절반이 0. 직전 값을 유지하는 것이 계약이다.
 */
test("스냅샷이 없는 틱은 상대 dps를 유지한다", () => {
  let pollCount = 0;
  const battle = new Battle({
    seed: 1,
    teamSize: 2,
    opponent: {
      poll: () => {
        pollCount++;
        // 첫 틱에만 스냅샷을 준다 (200ms에 200딜 = dps 1000)
        return pollCount === 1
          ? { snapshot: { rawDamage: 200, atMs: 0, windowMs: 200 }, events: [] }
          : { snapshot: null, events: [] };
      },
    },
  });
  battle.tick([], STEP);
  const first = battle.state.theirDps;
  expect(first).toBeCloseTo(1000, 6);
  // 이후 12프레임(=200ms) 동안 소식이 없어도 값이 떨어지지 않는다
  for (let i = 0; i < 12; i++) battle.tick([], STEP);
  expect(battle.state.theirDps).toBeCloseTo(first, 6);
});

/**
 * `windowMs`가 없는 스냅샷은 "이미 초당 값"이라는 계약이다 (스크립트 상대·테스트).
 * 창에 넣을 때 단위를 맞추지 않으면 그 상대가 60배 강해진다.
 */
test("windowMs 없는 스냅샷도 초당 값으로 읽는다", () => {
  const battle = new Battle({
    seed: 1,
    teamSize: 2,
    opponent: {
      poll: () => ({ snapshot: { rawDamage: 500, atMs: 0 }, events: [] }),
    },
  });
  for (let i = 0; i < 20; i++) battle.tick([], STEP);
  expect(battle.state.theirDps).toBeCloseTo(500, 3);
});

/**
 * 창을 넣으면서 양 팀이 같은 처리를 받는지 — 같은 딜 패턴이면 게이지가
 * 움직이지 않아야 한다. 한쪽만 평활하면 그쪽이 구조적으로 유리해진다.
 */
test("같은 딜 패턴이면 게이지는 제자리다", () => {
  const loadout = new PresetLoadoutProvider().load(2);
  /**
   * **AI에게 방해 칸을 주지 않는다.** 예전 주석은 "AI도 스킬을 쓰지만 그건
   * 대칭 조건이 아니므로 dps만 비교한다"였는데 그게 틀렸다: `slow`는 코어가
   * **내** 원딜에 `SLOW_DAMAGE_MULT`(0.6)를 곱하므로(`core/battle.ts`) AI의
   * 시전이 이 수의 기대값을 바꾼다. 5초 창 안에 룰렛이 방해를 안 뽑았을 때만
   * 통과하던 것이고, 6번째 칸이 붙어 뽑는 순서가 밀리자 실제로 깨졌다
   * (58.86 = 98.10 × 0.6).
   *
   * 기대값에 0.6을 곱해 맞추면 안 된다 — 이 수가 재려는 것은 창의 평활도이지
   * 룰렛이 무엇을 뽑았는지가 아니다. 조건을 실제로 대칭으로 만든다.
   */
  const ai = new AIOpponentSource({
    seed: 11,
    teamSize: 2,
    characters: loadout.characters,
    skills: loadout.skills.filter((s) => s.kind === "attack"),
  });
  const battle = new Battle({ seed: 11, teamSize: 2, opponent: ai });
  const casts = createCastQueue();
  const cd = createCooldownTracker(loadout.skills);
  // 우리는 자동 공격만 낸다 — 창이 평평한 입력을 왜곡하지 않아야 한다
  for (let i = 0; i < 60 * 5; i++) {
    const nowMs = battle.state.elapsedMs;
    void cd.readySkills(nowMs);
    const members = [
      ...autoAttackDamage(loadout.characters.slice(0, 2), STEP),
      ...casts.drain(STEP),
    ];
    battle.tick(members, STEP);
    // 우리 dps는 자동 공격만이라 평평하다 — 창이 그 값을 왜곡하지 않아야 한다
    expect(battle.state.myDps).toBeGreaterThan(0);
    /**
     * **대조군.** 감속이 한 프레임이라도 걸렸다면 위의 "방해 칸을 뺐다"가
     * 무효가 된 것이고, 아래 기대값은 0.6이 곱해진 채로 통과할 수 없다.
     * 여기서 물어야 결과 숫자가 아니라 **조건**이 깨진 것을 알 수 있다.
     */
    expect(battle.state.slowUntilMs).toBe(0);
  }
  // 자동 공격 dps는 캐릭터 스탯의 합이다 (물의 사제 40/900 + 잎의 궁수 44/820)
  expect(battle.state.myDps).toBeCloseTo(40 / 0.9 + 44 / 0.82, 0);
});
