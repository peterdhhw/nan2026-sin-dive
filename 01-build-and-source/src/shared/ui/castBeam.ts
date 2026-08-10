import { Container, Graphics } from "pixi.js";
import {
  BEAM_POOL,
  BEAM_SEGMENTS,
  BEAM_W,
  beamPoint,
  beamPose,
  type Point,
} from "./castBeamRules";
import { ART_PX, snapPx } from "./shapeRules";

export type { Point };

/**
 * 시전 광선 궤적 — 스킬 슬롯에서 필드로 뻗는 선.
 *
 * 설계 문서: specs/2026-07-27-ux/07-scene-battle.md §7, README §3-2
 *
 * 이 레이어는 **디자인 좌표 전체(720×1280)를 좌표계로 쓴다** — 스킬바(하단)에서
 * 필드(상단)로 넘어가므로 어느 한 밴드의 로컬 좌표에 둘 수 없다. `app.layers.fx`
 * 아래에 붙는다.
 */
export interface CastBeamLayer {
  view: Container;
  /**
   * @param bowSign 곡선이 휘는 방향(±1). 슬롯별로 갈라 놓으면 연타해도 궤적이 겹치지 않는다
   */
  fire(from: Point, to: Point, color: number, bowSign: number): void;
  update(dtMs: number): void;
  destroy(): void;
}

interface Beam {
  g: Graphics;
  active: boolean;
  elapsedMs: number;
  from: Point;
  to: Point;
  color: number;
  bowSign: number;
}

export function createCastBeamLayer(): CastBeamLayer {
  const view = new Container();
  const beams: Beam[] = [];

  for (let i = 0; i < BEAM_POOL; i++) {
    const g = new Graphics();
    // 광선은 서로 겹쳐도 밝아지기만 하면 된다 — 가산 합성이 에너지처럼 읽힌다.
    // **Container가 아니라 Graphics에 건다**: Pixi v8의 컨테이너 blendMode는
    // 렌더 그룹이 아니면 자식에게 전달되지 않아서 광선이 아예 안 보였다
    // (스크린샷에서 확인 — 쿨다운은 돌았는데 궤적이 없었다)
    g.blendMode = "add";
    g.visible = false;
    view.addChild(g);
    beams.push({
      g,
      active: false,
      elapsedMs: 0,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      color: 0xffffff,
      bowSign: 1,
    });
  }

  let cursor = 0;

  const paint = (b: Beam): void => {
    const pose = beamPose(b.elapsedMs);
    b.g.clear();
    if (pose.alpha <= 0 || pose.to <= pose.from) return;

    // 꼬리 → 머리로 갈수록 두꺼워지는 선. Graphics.stroke는 폭이 균일하므로
    // 조각마다 폭을 바꿔 여러 번 긋는다 (조각 10개면 이음새가 안 보인다)
    for (let i = 0; i < BEAM_SEGMENTS; i++) {
      const t0 = pose.from + ((pose.to - pose.from) * i) / BEAM_SEGMENTS;
      const t1 = pose.from + ((pose.to - pose.from) * (i + 1)) / BEAM_SEGMENTS;
      const p0 = beamPoint(b.from, b.to, t0, b.bowSign);
      const p1 = beamPoint(b.from, b.to, t1, b.bowSign);
      const grow = (i + 1) / BEAM_SEGMENTS;
      b.g
        .moveTo(p0.x, p0.y)
        .lineTo(p1.x, p1.y)
        .stroke({
          color: b.color,
          // 폭은 격자 칸 수로만 변한다 — 조각마다 2.8px, 3.4px처럼 반 칸씩
          // 굵어지면 같은 광선 안에서 획 두께가 뭉개진다. 최소 한 칸은 남긴다
          width: Math.max(ART_PX, snapPx(BEAM_W * (0.35 + grow * 0.65))),
          alpha: pose.alpha * (0.35 + grow * 0.65),
          /**
           * 끝은 **사각**이다. 둥근 끝(`cap: "round"`)은 반원이라 조각마다
           * 안티에일리어싱된 반원이 하나씩 붙는다. 그냥 자르면(`butt`) 휘어진
           * 궤적의 조각 이음새에 틈이 벌어지므로, 반 칸 내밀어 덮는 사각을 쓴다.
           */
          cap: "square",
        });
    }

    // 머리에 흰 점 — 선만으로는 어느 쪽이 진행 방향인지 안 읽힌다.
    // 지름 13px 원은 이 크기에서 전부 안티에일리어싱이라 한 칸 격자 사각으로 찍는다
    const head = beamPoint(b.from, b.to, pose.to, b.bowSign);
    const hd = snapPx(BEAM_W * 1.8);
    b.g.rect(head.x - hd / 2, head.y - hd / 2, hd, hd).fill({
      color: 0xffffff,
      alpha: pose.alpha * 0.85,
    });
  };

  return {
    view,
    fire(from: Point, to: Point, color: number, bowSign: number): void {
      // 풀이 다 차면 가장 오래된 것을 덮어쓴다 — 연타 중엔 개별 궤적을 못 읽는다
      const b = beams.find((x) => !x.active) ?? beams[cursor]!;
      cursor = (cursor + 1) % BEAM_POOL;
      b.active = true;
      b.elapsedMs = 0;
      b.from = { x: from.x, y: from.y };
      b.to = { x: to.x, y: to.y };
      b.color = color;
      b.bowSign = bowSign;
      b.g.visible = true;
      paint(b);
    },
    update(dtMs: number): void {
      for (const b of beams) {
        if (!b.active) continue;
        b.elapsedMs += dtMs;
        if (beamPose(b.elapsedMs).done) {
          b.active = false;
          b.g.visible = false;
          b.g.clear();
          continue;
        }
        paint(b);
      }
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
