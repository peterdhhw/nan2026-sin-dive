/**
 * 소리 크기 설정의 순수 규칙 — 단계 순환·저장 파싱·라벨.
 *
 * ## 왜 이 파일이 있는가
 *
 * 이 규칙의 실패는 **전부 조용하다.** 기본값이 틀리면 커밋이 모든 소리를
 * 반으로 줄이고, 순환 방향이 틀리면 줄이려고 누른 탭이 소리를 키우고, 파싱이
 * 틀리면 저장된 값이 라벨로 표시할 수 없는 상태가 된다 — 셋 다 화면이 안
 * 죽는다. 그래서 부등식이 아니라 **값 자체**를 node가 묻는다.
 */

import { describe, expect, it } from "vitest";
import {
  AUDIO_STORAGE_KEY,
  DEFAULT_VOLUME,
  VOLUME_STEPS,
  isMuted,
  nearestVolume,
  nextVolume,
  parseVolume,
  serializeVolume,
  volumeLabel,
  volumeNotice,
} from "../src/shared/audioSettingsRules";

describe("단계 목록", () => {
  /**
   * **기본값이 출하된 소리와 같아야 한다.** 첫 항목이 1이 아니면 이 기능을
   * 켠 커밋이 아무 말 없이 모든 유저의 소리를 줄인다 — 버그 리포트가
   * "소리가 작아졌다"로 오지 않고 아예 안 온다.
   */
  it("첫 단계가 1(출하된 크기)이고 기본값이 그것이다", () => {
    expect(VOLUME_STEPS[0]).toBe(1);
    expect(DEFAULT_VOLUME).toBe(1);
  });

  /**
   * **내림차순이어야 한다.** 배지를 누르는 동기는 "시끄럽다"이므로 첫 탭이
   * 소리를 줄여야 한다. 오름차순이면 줄이려고 누른 사람이 더 크게 만든다.
   */
  it("내림차순이다 — 첫 탭이 소리를 줄인다", () => {
    for (let i = 1; i < VOLUME_STEPS.length; i += 1) {
      expect(VOLUME_STEPS[i]!).toBeLessThan(VOLUME_STEPS[i - 1]!);
    }
  });

  it("무음이 포함되고 모든 단계가 0~1이다", () => {
    expect(VOLUME_STEPS).toContain(0);
    for (const v of VOLUME_STEPS) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  /** 중간 단계가 있어야 3단계다 — ON/OFF면 "조금 시끄럽다"의 답이 완전 무음이다 */
  it("무음이 아닌 중간 단계가 있다", () => {
    const mid = VOLUME_STEPS.filter((v) => v > 0 && v < 1);
    expect(mid.length).toBeGreaterThanOrEqual(1);
  });

  /** 두 모드가 같은 설정을 본다 (docs/SAVE-SCHEMA.md §3 규칙 1) */
  it("저장 키가 sin.shared. 접두사를 쓴다", () => {
    expect(AUDIO_STORAGE_KEY.startsWith("sin.shared.")).toBe(true);
  });
});

describe("nextVolume — 탭 한 번", () => {
  it("첫 탭이 소리를 줄인다", () => {
    expect(nextVolume(DEFAULT_VOLUME)).toBeLessThan(DEFAULT_VOLUME);
  });

  it("단계 수만큼 누르면 제자리로 돌아온다", () => {
    let v: number = VOLUME_STEPS[0];
    const seen = [v];
    for (let i = 0; i < VOLUME_STEPS.length; i += 1) {
      v = nextVolume(v);
      seen.push(v);
    }
    // 마지막이 처음과 같고, 그 전까지는 전부 다른 값이다(제자리 도돌이 금지)
    expect(seen[seen.length - 1]).toBe(seen[0]);
    expect(new Set(seen.slice(0, -1)).size).toBe(VOLUME_STEPS.length);
  });

  it("모든 단계를 거친다 — 어느 단계도 건너뛰지 않는다", () => {
    let v: number = VOLUME_STEPS[0];
    const visited = new Set<number>([v]);
    for (let i = 0; i < VOLUME_STEPS.length; i += 1) {
      v = nextVolume(v);
      visited.add(v);
    }
    expect(visited).toEqual(new Set(VOLUME_STEPS));
  });

  /**
   * 모르는 값에서 **기본이 아니라 첫 단계**로 간다. 기본으로 접으면
   * 기본값이 첫 단계인 지금은 우연히 같지만, 이상한 저장값이 있는
   * 브라우저에서 탭이 제자리를 돌 위험이 남는다.
   */
  it("모르는 값에서 첫 단계로 간다", () => {
    for (const bad of [0.7, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nextVolume(bad)).toBe(VOLUME_STEPS[0]);
    }
  });
});

describe("parseVolume — 저장값을 읽는다", () => {
  it("모든 단계를 왕복한다", () => {
    for (const v of VOLUME_STEPS) {
      expect(parseVolume(serializeVolume(v))).toBe(v);
    }
  });

  /** 취향 데이터라 모르는 값은 버린다 (docs/SAVE-SCHEMA.md §2-2) */
  it("모르는 값·깨진 값은 기본으로 버린다", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "abc",
      "0.7", // 수로는 읽히지만 단계 목록에 없다 — 라벨이 표시할 수 없는 상태
      "-1",
      "2",
      "NaN",
      "Infinity",
    ]) {
      expect(parseVolume(raw), String(raw)).toBe(DEFAULT_VOLUME);
    }
  });

  /**
   * `"0"`은 **버려서는 안 된다.** falsy라서 조건문 한 줄로 기본값으로 새기
   * 쉬운 값이고, 그러면 무음으로 껐던 유저가 다음 실행에서 소리를 얻는다.
   */
  it("무음(0)은 기본으로 되돌리지 않는다", () => {
    expect(parseVolume("0")).toBe(0);
    expect(isMuted(parseVolume("0"))).toBe(true);
  });
});

describe("nearestVolume — 우리 값을 접는다", () => {
  it("단계는 그대로 둔다", () => {
    for (const v of VOLUME_STEPS) expect(nearestVolume(v)).toBe(v);
  });

  it("사이 값은 가장 가까운 단계로 접는다", () => {
    expect(nearestVolume(0.9)).toBe(1);
    expect(nearestVolume(0.55)).toBe(0.5);
    expect(nearestVolume(0.1)).toBe(0);
  });

  it("범위를 넘는 값은 양 끝으로 접는다", () => {
    expect(nearestVolume(5)).toBe(1);
    expect(nearestVolume(-5)).toBe(0);
  });

  it("깨진 값은 기본이다", () => {
    expect(nearestVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
  });

  /**
   * **정확히 두 단계 사이인 값은 큰 쪽으로 접는다.** 돌연변이로 발견한 구멍이다
   * (`d < bestD`를 `<=`로 바꿔도 통과했다) — 그때 접히는 방향이 반대로 뒤집혀
   * 조용히 작은 쪽을 고른다.
   *
   * 왜 큰 쪽인가: 이 함수는 **우리 코드가 만든 값**을 정규화하므로, 애매한
   * 입력에서 소리를 줄이는 쪽으로 기울면 유저가 설정하지 않은 감소가 생긴다
   * (`DEFAULT_VOLUME`이 출하 크기여야 하는 것과 같은 이유다). 반대로 키우는
   * 것은 원래 크기로 돌아가는 것뿐이다.
   */
  it("동점은 큰 쪽으로 접는다 — 설정 안 한 감소를 만들지 않는다", () => {
    expect(nearestVolume(0.75)).toBe(1);
    expect(nearestVolume(0.25)).toBe(0.5);
  });

  /**
   * `parseVolume`과 **다르게** 동작해야 한다. 둘이 같아지면(둘 다 버리거나
   * 둘 다 접거나) 한쪽 이름이 거짓말이 된다 — 저장값은 남의 데이터라 버리고,
   * 우리 코드가 만든 값은 접는다.
   */
  it("parseVolume과 다르다 — 하나는 버리고 하나는 접는다", () => {
    expect(parseVolume("0.1")).toBe(DEFAULT_VOLUME);
    expect(nearestVolume(0.1)).toBe(0);
  });
});

describe("라벨·문구", () => {
  it("위 줄은 모든 단계에서 같다 — 배지 이름이다", () => {
    const tops = new Set(VOLUME_STEPS.map((v) => volumeLabel(v)[0]));
    expect(tops.size).toBe(1);
  });

  it("아래 줄은 단계마다 다르다 — 상태를 읽을 수 있어야 한다", () => {
    const bottoms = VOLUME_STEPS.map((v) => volumeLabel(v)[1]);
    expect(new Set(bottoms).size).toBe(VOLUME_STEPS.length);
    for (const b of bottoms) expect(b.length).toBeGreaterThan(0);
  });

  /** `0%`는 "소리가 0만큼 난다"로 읽혀 고장인지 설정인지 구별되지 않는다 */
  it("무음은 퍼센트가 아니라 무음이라고 적는다", () => {
    expect(volumeLabel(0)[1]).toBe("무음");
    expect(volumeLabel(0)[1]).not.toContain("%");
    expect(volumeLabel(1)[1]).toContain("%");
  });

  it("사이 값도 접어서 라벨을 만든다 — 표시할 수 없는 상태가 없다", () => {
    for (const v of [0.9, 0.55, 0.1, 3, Number.NaN]) {
      const [top, bottom] = volumeLabel(v);
      expect(top.length).toBeGreaterThan(0);
      expect(bottom.length).toBeGreaterThan(0);
    }
  });

  it("isMuted는 0에서만 참이다", () => {
    expect(isMuted(0)).toBe(true);
    for (const v of VOLUME_STEPS.filter((s) => s > 0)) {
      expect(isMuted(v)).toBe(false);
    }
    // 접히는 값도 같이 본다
    expect(isMuted(0.1)).toBe(true);
    expect(isMuted(0.4)).toBe(false);
  });

  /**
   * **무음 문구가 무엇을 잃는지 말해야 한다.** 3단계를 만든 이유가 그것이고
   * (무음은 층 돌파·보스 신호도 지운다), 무음으로 간 탭은 소리로 확인이
   * 안 되므로 화면이 대신 말하는 유일한 자리다.
   */
  it("무음 토스트가 잃는 것을 말한다", () => {
    const n = volumeNotice(0);
    expect(n).toContain("무음");
    expect(n.length).toBeGreaterThan("무음".length);
  });

  it("단계마다 다른 토스트가 나온다", () => {
    const notices = VOLUME_STEPS.map((v) => volumeNotice(v));
    expect(new Set(notices).size).toBe(VOLUME_STEPS.length);
  });
});
