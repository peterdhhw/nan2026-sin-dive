import { describe, expect, it } from "vitest";
import {
  MINI_GAUGE_W,
  PARTICLE_COUNT,
  R_BUTTONS_AT_MS,
  R_BUTTONS_FADE_MS,
  R_CAMERA_DROP_MS,
  R_CAMERA_DROP_PX,
  R_DEFEAT_SATURATE_DROP,
  R_FLASH_MS,
  R_METRICS_AT_MS,
  R_METRIC_STAGGER_MS,
  R_PANEL_AT_MS,
  R_SCRIM_ALPHA,
  R_SCRIM_AT_MS,
  R_SCRIM_MS,
  R_STAMP_AT_MS,
  V_ART_AT_MS,
  V_ART_BOTTOM_Y,
  V_ART_MAX_H,
  V_ART_MAX_W,
  V_ART_MS,
  V_ART_RISE_PX,
  V_ART_VARIANT,
  V_CARD_AT_MS,
  V_CARD_MS,
  V_CARD_Y,
  V_FADE_MS,
  V_HOLD_MS,
  V_SKIP_AT_MS,
  V_TOTAL_MS,
  V_WORD_AT_MS,
  V_WORD_MS,
  V_WORD_Y,
  buttonAlpha,
  buttonsLive,
  cameraDrop,
  fieldSaturate,
  finishFlash,
  metricAtMs,
  miniGaugeRatio,
  miniThresholds,
  panelScale,
  particleT,
  particleX,
  scrimAlpha,
  scrimProgress,
  showsVictory,
  stampScale,
  stampShake,
  victoryAlpha,
  victoryArtProgress,
  victoryArtRise,
  victoryArtSize,
  victoryCardAlpha,
  victoryLive,
  victorySkippable,
  victoryWordFlash,
  victoryWordScale,
} from "../src/pvp/resultRules";
import { DESIGN_H, DESIGN_W } from "../src/shared/viewport";
import { WIN_THRESHOLD } from "../src/pvp/gaugeBarRules";
import { SCRIM_SATURATE, scrimSaturate } from "../src/shared/ui/scrimRules";
import { opponentLabel, rematchHint, resultText } from "../src/pvp/matchText";
import type { SessionResult } from "../src/pvp/session";
import type { MatchSlot } from "../src/net/matchmaking";

const res = (over: Partial<SessionResult> = {}): SessionResult => ({
  winner: 0,
  elapsedMs: 45_000,
  myKills: 12,
  gaugePos: 0.8,
  reason: "threshold",
  ...over,
});

describe("타임라인", () => {
  it("마디 순서가 어긋나지 않았다 (§08-1)", () => {
    expect(R_FLASH_MS).toBeLessThan(R_STAMP_AT_MS);
    expect(R_STAMP_AT_MS).toBeLessThan(R_PANEL_AT_MS);
    expect(R_PANEL_AT_MS).toBeLessThan(R_METRICS_AT_MS);
    expect(R_METRICS_AT_MS).toBeLessThan(R_BUTTONS_AT_MS);
  });

  it("흰 플래시는 140ms에 끝난다", () => {
    expect(finishFlash(0)).toBe(1);
    expect(finishFlash(R_FLASH_MS)).toBe(0);
    expect(finishFlash(-10)).toBe(0);
  });

  it("스탬프는 2.0에서 1.0으로, 200ms 전에는 없다", () => {
    expect(stampScale(0)).toBe(0);
    expect(stampScale(R_STAMP_AT_MS)).toBeCloseTo(2.0, 5);
    expect(stampScale(R_STAMP_AT_MS + 300)).toBe(1);
    expect(stampShake(R_STAMP_AT_MS - 1)).toBe(0);
    expect(stampShake(R_STAMP_AT_MS + 400)).toBe(0);
  });

  it("패널은 0.8에서 1.0으로 커진다", () => {
    expect(panelScale(0)).toBe(0);
    expect(panelScale(R_PANEL_AT_MS)).toBeCloseTo(0.8, 5);
    expect(panelScale(R_PANEL_AT_MS + 320)).toBe(1);
  });

  it("지표는 위에서 아래로 120ms씩 밀린다", () => {
    expect(metricAtMs(0)).toBe(R_METRICS_AT_MS);
    expect(metricAtMs(3)).toBe(R_METRICS_AT_MS + R_METRIC_STAGGER_MS * 3);
    // 마지막 행도 버튼이 뜨기 전에 다 나와야 한다
    expect(metricAtMs(3)).toBeLessThan(R_BUTTONS_AT_MS);
  });

  it("음수·소수 행 번호를 접는다", () => {
    expect(metricAtMs(-2)).toBe(R_METRICS_AT_MS);
    expect(metricAtMs(1.7)).toBe(R_METRICS_AT_MS + R_METRIC_STAGGER_MS);
    expect(metricAtMs(NaN)).toBe(R_METRICS_AT_MS);
  });
});

describe("buttonsLive", () => {
  it("결과를 읽기 전에는 눌리지 않는다 — 오탭 방지 (§08-1)", () => {
    expect(buttonsLive(0)).toBe(false);
    expect(buttonsLive(R_BUTTONS_AT_MS)).toBe(false);
    expect(buttonsLive(R_BUTTONS_AT_MS + R_BUTTONS_FADE_MS)).toBe(true);
  });

  it("알파와 같은 소스다 — '보이는데 안 먹힌다'가 없어야 한다", () => {
    for (let t = 0; t < R_BUTTONS_AT_MS + 600; t += 20) {
      expect(buttonsLive(t)).toBe(buttonAlpha(t) >= 1);
    }
  });

  it("알파는 0..1을 벗어나지 않는다", () => {
    expect(buttonAlpha(0)).toBe(0);
    expect(buttonAlpha(9_999)).toBe(1);
  });
});

describe("파티클", () => {
  it("진행률이 0..1 안에서 순환한다", () => {
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      for (const t of [0, 500, 1_600, 5_000]) {
        const v = particleT(t, i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("x 위치가 인덱스로만 정해진다 (결정론 — 스크린샷 회귀)", () => {
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      expect(particleX(i)).toBe(particleX(i));
      expect(particleX(i)).toBeGreaterThanOrEqual(0);
      expect(particleX(i)).toBeLessThan(1);
    }
  });

  it("전부 같은 위상에 몰려 있지 않다", () => {
    const phases = new Set<number>();
    for (let i = 0; i < PARTICLE_COUNT; i += 1) phases.add(particleT(0, i));
    expect(phases.size).toBeGreaterThan(PARTICLE_COUNT / 2);
  });
});

describe("미니 게이지", () => {
  it("−1..1을 0..1로 옮긴다 — 전투 중 본 위치와 어긋나면 안 된다 (§08-4)", () => {
    expect(miniGaugeRatio(-1)).toBe(0);
    expect(miniGaugeRatio(0)).toBe(0.5);
    expect(miniGaugeRatio(1)).toBe(1);
  });

  it("범위를 벗어난 값·NaN을 접는다", () => {
    expect(miniGaugeRatio(-4)).toBe(0);
    expect(miniGaugeRatio(4)).toBe(1);
    expect(miniGaugeRatio(NaN)).toBe(0.5);
  });

  it("임계선을 WIN_THRESHOLD에서 파생한다 — 두 곳에서 따로 정하지 않는다", () => {
    const [lo, hi] = miniThresholds();
    expect(lo).toBeCloseTo((1 - WIN_THRESHOLD) / 2, 6);
    expect(hi).toBeCloseTo((1 + WIN_THRESHOLD) / 2, 6);
    expect(lo).toBeLessThan(hi);
    // 바 안에 그려져야 한다
    expect(MINI_GAUGE_W * lo).toBeGreaterThan(0);
    expect(MINI_GAUGE_W * hi).toBeLessThan(MINI_GAUGE_W);
  });
});

describe("resultText", () => {
  it("스탬프가 resultHeadline보다 짧다 — 크게 찍히는 문구다 (§08-3)", () => {
    for (const winner of [0, 1, null] as const) {
      for (const reason of ["threshold", "timeLimit", "forfeit"] as const) {
        const t = resultText(res({ winner, reason }));
        expect(t.stamp.length).toBeGreaterThan(0);
        expect(t.subtitle.length).toBeGreaterThan(0);
        expect(t.stamp.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it("몰수 승리에는 축하 파티클을 주지 않는다 — 유저가 잘한 게 없다 (§08-3)", () => {
    expect(resultText(res({ winner: 0, reason: "forfeit" })).celebrate).toBe(
      false,
    );
    expect(resultText(res({ winner: 0, reason: "threshold" })).celebrate).toBe(
      true,
    );
  });

  it("패배·무승부에는 축하가 없다", () => {
    expect(resultText(res({ winner: 1 })).celebrate).toBe(false);
    expect(
      resultText(res({ winner: null, reason: "timeLimit" })).celebrate,
    ).toBe(false);
  });

  it("판정승과 게이지 선점 승리를 다른 문구로 구분한다", () => {
    const judged = resultText(res({ winner: 0, reason: "timeLimit" }));
    const pushed = resultText(res({ winner: 0, reason: "threshold" }));
    expect(judged.stamp).not.toBe(pushed.stamp);
  });
});

describe("opponentLabel / rematchHint", () => {
  const slots = (theirKind: "human" | "ai"): MatchSlot[] => [
    { slotId: "t0-s0", team: 0, kind: "human", displayName: "나" },
    { slotId: "t0-s1", team: 0, kind: "ai", displayName: "AI" },
    { slotId: "t1-s0", team: 1, kind: theirKind, displayName: "플레이어 B" },
    { slotId: "t1-s1", team: 1, kind: "ai", displayName: "AI" },
  ];

  it("사람 상대면 이름을, AI면 AI 상대로 적는다 (§08-4)", () => {
    expect(opponentLabel(slots("human"))).toBe("플레이어 B");
    expect(opponentLabel(slots("ai"))).toBe("AI 상대");
  });

  it("AI 대전이었을 때 사람 대전도 있다고 알린다 (§08-5-1)", () => {
    expect(rematchHint(slots("ai"))).toContain("실제 유저");
    expect(rematchHint(slots("human"))).toContain("플레이어 B");
  });

  it("슬롯이 비어 있어도 문구가 나온다", () => {
    expect(opponentLabel([]).length).toBeGreaterThan(0);
    expect(rematchHint([]).length).toBeGreaterThan(0);
  });
});

describe("딤 · 채도 · 카메라 (§08-1)", () => {
  it("딤은 흰 플래시가 끝난 뒤에 시작한다 — 겹치면 하얗게 씻긴다", () => {
    expect(scrimAlpha(0)).toBe(0);
    expect(scrimAlpha(R_FLASH_MS)).toBe(0);
    expect(scrimAlpha(R_SCRIM_AT_MS + 1)).toBeGreaterThan(0);
    expect(scrimAlpha(R_SCRIM_AT_MS + R_SCRIM_MS)).toBeCloseTo(
      R_SCRIM_ALPHA,
      6,
    );
    expect(scrimAlpha(9_999)).toBeCloseTo(R_SCRIM_ALPHA, 6);
  });

  it("딤 진행도는 단조 증가한다 — 되돌아가면 깜빡인다", () => {
    let prev = -1;
    for (let t = 0; t <= R_SCRIM_AT_MS + R_SCRIM_MS + 100; t += 10) {
      const v = scrimProgress(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it("채도는 딤과 같은 시계로 내려간다 (§C9와 같은 목표값)", () => {
    expect(fieldSaturate(0, false)).toBe(1);
    expect(fieldSaturate(9_999, false)).toBeCloseTo(SCRIM_SATURATE, 6);
    // 위젯 `Scrim`과 같은 값이어야 한다 — 두 곳에 0.4를 적어두지 않는다
    expect(fieldSaturate(9_999, false)).toBeCloseTo(scrimSaturate(1), 6);
  });

  it("패배는 추가로 −20%p 빠진다 — 스크린샷 한 장으로 승패가 읽힌다", () => {
    const win = fieldSaturate(9_999, false);
    const lose = fieldSaturate(9_999, true);
    expect(lose).toBeCloseTo(SCRIM_SATURATE - R_DEFEAT_SATURATE_DROP, 6);
    expect(lose).toBeLessThan(win);
    expect(lose).toBeGreaterThanOrEqual(0);
  });

  it("카메라는 패배에서만 내려앉고 12px에서 멈춘다", () => {
    expect(cameraDrop(9_999, false)).toBe(0);
    expect(cameraDrop(0, true)).toBe(0);
    expect(cameraDrop(R_STAMP_AT_MS, true)).toBe(0);
    expect(cameraDrop(R_STAMP_AT_MS + R_CAMERA_DROP_MS, true)).toBe(
      R_CAMERA_DROP_PX,
    );
    expect(cameraDrop(60_000, true)).toBe(R_CAMERA_DROP_PX);
    const mid = cameraDrop(R_STAMP_AT_MS + R_CAMERA_DROP_MS / 2, true);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(R_CAMERA_DROP_PX);
  });
});

/**
 * 승리 삽화 오버레이 (§08-8 / §10-2).
 *
 * **여기서 잡으려는 실패**는 두 종류다:
 *
 * 1. **안 보이는 판이 탭을 먹는다.** 결과 버튼은 1400ms에 살아나는데
 *    (`buttonsLive`) 그때 화면에는 이 오버레이가 있다. 알파와 `live`가 다른
 *    소스를 쓰면 "화면에 아무것도 없는데 버튼이 안 눌린다"가 된다.
 * 2. **삽화가 화면을 뚫는다.** `win` 삽화의 폭은 302~701px로 두 배 넘게
 *    벌어진다 — 높이만 맞추면 가장 넓은 캐릭터가 1073px이 된다.
 */
describe("승리 오버레이 (§08-8)", () => {
  it("몰수 승리에는 안 뜬다 — 파티클과 같은 게이트다", () => {
    // 진 판·비긴 판
    expect(showsVictory(false, 1)).toBe(false);
    expect(showsVictory(false, null)).toBe(false);
    // 이긴 판이지만 축하하지 않는 판(몰수) — `resultText`가 그걸 정한다
    expect(showsVictory(false, 0)).toBe(false);
    expect(showsVictory(true, 0)).toBe(true);
    // 실제 결과로도 확인한다. 두 판정이 갈리면 "축하는 없는데 카드는 늘어난다"
    const forfeitWin = resultText(res({ winner: 0, reason: "forfeit" }));
    expect(showsVictory(forfeitWin.celebrate, 0)).toBe(false);
    const cleanWin = resultText(res({ winner: 0 }));
    expect(showsVictory(cleanWin.celebrate, 0)).toBe(true);
  });

  it("삽화 → 워드마크 → 카드 순서다 — 뒤집히면 축하가 카드 안내로 시작한다", () => {
    expect(V_ART_AT_MS).toBeLessThan(V_WORD_AT_MS);
    expect(V_WORD_AT_MS).toBeLessThan(V_CARD_AT_MS);
    // 카드 줄이 다 뜬 뒤에도 읽을 시간이 남아야 한다
    expect(V_CARD_AT_MS + V_CARD_MS).toBeLessThan(V_HOLD_MS);
    // 삽화가 자리를 잡은 뒤에 워드마크가 찍힌다
    expect(V_ART_AT_MS + V_ART_MS).toBeLessThanOrEqual(
      V_WORD_AT_MS + V_WORD_MS,
    );
  });

  it("알파와 live가 같은 소스다 — 갈리면 안 보이는 판이 버튼을 먹는다", () => {
    for (const t of [
      0,
      100,
      500,
      V_HOLD_MS,
      V_HOLD_MS + 200,
      V_TOTAL_MS,
      9_999,
    ]) {
      expect(victoryLive(t), `t=${t}`).toBe(victoryAlpha(t) > 0);
    }
    for (const skip of [V_SKIP_AT_MS, 1_000, V_HOLD_MS + 500]) {
      for (const t of [skip, skip + 100, skip + V_FADE_MS, skip + 9_999]) {
        expect(victoryLive(t, skip), `skip=${skip} t=${t}`).toBe(
          victoryAlpha(t, skip) > 0,
        );
      }
    }
  });

  it("유지 구간에는 꽉 차 있고 페이드가 끝나면 사라진다", () => {
    expect(victoryAlpha(0)).toBe(1);
    expect(victoryAlpha(V_HOLD_MS)).toBe(1);
    expect(victoryAlpha(V_HOLD_MS + V_FADE_MS / 2)).toBeCloseTo(0.5, 2);
    expect(victoryAlpha(V_TOTAL_MS)).toBe(0);
    expect(victoryAlpha(60_000)).toBe(0);
    expect(victoryLive(V_TOTAL_MS)).toBe(false);
  });

  /**
   * **결과 버튼이 살아나기 전에 오버레이가 걷혀야 한다.** 안 그러면 유저는
   * 탭할 것이 없는 화면을 기다린다 — 탭으로 걷을 수는 있지만(`victorySkippable`)
   * 그건 걷어야 한다는 걸 아는 사람에게만 열린 길이다.
   */
  it("스스로 걷히는 시각이 결과 버튼보다 늦지 않다", () => {
    expect(V_TOTAL_MS).toBeGreaterThan(R_BUTTONS_AT_MS);
    // 버튼이 다 뜬 뒤 3초 안에는 걷힌다 — 축하가 화면을 붙잡고 있으면 안 된다
    expect(V_TOTAL_MS).toBeLessThan(
      R_BUTTONS_AT_MS + R_BUTTONS_FADE_MS + 3_000,
    );
  });

  /**
   * 전투 마지막 프레임의 스킬 연타가 그대로 여기로 들어온다 — 워드마크가
   * 멈추기 전에는 탭이 안 먹어야 한다(§08-1이 버튼을 1400ms까지 잠그는 것과
   * 같은 이유).
   */
  it("워드마크가 멈추기 전에는 탭으로 못 걷는다", () => {
    expect(victorySkippable(0)).toBe(false);
    expect(victorySkippable(V_WORD_AT_MS)).toBe(false);
    expect(victorySkippable(V_SKIP_AT_MS - 1)).toBe(false);
    expect(victorySkippable(V_SKIP_AT_MS)).toBe(true);
    expect(victorySkippable(NaN)).toBe(false);
  });

  it("탭해도 즉시 사라지지 않는다 — 튀어나오면 잘못 누른 것으로 읽힌다", () => {
    const skip = V_SKIP_AT_MS;
    expect(victoryAlpha(skip, skip)).toBe(1);
    expect(victoryAlpha(skip + V_FADE_MS / 2, skip)).toBeCloseTo(0.5, 2);
    expect(victoryAlpha(skip + V_FADE_MS, skip)).toBe(0);
    // 유지 구간을 넘겨 탭해도 페이드가 다시 늘어나지 않는다
    const late = V_HOLD_MS + 300;
    expect(victoryAlpha(late, late)).toBe(victoryAlpha(late));
  });

  it("삽화가 아래에서 올라와 제자리에 멈춘다", () => {
    expect(victoryArtProgress(0)).toBe(0);
    expect(victoryArtRise(0)).toBe(V_ART_RISE_PX);
    expect(victoryArtRise(V_ART_AT_MS + V_ART_MS)).toBe(0);
    expect(victoryArtRise(9_999)).toBe(0);
    // 단조 감소여야 한다 — 되돌아가면 인물이 튄다
    let prev = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= V_ART_AT_MS + V_ART_MS + 100; t += 10) {
      const v = victoryArtRise(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it("워드마크가 크게 찍혀 1.0으로 앉는다 — 결과 스탬프보다 크게 시작한다", () => {
    expect(victoryWordScale(V_WORD_AT_MS - 1)).toBe(0);
    // 찍히는 순간이 가장 크다(2.4) — 스탬프(2.0)보다 커야 위에 있는 것으로 읽힌다
    expect(victoryWordScale(V_WORD_AT_MS)).toBeCloseTo(2.4, 6);
    expect(victoryWordScale(V_WORD_AT_MS + V_WORD_MS)).toBe(1);
    expect(victoryWordScale(9_999)).toBe(1);
    expect(victoryWordScale(V_WORD_AT_MS + V_WORD_MS / 2)).toBeLessThan(2.4);
  });

  it("플래시는 워드마크와 같이 시작해 짧게 끝난다", () => {
    expect(victoryWordFlash(V_WORD_AT_MS - 1)).toBe(0);
    expect(victoryWordFlash(V_WORD_AT_MS)).toBeCloseTo(0.8, 6);
    expect(victoryWordFlash(V_WORD_AT_MS + 200)).toBe(0);
    // 유지 구간 안에서 끝난다 — 걷히는 중에 하얘지면 결과 화면이 씻긴다
    expect(victoryWordFlash(V_HOLD_MS)).toBe(0);
  });

  it("카드 줄은 워드마크가 멈춘 뒤에 뜬다", () => {
    expect(victoryCardAlpha(V_WORD_AT_MS + V_WORD_MS)).toBe(0);
    expect(victoryCardAlpha(V_CARD_AT_MS)).toBe(0);
    expect(victoryCardAlpha(V_CARD_AT_MS + V_CARD_MS)).toBe(1);
    expect(victoryCardAlpha(9_999)).toBe(1);
  });

  /**
   * **폭·높이 둘 다** 상한을 지킨다. 높이만 맞추면 가장 넓은 `win` 삽화
   * (701×435, 비율 1.61)가 높이 상한에서 1073px이 되어 720px 화면 밖으로
   * 팔이 나간다. 종횡비는 지킨다 — 폭을 잘라 맞추면 인물이 눌린다.
   */
  it("삽화가 화면 안에 들고 종횡비가 유지된다", () => {
    for (const [w, h] of [
      [302, 435],
      [701, 435],
      [400, 900],
      [1_600, 400],
    ] as const) {
      const s = victoryArtSize(w, h);
      expect(s.w, `${w}×${h}`).toBeLessThanOrEqual(V_ART_MAX_W + 1e-6);
      expect(s.h, `${w}×${h}`).toBeLessThanOrEqual(V_ART_MAX_H + 1e-6);
      expect(s.w / s.h, `${w}×${h} 비율`).toBeCloseTo(w / h, 6);
      expect(s.w).toBeLessThanOrEqual(DESIGN_W);
    }
    // 크기를 모르면 0이다 — 1로 두면 1px 스프라이트가 화면에 남는다
    expect(victoryArtSize(0, 435)).toEqual({ w: 0, h: 0 });
    expect(victoryArtSize(NaN, NaN)).toEqual({ w: 0, h: 0 });
  });

  it("삽화 발밑과 카드 줄이 화면 안에서 겹치지 않는다", () => {
    expect(V_WORD_Y).toBeLessThan(V_ART_BOTTOM_Y);
    expect(V_ART_BOTTOM_Y).toBeLessThan(V_CARD_Y);
    expect(V_CARD_Y).toBeLessThan(DESIGN_H);
    // 발밑 위로 삽화 최대 높이만큼 올라가도 화면을 안 넘는다
    expect(V_ART_BOTTOM_Y - V_ART_MAX_H).toBeGreaterThanOrEqual(0);
  });

  it("삽화 variant는 승리본 하나다 — 셋 다 받으면 11MB가 안 쓰인다", () => {
    expect(V_ART_VARIANT).toBe("win");
  });
});
