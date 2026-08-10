import { expect, test } from "vitest";
import { AIOpponentSource } from "../src/ai/aiOpponentSource";
import { STRATEGY_PRESETS } from "../src/ai/strategy";
import { PresetLoadoutProvider, PRESET_SKILLS } from "../src/loadout/preset";
import { Battle } from "../src/core/battle";
import { isInterferenceEvent } from "../src/core/types";
import type { MemberDamage } from "../src/core/team";

const me = (rawDamage: number): MemberDamage[] => [{ memberId: "me", rawDamage }];

function makeAi(seed = 5, teamSize = 2) {
  const lo = new PresetLoadoutProvider().load(teamSize);
  return new AIOpponentSource({
    seed,
    teamSize,
    characters: lo.characters,
    skills: [...PRESET_SKILLS],
  });
}

test("produces a damage snapshot from auto-attacks", () => {
  const ai = makeAi();
  const u = ai.poll(1000);
  expect(u.snapshot).not.toBeNull();
  expect(u.snapshot!.rawDamage).toBeGreaterThan(0);
});

test("more team members means more damage", () => {
  const two = makeAi(5, 2).poll(2000).snapshot!.rawDamage;
  const three = makeAi(5, 3).poll(2000).snapshot!.rawDamage;
  expect(three).toBeGreaterThan(two);
});

test("same seed produces the same damage sequence", () => {
  const a = makeAi(11);
  const b = makeAi(11);
  for (const t of [200, 400, 600, 800]) {
    expect(a.poll(t).snapshot!.rawDamage).toBe(b.poll(t).snapshot!.rawDamage);
  }
});

test("emits well-formed interference events stamped fromTeam 1", () => {
  const ai = makeAi(3);
  const events = [];
  for (let t = 200; t <= 90_000; t += 200) events.push(...ai.poll(t).events);
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    expect(isInterferenceEvent(e)).toBe(true);
    expect(e.fromTeam).toBe(1);
  }
});

test("event ids are unique across a long match", () => {
  const ai = makeAi(3);
  const ids: string[] = [];
  for (let t = 200; t <= 90_000; t += 200) ids.push(...ai.poll(t).events.map((e) => e.eventId));
  expect(new Set(ids).size).toBe(ids.length);
});

/**
 * 쿨다운은 **멤버마다** 지켜진다 (인원당 추적기 하나 — 소스의 `members` 결정 기록).
 *
 * 1인 팀으로 물어야 이 계약이 드러난다: 2인 팀은 두 명이 각자 쿨을 소비하므로
 * 팀 전체로는 12초 안에 두 번 나가는 것이 정상이다(내 팀도 나 + 팀원이 그렇다).
 * 예전 이 테스트는 팀 간격을 12초로 물어서, 인원을 인원수만큼 세우는 순간
 * 깨졌다 — 팀 간격이 계약이 아니었기 때문이다.
 */
test("respects skill cooldowns — one member cannot fire interference twice within its cooldown", () => {
  const ai = makeAi(3, 1);
  let last = -Infinity;
  for (let t = 200; t <= 90_000; t += 200) {
    for (const e of ai.poll(t).events) {
      if (e.kind !== "slow") continue;
      expect(t - last).toBeGreaterThanOrEqual(12_000); // corrupt_chains cooldown
      last = t;
    }
  }
});

/**
 * 인원이 늘면 **시전도 같은 비율로** 늘어난다.
 *
 * 이게 깨져 있던 것이 "방치해도 이기는 대전"의 원인이었다: 소스가 `teamSize`를
 * 자동 공격에만 쓰고 스킬에는 안 써서, 2인 팀 상대가 1인분만 시전했다(내 팀
 * 224회 대 상대 105회, 2.13배). 위 쿨다운 테스트는 그 상태에서 통과했다 —
 * 팀 간격을 물으면 시전이 모자란 쪽이 오히려 더 잘 통과한다.
 */
test("interference count scales with team size — a 2-man team casts about twice", () => {
  const countFor = (teamSize: number): number => {
    const ai = makeAi(3, teamSize);
    let n = 0;
    for (let t = 200; t <= 120_000; t += 200) n += ai.poll(t).events.length;
    return n;
  };
  const one = countFor(1);
  const two = countFor(2);
  expect(one).toBeGreaterThan(0);
  // 난수가 갈려 있으므로 정확히 2배는 아니다 — 1인분에 머무는 것만 잡으면 된다
  expect(two).toBeGreaterThan(one * 1.5);
});

test("a harasser strategy emits more interference than rush", () => {
  const countFor = (preset: keyof typeof STRATEGY_PRESETS): number => {
    const ai = makeAi(3);
    ai.setStrategy(STRATEGY_PRESETS[preset]);
    let n = 0;
    for (let t = 200; t <= 120_000; t += 200) n += ai.poll(t).events.length;
    return n;
  };
  expect(countFor("harasser")).toBeGreaterThanOrEqual(countFor("rush"));
});

test("Battle runs to completion against the AI with no code change (AC-5)", () => {
  const ai = makeAi(7);
  const b = new Battle({ seed: 7, teamSize: 2, timeLimitMs: 60_000, opponent: ai });
  for (let i = 0; i < 4000 && b.state.phase === "running"; i++) b.tick(me(120), 16);
  expect(b.state.phase).toBe("finished");
});

test("polling backwards in time does not produce negative damage", () => {
  const ai = makeAi();
  ai.poll(5000);
  expect(ai.poll(1000).snapshot!.rawDamage).toBeGreaterThanOrEqual(0);
});
