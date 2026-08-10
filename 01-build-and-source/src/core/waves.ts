import { createRng } from "./rng";
import type { EnemyDef, WaveDef } from "./types";

/**
 * PvP 층(웨이브) 생성.
 *
 * ## 왜 "개체 HP"가 아니라 "층 예산"인가 (2026-08-05)
 *
 * 예전 식은 `개체 HP = 100 × 1.12^(층-1) × 편차`였고 잡몹이 1~4마리였다.
 * 그러면 **무리 수가 층의 총 HP를 곱한다** — 같은 깊이인데 1마리 층과 4마리
 * 층의 총량이 4배 벌어져서, 층 하나에 걸리는 시간이 깊이와 무관하게 튀었다.
 * 실측(시드 3·7·11·42, 조작): 층 시간이 **0.07초~26.75초**였고 1~4층은
 * 0.1초 안에 지나갔다. 전진 연출이 1.2초이므로 그보다 짧은 층은 연출이 끝나기
 * 전에 다음 층이 넘어가고, `session.tickAdvance`의 `catchup`이 터져
 * `WAVE 1 클리어` → `WAVE 3`으로 층을 건너뛴 채 보여줬다 (118초 플레이에서 3회).
 *
 * `catchup`은 그 증상을 덮는 장치였고, 연출을 짧게 줄이는 것도 증상 처방이다.
 * 원인은 **층의 총 HP가 시간을 결정하지 않았다**는 것이므로, 층마다 목표 시간을
 * 정하고 그 시간에서 총 HP를 역산한다. 무리 수는 이제 예산을 **나눈다** —
 * 1마리든 4마리든 층 하나의 총량이 같고, 마리 수는 보이는 리듬만 바꾼다.
 *
 * ## 층당 성장률을 1.12에서 낮춘 이유
 *
 * 1.12는 우리 딜의 성장보다 빨랐다. 실측 팀 dps는 판 내내 거의 평평하고
 * (조작 520~590, 방치 300~340 — 강화가 없는 모드다) HP만 복리로 오르므로
 * 층 시간이 뒤로 갈수록 폭발했다: 20층이 16~29초. 층 시간의 **폭**을 상수로
 * 정하고(`FLOOR_TIME_SPAN`) 성장률을 거기서 역산한다.
 *
 * 상수를 이렇게 유도로 적는 이유: 예전처럼 `1.12`만 남으면 그 값이 어느 페이스를
 * 뜻했는지가 사라진다. 실제로 그 값은 "120초에 20층" 시절의 것이었는데 스킬
 * 5슬롯·딜 수치가 바뀐 뒤에도 그대로 남아 있었다.
 *
 * ## 여는 딜은 층 예산이 아니라 스킬 쪽이 막는다 (2026-08-05, 3단계)
 *
 * 6번째 칸(타락 버프 ×1.5)이 붙자 판 첫 프레임의 딜 폭이 2,721 → 4,082가 되어
 * 1층 예산(2,808)을 넘겼고 catchup이 되돌아왔다. **여기를 고치지 않았다** —
 * 예산을 올리면 모든 층이 같이 느려진다. 문제는 총량이 아니라 총량이 판의 첫
 * 1.4초에 몰린다는 것이다.
 *
 * 그때의 처방은 그 칸만 늦게 여는 `SkillDef.openingDelayMs`였다. 칸을 지우면서
 * (`loadout/preset.presetSkillsFor`) 그 필드도 같이 지웠다 — 유일한 소비자였다.
 * 부등식을 지키는 것은 이제 **여는 딜 자체가 작다**는 것이다: 네 공격 칸의 합이
 * 735딜로 옛 1,300보다 낮다(`ROLE_NUMBERS`). 즉 장치가 사라진 것이 아니라
 * 장치가 필요 없어졌고, 그 구분은 `tests/pacing.test.ts`의 여는 딜 검사가
 * 실측으로 계속 묻는다 — 딜을 올리다 예산을 넘기면 거기서 걸린다.
 */

/**
 * 층 하나의 목표 클리어 시간.
 *
 * **하한이 있다.** 층의 총 HP는 전진 연출(1.2초) 동안 우리가 낼 수 있는 최대
 * 딜보다 커야 한다 — 작으면 연출 중에 다음 층이 넘어가 `catchup`이 다시 터진다.
 * 실측 최대치는 판 시작 직후의 2,604딜(쿨다운 5개가 동시에 준비된 상태,
 * 40시드)이므로 목표 시간은 `2604 / TEAM_DPS_REF ≈ 5.0초`보다 커야 한다.
 * 5.4초는 그 하한에 7.8% 여유를 둔 값이다 (`tests/waves.test.ts`가 못 박는다).
 */
export const FLOOR_TARGET_MS = 5_400;

/**
 * 목표 시간을 HP로 환산할 때 쓰는 기준 팀 dps.
 *
 * 조작 플레이의 실측 평균이다(시드 3·7·11·42 × 120초: 516~587, 판 내내 평평).
 * 방치는 300 근처이므로 방치 플레이는 층당 약 1.8배 걸린다 — 그게 조작의 보상이다.
 */
export const TEAM_DPS_REF = 520;

/** 1층의 총 HP. 목표 시간 × 기준 dps — 개체 수와 무관한 **층 전체** 예산이다 */
export const WAVE_BASE_TOTAL_HP = Math.round(
  (FLOOR_TARGET_MS / 1000) * TEAM_DPS_REF,
);

/**
 * 한 판에서 내려가는 층수 (성장률 역산의 기준).
 *
 * 실측값이다 — 이 곡선으로 조작 플레이가 73~81초에 결판나고 그때 11~13층이다
 * (24시드). 희망치가 아니라 결과이므로, 딜이나 승패 조건을 바꾸면 여기도
 * 다시 재야 한다.
 */
export const WAVES_PER_MATCH = 13;

/**
 * 마지막 층이 첫 층의 몇 배 시간이 걸리는가.
 *
 * 1.0이면 깊이가 체감되지 않고, 예전 1.12는 실질 5배였다(0.1초 → 26초).
 * 1.5는 "뒤로 갈수록 확실히 무겁지만 벽은 아니다"의 값이다.
 */
export const FLOOR_TIME_SPAN = 1.5;

/**
 * 층당 총 HP 복리 증가율. **`FLOOR_TIME_SPAN`에서 유도한다 — 손으로 적지 않는다.**
 *
 * `growth^(WAVES_PER_MATCH - 1) = FLOOR_TIME_SPAN`이므로 첫 층과 마지막 층의
 * 시간 비가 정확히 그 폭이 된다. 값만 적으면 페이스를 바꿀 때 무엇을 뜻하는
 * 수인지 알 수 없다.
 */
export const HP_GROWTH_PER_WAVE = Math.pow(
  FLOOR_TIME_SPAN,
  1 / (WAVES_PER_MATCH - 1),
);

/** 5번째 웨이브마다 보스 */
export const BOSS_EVERY = 5;

/**
 * 보스 층의 총 HP = 그 깊이의 예산 × 이 값.
 *
 * 예전에는 보스가 `1000 × 1.12^(층-1)`이라 앞 층의 **3~5배**였고, 그 층에서만
 * 5~26초가 걸려 페이스가 5층마다 끊겼다. 1.4는 "잡몹 층보다 확실히 길지만
 * 멈춤은 아니다"다 — 실측으로 보스 층 9~13초, 잡몹 층 2.5~9초다.
 */
export const BOSS_HP_MULT = 1.4;

/** 잡몹 개체 HP 편차 폭 (±15%). 총합은 유지하고 **분배만** 흔든다 */
export const MINION_JITTER = 0.15;

/**
 * 이 깊이의 층 전체 HP 예산. 보스 층은 배율이 곱해진다.
 *
 * @param index 0-based 층 인덱스
 */
export function waveTotalHp(index: number): number {
  const depth = Math.max(0, Math.floor(index));
  const budget = WAVE_BASE_TOTAL_HP * Math.pow(HP_GROWTH_PER_WAVE, depth);
  return (depth + 1) % BOSS_EVERY === 0 ? budget * BOSS_HP_MULT : budget;
}

/**
 * seed로부터 결정론적 웨이브 목록을 만든다.
 * 양 팀이 같은 seed를 쓰면 네트워크 동기화 없이 동일한 적과 싸운다 (AC-4).
 */
export function generateWaves(seed: number, count: number): WaveDef[] {
  const rng = createRng(seed);
  const waves: WaveDef[] = [];

  for (let index = 0; index < count; index++) {
    const total = waveTotalHp(index);
    const isBossWave = (index + 1) % BOSS_EVERY === 0;
    const enemies: EnemyDef[] = [];

    if (isBossWave) {
      enemies.push({
        id: `w${index}-boss`,
        isBoss: true,
        hp: Math.round(total),
        // PvP에는 표시 HP 배율이 없다 — 2:2 팀 크기가 안 바뀐다(설계 §5)
        goldHp: Math.round(total),
      });
    } else {
      const n = 1 + rng.int(4); // 1..4
      /**
       * 예산을 **나눈다.** 개체별 ±15% 편차로 HP바 길이가 서로 다르게
       * 보이지만, 가중치를 합으로 정규화하므로 층의 총량은 마리 수와 무관하다 —
       * 곱셈이었던 것이 이 파일 머리 주석의 문제였다.
       */
      const weights: number[] = [];
      for (let i = 0; i < n; i++) {
        weights.push(1 - MINION_JITTER + rng.next() * MINION_JITTER * 2);
      }
      const sum = weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) {
        const hp = Math.max(1, Math.round((total * weights[i]!) / sum));
        enemies.push({
          id: `w${index}-m${i}`,
          isBoss: false,
          // 0 HP인 적은 이미 죽은 슬롯이 된다 — 마리 수가 많아도 최소 1은 준다
          hp,
          goldHp: hp, // PvP는 배율이 없다
        });
      }
    }

    waves.push({ index, enemies });
  }

  return waves;
}
