import { Container, Graphics, Text } from "pixi.js";
import { PRESET_SKILLS } from "../loadout/preset";
import type { GameApp } from "./app";
import { DESIGN_H, DESIGN_W } from "./viewport";
import {
  ACCENT_GOLD,
  FONT_FAMILY,
  TEAM_OURS,
  T_CAPTION,
  T_TITLE,
  UI_TEXT,
  UI_TEXT_DIM,
} from "./theme";
import { createBanner, type BannerKind } from "./ui/banner";
import { createButton, type ButtonState } from "./ui/button";
import { createHintFinger, createToast } from "./ui/hint";
import { createPanel } from "./ui/panel";
import { createPill } from "./ui/pill";
import { createScrim } from "./ui/scrim";
import { createCircleButton, createSkillSlot } from "./ui/skillSlot";
import { createWaveRail } from "./ui/waveRail";

/**
 * 공용 위젯 갤러리 — `?gallery=1`.
 *
 * 설계 문서: specs/2026-07-27-ux/09-implementation-plan.md §3 (스크린샷 회귀)
 *
 * **전투 화면만으로는 위젯 회귀를 잡을 수 없다.** 배너는 1.26초에 지나가고,
 * 잠긴 버튼·크림 패널·토스트는 다른 씬에만 나오고, 쿨다운 파이는 눌러야 보인다.
 * 형태 규칙(§01-3)이 바뀌었는지 한 장으로 확인할 수 있어야 한다.
 *
 * DEV에서만 진입한다 (`parseDebugEntry`가 프로덕션에서 false를 준다).
 */

export interface Gallery {
  /** 정지시켜도 되는 데모다 — 세션과 달리 코어 틱이 없다 */
  stop(): void;
}

function heading(text: string, y: number): Text {
  const t = new Text({
    text,
    style: {
      fill: UI_TEXT_DIM,
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: "400",
    },
  });
  t.position.set(24, y);
  return t;
}

export function createGallery(app: GameApp): Gallery {
  const root = new Container();
  app.root.addChild(root);

  const bg = new Graphics()
    .rect(0, 0, DESIGN_W, DESIGN_H)
    .fill({ color: 0x181428 });
  const title = new Text({
    text: "WIDGET GALLERY",
    style: {
      fill: ACCENT_GOLD,
      fontFamily: FONT_FAMILY,
      fontSize: T_TITLE.size,
      fontWeight: "700",
    },
  });
  title.position.set(24, 18);
  root.addChild(bg, title);

  const updates: ((dtMs: number) => void)[] = [];

  // ── 패널 2종
  root.addChild(heading("Panel — dark / cream + header", 70));
  const darkPanel = createPanel({ w: 320, h: 150, header: "패널" });
  darkPanel.view.position.set(24, 92);
  const creamPanel = createPanel({
    w: 320,
    h: 150,
    variant: "cream",
    header: "결과",
  });
  creamPanel.view.position.set(376, 92);
  root.addChild(darkPanel.view, creamPanel.view);
  for (const p of [darkPanel, creamPanel]) {
    const t = new Text({
      text: "본문 텍스트",
      style: {
        fill: p.textColor,
        fontFamily: FONT_FAMILY,
        fontSize: T_CAPTION.size,
        fontWeight: "700",
      },
    });
    p.content.addChild(t);
  }

  // ── 버튼 5상태
  root.addChild(
    heading("Button — ready / confirm / ad / neutral / disabled", 262),
  );
  const states: ButtonState[] = [
    "ready",
    "confirm",
    "ad",
    "neutral",
    "disabled",
  ];
  states.forEach((state, i) => {
    const b = createButton({
      label: state,
      ...(state === "ad" ? { sublabel: "무료" } : {}),
      state,
      w: 128,
    });
    b.view.position.set(24 + i * 136, 284);
    root.addChild(b.view);
    updates.push((dt) => b.update(dt));
  });

  // ── 필
  root.addChild(heading("Pill — 아이콘 + 카운트업", 378));
  const goldPill = createPill({ w: 200, iconColor: ACCENT_GOLD, text: "1240" });
  goldPill.view.position.set(36, 400);
  const timePill = createPill({ w: 180, iconColor: TEAM_OURS, text: "1:58" });
  timePill.view.position.set(268, 400);
  root.addChild(goldPill.view, timePill.view);
  updates.push((dt) => {
    goldPill.update(dt);
    timePill.update(dt);
  });
  // 카운트업이 실제로 도는 것을 보여준다 — 정지 화면이면 규칙이 살아 있는지 모른다
  let pillMs = 0;
  let pillVal = 1240;
  updates.push((dt) => {
    pillMs += dt;
    if (pillMs < 900) return;
    pillMs = 0;
    pillVal += 137;
    goldPill.setValue(pillVal);
  });

  // ── 스킬 슬롯 (준비 / 쿨다운 / AUTO 배지)
  root.addChild(heading("SkillSlot — ready / cooling / AUTO badge", 468));
  const slots = PRESET_SKILLS.map((skill, i) => {
    const s = createSkillSlot({
      skill,
      diameter: 120,
      color: [0x6a4bb0, 0x6a4bb0, 0xb04b6a, 0x4bb08a][i] ?? 0x6a4bb0,
    });
    s.view.position.set(96 + i * 148, 560);
    root.addChild(s.view);
    return s;
  });
  const autoBadge = createCircleButton({
    diameter: 96,
    color: 0x30a858,
    top: "AUTO",
    bottom: "ON",
  });
  autoBadge.view.position.set(660, 560);
  root.addChild(autoBadge.view);
  updates.push((dt) => {
    for (const s of slots) s.update(dt);
    autoBadge.update(dt);
  });
  // 슬롯 0은 준비, 1~3은 쿨다운을 각각 다른 비율로 돌린다 — 파이·남은 초·
  // 완료 펄스가 전부 한 화면에서 보인다
  let slotMs = 0;
  updates.push((dt) => {
    slotMs += dt;
    slots.forEach((s, i) => {
      if (i === 0) {
        s.setRemaining(0);
        return;
      }
      const cd = s.skill.cooldownMs;
      // 각 슬롯이 다른 위상으로 돈다 — 같은 위상이면 파이 4개가 똑같이 움직인다
      const t = (slotMs + i * cd * 0.3) % cd;
      s.setRemaining(cd - t);
    });
  });

  // ── WaveRail
  root.addChild(heading("WaveRail — 눈금 + 마커 + 보스", 668));
  const rail = createWaveRail({ w: 440 });
  rail.view.position.set(DESIGN_W / 2, 700);
  root.addChild(rail.view);
  rail.setWave(1);
  let railMs = 0;
  updates.push((dt) => {
    rail.update(dt);
    railMs += dt;
    rail.setProgress((railMs % 3000) / 3000);
  });

  /**
   * ── Banner 6종 (순환)
   *
   * **시전 공지 세 갈래가 다 있어야 한다.** 전에는 내가 건 방해를 `system`으로
   * 데모했는데(회색), 그게 실제 배선이기도 했다 — 그래서 내가 건 것과 AI 팀원이
   * 건 것이 화면에서 같았다. 갤러리에 셋을 나란히 두면 색이 갈렸는지 한 화면에서
   * 보인다: 내 것(우리 진영색) / 팀원(그 색을 죽인 것) / 당한 것(상대색).
   */
  root.addChild(
    heading("Banner — interference / myCast / teammate / buff / wave / system", 782),
  );
  const banner = createBanner({ w: DESIGN_W });
  banner.view.y = 804;
  root.addChild(banner.view);
  const bannerDemo: readonly [BannerKind, string][] = [
    ["interference", "⚡ 감속당했다!"],
    ["myCast", "타락의 사슬 → 상대"],
    ["teammate", "팀원 · 타락의 사슬 → 상대"],
    // 프리셋에 버프 칸은 없다(`presetSkillsFor`의 결정 기록). 갈래는 살아 있고
    // (`session.castSkill`) 이 색이 아틀라스·배너에 남아 있는지를 여기서 본다 —
    // 지워진 스킬 이름을 적으면 없는 칸을 데모하는 것으로 읽힌다
    ["buff", "버프 발동!"],
    ["wave", "WAVE 3 클리어"],
    ["system", "미니보스 접근"],
  ];
  let bannerIdx = 0;
  let bannerMs = 0;
  banner.show(...bannerDemo[0]!);
  updates.push((dt) => {
    banner.update(dt);
    bannerMs += dt;
    if (bannerMs < 1500) return;
    bannerMs = 0;
    bannerIdx = (bannerIdx + 1) % bannerDemo.length;
    banner.show(...bannerDemo[bannerIdx]!);
  });

  // ── Toast + HintFinger
  root.addChild(heading("Toast / HintFinger", 900));
  const toast = createToast({ cx: DESIGN_W / 2, cy: 960 });
  root.addChild(toast.view);
  toast.show("감속 해제");
  let toastMs = 0;
  updates.push((dt) => {
    toast.update(dt);
    toastMs += dt;
    if (toastMs < 2600) return;
    toastMs = 0;
    toast.show("감속 해제");
  });
  // 갤러리에서는 localStorage를 쓰지 않는다 — 갤러리를 한 번 열었다고
  // 실제 첫 대전의 온보딩이 사라지면 안 된다
  const finger = createHintFinger({ store: null });
  root.addChild(finger.view);
  finger.showAt(120, 990);
  updates.push((dt) => finger.update(dt));

  // ── Scrim (하단 일부만 덮어 대비를 보여준다)
  root.addChild(heading("Scrim — α0.72 + 채도 40%", 1040));
  const scrimHost = new Container();
  const scrimSample = new Graphics();
  for (let i = 0; i < 6; i += 1) {
    scrimSample
      .rect(24 + i * 112, 1064, 100, 90)
      .fill({
        color: [0xff4040, 0xffc94a, 0x40ff80, 0x40a0ff, 0xa850e8, 0xffffff][i],
      });
  }
  scrimHost.addChild(scrimSample);
  root.addChild(scrimHost);
  const scrim = createScrim({
    w: DESIGN_W / 2,
    h: 110,
    target: scrimHost,
  });
  scrim.view.position.set(DESIGN_W / 2, 1058);
  root.addChild(scrim.view);
  scrim.show();
  updates.push((dt) => scrim.update(dt));

  const note = new Text({
    text: "?gallery=1 · DEV only",
    style: {
      fill: UI_TEXT,
      fontFamily: FONT_FAMILY,
      fontSize: T_CAPTION.size,
      fontWeight: "400",
    },
  });
  note.anchor.set(1, 1);
  note.position.set(DESIGN_W - 24, DESIGN_H - 12);
  root.addChild(note);

  const tick = (ticker: { deltaMS: number }): void => {
    for (const u of updates) u(ticker.deltaMS);
  };
  app.app.ticker.add(tick);

  return {
    stop(): void {
      app.app.ticker.remove(tick);
      root.destroy({ children: true });
    },
  };
}
