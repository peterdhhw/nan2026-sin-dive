import type { Loadout } from "./types";

/**
 * 로드아웃에 성장 배율을 먹인다 — **싱글에서 키운 팀으로 대전에 나가기 위한 것.**
 *
 * 설계 문서: docs/GAPS.md §5(성장), 기획서 §2(수익화 축의 "성장")
 *
 * ## 왜 배율을 받고 강화 레벨을 받지 않는가
 *
 * 강화 레벨(`UpgradeLevels`)은 `single/`의 개념이고 이 파일은 `pvp/`도 쓴다.
 * 레벨을 받으면 `pvp/` → `loadout/` → `single/`이 되어 "두 모드가 서로를
 * 잠근다"는 경계 규칙을 우회한다(CI가 `src/loadout/`을 층으로 세지 않으므로
 * **검사에 안 걸리고** 통과한다 — 그래서 여기 적어 둔다).
 *
 * 배율을 뽑는 것은 배선층(`main.ts`)의 일이다: `atkMulOf`·`attackIntervalMulOf`·
 * `skillMulOf`가 `single/economyRules.ts`에 있고, `main.ts`는 두 모드를 다 볼 수
 * 있는 유일한 자리다.
 *
 * ## 왜 스킬까지 곱하는가
 *
 * 싱글은 시전 시점에 곱한다(`single/session.ts`: `skill.power * skillMulOf`).
 * 대전에서 같은 짓을 하면 곱하는 곳이 두 벌이 되고, 한쪽만 고치면 "같은 스킬이
 * 모드마다 다른 딜"이 된다 — 그건 화면에서 숫자로만 보이니 눈에 안 띈다.
 * 여기서 **로드아웃에 구워 두면** 코어·AI·HUD가 전부 같은 값을 본다.
 */

export interface GrowthMuls {
  /** 자동 공격 딜 배율 (1 이상) */
  atkMul: number;
  /** 공격 **간격** 배율 (1 이하 — 작을수록 빠르다) */
  intervalMul: number;
  /** 스킬 위력 배율 (1 이상) */
  skillMul: number;
}

/** 성장이 없는 팀 — 저장값을 못 읽었을 때의 기본값이다 */
export const NO_GROWTH: GrowthMuls = {
  atkMul: 1,
  intervalMul: 1,
  skillMul: 1,
};

/**
 * 배율 하나를 안전한 값으로 접는다.
 *
 * **0·음수·NaN을 막는 이유**: 공격 간격이 0이나 NaN이 되면 팀이 **딜을 아예
 * 못 넣는다.** `autoAttackDamage`가 `interval > 0`을 검사해서 아니면 dps를 0으로
 * 두기 때문이다(코어는 `Infinity`를 만들지 않는다 — 거기서 이미 막혀 있다).
 * 그래서 증상은 "판이 터진다"가 아니라 **"아군이 칼은 휘두르는데 상대 게이지가
 * 안 움직인다"**다. 조용하고, 실력 문제로 보인다.
 *
 * 공격력 쪽 NaN은 더 조용하다: 게이지가 NaN이 되고 화면은 멈춘 것처럼 보인다.
 * 둘 다 "저장값이 조금 깨졌다"가 만들 수 있는 결과라 여기서 접는다.
 */
function safeMul(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 배율이 먹은 **새 로드아웃**을 만든다. 원본은 건드리지 않는다 — 프리셋 객체를
 * 제자리에서 고치면 다음 판이 곱해진 값에 또 곱한다(복리로 터진다).
 */
export function scaleLoadout(base: Loadout, muls: GrowthMuls): Loadout {
  const atkMul = safeMul(muls.atkMul, 1);
  const intervalMul = safeMul(muls.intervalMul, 1);
  const skillMul = safeMul(muls.skillMul, 1);
  return {
    characters: base.characters.map((c) => ({
      ...c,
      stats: {
        attack: c.stats.attack * atkMul,
        // 간격은 **곱하면 줄어든다**(배율 1 이하). 1ms 밑으로는 내리지 않는다 —
        // 상한 없는 강화가 아니지만(SPD_MAX_LEVEL) 배율의 출처가 저장값이므로
        // 여기서도 막는다
        attackIntervalMs: Math.max(1, c.stats.attackIntervalMs * intervalMul),
      },
      // melee.clips는 배열이다 — 얕은 복사로 공유하면 세션이 밀어 넣은 클립이
      // 프리셋에 남는다 (`preset.toLoadout`과 같은 근거)
      melee: { ...c.melee, clips: [...c.melee.clips] },
    })),
    /**
     * 스킬도 새 객체다. 쿨다운 추적기가 배열을 들고 있다(`presetSkillsFor` 주석).
     *
     * **공격 스킬만 곱한다.** 방해 스킬의 `power`는 딜이 아니라 감속률·시야
     * 차단 세기다(`corrupt_chains` 0.4 = 감속 40%) — 여기에 성장 배율을 곱하면
     * 강화를 산 사람의 감속이 100%를 넘어 상대가 아예 멈춘다. 싱글도 같은
     * 경계다: 그쪽은 방해 칸을 아예 안 싣는다(`single/session.ts`가
     * `attack | buff`만 통과시킨다).
     *
     * **타락 버프도 안 곱한다** (3단계). `power` 1.5는 딜이 아니라 **배수**라서
     * 강화가 곱하면 배수가 배수를 먹는다 — 공격 칸이 이미 `skillMul`을 받으므로
     * 버프까지 곱하면 같은 강화가 두 번 실린다.
     */
    skills: base.skills.map((s) =>
      s.kind === "attack" ? { ...s, power: s.power * skillMul } : { ...s },
    ),
  };
}
