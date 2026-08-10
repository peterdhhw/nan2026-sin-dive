import type { WaveDef } from "./types";

export interface EnemyHit {
  /** 현재 웨이브 안에서의 인덱스 — 렌더러의 적 슬롯과 1:1 대응 */
  enemyIndex: number;
  killed: boolean;
  /**
   * 이 적에게 실제로 들어간 딜. 데미지 숫자에 찍는 값이다 (설계 문서 07-4-4).
   * 요청 딜이 남은 HP보다 크면 남은 HP만큼만 들어간다 — 오버킬을 표시하지 않는다.
   */
  dealt: number;
  /** 피격 후 남은 HP 비율 0..1. HP바가 이 값을 따라간다 (설계 문서 02-C5) */
  hpRatio: number;
}

export interface WaveRunnerState {
  waveIndex: number;
  /** 마지막 웨이브를 몇 번 반복했는지 (제한시간까지 버티는 경우) */
  loops: number;
  enemyHp: number[];
  killCount: number;
}

export interface WaveRunner {
  readonly state: WaveRunnerState;
  readonly currentWave: WaveDef;
  /** 이번 틱의 팀 합산 딜을 적용하고, 연출용 피격 목록을 돌려준다. */
  applyDamage(rawDamage: number): EnemyHit[];
  /**
   * 이 웨이브로 **맞춘다** — 적 HP를 그 웨이브의 만피로 다시 깐다.
   *
   * 상/하 필드는 같은 층을 보여줘야 한다(설계 문서 07-8: "공용 웨이브이므로
   * 동기"). 두 러너가 각자 전진하면 인덱스가 벌어져서 위아래에 다른 종족이
   * 서고, 그러면 "같은 층을 누가 더 빨리 쓰는가"라는 대전의 전제가 화면에서
   * 사라진다. 상대 러너를 화면의 층에 맞추는 데 쓴다.
   *
   * `killCount`는 유지한다 — 처치 수는 그 팀이 실제로 쓰러뜨린 수이므로
   * 층을 맞추는 것과 무관하다. 같은 인덱스로 불러도 HP는 다시 깔린다
   * (마지막 웨이브 반복이 그 경우다 — 인덱스가 그대로고 loops만 오른다).
   */
  syncTo(waveIndex: number, loops?: number): void;
}

export interface WaveRunnerOpts {
  /**
   * 무리를 다 쓸었을 때 **스스로** 다음 웨이브로 넘어가는가. 기본 `true`.
   *
   * `false`는 따라가는 러너(상대 팀)가 쓴다 — 그 러너는 `syncTo`로만 층을
   * 옮긴다. 스스로 넘어가게 두면 두 필드의 층이 벌어져서 위아래에 다른 종족이
   * 선다(실측: 프레임의 96~98%에서 어긋났고 최대 5층 차이). 다 쓸고 나서
   * 다음 층까지 기다리는 그림은 정보다 — "상대는 이 층을 벌써 끝냈다"다.
   */
  autoAdvance?: boolean;
}

/**
 * @param startWaveIndex 시작 웨이브 인덱스(0-based). 범위 밖은 접는다.
 *   0이 아닌 값은 디버그 진입(`?wave=`)만 쓴다 — 웨이브 3의 심연 테마를
 *   스크린샷으로 검증하려면 실제 플레이로 60초를 기다려야 한다 (설계 문서 09-3).
 */
export function createWaveRunner(
  waves: readonly WaveDef[],
  startWaveIndex = 0,
  opts: WaveRunnerOpts = {},
): WaveRunner {
  if (waves.length === 0) throw new Error("waveRunner needs at least one wave");

  const clampIndex = (n: number): number =>
    Number.isFinite(n)
      ? Math.max(0, Math.min(waves.length - 1, Math.floor(n)))
      : 0;

  const autoAdvance = opts.autoAdvance !== false;
  let waveIndex = clampIndex(startWaveIndex);
  let loops = 0;
  let killCount = 0;
  let enemyHp: number[] = [];

  /** 웨이브 시작 시점의 최대 HP — hpRatio 계산에 쓴다 */
  let enemyMaxHp: number[] = [];

  const loadWave = (): void => {
    enemyHp = waves[waveIndex]!.enemies.map((e) => e.hp);
    enemyMaxHp = [...enemyHp];
  };
  loadWave();

  const advance = (): void => {
    if (waveIndex + 1 < waves.length) {
      waveIndex += 1;
    } else {
      // 웨이브가 끝나도 전투는 제한시간까지 계속된다 — 마지막 웨이브를 반복한다
      loops += 1;
    }
    loadWave();
  };

  return {
    get state(): WaveRunnerState {
      return { waveIndex, loops, enemyHp: [...enemyHp], killCount };
    },
    get currentWave(): WaveDef {
      return waves[waveIndex]!;
    },
    applyDamage(rawDamage: number): EnemyHit[] {
      if (!(rawDamage > 0)) return [];
      const hits: EnemyHit[] = [];
      let left = rawDamage;

      for (let i = 0; i < enemyHp.length && left > 0; i++) {
        const hp = enemyHp[i]!;
        if (hp <= 0) continue;
        const dealt = Math.min(hp, left);
        enemyHp[i] = hp - dealt;
        left -= dealt;
        const killed = enemyHp[i]! <= 0;
        if (killed) killCount += 1;
        const maxHp = enemyMaxHp[i] ?? 0;
        hits.push({
          enemyIndex: i,
          killed,
          dealt,
          // maxHp가 0인 웨이브 정의는 없지만, 0으로 나눠 NaN이 HP바로 흘러가면
          // 화면에서 원인을 찾기 어렵다
          hpRatio: maxHp > 0 ? Math.max(0, enemyHp[i]!) / maxHp : 0,
        });
      }

      // 남은 딜은 버린다 — 한 틱에 여러 웨이브가 사라지면 연출이 따라가지 못한다
      if (autoAdvance && enemyHp.every((hp) => hp <= 0)) advance();
      return hits;
    },
    syncTo(nextIndex: number, nextLoops?: number): void {
      waveIndex = clampIndex(nextIndex);
      if (nextLoops !== undefined && Number.isFinite(nextLoops)) {
        loops = Math.max(0, Math.floor(nextLoops));
      }
      loadWave();
    },
  };
}
