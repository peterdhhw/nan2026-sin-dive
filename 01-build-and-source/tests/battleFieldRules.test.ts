import { describe, expect, it, test } from "vitest";
import { readFileSync } from "node:fs";
import { HERO_SLUGS } from "../src/shared/charManifest";
import { DESIGN_H, DESIGN_W, computeSplit } from "../src/pvp/splitLayout";
import {
  ALLY_BODY_W_RATIO_FALLBACK,
  ALLY_H_RATIO,
  ALLY_LANE_GAP_RATIO,
  BOSS_SCALE,
  FX_COVER_RATIO,
  REF_FIELD_H,
  allyDisplayPx,
  enemyDisplayPx,
  DEATH_MS,
  DEATH_ROTATE_DEG,
  DEATH_SQUASH_Y,
  ENEMY_H_RATIO,
  ENEMY_SLOT_X,
  GOLD_POP_MS,
  GROUND_RATIO,
  HIT_FLASH_MS,
  KNOCKBACK_MS,
  KNOCKBACK_PX,
  MAX_VISIBLE_ENEMIES,
  allyBodyWPx,
  allyLaneX,
  allySlotRatio,
  clampToField,
  deathPose,
  depthPose,
  dimColor,
  enemySlotDepth,
  enemySlotRatio,
  fieldSlideY,
  goldPose,
  hitFlash,
  knockback,
  showsHpBar,
  type HpBarSlotState,
} from "../src/shared/battleFieldRules";
import { ENEMY_WALK_IN_MS, PENDING_HARD_MS } from "../src/shared/meleeRules";
import { HUD_H } from "../src/single/diveHudRules";
import { SINGLE_FIELD_H, UPGRADE_ROW_Y } from "../src/single/upgradePanelRules";
import { DIVE_SLIDE_TOTAL_MS, diveSlideOffset } from "../src/single/sessionRules";

test("ground sits at 0.88 of the field height", () => {
  // 0.92였을 때 캐릭터가 화면 아래에 눌려 보였다 (설계 문서 07-4-1)
  expect(GROUND_RATIO).toBe(0.88);
});

/**
 * `REF_FIELD_H`는 이펙트 크기의 기준이다 (`FX_COVER_RATIO`, `meleeFx`).
 * 레이아웃이 실제로 주는 값과 어긋나면 이펙트 상한이 화면과 무관한 숫자가
 * 되고, 그것은 화면을 열어 보기 전에는 드러나지 않는다.
 */
test("기준 필드 높이가 레이아웃이 실제로 주는 값이다 — 눈대중 상수가 아니다", () => {
  const top = computeSplit(0.5, DESIGN_W, DESIGN_H).top;
  expect(Math.round(top.h)).toBe(REF_FIELD_H);
  expect(allyDisplayPx()).toBeCloseTo(REF_FIELD_H * ALLY_H_RATIO, 6);
  expect(enemyDisplayPx()).toBeCloseTo(REF_FIELD_H * ENEMY_H_RATIO, 6);
});

/**
 * 유저 지적: "캐릭터랑 적들이 화면에서 너무 커. 크기를 줄이고 이펙트를 더."
 * 0.55는 아군 하나가 화면 높이의 18%를 먹어서 이펙트를 얹을 자리가 없었다 —
 * 던전앤파이터 계열은 반대 순서다(캐릭터를 작게, 이펙트가 그 위를 덮는다).
 */
test("아군이 화면 높이의 1/7을 넘지 않는다 — 넘으면 이펙트를 얹을 자리가 없다", () => {
  expect(allyDisplayPx() / DESIGN_H).toBeLessThan(1 / 7);
  // 너무 작으면 도트 캐릭터의 표정·무기가 안 읽힌다
  expect(allyDisplayPx() / DESIGN_H).toBeGreaterThan(1 / 12);
});

/**
 * 적이 아군보다 크면 "내가 작은 것"이 아니라 "적이 보스인 것"으로 읽힌다.
 * 둘을 같이 줄여야 관계가 유지된다 — 한쪽만 줄이면 스케일이 무너진다.
 */
test("적은 아군보다 작다 — 둘의 관계는 크기를 바꿔도 유지된다", () => {
  expect(ENEMY_H_RATIO).toBeLessThan(ALLY_H_RATIO);
  expect(ENEMY_H_RATIO / ALLY_H_RATIO).toBeGreaterThan(0.5);
  expect(ENEMY_H_RATIO / ALLY_H_RATIO).toBeLessThan(0.8);
});

/**
 * 상한이 1을 넘으면 이펙트가 캐릭터를 완전히 삼켜서 누가 때렸는지 안 보인다 —
 * 소프트 글로우를 아군으로 오인한 실패가 정확히 그것이었다. 반대로 너무
 * 작으면 층을 겹쳐도 타격이 밋밋하다.
 */
test("이펙트 덮임 한계가 캐릭터를 지우지도, 안 보이지도 않는다", () => {
  expect(FX_COVER_RATIO).toBeGreaterThan(0.4);
  expect(FX_COVER_RATIO).toBeLessThan(1);
});

test("hit flash decays to zero inside its window", () => {
  expect(hitFlash(0)).toBe(1);
  expect(hitFlash(HIT_FLASH_MS / 2)).toBeCloseTo(0.5);
  expect(hitFlash(HIT_FLASH_MS)).toBe(0);
  expect(hitFlash(HIT_FLASH_MS + 100)).toBe(0);
});

// 음수는 "아직 시작 안 함" 센티넬(-1)로 쓰이므로 절대 발광하면 안 된다
test("negative elapsed never flashes", () => {
  expect(hitFlash(-1)).toBe(0);
  expect(knockback(-1)).toBe(0);
});

test("knockback peaks then returns to zero", () => {
  expect(knockback(0)).toBe(0);
  expect(knockback(KNOCKBACK_MS * 0.25)).toBeCloseTo(KNOCKBACK_PX);
  expect(knockback(KNOCKBACK_MS)).toBe(0);
  expect(knockback(KNOCKBACK_MS + 50)).toBe(0);
});

test("knockback never exceeds its budget", () => {
  for (let t = 0; t <= KNOCKBACK_MS; t += 4) {
    expect(knockback(t)).toBeLessThanOrEqual(KNOCKBACK_PX + 1e-9);
    expect(knockback(t)).toBeGreaterThanOrEqual(0);
  }
});

test("death squashes, rotates and fades to done", () => {
  const start = deathPose(0);
  expect(start.scaleY).toBe(1);
  expect(start.rotationDeg).toBe(0);
  expect(start.alpha).toBe(1);
  expect(start.done).toBe(false);

  const end = deathPose(DEATH_MS);
  expect(end.scaleY).toBeCloseTo(DEATH_SQUASH_Y);
  expect(end.rotationDeg).toBeCloseTo(DEATH_ROTATE_DEG);
  expect(end.alpha).toBeCloseTo(0);
  expect(end.done).toBe(true);
});

// 처음부터 투명해지면 죽는 게 안 보인다 — 앞 절반은 완전 불투명이어야 한다
test("death stays opaque through the first half", () => {
  expect(deathPose(DEATH_MS * 0.25).alpha).toBe(1);
  expect(deathPose(DEATH_MS * 0.5).alpha).toBe(1);
  expect(deathPose(DEATH_MS * 0.75).alpha).toBeCloseTo(0.5);
});

test("death pose clamps beyond its duration and on garbage input", () => {
  expect(deathPose(DEATH_MS * 10).done).toBe(true);
  expect(deathPose(Number.NaN).done).toBe(true);
  expect(deathPose(-50).scaleY).toBe(1);
});

test("gold arcs upward and lands before it expires", () => {
  const peak = goldPose(GOLD_POP_MS * 0.5, 0);
  const end = goldPose(GOLD_POP_MS, 0);
  expect(peak.dy).toBeLessThan(0);
  // 정점이 끝점보다 높아야 한다(y는 위로 음수) — 포물선이 아니라 직선이면 이게 깨진다
  expect(peak.dy).toBeLessThan(end.dy);
  expect(end.alpha).toBeCloseTo(0);
  expect(end.done).toBe(true);
});

test("gold drift is proportional to the given jitter", () => {
  expect(goldPose(GOLD_POP_MS, 22).dx).toBeCloseTo(22);
  expect(goldPose(GOLD_POP_MS, -22).dx).toBeCloseTo(-22);
  expect(goldPose(0, 22).dx).toBe(0);
});

// 설계 문서의 `0.62 + i×0.13`은 4번째가 1.01 — 완전히 화면 밖이었다.
// 웨이브는 실제로 4마리까지 생성되므로 넷째가 안 보이면 유령을 때리는 셈이다.
test("every enemy slot lands inside the field", () => {
  expect(ENEMY_SLOT_X.length).toBe(MAX_VISIBLE_ENEMIES);
  for (const r of ENEMY_SLOT_X) {
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(1);
  }
});

test("slots are ordered left to right without collapsing", () => {
  for (let i = 1; i < ENEMY_SLOT_X.length; i++) {
    expect(ENEMY_SLOT_X[i]!).toBeGreaterThan(ENEMY_SLOT_X[i - 1]!);
  }
});

test("the boss gets its own slot, not the first minion position", () => {
  expect(enemySlotRatio(0, true)).not.toBe(enemySlotRatio(0, false));
  // 보스는 어느 인덱스로 물어도 같은 자리다 — 웨이브에 하나뿐이다
  expect(enemySlotRatio(3, true)).toBe(enemySlotRatio(0, true));
});

/**
 * 아군 간격을 **실측 몸통 폭**으로 검증한다.
 *
 * 예전 간격(137px)은 "리그 폭 ≈ 키의 0.9배" 가정에서 나왔는데, 우리 에셋은
 * 달리기·굴르기에서 몸이 눕는다(노라 `run` 219px). 두 아군이 서로를 관통해
 * 한 덩어리로 보였다 — 스크린샷에서 확인했다. 원화를 갈아끼우면 이 테스트가
 * 먼저 깨져야 한다. 조용히 다시 뭉치면 화면을 열어 보기 전엔 모른다.
 *
 * **알파 bbox 폭(`box[2]`)이 아니라 `bodyW`로 잰다.** chierit 로스터로 바꾸면서
 * fire_knight가 bbox 195px > 간격 173px로 이 테스트를 깼는데, 그 폭은 등 뒤로
 * 늘어뜨린 **대검**이었다 — 두 아군을 실제 자리에 세워 보니 몸은 서로 닿지도
 * 않는다(`/tmp/gap_fk_lr.png`). bbox로 재면 "무기를 든 캐릭터는 전부 겹친다"가
 * 되어 검사가 진짜 겹침을 못 가리킨다. 임포터가 행 폭의 중앙값을 재서 남긴다.
 *
 * 무기가 옆칸에 걸치는 것 자체는 결함이 아니다 — 겹치면 안 되는 것은 몸이다.
 */
test("아군 간격이 대기 자세 몸통 폭보다 넓다 — 뭉치면 둘이 한 명으로 보인다", () => {
  const manifest = JSON.parse(
    readFileSync("public/assets/chars/chars.json", "utf-8"),
  ) as {
    chars: Record<
      string,
      { refSubjH: number; actions: Record<string, { bodyW?: number }> }
    >;
  };
  const fieldW = 720;
  const fieldH = 420;
  const gapPx = fieldW * (allySlotRatio(1) - allySlotRatio(0));
  for (const [i, slug] of HERO_SLUGS.entries()) {
    const def = manifest.chars[slug]!;
    const scale = (fieldH * ALLY_H_RATIO) / def.refSubjH;
    // 대기 자세만 본다 — 돌진 중에는 한쪽이 적 앞으로 나가 있어서 겹쳐도 된다.
    // 값이 없으면 이 검사는 아무것도 검증하지 않는다(임포터가 안 쟀다는 뜻)
    const bodyW = def.actions.idle!.bodyW;
    expect(bodyW, `${slug}(#${i}) bodyW`).toBeDefined();
    expect(bodyW! * scale, `${slug}(#${i})`).toBeLessThan(gapPx);
  }
});

test("아군 자리는 왼쪽부터 오른쪽으로, 3인 이상도 필드 안이다", () => {
  expect(allySlotRatio(0)).toBeLessThan(allySlotRatio(1));
  expect(allySlotRatio(1)).toBeLessThan(allySlotRatio(2));
  // 적은 0.52부터 선다 — 아군 대기 자리가 그 앞을 넘으면 시작부터 겹친다
  for (let i = 0; i < 2; i++) {
    expect(allySlotRatio(i), `#${i}`).toBeLessThan(ENEMY_SLOT_X[0]!);
  }
  expect(allySlotRatio(0)).toBeGreaterThan(0);
});

test("음수 인덱스도 첫 자리로 접힌다 — 자리 계산이 화면 밖으로 나가지 않는다", () => {
  expect(allySlotRatio(-3)).toBe(allySlotRatio(0));
});

test("out-of-range slot indices fall back to the last slot", () => {
  const last = ENEMY_SLOT_X[ENEMY_SLOT_X.length - 1]!;
  expect(enemySlotRatio(99, false)).toBe(last);
  expect(enemySlotRatio(-1, false)).toBe(last);
});

test("clampToField keeps a wide boss fully on screen", () => {
  const fieldW = 720;
  const fieldH = 560;
  const half = fieldH * ENEMY_H_RATIO * BOSS_SCALE * 0.5;
  const extent = { left: -half, right: half };
  const x = clampToField(fieldW * enemySlotRatio(0, true), extent, fieldW);
  expect(x + extent.right).toBeLessThanOrEqual(fieldW);
  expect(x + extent.left).toBeGreaterThanOrEqual(0);
});

// 에일리언 리그는 원점이 왼쪽으로 치우쳐 있어서 facing -1이면 덩치가 오른쪽에 쏟아진다.
// 대칭 가정으로는 이 경우를 못 잡는다 — 스크린샷에서 보스가 화면을 벗어났다.
test("an asymmetric rig is clamped by its actual right edge", () => {
  const fieldW = 720;
  // 원점 오른쪽으로만 300px 뻗는 리그
  const extent = { left: -20, right: 300 };
  const x = clampToField(fieldW * 0.92, extent, fieldW);
  expect(x + extent.right).toBeLessThanOrEqual(fieldW);
  expect(x).toBeLessThan(fieldW * 0.92);
});

test("a rig leaning left is pushed off the left edge just as hard", () => {
  const extent = { left: -300, right: 20 };
  const x = clampToField(10, extent, 720);
  expect(x + extent.left).toBeGreaterThanOrEqual(0);
});

test("a character wider than the field is centred instead of clamped twice", () => {
  // 양쪽 클램프가 서로 모순되는 경우 — 무한 루프나 NaN이 아니라 중앙이어야 한다
  const x = clampToField(10, { left: -900, right: 900 }, 720);
  expect(x).toBe(360);
  expect(Number.isFinite(x)).toBe(true);
});

test("clampToField leaves in-range positions alone", () => {
  expect(clampToField(400, { left: -50, right: 50 }, 720)).toBe(400);
});

// 에일리언은 폭이 키와 거의 같아서 4마리가 720px 안에 안 들어간다.
// 겹침을 거리로 읽히게 하려면 크기·높이·명도 세 신호가 같이 움직여야 한다.
test("depth shrinks, lifts and dims together", () => {
  const front = depthPose(0, 200);
  expect(front.scale).toBe(1);
  expect(front.lift).toBe(0);
  expect(front.dim).toBe(1);

  const back = depthPose(1, 200);
  expect(back.scale).toBeLessThan(1);
  expect(back.lift).toBeGreaterThan(0);
  expect(back.dim).toBeLessThan(1);
});

test("depth is monotonic — no slot is both nearer and dimmer", () => {
  let prev = depthPose(0, 200);
  for (let d = 0.1; d <= 1; d += 0.1) {
    const cur = depthPose(d, 200);
    expect(cur.scale).toBeLessThanOrEqual(prev.scale);
    expect(cur.lift).toBeGreaterThanOrEqual(prev.lift);
    expect(cur.dim).toBeLessThanOrEqual(prev.dim);
    prev = cur;
  }
});

test("depthPose clamps out-of-range and garbage depths", () => {
  expect(depthPose(5, 200)).toEqual(depthPose(1, 200));
  expect(depthPose(-5, 200)).toEqual(depthPose(0, 200));
  expect(depthPose(Number.NaN, 200)).toEqual(depthPose(0, 200));
});

// 지그재그여야 인접한 두 마리가 같은 깊이에 겹치지 않는다
test("adjacent slots never share a depth", () => {
  for (let i = 1; i < MAX_VISIBLE_ENEMIES; i++) {
    expect(enemySlotDepth(i)).not.toBe(enemySlotDepth(i - 1));
  }
  expect(enemySlotDepth(0)).toBe(0);
  // 범위 밖은 앞쪽으로 떨어진다 — 안 보이는 것보다 낫다
  expect(enemySlotDepth(99)).toBe(0);
});

test("dimColor scales every channel and keeps the value in range", () => {
  expect(dimColor(0xffffff, 1)).toBe(0xffffff);
  expect(dimColor(0xffffff, 0)).toBe(0x000000);
  expect(dimColor(0xffffff, 0.5)).toBe(0x808080);
  // 채널이 서로 새어나가면 안 된다
  expect(dimColor(0xff0000, 0.5)).toBe(0x800000);
  expect(dimColor(0x0000ff, 0.5)).toBe(0x000080);
});

test("dimColor clamps garbage factors instead of producing NaN", () => {
  expect(dimColor(0xffffff, 5)).toBe(0xffffff);
  expect(dimColor(0xffffff, -1)).toBe(0x000000);
  expect(dimColor(0xffffff, Number.NaN)).toBe(0xffffff);
});

/**
 * 슬라이드 오프셋의 기준이 `rect.y`다 (2026-08-07 회귀).
 *
 * 싱글 하강 연출이 `field.view.y = offset`으로 직접 쓰고 있었다. `view`는
 * `layout()`이 이미 `rect.y`로 옮겨 둔 컨테이너라, 슬라이드가 끝나는 순간
 * (`offset = 0`) 전장이 화면 맨 위(y=0)로 붙었다 — 필드 아래쪽 `rect.y`만큼
 * (싱글 153.6px) **배경 없는 검은 띠**가 남고 하늘이 HUD 밑으로 파고들었다.
 * 1:1 캡처에서 y 800~953이 검게 비어 있었고, 나는 이걸 배경 에셋(하늘 비율)
 * 문제로 잘못 짚었다 — 좌표 문제였다.
 *
 * **연출 중이 아니라 연출이 끝난 자리가 결함이었다.** 그래서 `offset = 0`을
 * 여기서 따로 묻는다.
 */
describe("fieldSlideY — 슬라이드는 rect.y에서 재는 오프셋이다", () => {
  /** 싱글 필드의 `rect.y` — 숫자를 손으로 적으면 HUD가 움직일 때 조용해진다 */
  const HUD_Y = HUD_H;

  it("오프셋 0은 제자리다 — 화면 위(0)가 아니다", () => {
    expect(fieldSlideY(HUD_Y, 0)).toBe(HUD_Y);
    expect(fieldSlideY(HUD_Y, 0)).not.toBe(0);
  });

  it("오프셋은 rect.y에 더한다 — 위로 빠질 때도 기준은 rect.y다", () => {
    expect(fieldSlideY(HUD_Y, -SINGLE_FIELD_H)).toBe(HUD_Y - SINGLE_FIELD_H);
    expect(fieldSlideY(HUD_Y, 120)).toBe(HUD_Y + 120);
  });

  /**
   * 하강 연출의 **모든 시점**에서 오프셋만큼만 움직인다. 한 시점만 재면
   * 끝값이나 중간값 하나가 검사 밖에 남는다 (원래 결함은 끝값이었다).
   */
  it("연출 전 구간에서 view.y − rect.y = 오프셋이다", () => {
    for (let ms = 0; ms <= DIVE_SLIDE_TOTAL_MS + 200; ms += 60) {
      const offset = diveSlideOffset(ms, SINGLE_FIELD_H);
      expect(fieldSlideY(HUD_Y, offset) - HUD_Y, `${ms}ms`).toBeCloseTo(offset, 6);
    }
  });

  /**
   * 연출이 끝나면 필드가 자기 자리를 **꽉** 채운다 — 위는 HUD 아래에 붙고
   * 아래는 강화 줄에 닿는다. 검은 띠는 이 둘 중 하나가 어긋난 결과였다.
   */
  it("제자리에서 필드가 HUD 아래부터 강화 줄까지 빈틈없이 덮는다", () => {
    const y = fieldSlideY(HUD_Y, diveSlideOffset(DIVE_SLIDE_TOTAL_MS, SINGLE_FIELD_H));
    expect(y).toBeCloseTo(HUD_Y, 6);
    expect(y + SINGLE_FIELD_H).toBeCloseTo(UPGRADE_ROW_Y, 6);
  });

  it("쓰레기 값은 제자리로 접는다 — NaN이 들어가면 필드가 사라진다", () => {
    expect(fieldSlideY(HUD_Y, Number.NaN)).toBe(HUD_Y);
    expect(fieldSlideY(HUD_Y, Number.POSITIVE_INFINITY)).toBe(HUD_Y);
    expect(fieldSlideY(Number.NaN, 40)).toBe(40);
  });
});

/**
 * 돌진이 수렴할 때 두 아군이 겹치는 것을 막는 규칙.
 *
 * **왜 이 검사가 필요한가:** 겹침은 화면에서 "한 명이 사라졌다"로 보이고,
 * 캐릭터가 커지거나(`ALLY_H_RATIO`) 사거리(`MeleeStyle.reach`)가 바뀌면 조용히
 * 돌아온다. 1:1 캡처로 세 번 고쳤는데(뺄셈 → 몸폭 → 클램프+하한) 세 판 모두
 * **코드는 그럴듯했고 결과값만 틀렸다** — 그래서 결과값 사이의 거리를 묻는다.
 */
describe("allyLaneX — 겹침은 결과 x 사이의 거리다", () => {
  /** 싱글 필드 기준 물의 사제 몸폭 — 이 파일의 다른 검사와 같은 출처다 */
  const bodyW = allyBodyWPx(24, 38, SINGLE_FIELD_H);

  it("앞줄이 없으면 사거리가 준 자리를 그대로 쓴다", () => {
    expect(allyLaneX(301, null, bodyW, 94)).toBe(301);
  });

  it("앞줄과 겹치면 몸폭만큼 물러선다 — 뺄셈이 아니라 간격이 결과다", () => {
    // 두 아군의 원래 멈춤 지점이 37px 차이였던 10층 보스 실측 상황이다.
    // 오프셋 뺄셈은 이 차이를 그대로 남긴다 — 클램프는 간격을 보장한다
    const ahead = 338;
    const rear = allyLaneX(301, ahead, bodyW, 94);
    expect(ahead - rear).toBeCloseTo(bodyW * ALLY_LANE_GAP_RATIO, 5);
  });

  it("이미 충분히 뒤면 끌어당기지 않는다 — 사거리가 긴 캐릭터가 앞으로 밀리면 적 몸 속이다", () => {
    const rear = allyLaneX(100, 338, bodyW, 94);
    expect(rear).toBe(100);
  });

  it("대기 자리보다 뒤로는 안 간다 — 후퇴는 접근 모션의 부호를 뒤집는다", () => {
    // 1.0으로 올렸을 때 실측된 상황: 물러날 자리가 88px인데 대기 자리가 94다
    const homeX = 94;
    const rear = allyLaneX(180, 200, bodyW, homeX);
    expect(rear).toBeGreaterThanOrEqual(homeX);
  });

  it("벌릴 자리가 없어도 대기 자리를 지킨다 — 앞줄이 대기 자리보다 뒤인 경우", () => {
    expect(allyLaneX(120, 60, bodyW, 94)).toBe(94);
  });

  /**
   * **간격 비율은 캡처가 정한 값이다** — 0.55 / 0.8 / 1.0을 실제로 돌려서
   * 골랐다. 그래서 이 검사는 상수를 그대로 다시 적지 않는다(그러면 값을
   * 바꿀 때 같이 고쳐서 아무것도 안 묻는다). 대신 그때 본 **결과**를 묻는다:
   * 줄에 선 두 아군 사이가 대기 자리 간격만큼 벌어져야 한다. 0.55는 94px로
   * 몸폭의 절반이라 1:1 캡처에서 두 실루엣이 아직 이어져 보였다.
   */
  it("줄에 선 간격이 대기 자리 간격만큼 된다 — 절반이면 실루엣이 이어진다", () => {
    const slotGap = 720 * (allySlotRatio(1) - allySlotRatio(0));
    const ahead = 400;
    const rear = allyLaneX(390, ahead, bodyW, 94);
    // 물의 사제 몸폭 172px, 대기 간격 173px — 둘이 거의 같게 설계되어 있다
    expect(ahead - rear).toBeGreaterThanOrEqual(slotGap * 0.95);
  });

  it("쓰레기 값에 캐릭터를 화면 밖으로 보내지 않는다", () => {
    expect(allyLaneX(Number.NaN, 300, bodyW, 94)).toBe(0);
    expect(allyLaneX(301, Number.NaN, bodyW, 94)).toBe(301);
    expect(allyLaneX(301, 338, Number.NaN, 94)).toBe(301);
  });
});

/**
 * 줄 간격의 유일한 입력. `visualExtent()`로 재면 공격 클립의 무기 궤적까지
 * 삼켜서 뒤 아군이 화면 밖(x −22)으로 물러났다 — 실측이다.
 */
describe("allyBodyWPx — 몸폭은 클립과 무관하게 고정이다", () => {
  it("매니페스트 몸폭에 표시 배율을 곱한다", () => {
    // 물의 사제: bodyW 24 / refSubjH 38, 싱글 필드 800px → 키 272px
    const px = allyBodyWPx(24, 38, SINGLE_FIELD_H);
    expect(px).toBeCloseTo((24 * (SINGLE_FIELD_H * ALLY_H_RATIO)) / 38, 5);
    // 대기 자리 간격(0.24 × 720 = 173px)과 같은 크기여야 한다 — 그래야 줄에
    // 선 간격이 대기 중 간격과 같아진다. 어긋나면 한쪽이 무의미해진다
    expect(px).toBeGreaterThan(150);
    expect(px).toBeLessThan(200);
  });

  /**
   * **대기 자리 간격과 비교하면 안 된다.** 처음 그렇게 적었고 leaf_ranger가
   * 179px > 173px으로 깨졌는데, 그건 결함이 아니다 — `allyLaneX`의 `homeX`
   * 하한이 대기 자리 밖으로 나가는 것을 이미 막는다. 넘으면 "줄이 화면을
   * 넘어간다"고 적어 뒀지만 그런 일은 일어날 수 없었다.
   *
   * 실제로 필요한 부등식은 **줄이 들어갈 자리가 있는가**다: 2인 줄은 앞 아군의
   * 자리에서 몸폭만큼 뒤까지 쓰므로, 첫 아군의 대기 자리(0.13)와 가장 가까운
   * 적(0.52) 사이에 그만큼이 들어가야 한다. 안 들어가면 하한이 상시 발동해서
   * **줄이 조용히 접히고**(간격 0) 겹침이 그대로 돌아온다 — 그때는 이 상수가
   * 아니라 대기 자리나 팀 크기를 고쳐야 한다.
   *
   * 이 검사가 못 보는 것: 사거리(`MeleeStyle.reach`)가 긴 캐릭터는 적 앞까지
   * 못 가므로 여유가 더 적다. 그 경우까지는 `[strike]` 로그와 캡처가 본다.
   */
  it("2인 줄이 첫 아군 자리와 가장 가까운 적 사이에 들어간다", () => {
    const manifest = JSON.parse(
      readFileSync("public/assets/chars/chars.json", "utf-8"),
    ) as {
      chars: Record<
        string,
        { refSubjH: number; actions: Record<string, { bodyW?: number }> }
      >;
    };
    const room = 720 * (ENEMY_SLOT_X[0]! - allySlotRatio(0));
    for (const slug of HERO_SLUGS) {
      const def = manifest.chars[slug]!;
      const px = allyBodyWPx(
        def.actions.idle!.bodyW,
        def.refSubjH,
        SINGLE_FIELD_H,
      );
      expect(px, slug).toBeGreaterThan(0);
      expect(px * ALLY_LANE_GAP_RATIO, slug).toBeLessThanOrEqual(room);
    }
  });

  it("몸폭을 모르면 0이 아니라 근사한다 — 0이면 줄이 조용히 사라진다", () => {
    const px = allyBodyWPx(undefined, 38, SINGLE_FIELD_H);
    expect(px).toBeCloseTo(
      SINGLE_FIELD_H * ALLY_H_RATIO * ALLY_BODY_W_RATIO_FALLBACK,
      5,
    );
    expect(allyBodyWPx(0, 38, SINGLE_FIELD_H)).toBe(px);
    expect(allyBodyWPx(Number.NaN, 38, SINGLE_FIELD_H)).toBe(px);
  });

  it("필드가 커지면 몸폭도 같이 커진다 — px 상수는 조용히 뜻이 달라진다", () => {
    const small = allyBodyWPx(24, 38, 400);
    const big = allyBodyWPx(24, 38, 800);
    expect(big).toBeCloseTo(small * 2, 5);
  });
});

/**
 * HP바 가시성 (유저 신고 1번: "몬스터의 HP 바가 계속 있는데, 밑으로 내려가는").
 *
 * **바가 아래로 흐르는 것 자체는 결함이 아니다** — 바는 `overlay`에 있고 그
 * 부모가 층 전환에 슬라이드하는 컨테이너다(`fieldSlideY`). 결함은 죽은 적의
 * 바가 그 슬라이드에 실려 남는 것이고, 그래서 여기서 묻는 것은 슬라이드가
 * 아니라 **어떤 상태에서 바가 보이는가**다.
 */
describe("showsHpBar — 죽은 적의 바가 남지 않는다", () => {
  const slot = (o: Partial<HpBarSlotState>): HpBarSlotState => ({
    occupied: true,
    buried: false,
    deathMs: -1,
    walkInMs: null,
    ...o,
  });

  /** 대조군 — 산 적의 바는 보여야 한다. 이게 없으면 `false` 상수도 통과한다 */
  it("자리에 선 산 적은 바가 보인다", () => {
    expect(showsHpBar(slot({}))).toBe(true);
  });

  it("걸어 들어오는 중에는 감춘다 — 바는 슬롯 좌표에 고정이다", () => {
    expect(showsHpBar(slot({ walkInMs: 0 }))).toBe(false);
    expect(showsHpBar(slot({ walkInMs: ENEMY_WALK_IN_MS - 1 }))).toBe(false);
  });

  it("빈 슬롯·묻힌 적은 바가 없다", () => {
    expect(showsHpBar(slot({ occupied: false, buried: true }))).toBe(false);
    expect(showsHpBar(slot({ buried: true }))).toBe(false);
  });

  it("쓰러지는 중(사망 연출)에는 바를 뺀다 — 0%인 바는 정보가 없다", () => {
    expect(showsHpBar(slot({ deathMs: 0 }))).toBe(false);
    expect(showsHpBar(slot({ deathMs: DEATH_MS - 1 }))).toBe(false);
  });

  /**
   * **이 조합이 신고된 화면이다.** 사망 연출이 끝나면 `deathMs`는 -1로 돌아오므로
   * (`slot.deathMs = -1`) 죽기 전과 죽은 뒤의 `deathMs`가 같다 — `deathMs < 0`을
   * "살아 있다"로 읽으면 묻힌 적이 산 적으로 보인다. 죽은 것을 아는 값은
   * `buried`뿐이다.
   */
  it("연출이 끝난 뒤 deathMs가 -1로 돌아와도 바가 되살아나지 않는다", () => {
    const afterDeath = slot({ deathMs: -1, buried: true });
    expect(afterDeath.deathMs).toBeLessThan(0); // 옛 조건이 통과시켰던 지점
    expect(showsHpBar(afterDeath)).toBe(false);
  });

  /**
   * 상태를 하나씩 넣는 위 검사들은 **그 조합이 실제로 생기는지**를 안 묻는다.
   * 여기서 등장→강제 방출 처치→연출 완료→등장 도착의 순서를 실제로 돌린다
   * (`only-reachable-cases-content`가 아니라 `only-reachable-cases-count`).
   *
   * 도달 가능한 이유: 등장은 620ms이고 밀린 피격의 강제 방출 한계는 2800ms지만
   * **웨이브가 바뀌는 순간의 방출은 등장 중에 떨어진다** — 그 둘이 겹친다는 것을
   * 상수로 확인해 둔다.
   */
  it("등장 중에 죽은 적은 도착 시점에도 바가 없다 (도달 가능한 순서)", () => {
    expect(ENEMY_WALK_IN_MS).toBeLessThan(PENDING_HARD_MS);
    // 1) 스폰: 만피로 걸어 들어온다
    const s = slot({ walkInMs: 0 });
    expect(showsHpBar(s)).toBe(false);
    // 2) 등장 중에 처치 확정 (`releaseHit`의 킬 분기)
    s.deathMs = 0;
    expect(showsHpBar(s)).toBe(false);
    // 3) 사망 연출 완료 — 여기서 deathMs가 -1로 **돌아온다**
    s.deathMs = -1;
    s.buried = true;
    // 4) 등장 시간이 다 차서 도착 처리가 돈다
    s.walkInMs = null;
    expect(showsHpBar(s)).toBe(false);
  });
});
