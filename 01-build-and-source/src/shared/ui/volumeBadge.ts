/**
 * 소리 크기 배지 — 탭 한 번에 `100% → 50% → 무음`을 돈다.
 *
 * 규칙: `shared/audioSettingsRules.ts` · 자리: 모드가 준다
 * (`single/diveHudRules.volumeBadgePos` · `pvp/autoBadgeRules.volumeBadgePos`).
 *
 * ## 왜 위젯을 따로 두는가
 *
 * AUTO 배지는 `skillBar.autoView`가 들고 있다 — 바가 지름을 정하고
 * (`autoBadgeD`) 자리는 모드가 주는 구조다. 소리 배지를 거기 얹으면 스킬바가
 * 오디오 설정을 알게 되는데, 바는 두 모드가 공유하는 전투 위젯이고 소리 설정은
 * 전투와 무관하다. 대신 **AUTO와 같은 위젯(`createCircleButton`)·같은 지름
 * (`autoBadgeD`)** 을 써서 두 배지가 한 열의 같은 물건으로 읽히게 한다.
 *
 * ## 저장은 여기서 한다
 *
 * `audio.setVolume`이 게인 반영과 저장을 같이 한다. 순수 함수 밖에서 저장한다는
 * 규약(docs/SAVE-SCHEMA.md §2-4)은 **판정**을 순수하게 두라는 것이고, 판정은
 * `audioSettingsRules.nextVolume`이 한다 — 이 파일은 위젯이므로 저장 경로에
 * 있어도 된다. 씬마다 저장을 부르게 하면 한 씬이 빠뜨렸을 때 조용히 안 남는다.
 */

import { Container } from "pixi.js";
import { createCircleButton, type CircleButton } from "./skillSlot";
import { STATE_OFF, STATE_OK } from "../theme";
import { getVolume, playSfx, setVolume } from "../audio";
import { isMuted, nextVolume, volumeLabel } from "../audioSettingsRules";

export interface VolumeBadgeOpts {
  /** 지름 — `skillBarRules.autoBadgeD(barH)`를 넘긴다 (AUTO와 같은 크기) */
  diameter: number;
  /** 배지 **중심**의 디자인 좌표 (모드의 `volumeBadgePos`) */
  at: { x: number; y: number };
  /** 바뀐 뒤 알릴 문구가 필요하면 (토스트). 없으면 조용히 바뀐다 */
  onChange?(volume: number): void;
}

export interface VolumeBadge {
  view: Container;
  /** 프레임 갱신 — 눌림 애니메이션이 돈다 */
  update(dtMs: number): void;
  destroy(): void;
}

export function createVolumeBadge(opts: VolumeBadgeOpts): VolumeBadge {
  const view = new Container();
  view.label = "volume-badge";
  view.position.set(opts.at.x, opts.at.y);

  const badge: CircleButton = createCircleButton({
    diameter: opts.diameter,
    color: STATE_OK,
    top: volumeLabel(getVolume())[0],
    bottom: volumeLabel(getVolume())[1],
    onTap: () => {
      const next = setVolume(nextVolume(getVolume()));
      paint();
      /**
       * 탭 소리는 **바꾼 뒤에** 낸다 — 새 크기로 들려야 "이만큼 작아졌다"가
       * 귀로 확인된다. 무음으로 갔을 때는 `playSfx`가 무음 가드에서 돌아가므로
       * 아무 소리도 안 나는데, 그게 맞다(무음을 알리는 소리는 모순이다).
       */
      playSfx("ui_tap");
      opts.onChange?.(next);
    },
  });
  view.addChild(badge.view);

  /** 무음이면 회색 — AUTO의 `STATE_OFF`와 같은 신호를 쓴다 */
  const paint = (): void => {
    const v = getVolume();
    badge.setColor(isMuted(v) ? STATE_OFF : STATE_OK);
    badge.setText(...volumeLabel(v));
  };
  paint();

  return {
    view,
    update(dtMs: number): void {
      badge.update(dtMs);
    },
    destroy(): void {
      view.destroy({ children: true });
    },
  };
}
