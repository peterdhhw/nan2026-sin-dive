/**
 * 한 매치에 서는 **네 명이 누구인가** — 양 팀의 캐릭터를 시드에서 뽑는다.
 *
 * Pixi를 import하지 않는다 (`session.ts`·`vsScene.ts`가 부른다).
 *
 * ## 왜 파일로 뗐는가 — 두 화면이 다른 상대를 세우고 있었다
 *
 * 이 유도식은 `session.ts` 안에만 있었고, VS 인트로(`vsScene.buildSide`)는
 * **내 로드아웃을 양쪽에 그대로 깔았다** — 상대 칸에 내 두 캐릭터가 붉은 틴트만
 * 입고 섰다(캡처로 확인: 아래 절반이 내 리제·실비아였다). 그래서 유저에게는
 * "매번 같은 상대"였고, 전투가 시작되면 아래 필드의 캐릭터가 **VS에서 본 것과
 * 다른 사람**으로 바뀌었다.
 *
 * 한 화면만 고치면 다음에 또 갈린다. 유도식이 한 곳에 있어야 두 화면이 같은
 * 넷을 세운다는 것이 구조로 보장된다.
 */

import { presetCharacterBySlug } from "../loadout/preset";
import type { CharacterLoadout } from "../loadout/types";
import { pickHeroSlugs } from "../shared/charManifest";

/**
 * 상대 팀 슬러그를 뽑을 때 매치 시드에 더하는 값.
 *
 * 0이면 내 팀과 같은 해시를 쓰게 되고, 제외 목록이 있어도 **뽑는 순서**가
 * 같아져서 조합이 시드마다 함께 움직인다. 상수로 뽑아 둔 이유는 두 호출자가
 * 같은 값을 써야 VS와 전장이 같은 상대를 세우기 때문이다.
 */
export const THEIR_SEED_OFFSET = 1;

/**
 * 상대 팀 캐릭터. 내 팀과 **겹치지 않게** 시드에서 뽑는다.
 *
 * 두 필드가 같은 스프라이트를 쓰면 좌우 반전만 다른 거울 그림이 되어, 위아래를
 * 훑는 순간 어느 쪽이 내 팀인지 판단이 한 박자 늦는다. 팀 색(§HUD)만으로는
 * 실루엣이 같아서 부족했다.
 *
 * **슬러그만 갈아 끼우지 않는다** — 그 캐릭터의 동작까지 가져온다. 예전에는
 * `{...c, charSlug}`였고, 그러면 실비아 스프라이트가 리제의 접근 곡선(190ms
 * 달리기)과 클립으로 움직여서 넷을 갈라 둔 것이 아래 필드에서 지워졌다.
 * 프리셋에 없는 슬러그면 원래 캐릭터를 그대로 쓴다(슬러그 목록이 프리셋보다
 * 넓어질 때 얼어붙지 않게).
 *
 * @param seed 매치 시드. 같은 매치를 재생하면 같은 상대가 나온다
 * @param mine 내 팀 캐릭터. `memberId`와 인원수를 여기서 물려받는다
 */
export function theirRoster(
  seed: number,
  mine: readonly CharacterLoadout[],
): CharacterLoadout[] {
  const slugs = pickHeroSlugs(
    seed + THEIR_SEED_OFFSET,
    mine.length,
    mine.map((c) => c.charSlug),
  );
  return mine.map((c, i) => {
    const slug = slugs[i];
    const preset = slug ? presetCharacterBySlug(slug, c.memberId) : null;
    return preset ?? { ...c, charSlug: slug ?? c.charSlug };
  });
}
