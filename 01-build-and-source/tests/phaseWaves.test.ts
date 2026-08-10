import { describe, expect, it } from "vitest";
import {
  MINIBOSS_HP_MULT,
  NAMED_BOSS_HP_MULT,
  PHASE_RESET_FEEL_FLOOR,
  SINGLE_HP_GROWTH,
  SOLO_HP_SCALE,
  SINGLE_MINION_BASE_HP,
  floorKindOf,
  floorOfWaveIndex,
  generateFloorEnemies,
  generatePhaseWaves,
  minionHpAtFloor,
  earlyRampHpMul,
  EARLY_RAMP_MULT,
  SOLO_MINION_FLOORS,
  mixFloorSeed,
  singleFloorHpMul,
  singleMinionBaseHpOf,
} from "../src/core/phase/phaseWaves";
import { FINAL_FLOOR } from "../src/core/phase/floors";

describe("floorKindOf — 보스 주기 (100층 네임드 > 10층 미니 > 잡몹)", () => {
  it("100의 배수 층은 네임드 보스다 (10의 배수이기도 하지만 네임드가 이긴다)", () => {
    expect(floorKindOf(100)).toBe("boss");
    expect(floorKindOf(1000)).toBe("boss");
    expect(floorKindOf(9900)).toBe("boss");
  });

  it("10의 배수 층(100의 배수 제외)은 미니보스다", () => {
    expect(floorKindOf(10)).toBe("miniboss");
    expect(floorKindOf(90)).toBe("miniboss");
    expect(floorKindOf(110)).toBe("miniboss");
  });

  it("나머지는 잡몹 층이다", () => {
    expect(floorKindOf(1)).toBe("minions");
    expect(floorKindOf(99)).toBe("minions");
    expect(floorKindOf(101)).toBe("minions");
  });

  /** 9,999는 100의 배수가 아니다 — 최종 층 연출은 세션 몫이고 여기선 규칙만 지킨다 */
  it("9,999층 자체는 잡몹 층이다 (엔딩 연출은 웨이브 규칙 밖)", () => {
    expect(floorKindOf(FINAL_FLOOR)).toBe("minions");
  });
});

describe("HP 곡선 — 페이즈 리셋 + 1.06 복리", () => {
  it("페이즈 첫 층은 배율 1이다", () => {
    expect(singleFloorHpMul(1)).toBeCloseTo(1);
    expect(singleFloorHpMul(1001)).toBeCloseTo(1);
    expect(singleFloorHpMul(9001)).toBeCloseTo(1);
  });

  it("페이즈 안에서 단조 증가한다", () => {
    expect(singleFloorHpMul(500)).toBeGreaterThan(singleFloorHpMul(499));
    expect(singleFloorHpMul(1000)).toBeGreaterThan(singleFloorHpMul(999));
  });

  it("100층 잡몹은 1층의 약 322배다 (1.12였다면 7.3만 배 — 데모에서 못 만난다)", () => {
    const ratio = minionHpAtFloor(100) / minionHpAtFloor(1);
    expect(ratio).toBeCloseTo(Math.pow(SINGLE_HP_GROWTH, 99), 6);
    expect(ratio).toBeLessThan(1000);
  });

  it("페이즈 경계에서 HP가 내려간다 — 1,001층은 직전 페이즈 801층 체감이다", () => {
    expect(minionHpAtFloor(1001)).toBeLessThan(minionHpAtFloor(1000));
    expect(minionHpAtFloor(1001)).toBeCloseTo(
      SINGLE_MINION_BASE_HP * Math.pow(SINGLE_HP_GROWTH, PHASE_RESET_FEEL_FLOOR),
    );
    expect(minionHpAtFloor(1001)).toBeCloseTo(
      minionHpAtFloor(PHASE_RESET_FEEL_FLOOR + 1),
    );
  });

  it("9,999층까지 유한하다", () => {
    expect(Number.isFinite(minionHpAtFloor(FINAL_FLOOR))).toBe(true);
    expect(Number.isFinite(singleMinionBaseHpOf(9))).toBe(true);
  });
});

describe("generateFloorEnemies — 층 하나의 무리", () => {
  it("같은 (seed, floor)는 항상 같은 무리다", () => {
    const a = generateFloorEnemies(42, 37);
    const b = generateFloorEnemies(42, 37);
    expect(a).toEqual(b);
  });

  it("seed가 다르면 잡몹 구성이 달라질 수 있다 (300층 표본에서 최소 한 층)", () => {
    let differs = 0;
    for (let floor = 1; floor <= 300; floor++) {
      if (floorKindOf(floor) !== "minions") continue;
      const a = generateFloorEnemies(1, floor);
      const b = generateFloorEnemies(2, floor);
      if (JSON.stringify(a) !== JSON.stringify(b)) differs += 1;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it("잡몹 층은 1~4마리, 개체 HP는 기준의 ±15% 안이다", () => {
    for (const seed of [3, 7, 11, 42]) {
      for (const floor of [1, 7, 53, 999]) {
        const enemies = generateFloorEnemies(seed, floor);
        expect(enemies.length).toBeGreaterThanOrEqual(1);
        expect(enemies.length).toBeLessThanOrEqual(4);
        // **도입부 덧댐을 곱한 값이 기준이다.** `minionHpAtFloor`만 쓰면 1·7층에서
        // ±15% 밖으로 나가는데, 그건 편차가 깨진 것이 아니라 기준을 잘못 든 것이다
        const base = minionHpAtFloor(floor) * earlyRampHpMul(floor);
        for (const e of enemies) {
          expect(e.isBoss).toBe(false);
          // **`goldHp`로 묻는다** — 편차는 배율 전 값의 성질이고, `hp`에는
          // `SOLO_HP_SCALE`이 곱해져 있다
          expect(e.goldHp).toBeGreaterThanOrEqual(Math.floor(base * 0.85));
          expect(e.goldHp).toBeLessThanOrEqual(Math.ceil(base * 1.15));
        }
      }
    }
  });

  it("미니보스 층은 편차 없는 1마리 × 6배다 (표시 HP는 SOLO_HP_SCALE 적용)", () => {
    // 기대값을 손으로 계산하지 않고 배율식으로 적는다 —
    // `derived-constants-need-their-derivation`
    const goldHp = Math.round(
      minionHpAtFloor(10) * earlyRampHpMul(10) * MINIBOSS_HP_MULT,
    );
    expect(generateFloorEnemies(42, 10)).toEqual([
      {
        id: "f10-mini",
        isBoss: true,
        hp: Math.round(goldHp * SOLO_HP_SCALE),
        goldHp,
      },
    ]);
  });

  it("네임드 보스 층은 편차 없는 1마리 × 20배다 (표시 HP는 SOLO_HP_SCALE 적용)", () => {
    const goldHp = Math.round(
      minionHpAtFloor(100) * earlyRampHpMul(100) * NAMED_BOSS_HP_MULT,
    );
    expect(generateFloorEnemies(42, 100)).toEqual([
      {
        id: "f100-boss",
        isBoss: true,
        hp: Math.round(goldHp * SOLO_HP_SCALE),
        goldHp,
      },
    ]);
  });

  it("id는 층 번호를 품는다 — pickEnemySlug 해시가 층마다 다른 종을 고르게", () => {
    for (const e of generateFloorEnemies(42, 37)) {
      expect(e.id.startsWith("f37-")).toBe(true);
    }
  });
});

describe("generatePhaseWaves — 창(window) 생성", () => {
  it("WaveDef.index는 배열 위치가 아니라 실제 층 번호다", () => {
    const waves = generatePhaseWaves(42, 51, 5);
    expect(waves.map((w) => w.index)).toEqual([51, 52, 53, 54, 55]);
  });

  /**
   * 층의 무리는 (seed, floor)로만 결정된다 — 어느 구간으로 잘라 만들어도
   * 같은 층은 같은 무리다. 이게 깨지면 러너 창을 갈아탈 때마다 적이 바뀐다.
   */
  it("청크 경계 무관: 다른 창에서 만든 같은 층은 완전히 같다", () => {
    const wide = generatePhaseWaves(42, 1, 60);
    const narrow = generatePhaseWaves(42, 25, 10);
    for (let i = 0; i < narrow.length; i++) {
      expect(narrow[i]).toEqual(wide[24 + i]);
    }
  });

  it("9,999층을 넘는 요청은 거기서 잘리고, 최소 1층은 나온다", () => {
    const tail = generatePhaseWaves(42, FINAL_FLOOR - 3, 100);
    expect(tail.length).toBe(4);
    expect(tail[tail.length - 1]?.index).toBe(FINAL_FLOOR);

    const last = generatePhaseWaves(42, FINAL_FLOOR, 100);
    expect(last.length).toBe(1);
    expect(last[0]?.index).toBe(FINAL_FLOOR);
  });

  it("floorOfWaveIndex는 창 시작층 + 러너 인덱스다", () => {
    expect(floorOfWaveIndex(51, 0)).toBe(51);
    expect(floorOfWaveIndex(51, 4)).toBe(55);
    expect(floorOfWaveIndex(FINAL_FLOOR, 10)).toBe(FINAL_FLOOR);
  });
});

describe("mixFloorSeed — 층별 독립 시드", () => {
  it("층이 다르면 시드가 다르다 (1..2000 전수)", () => {
    const seen = new Set<number>();
    for (let floor = 1; floor <= 2000; floor++) {
      seen.add(mixFloorSeed(42, floor));
    }
    expect(seen.size).toBe(2000);
  });

  it("uint32 범위를 지킨다", () => {
    for (const floor of [1, 5000, FINAL_FLOOR]) {
      const s = mixFloorSeed(0xffffffff, floor);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("goldHp — 배율 전 HP를 적이 직접 들고 있다 (§3-2)", () => {
  /**
   * **왜 적이 두 HP를 들고 있는가.** `SOLO_HP_SCALE`을 표시 HP에만 곱하면
   * `goldForKill(enemy.hp)`가 깎인 HP를 보고 수입도 깎는다 — 실측으로 hp×0.5에서도
   * 100F가 133s에서 안 내려갔다(기준선 106s). HP를 깎으면 강화가 늦어지고 그
   * 상쇄가 손잡이를 먹는다(`balance-knob-cant-replace-missing-structure`:
   * 스칼라 하나로는 두 계약이 겹치는 값이 없다).
   *
   * 두 값을 **한 객체가** 들고 있어야 "어느 HP로 골드를 주는가"가 호출부마다
   * 갈리지 않는다.
   */
  it("잡몹의 hp는 goldHp × SOLO_HP_SCALE이다", () => {
    for (const floor of [1, 7, 37, 250, 1000]) {
      for (const e of generateFloorEnemies(42, floor)) {
        expect(e.hp, `f${floor}/${e.id}`).toBe(
          Math.round(e.goldHp * SOLO_HP_SCALE),
        );
      }
    }
  });

  /** 보스도 같은 배율이다 — 보스만 예외로 두면 100F 보스 앞에서 페이스가 튄다 */
  it("미니보스·네임드 보스도 같은 배율을 받는다", () => {
    for (const floor of [10, 100]) {
      const [e] = generateFloorEnemies(42, floor);
      expect(e!.hp).toBe(Math.round(e!.goldHp * SOLO_HP_SCALE));
      expect(e!.isBoss).toBe(true);
    }
  });

  /**
   * **`SOLO_HP_SCALE`이 1이 아니라는 것을 묻는다.** 위 두 검사는 배율이 1이어도
   * 통과한다 — 그러면 이 작업이 아무것도 안 한 상태로 조용히 통과한다
   * (`no-absolute-thresholds-on-weights`의 "측정 불가를 성공으로 취급").
   */
  it("배율이 실제로 HP를 깎는다", () => {
    expect(SOLO_HP_SCALE).toBeLessThan(1);
    expect(SOLO_HP_SCALE).toBeGreaterThan(0.5);
    const e = generateFloorEnemies(42, 37)[0]!;
    expect(e.hp).toBeLessThan(e.goldHp);
  });
});

describe("도입부 HP 덧댐 — 개막 일제 사격이 일곱 층을 관통하지 못하게", () => {
  it("1층이 EARLY_RAMP_MULT배, 자연 성장이 따라잡는 층에서 정확히 1배다", () => {
    expect(earlyRampHpMul(1)).toBeCloseTo(EARLY_RAMP_MULT, 6);
    // 합류 층을 손으로 적지 않는다 — 배수와 성장률에서 유도한다
    const join = Math.ceil(1 + Math.log(EARLY_RAMP_MULT) / Math.log(SINGLE_HP_GROWTH));
    expect(earlyRampHpMul(join)).toBe(1);
    expect(earlyRampHpMul(join - 1)).toBeGreaterThan(1);
    // 유도값이 실제로 도입부 구간이어야 한다 (배수를 키워 100층까지 끌면
    // 그건 도입부 손잡이가 아니라 게임 전체 밸런스다)
    expect(join).toBeGreaterThan(SOLO_MINION_FLOORS);
    expect(join).toBeLessThan(100);
  });

  it("덧댐은 단조 감쇠하고, 어떤 층도 1배 아래로 내려가지 않는다", () => {
    // **1 아래로 내려가면 덧댐이 아니라 벌점이다** — "천천히 만들어 달라"는
    // 요청에 일부 층을 더 빠르게 만드는 함수가 섞여 들어오는 사고를 막는다
    let prev = Number.POSITIVE_INFINITY;
    for (let f = 1; f <= 200; f++) {
      const m = earlyRampHpMul(f);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
  });

  it("층 HP가 앞 층보다 낮아지는 층이 없다 — 폐기한 두 감쇠꼴에는 있었다", () => {
    // 폐기 1) 곱셈 `MULT^(1-k)`: 층당 1.28배씩 빠지는데 성장은 1.06배뿐이라
    //   8·9층이 앞 층보다 얇아졌다(실측 체류 0.10s·0.08s).
    // 폐기 2) 덧셈 `1+(MULT-1)(1-k)`: 완만하지만 구간 끝에 27% 절벽이 남았다.
    // 둘 다 대조군으로 같이 잰다 — 이 검사가 겨냥한 갈래를 정말 밟는지
    // 확인해야 한다 (`controls-must-hit-target-branch`).
    const SPAN = 20;
    const geo = (f: number) =>
      f > SPAN ? 1 : Math.pow(EARLY_RAMP_MULT, 1 - (f - 1) / SPAN);
    const add = (f: number) =>
      1 + (EARLY_RAMP_MULT - 1) * Math.max(0, 1 - (f - 1) / SPAN);
    const worstDrop = (mul: (f: number) => number): number => {
      let worst = 0;
      for (let f = 2; f <= 120; f++) {
        const hp = minionHpAtFloor(f) * mul(f);
        const prev = minionHpAtFloor(f - 1) * mul(f - 1);
        worst = Math.max(worst, 1 - hp / prev);
      }
      return worst;
    };

    // 문턱 1%는 1,000 HP 막대에서 10 HP — 화면에서 구별되는 최소 폭이다.
    // 실측 하락폭은 곱셈꼴 5.5%(층마다), 덧셈꼴 27%(구간 끝 절벽)로 둘 다
    // 이보다 훨씬 크다. 채택한 꼴은 정확히 0이므로 문턱값 선택이 판정을
    // 가르지 않는다 — 두 값이 붙어 있으면 이 검사는 문턱 튜닝이 된다
    expect(worstDrop(geo)).toBeGreaterThan(0.01);
    expect(worstDrop(add)).toBeGreaterThan(0.01);

    // 채택한 평탄꼴 — 하락이 없다. 부동소수 오차만 허용한다
    expect(worstDrop(earlyRampHpMul)).toBeLessThan(1e-9);
  });

  it("덧댐은 표시 HP와 골드에 **함께** 들어간다", () => {
    // HP만 올리면 초반 골드 수입이 배수만큼 줄어 강화가 늦어진다 —
    // 도입부만 늦추려던 것이 게임 전체를 늦춘다
    const e = generateFloorEnemies(42, 1)[0]!;
    const base = minionHpAtFloor(1);
    expect(e.goldHp).toBeGreaterThan(base * (EARLY_RAMP_MULT - 1));
    expect(e.hp).toBe(Math.round(e.goldHp * SOLO_HP_SCALE));
  });

  it("SOLO_MINION_FLOORS까지는 한 마리, 그 다음 층부터 무리가 나온다", () => {
    for (const seed of [3, 7, 11, 42]) {
      for (let f = 1; f <= SOLO_MINION_FLOORS; f++) {
        if (floorKindOf(f) !== "minions") continue;
        expect(generateFloorEnemies(seed, f)).toHaveLength(1);
      }
    }
    // 11층부터는 여러 마리가 나오는 층이 실제로 있다 — 규칙이 영구히 켜져
    // 있으면 "한 마리 층"이 도입부 규칙이 아니라 게임 전체가 된다
    let multi = 0;
    for (let f = SOLO_MINION_FLOORS + 1; f <= SOLO_MINION_FLOORS + 20; f++) {
      if (generateFloorEnemies(42, f).length > 1) multi += 1;
    }
    expect(multi).toBeGreaterThan(0);
  });
});
