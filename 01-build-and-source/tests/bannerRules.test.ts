import { describe, expect, it } from "vitest";
import {
  BANNER_COLOR,
  BANNER_H,
  BANNER_HOLD_MS,
  BANNER_IN_MS,
  BANNER_OUT_MS,
  BANNER_TOTAL_MS,
  bannerAction,
  bannerOffset,
  bannerPhase,
  enqueue,
  type BannerKind,
  type BannerRequest,
} from "../src/shared/ui/bannerRules";
import { TEAM_OURS, TEAM_THEIRS, UI_PANEL } from "../src/shared/theme";
import { luminance } from "../src/shared/color";

/**
 * **`BANNER_COLOR`의 키에서 뽑는다 — 손으로 나열하지 않는다.**
 *
 * 전에는 `["interference", "buff", "wave", "system"]` 네 개를 적어 뒀다.
 * 그래서 `myCast`/`teammate`를 추가했을 때 색 중복·큐 상한·결정 행렬 검사가
 * 새 종류를 **한 번도 보지 않고** 통과했다. 실제로 `teammate`에 `UI_PANEL`
 * (= `system`색)을 넣었는데 "서로 다른 색이다" 검사가 조용했다.
 */
const KINDS = Object.keys(BANNER_COLOR) as BannerKind[];

describe("BANNER_COLOR", () => {
  it("종류가 하나도 빠지지 않는다 — 색표가 곧 종류 목록이다", () => {
    // 타입에 종류를 추가하면 `Record`가 색을 강제하고, 이 목록이 그것을 받는다
    expect(KINDS.length).toBeGreaterThanOrEqual(6);
    for (const k of [
      "interference",
      "myCast",
      "teammate",
      "buff",
      "wave",
      "system",
    ] satisfies BannerKind[]) {
      expect(KINDS, k).toContain(k);
    }
  });

  it("모든 종류가 서로 다른 색이다 — 같으면 종류를 구분할 수 없다", () => {
    expect(new Set(KINDS.map((k) => BANNER_COLOR[k])).size).toBe(KINDS.length);
  });

  it("전부 24비트 색이다", () => {
    for (const k of KINDS) {
      expect(BANNER_COLOR[k]).toBeGreaterThanOrEqual(0);
      expect(BANNER_COLOR[k]).toBeLessThanOrEqual(0xffffff);
    }
  });

  /**
   * **내가 건 방해와 당한 방해가 색으로 갈려야 한다.**
   *
   * 둘 다 "방해"라서 한 종류로 묶여 있었고, 그래서 화면에 방향이 없었다 —
   * 상대에게 꽂은 것과 내가 맞은 것이 같은 붉은 배너였다.
   */
  it("내 시전은 우리 진영색, 당한 방해는 상대 진영색이다", () => {
    expect(BANNER_COLOR.myCast).toBe(TEAM_OURS);
    expect(BANNER_COLOR.interference).toBe(TEAM_THEIRS);
  });

  /**
   * **팀원 배너는 우리 편으로 읽히면서 내 것보다 죽어 있어야 한다.**
   *
   * `system`(회색 `UI_PANEL`)을 재사용하면 팀원이 한 일이 시스템 공지처럼
   * 보이고, 진영색을 그대로 쓰면 내 조작과 구분이 안 된다.
   */
  it("팀원 배너는 내 진영색을 어둡게 죽인 것이다 — 시스템색이 아니다", () => {
    expect(BANNER_COLOR.teammate).not.toBe(UI_PANEL);
    expect(BANNER_COLOR.teammate).not.toBe(BANNER_COLOR.myCast);
    expect(luminance(BANNER_COLOR.teammate)).toBeLessThan(
      luminance(BANNER_COLOR.myCast),
    );
  });
});

describe("타이밍 상수", () => {
  it("스펙 그대로다 (§01-4: 180 / 900 / 180)", () => {
    expect([BANNER_IN_MS, BANNER_HOLD_MS, BANNER_OUT_MS]).toEqual([180, 900, 180]);
    expect(BANNER_TOTAL_MS).toBe(1260);
  });

  it("높이 72 (§C8)", () => {
    expect(BANNER_H).toBe(72);
  });
});

describe("bannerPhase", () => {
  it("경계에서 다음 단계로 넘어간다", () => {
    const hold = BANNER_HOLD_MS;
    expect(bannerPhase(0, hold)).toBe("in");
    expect(bannerPhase(BANNER_IN_MS - 1, hold)).toBe("in");
    expect(bannerPhase(BANNER_IN_MS, hold)).toBe("hold");
    expect(bannerPhase(BANNER_IN_MS + hold - 1, hold)).toBe("hold");
    expect(bannerPhase(BANNER_IN_MS + hold, hold)).toBe("out");
    expect(bannerPhase(BANNER_TOTAL_MS - 1, hold)).toBe("out");
    expect(bannerPhase(BANNER_TOTAL_MS, hold)).toBe("done");
  });

  it("음수 시간은 done — 살아 있지 않은 배너다", () => {
    expect(bannerPhase(-1, BANNER_HOLD_MS)).toBe("done");
  });

  it("유지 시간을 늘리면 그만큼 hold가 길어진다", () => {
    expect(bannerPhase(BANNER_IN_MS + 2000, 3000)).toBe("hold");
    expect(bannerPhase(BANNER_IN_MS + 2000, 900)).toBe("done");
  });
});

describe("bannerOffset", () => {
  const hold = BANNER_HOLD_MS;

  it("좌 밖 → 중앙 → 우 밖으로 한 방향으로 통과한다", () => {
    expect(bannerOffset(0, hold)).toBeCloseTo(-1, 5);
    expect(bannerOffset(BANNER_IN_MS, hold)).toBe(0);
    expect(bannerOffset(BANNER_IN_MS + hold, hold)).toBe(0);
    expect(bannerOffset(BANNER_TOTAL_MS, hold)).toBe(1);
  });

  it("전 구간 단조 증가 — 되돌아가면 취소된 것처럼 보인다", () => {
    let prev = -2;
    for (let t = 0; t <= BANNER_TOTAL_MS; t += 5) {
      const v = bannerOffset(t, hold);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("hold 동안 정확히 0에 머문다 — 흔들리면 글자를 읽을 수 없다", () => {
    for (let t = BANNER_IN_MS; t < BANNER_IN_MS + hold; t += 37) {
      expect(bannerOffset(t, hold)).toBe(0);
    }
  });

  it("진입이 퇴장보다 감속형이다 (도착은 부드럽고 퇴장은 가속)", () => {
    const inMid = bannerOffset(BANNER_IN_MS / 2, hold); // −1..0 구간
    const outMid = bannerOffset(BANNER_IN_MS + hold + BANNER_OUT_MS / 2, hold);
    // easeOutCubic: 절반 시점에 이미 대부분 도착 → −0.5보다 0에 가깝다
    expect(inMid).toBeGreaterThan(-0.5);
    // easeInCubic: 절반 시점에 아직 거의 안 나갔다
    expect(outMid).toBeLessThan(0.5);
  });

  it("범위 밖 시간에서도 화면 밖 값을 준다", () => {
    expect(bannerOffset(-100, hold)).toBe(1);
    expect(bannerOffset(99999, hold)).toBe(1);
  });
});

const req = (over: Partial<BannerRequest> = {}): BannerRequest => ({
  kind: "interference",
  text: "⚡ 감속당했다!",
  holdMs: BANNER_HOLD_MS,
  ...over,
});

describe("enqueue", () => {
  it("빈 큐에 그대로 들어간다", () => {
    expect(enqueue([], req())).toEqual([req()]);
  });

  it("종류당 한 장만 남고 최신이 이긴다 — 지난 웨이브 번호가 뜨면 안 된다", () => {
    const q = enqueue(enqueue([], req({ kind: "wave", text: "WAVE 3" })), req({ kind: "wave", text: "WAVE 4" }));
    expect(q).toHaveLength(1);
    expect(q[0]!.text).toBe("WAVE 4");
  });

  it("다른 종류는 함께 남는다 — 방해 알림이 웨이브 알림에 먹히면 안 된다", () => {
    const q = enqueue(enqueue([], req({ kind: "wave" })), req({ kind: "interference" }));
    expect(q.map((r) => r.kind)).toEqual(["wave", "interference"]);
  });

  it("원본 큐를 변형하지 않는다", () => {
    const orig = [req({ kind: "wave" })];
    enqueue(orig, req({ kind: "wave", text: "다른 것" }));
    expect(orig).toHaveLength(1);
    expect(orig[0]!.text).toBe("⚡ 감속당했다!");
  });

  it("종류가 몇 개여도 큐가 종류 수를 넘지 않는다", () => {
    let q: BannerRequest[] = [];
    for (let i = 0; i < 40; i += 1) {
      q = enqueue(q, req({ kind: KINDS[i % KINDS.length]!, text: `t${i}` }));
    }
    expect(q).toHaveLength(KINDS.length);
  });
});

describe("bannerAction", () => {
  it("떠 있는 게 없으면 바로 띄운다", () => {
    expect(bannerAction(null, req())).toBe("start");
  });

  it("완전히 같은 요청은 유지 시간만 채운다 (§C8)", () => {
    expect(bannerAction(req(), req())).toBe("refill");
  });

  it("같은 종류·다른 문구는 지금 배너를 갈아탄다 — 지난 웨이브 번호가 뜨면 안 된다", () => {
    expect(
      bannerAction(req({ kind: "wave", text: "WAVE 3" }), req({ kind: "wave", text: "WAVE 4" })),
    ).toBe("retarget");
  });

  it("다른 종류는 큐에 세운다 — 방해 알림이 웨이브 알림을 삼키면 안 된다", () => {
    expect(bannerAction(req({ kind: "wave" }), req({ kind: "interference" }))).toBe(
      "queue",
    );
  });

  it("어떤 조합에서도 결정이 하나로 정해진다", () => {
    const actions = new Set<string>();
    for (const a of KINDS) {
      for (const b of KINDS) {
        for (const text of ["같음", "다름"]) {
          actions.add(
            bannerAction(req({ kind: a, text: "같음" }), req({ kind: b, text })),
          );
        }
      }
    }
    expect(actions).toEqual(new Set(["refill", "retarget", "queue"]));
  });
});
