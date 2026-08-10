export interface FxSheet {
  key: string;
  /** public/ 기준 상대 경로 — Vite base와 무관하게 동작한다 */
  url: string;
  frameW: number;
  frameH: number;
  frames: number;
  fps: number;
}

/** tools/gen_effects.py 의 SPECS와 반드시 일치해야 한다 (테스트로 강제). */
export const FX_SHEETS: Record<
  "missile" | "impact" | "aura" | "slash" | "spark" | "dust",
  FxSheet
> = {
  missile: {
    key: "missile",
    url: "assets/fx/missile.png",
    frameW: 64,
    frameH: 64,
    frames: 8,
    fps: 24,
  },
  impact: {
    key: "impact",
    url: "assets/fx/impact.png",
    frameW: 96,
    frameH: 96,
    frames: 6,
    fps: 20,
  },
  aura: {
    key: "aura",
    url: "assets/fx/aura.png",
    frameW: 80,
    frameH: 80,
    frames: 8,
    fps: 12,
  },
  /**
   * 근접 전용 3종. 임팩트 하나로 넷을 다 처리하면 무기가 검이든 둔기든 같은
   * 별이 터져서 "색만 다른 같은 사람"으로 돌아간다 — `meleeFx`가 갈라 준다.
   */
  slash: {
    key: "slash",
    url: "assets/fx/slash.png",
    frameW: 96,
    frameH: 96,
    frames: 5,
    fps: 22,
  },
  spark: {
    key: "spark",
    url: "assets/fx/spark.png",
    frameW: 64,
    frameH: 64,
    frames: 5,
    fps: 24,
  },
  dust: {
    key: "dust",
    url: "assets/fx/dust.png",
    frameW: 64,
    frameH: 64,
    frames: 6,
    fps: 16,
  },
};

export interface BgRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 표시 높이 ÷ 필드 높이. `scenery_*` 아틀라스만 갖는다 (`gen_bg_art.py`의
   * `h_ratio`). **TS에 복사해 두지 않는 이유**: 이 값이 그림의 밀도를 정하므로
   * 그림과 같은 파일에 있어야 한다. 두 벌이면 생성기에서 고쳐도 화면은 그대로고
   * 아무 테스트도 안 깨진다.
   */
  ratio?: number;
}

export interface BgAtlas {
  url: string;
  w: number;
  h: number;
  regions: Record<string, BgRegion>;
}

/**
 * 배경 아틀라스 경로. region 좌표는 `public/assets/bg/bg.json`에서 **런타임에**
 * 읽는다 — 여기에 복사해 두면 `tools/gen_bg.py`를 다시 돌릴 때마다 두 벌을
 * 손으로 맞춰야 하고, 어긋나면 배경이 엉뚱한 조각으로 그려진다.
 * (fx 시트는 region이 균등 격자라 숫자 4개로 끝나므로 TS에 두는 게 맞다.)
 */
export const BG_MANIFEST_URL = "assets/bg/bg.json";

/**
 * `bg.json`의 최상위 키. 생성기 두 개의 출력을 합친 것과 일치해야 한다
 * (테스트로 강제).
 *
 * - `props` — `gen_bg.py` (CC0 팩 실루엣 + 자작 도형). 지면 장식·천체
 * - `scenery_*` — `gen_bg_art.py` (SD3.5). 테마별 삽화 3겹
 *
 * `silhouette`이 있었다: 단색 실루엣 10종을 런타임 tint로 물들여 두 테마에
 * 돌려 쓰던 아틀라스다. 삽화로 갈면서 지웠다 — 나무 5그루를 흩뿌린 그림이
 * 배경이 허접했던 원인이었고, 테마 차이가 tint 뿐이었다.
 */
export const BG_ATLASES = ["props", "scenery_surface", "scenery_abyss"] as const;
export type BgAtlasName = (typeof BG_ATLASES)[number];

/**
 * 스킬 아이콘 아틀라스. `tools/gen_icons.py`가 만든다.
 *
 * 배경과 같은 이유로 region 좌표는 런타임에 읽는다. 아이콘은 6개뿐이라
 * TS에 둘 수도 있지만, 그러면 `gen_icons.py`를 손볼 때마다 두 벌을 맞춰야 한다.
 */
export const ICON_MANIFEST_URL = "assets/icons/icons.json";
export const ICON_ATLAS = "skills";

/**
 * 아이콘 region 목록 — `gen_icons.py`의 `ICONS` 키와 같아야 한다(테스트로 강제).
 *
 * 4개 → 6개 → 7개로 늘려 왔고 이유는 매번 같다: **한 화면에 같이 있는 칸이
 * 아이콘을 공유하면** 그 칸들이 같은 그림이 되어 라벨을 읽어야 무엇인지 알게
 * 되고, 그건 아이콘의 존재 이유와 반대다. 갈라 주는 규칙은
 * `skillSlotRules.iconRegionFor`다.
 *
 * `skill_ult`가 7번째다 — 공격 칸이 셋에서 넷이 되면서 붙었다
 * (`presetSkillsFor`의 결정 기록).
 *
 * **`skill_buff`는 지금 프리셋이 쓰지 않는다.** 그래도 남긴다. 이 판단은 이미
 * 한 번 값을 했다: 앞서 "프리셋이 쓰지 않지만 남긴다"고 적어 둔 덕분에 버프
 * 칸을 되돌릴 때 아이콘 작업이 0이었고, 그 뒤 다시 지웠다. `iconRegionFor`가
 * `kind === "buff"`를 여기로 보내므로 지우면 버프를 하나 되돌리는 순간 아틀라스에
 * 없는 region을 찾아 빈 칸이 된다.
 */
export const SKILL_ICON_REGIONS = [
  "skill_attack",
  "skill_combo",
  "skill_burst",
  "skill_ult",
  "skill_interference",
  "skill_blind",
  "skill_buff",
] as const;
export type SkillIconRegion = (typeof SKILL_ICON_REGIONS)[number];

/**
 * 캐릭터 에셋은 여기 없다 — `charManifest.ts`의 `CHAR_MANIFEST_URL`이다.
 *
 * Spine 리그(hero/alien)를 CC0 픽셀아트 스프라이트시트 22종으로 교체했다:
 * 리그가 한 벌뿐이라 999층을 내려가도 같은 적만 나왔고, 3/4 뷰라 횡스크롤
 * 전투의 옆모습 조건에도 안 맞았다 (asset-research/sidescroll/DECISION.md).
 */
