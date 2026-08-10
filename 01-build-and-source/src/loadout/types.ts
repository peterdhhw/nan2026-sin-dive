import type { SkillDef } from "../core/types";
import type { HeroSlug } from "../shared/charManifest";
import type { MeleeStyle } from "../shared/meleeRules";

export interface CharStats {
  /** 자동 공격 1회 딜 */
  attack: number;
  /** 자동 공격 간격(ms) */
  attackIntervalMs: number;
}

export interface CharacterLoadout {
  memberId: string;
  displayName: string;
  role: "attacker" | "guardian";
  /**
   * 이 캐릭터가 쓸 스프라이트 (`charManifest`의 HERO_SLUGS 중 하나).
   *
   * 예전에는 리그 하나에 무기 스킨만 바꿨다(`weapon/sword` …). 리그가 하나면
   * 팀이 둘이어도 같은 사람이 색만 다르게 서 있는 그림이라, 캐릭터별로
   * 다른 에셋을 쓰도록 바꿨다.
   */
  charSlug: HeroSlug;
  /** Pixi tint (0xRRGGBB). HUD 카드·게이지 색으로 캐릭터를 구분한다 */
  tintHex: number;
  level: number;
  stats: CharStats;
  /**
   * 근접 돌진 방식 — 접근 동작·속도·사거리·공격 클립.
   *
   * 스프라이트만 다르면 넷이 "색이 다른 같은 사람"으로 보인다. 실제로 다르게
   * 읽히는 신호는 **움직임**이라 캐릭터별로 여기서 갈라 둔다.
   */
  melee: MeleeStyle;
}

export interface Loadout {
  characters: CharacterLoadout[];
  skills: SkillDef[];
}

export interface LoadoutProvider {
  load(teamSize: number): Loadout;
}
