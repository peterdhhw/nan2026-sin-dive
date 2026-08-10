/**
 * **최상단 레이어의 쌓임 순서** — 열린 패널이 이펙트에 묻히지 않는가.
 *
 * ## 왜 이 파일이 있는가 (2026-08-07)
 *
 * 순서가 `session.ts`의 주석에만 있었고, 그래서 결함이 캡처로만 잡혔다: 강화
 * 시트가 `layers.skillBar`, 전투 이펙트가 `layers.fx`에 있어서 **시트를 열어도
 * 이펙트가 시트 위에 그려졌다.** 42층 1:1 캡처에서 `스킬 위력 Lv.30`의 레벨
 * 숫자와 `×10.06`이 별 파편에 묻혀 읽을 수 없었다.
 *
 * 이 결함이 조용한 이유가 검사의 이유다 — 시트는 하강을 멈추지 않으므로
 * (`paused`가 아니다) 뒤에서 전투가 계속 돌고, 이펙트는 몇 백 ms만 뜬다.
 * 이펙트가 없는 순간에 캡처가 찍히면 멀쩡해 보인다. 그런데 소개서 §3-5는
 * 심사자에게 **하강 중에 이 시트를 열라고** 안내한다.
 *
 * **여기서 이름 목록을 다시 적지 않는다.** 순서를 배열로 복사하면 규칙을
 * 두 곳에 두는 것이고, 그 둘이 갈리는 날 테스트는 자기 사본을 보고 통과한다.
 * 대신 **관계**를 묻는다.
 */

import { describe, expect, it } from "vitest";
import {
  DIVE_FX_STACK,
  drawsAbove,
  fxStackIndex,
  type DiveFxLayerName,
} from "../src/single/diveLayerRules";
import { CHOICE_EVERY } from "../src/single/sessionRules";
import { MINIBOSS_EVERY } from "../src/core/phase/phaseWaves";

describe("싱글 fx 쌓임 — 열린 패널이 이펙트 위에 온다", () => {
  /**
   * 이 파일의 이유. 시트가 이펙트 아래면 42층 캡처의 결함이 그대로다.
   *
   * 시트만 묻지 않는다 — `fx`에 있는 **모든 패널·모달**이 이펙트 위여야 한다.
   * 시트 하나만 물으면 다음에 추가되는 패널이 같은 결함을 다시 얻는다.
   */
  it("이펙트가 가장 아래다 — 그 위 전부가 글자를 가진 것들이다", () => {
    expect(fxStackIndex("effects")).toBe(0);
    for (const name of DIVE_FX_STACK) {
      if (name === "effects") continue;
      expect(drawsAbove(name, "effects"), `${name}`).toBe(true);
    }
  });

  /**
   * 카드 뽑기는 시트 **안**에 있고, 그 결과를 말하는 것이 토스트다
   * (`session.drawOneCard` → `toast.show`). 토스트가 아래면 방금 누른 버튼의
   * 결과가 자기가 띄운 패널에 가려진다.
   */
  it("토스트가 시트 위다 — 뽑기 결과를 시트가 가리지 않는다", () => {
    expect(drawsAbove("toast", "upgradeSheet")).toBe(true);
  });

  /**
   * 심연의 선택은 `paused`를 걸어 판을 멈추고, **시트가 열린 채로도 뜬다**
   * (시트는 `paused`가 아니라서 층이 계속 올라간다). 그래서 스토리는 시트·
   * 토스트·배너·이펙트보다 위여야 한다 — 50층에서 실제로 겹치는 조합이다.
   *
   * **쇼케이스는 예외다** (아래 검사). 스토리가 "가장 위"였던 것을 유일한
   * 예외와 함께 남긴다 — `story`를 그냥 목록 중간으로 내리면 시트와의 관계도
   * 같이 잃는다.
   */
  it("스토리 모달이 쇼케이스 말고 전부보다 위다 — 시트가 열려 있어도 뜬다", () => {
    for (const name of DIVE_FX_STACK) {
      if (name === "story" || name === "showcase") continue;
      expect(drawsAbove("story", name), `story vs ${name}`).toBe(true);
    }
  });

  /**
   * **쇼케이스가 가장 위다.** 근거는 두 모달의 성질이 다르다는 것이다:
   * 쇼케이스는 스스로 걷히고(2.6초), 스토리 모달은 입력을 기다린다.
   *
   * 50층이 그 둘이 겹치는 실제 층이다 — `CHOICE_EVERY`(50)가
   * `MINIBOSS_EVERY`(10)의 배수라서 같은 층 클리어가 둘을 다 띄운다.
   * 상수에서 그 사실을 **다시 계산해** 묻는다(숫자를 여기 적으면, 주기를
   * 고쳐 둘이 안 겹치게 된 날에도 이 검사가 겹침을 근거로 통과한다).
   */
  it("쇼케이스가 가장 위다 — 50층에서 심연의 선택과 같은 프레임에 뜬다", () => {
    expect(CHOICE_EVERY % MINIBOSS_EVERY).toBe(0);
    const last = DIVE_FX_STACK[DIVE_FX_STACK.length - 1];
    expect(last).toBe("showcase");
    for (const name of DIVE_FX_STACK) {
      if (name === "showcase") continue;
      expect(drawsAbove("showcase", name), `showcase vs ${name}`).toBe(true);
    }
  });

  /**
   * **없는 이름은 -1이다.** 0이면 호출부가 "맨 아래"로 읽고 조용히 붙인다 —
   * 오타 하나가 "이펙트보다 아래"가 되고, 그게 이 파일이 막는 결함이다.
   */
  it("모르는 이름은 -1이다 — 0으로 위장하지 않는다", () => {
    expect(fxStackIndex("upgradeSheeet")).toBe(-1);
    expect(fxStackIndex("")).toBe(-1);
  });

  /** 목록이 비거나 중복되면 위 검사들이 아무것도 안 묻는다 */
  it("이름이 중복 없이 씬이 붙이는 수만큼 있다", () => {
    expect(DIVE_FX_STACK.length).toBe(7);
    expect(new Set(DIVE_FX_STACK).size).toBe(DIVE_FX_STACK.length);
  });

  /**
   * `drawsAbove`가 순서를 실제로 **읽는지** 확인한다 — 늘 true를 주면 위
   * 검사 세 개가 전부 통과한다. 반대 방향이 false여야 관계가 성립한다.
   */
  it("위/아래가 서로 반대다 — 늘 참을 주지 않는다", () => {
    const pairs: [DiveFxLayerName, DiveFxLayerName][] = [
      ["upgradeSheet", "effects"],
      ["story", "toast"],
      ["toast", "upgradeSheet"],
    ];
    for (const [above, below] of pairs) {
      expect(drawsAbove(above, below), `${above} > ${below}`).toBe(true);
      expect(drawsAbove(below, above), `${below} > ${above}`).toBe(false);
    }
    expect(drawsAbove("story", "story")).toBe(false);
  });
});
