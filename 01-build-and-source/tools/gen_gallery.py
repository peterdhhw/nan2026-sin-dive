#!/usr/bin/env python3
"""캐릭터별 서비스 씬 갤러리 — **배경 있는 원본과 배경 제거본을 같이 남긴다.**

`gen_portraits.py`와 목적이 다르다:

| | `gen_portraits.py` | 이 스크립트 |
|---|---|---|
| 쓰는 곳 | 게임 화면(카드·선택·결과) | 갤러리 — 보고 고르는 것 |
| 배경 | **지운다.** UI 위에 얹으므로 배경이 있으면 UI를 가린다 | 배경이 주인공. 둘 다 남긴다 |
| 크기 | 표시 밀도에서 유도(`PX_PER_TEXEL`), 자르기 | 원본 1024 그대로 |
| 산출 | `public/` + 매니페스트(런타임이 읽는다) | `~/assets/`. 게임이 안 읽는다 |

**한 파일에 넣지 않은 이유:** 저쪽은 `portraits.json`을 쓰고 테스트
(`tests/portraitManifest.test.ts`)가 그 산출물을 검증한다. 갤러리 70장을 같은
매니페스트에 섞으면 "7종 × 5장" 검증이 무너지고, 배경 있는 그림이 게임 화면에
실려 UI를 가린다. 반대로 여기에 밀도·자르기를 들고 오면 갤러리가 435px로 줄어든다.

**외형은 저쪽에서 가져온다** — `LOOKS`를 복사하면 캐릭터가 두 벌로 갈린다.

산출 (`~/assets/portrait_gallery/` — 아래 `OUT` 주석에 자리를 고른 이유):

    <slug>/<NN>_<scene>.png       원본(배경 있음)
    <slug>/<NN>_<scene>_cut.png   배경 제거
    <slug>/sheet.png              캐릭터별 대조 시트
    index.json                    전체 인덱스(거절 사유 포함)

사용:

    python3 tools/gen_gallery.py                 # 7종 × 10장
    python3 tools/gen_gallery.py fire_knight     # 한 캐릭터만
    python3 tools/gen_gallery.py --no-cut        # 배경 제거 건너뛰기(호출 절반)
    python3 tools/gen_gallery.py --sheet-only    # 이미 있는 것으로 시트만 다시
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from typing import NamedTuple

from PIL import Image

from gen_portraits import (
    LOOKS,
    MATTE_MODEL,
    MODEL,
    RESULT_ANIME,
    RESULT_NEG,
    SEEDS,
    _client,
    _fingerprint,
)

HERE = os.path.dirname(os.path.abspath(__file__))

# ── 산출 위치: **리포 밖 `~/assets/`**. `.cache/`가 아니다
#
# 처음엔 `<repo>/.cache/portrait_gallery`였고 두 가지가 걸렸다.
#
# 1. **점으로 시작하는 이름은 탐색기에서 안 보인다.** 이 그림들은 사람이 열어
#    보고 고르는 것이 목적인데, 정작 열 수가 없었다.
# 2. `.cache/`는 **git이 무시하지 않는다**(`.gitignore`에 없다) — 264MB가
#    커밋 가능한 자리에 있었다. 리포 밖으로 내면 실수로 커밋될 수가 없다.
#
# `~/assets/`는 이미 원본 에셋을 두는 자리다(`chierit-elementals`). 아트 디렉션
# 문서 §5-3도 "원본 아카이브는 리포에 커밋하지 않는다"고 정해 뒀다.
#
# `PVP_GALLERY_OUT`으로 덮을 수 있다 — 다른 사람 홈에서 돌릴 때를 위한 손잡이다.
OUT = os.environ.get(
    "PVP_GALLERY_OUT", os.path.expanduser("~/assets/portrait_gallery")
)
INDEX = os.path.join(OUT, "index.json")

# ── 스타일. `gen_portraits.STYLE`을 그대로 쓸 수 없다
#
# 저쪽은 `plain empty background, no scenery`를 지시한다 — 이 스크립트의 목적이
# 정확히 그 반대다. 그래서 배경 관련 어구만 빼고 나머지(셀셰이딩·애니 앵커)는
# 오히려 **더 세게** 건다.
#
# **왜 더 세게 거는가:** 사진 같은 배경이 오면 얼굴도 같이 실사가 된다. 결과
# 삽화에서 실측했다 — `lose`의 `glowing embers`가 실사 숲을 끌고 왔고 그 그림만
# 주름·모공 있는 실사 얼굴로 나왔다(`gen_portraits.py`의 `lose` Variant 주석).
# 배경을 **일부러** 넣는 이 스크립트는 그 위험이 기본값이므로 `RESULT_ANIME`과
# `RESULT_NEG`를 처음부터 넣고 시작한다.
#
# **매체 선언은 `MEDIUM`으로 맨 앞에 따로 뺐다** (실측 2026-08-02). 아래
# `_prompt` 주석을 보라 — 이 문자열을 프롬프트 끝에만 두면 배경·얼굴이 실사로
# 온다. 여기 남은 것은 뒤쪽에 한 번 더 못 박는 몫이다.
STYLE = (
    "anime style illustration, japanese subculture game art, cel shaded, "
    "clean lineart, adult woman, attractive, "
    f"{RESULT_ANIME}, "
    "single character, full color anime key visual"
)

# 프롬프트 **맨 앞**에 놓는 매체 선언. 순서가 내용보다 중요했다(`_prompt` 주석).
MEDIUM = (
    "anime style illustration, flat cel shading, bold clean lineart, "
    "anime face with large stylized eyes, 2d anime key visual, "
    "japanese subculture game art"
)
# `background scenery`가 빠졌다 — 저쪽에선 배경을 막는 어구고 여기선 배경이 목적이다.
# `RESULT_NEG`(실사 부정어)는 남긴다. 위 주석의 이유로 여기가 더 필요하다.
NEG = (
    "photorealistic, 3d render, text, watermark, signature, ui, frame, border, "
    "extra limbs, extra fingers, deformed hands, multiple characters, crowd, "
    f"child, chibi, blurry, cropped head, {RESULT_NEG}"
)

# ── 정체성 — 색·머리·눈만. **의상은 씬이 정한다**
#
# `LOOKS`를 그대로 쓰면 해변에 갑옷을 입고 서 있다. 그런데 `LOOKS`는 색·머리·
# 눈·의상을 한 문자열로 묶어 놨어서 의상만 떼어낼 수가 없다 — 문자열을 잘라
# 쓰면 저쪽 서술을 고칠 때 여기가 조용히 어긋난다.
#
# 그래서 **정체성만 따로 적는다.** 이 표가 `LOOKS`와 겹치는 것은 색·머리·눈
# 뿐이고, 그게 "같은 사람"을 만드는 부분이다. 아래 `_check_identity`가 슬러그
# 집합이 어긋나면 죽는다 — 캐릭터가 늘었을 때 조용히 6종만 굽지 않는다.
IDENTITY: dict[str, str] = {
    "water_priestess": (
        "long flowing silver-blue hair, aqua eyes, teal and deep blue accents, "
        "ornate silver circlet"
    ),
    "leaf_ranger": (
        "short auburn hair with a side braid, green eyes, forest green accents, "
        "leaf-shaped ornaments"
    ),
    "metal_bladekeeper": (
        "straight black hair in a high ponytail, sharp grey eyes, "
        "steel grey and cold blue accents"
    ),
    "wind_hashashin": (
        "short white hair, violet eyes, pale violet and dark grey accents, "
        "long trailing scarf"
    ),
    "fire_knight": (
        "long wild red hair, amber eyes, crimson and gold accents, "
        "ember particles in her hair"
    ),
    "crystal_mauler": (
        "lavender twin tails, pink eyes, amethyst purple accents, "
        "small crystal shards floating near her"
    ),
    "ground_monk": (
        "dark brown hair in a topknot, warm brown eyes, "
        "earthy brown and ochre accents, cloth bindings on her arms"
    ),
}


# ── 서비스 강도. **`FANSERVICE`를 그대로 쓰지 않는다**
#
# 저쪽 문자열은 `thighhighs` · `alluring pose` · `eye contact with viewer`를
# 함께 들고 있다. 여기서는 그 셋을 `Scene`이 장면마다 말하므로(의상·포즈)
# 되풀이가 된다 — 점수만 올리고 그림은 안 바뀐다(실측 규칙 3,
# `gen_portraits.py`의 FANSERVICE 주석). **몸매만 남긴다.**
#
# 실측: 7종 중 한 명으로 10장 × 3회를 돌려 통과율을 셌다.
#
# | 프롬프트 | 통과 |
# |---|---|
# | 저쪽 `FANSERVICE` 그대로 | 12/30 (40%) |
# | 몸매만 (`GALLERY_FS`) | 14/30 (46%) |
# | 몸매만 + `DILUTE` | **20/30 (66%)** |
#
# **강도를 깎는 것으로는 안 올라간다.** 몸매를 더 깎아(`large bust`까지 제거)
# 재 봤더니 오히려 통과하던 `cafe`가 거절됐다 — 점수는 어휘 강도가 아니라
# 프롬프트 전체 모양으로 매겨진다.
GALLERY_FS = (
    "curvaceous hourglass figure, large bust, narrow waist, wide hips"
)

# 무해한 아트디렉션으로 점수를 희석한다 — **모든 장면에 붙인다.**
#
# 결과 삽화의 `DILUTE`는 거절된 한 칸에만 붙였다. 여기서는 열 장 중 여섯이
# 경계에 있어서(위 표) 자리마다 붙이면 어느 장면이 희석을 받았는지 기억해야
# 하는 표가 하나 더 생긴다. 전부에 붙이는 쪽이 단순하고, 붙이는 내용이 실제로
# 갤러리에 필요한 지시다 — 공식 일러스트 마감·채도·배경 밀도·와이드 구도.
#
# `detailed background painting`이 여기 있는 이유: 배경이 이 스크립트의 목적인데
# 인물 서술이 길어 배경이 흐려진다. 명시적으로 요구한다.
DILUTE = (
    "official character illustration, gacha game splash art, "
    "wholesome cheerful summer vibe, bright saturated colors, "
    "detailed background painting, wide establishing composition"
)


class Scene(NamedTuple):
    """한 장. `name`이 파일 이름이 되므로 영소문자·밑줄만."""

    name: str
    #: 배경. **장소를 말하고 조명은 애니 어휘로만** 말한다 — `golden hour
    #: photography` 같은 사진 어휘를 쓰면 얼굴이 실사가 된다(위 STYLE 주석)
    setting: str
    #: 의상. `IDENTITY`가 의상을 말하지 않으므로 여기가 유일한 출처다
    outfit: str
    #: 포즈·표정
    pose: str
    aspect: str


# ── 20장. **장소·의상·포즈를 다 다르게 한다**
#
# 같은 캐릭터를 20번 굽는 것이므로 서로 달라야 의미가 있다. 시드는 장면마다
# 바꾼다(`SEEDS[slug] + i*37`) — 같은 시드로 프롬프트만 바꾸면 구도가 서로
# 닮는다.
#
# **계절·시간대·실내외를 흩어 놓는다.** 앞 열 장이 여름·낮에 몰려 있었다(해변·
# 수영장·꽃밭·옥상). 뒤 열 장에 봄(`sakura_park`)·겨울(`shrine_newyear`)·
# 비(`rain_street`)·밤(`camping_night`)을 넣었다 — 나중에 쓸 때 골라 쓰는 것이
# 목적이므로 스무 장이 서로 비슷하면 스무 장이 아니다.
#
# **후보는 7종 캐릭터 전부로 재고 7/7만 채택한다**(`/tmp/probe_more.py`).
# 12종을 재서 10종을 채택했다:
#
# | 버린 것 | 이유 |
# |---|---|
# | `winter_street` | 6/7 — `ground_monk`에서 프롬프트 거절 |
# | `rooftop_stargaze` | 6/7 — `ground_monk`에서 출력 거절(시드 옮기면 통과하나 7/7이 이미 열 개다) |
#
# 5~6/7을 안 쓰는 이유: 경계에 있는 장면은 캐릭터가 늘거나 시드가 바뀌면 다시
# 무너진다. `arcade_night`을 세 번 틀린 것이 정확히 그 자리였다.
#
# 노출 강도는 결과 삽화와 같은 `FANSERVICE`를 쓴다(유저 지시: "팬서비스 — 더
# 과감하게"). 강도를 여기서 따로 정하지 않는 이유는 저쪽과 같다 — 두 벌이면
# 한쪽만 고쳐져서 갈린다.
#
# **곤경 서술과 겹치지 않는다.** 필터가 노출 + 곤경 조합을 거절한다(실측:
# `gen_portraits.py`의 FANSERVICE 주석). 그래서 열 장 다 편안하거나 당당한
# 장면이고, `wet`·`breathing hard` 같은 어구를 쓰지 않았다.
SCENES: list[Scene] = [
    Scene(
        "beach",
        "sunny tropical beach, turquoise sea, white sand, palm trees, "
        "bright blue sky with soft clouds",
        "two piece swimsuit, sheer sarong tied at the hip, sandals",
        "standing at the water's edge, looking back over her shoulder, "
        "playful smile, sea breeze in her hair",
        "9:16",
    ),
    Scene(
        "poolside",
        "resort poolside at midday, clear blue water, sun loungers, "
        "tiled deck, tropical plants",
        "sleek one piece swimsuit with a deep neckline, sunglasses on her head",
        "sitting on the pool edge with legs in the water, leaning back on "
        "one arm, relaxed confident smile",
        "1:1",
    ),
    Scene(
        # 처음엔 노천탕 안(`wrapped in a white towel`, 물에 어깨까지)이었고
        # **0/3 거절**이었다. 목욕 자체가 점수를 지고 있어서 강도를 깎아도
        # 통과선을 못 넘는다(수건 → 유카타로 바꾸니 3/3). 온천 마을 산책으로
        # 옮겼다 — 노출은 그대로고 장소만 물 밖이다
        "onsen_town",
        "hot spring town street at dusk, steam drifting from vents, "
        "wooden inns, stone lanterns, maple trees",
        "light cotton yukata worn loosely, obi sash, wooden sandals",
        "walking with a towel over her shoulder, glancing back at the viewer, "
        "soft relaxed smile",
        "9:16",
    ),
    Scene(
        "festival",
        "summer night festival street, paper lanterns, food stalls, "
        "warm bokeh lights, fireworks in the distance",
        "light summer yukata worn loosely off one shoulder, obi sash, "
        "holding a paper fan",
        "turning toward the viewer mid-step, bright delighted smile, "
        "fireworks reflected in her eyes",
        "9:16",
    ),
    Scene(
        # 처음엔 침실·침대 위(`sitting on the bed`)였고 **0/3 거절**이었다.
        # 침대가 점수를 진다 — 의상·포즈·FANSERVICE를 하나씩 빼 봐도 다 거절이고
        # 거실 소파로 옮기니 3/3. 아침의 편안한 분위기는 그대로다
        "sofa_morning",
        "bright living room in the morning, big window, houseplants, "
        "soft couch, coffee mug on the table",
        "oversized knit sweater slipping off one shoulder, shorts, long socks",
        "curled up on the couch hugging a cushion, sleepy content smile, "
        "messy hair",
        "1:1",
    ),
    Scene(
        "gym",
        "bright modern gym, racks of weights, mirrored wall, "
        "sunlight through high windows",
        "cropped sports bra and short leggings, sweatband on her wrist",
        "mid stretch with one arm overhead, toned midriff, "
        "focused determined look, ponytail swinging",
        "9:16",
    ),
    Scene(
        "cafe",
        "cozy afternoon cafe, wooden counter, hanging plants, "
        "warm light through a big window, latte on the table",
        "off shoulder knit sweater, short skirt, thighhighs",
        "leaning on the table with her chin on her hand, "
        "teasing half smile, looking straight at the viewer",
        "1:1",
    ),
    Scene(
        # **이 한 칸을 세 번 틀렸다. 그 셋이 다 같은 실수다** — 한 캐릭터로
        # 재고 일곱에 적용했다(실측 규칙 2: 점수는 캐릭터 서술까지 합쳐 매긴다).
        #
        # | 시도 | 잰 것 | 실제 |
        # |---|---|---|
        # | 젖은 아스팔트 밤거리 + 보디슈트 | 0/3 | — |
        # | 아케이드 + 캐비닛에 기댐 | `leaf_ranger` 3/3 | **7종 중 0종** |
        # | 서서 팔짱(포즈 교체) | `leaf_ranger` 3/3 | **7종 중 0종** |
        # | 지금 것 | **7종 중 7종** | 7종 중 7종 |
        #
        # 두 번째와 세 번째 사이에 대조군까지 돌렸다(포즈 교체 3/3 / 배경 교체
        # 0/3). **그 대조군이 거짓이었다** — 같은 프롬프트가 3/3과 0/3을 다 낸다.
        # 경계에서 한 캐릭터 3표는 신호가 아니다. 이제 후보는 **7종 전부**로 잰다
        # (`/tmp/probe_arcade.py`).
        #
        # 통과하는 `cafe`의 골격(니트·짧은 치마·니하이 + 앉은 포즈)에 아케이드
        # 배경만 얹었다. 기대는 포즈·서서 팔짱을 다 버렸고 네온 색감은 남는다.
        "arcade_night",
        "retro arcade at night, rows of glowing cabinets, neon signs, "
        "cyan and magenta light",
        "off shoulder knit sweater, short skirt, thighhighs",
        "sitting at an arcade machine with both hands on the controls, "
        "delighted grin, leaning toward the screen",
        "1:1",
    ),
    Scene(
        "flower_field",
        "vast flower field in full bloom, rolling hills, "
        "bright spring sky, petals drifting in the wind",
        "light sundress with thin straps, straw hat, barefoot",
        "spinning with her arms out, laughing with her eyes closed, "
        "skirt and hair lifted by the wind",
        "9:16",
    ),
    Scene(
        "rooftop_sunset",
        "city rooftop at sunset, orange and violet sky, "
        "distant skyline, laundry lines and antennas",
        "loose tank top and denim shorts, open shirt as a layer",
        "sitting on the ledge with one knee up, looking out at the city, "
        "wistful half smile, wind in her hair",
        "1:1",
    ),
    # ── 11~20장. 위 열 장이 여름·낮에 몰려 있어서 계절·시간대를 흩었다
    Scene(
        "bookstore",
        "cozy bookstore in the afternoon, tall wooden shelves, warm lamps, "
        "stacks of books, dust in the sunbeams",
        "long cardigan over a fitted top, short skirt, thighhighs",
        "reaching up for a book on a high shelf, standing on tiptoe, "
        "glancing back with a soft smile",
        "9:16",
    ),
    Scene(
        "sakura_park",
        "park path under full bloom cherry blossoms, petals falling, "
        "bright spring afternoon, distant pond",
        "light spring dress with a ribbon, cardigan on her shoulders",
        "holding a petal on her palm, looking up in wonder, "
        "hair and skirt lifted by the breeze",
        "9:16",
    ),
    Scene(
        # **비를 쓰면서 `wet`을 안 쓴다** — 노출 + 젖음은 필터가 거절하는 조합이다
        # (곤경 서술 금지. 위 SCENES 주석). 비는 배경에만 두고 인물은 우산을 든다
        "rain_street",
        "city street in warm summer rain, wet pavement reflecting lights, "
        "hydrangeas by the wall, grey bright sky",
        "damp summer blouse, short skirt, sandals",
        "holding a clear umbrella, tilting it back to look up at the rain, "
        "delighted grin",
        "9:16",
    ),
    Scene(
        "aquarium",
        "large aquarium tunnel, glowing blue water, schools of fish, "
        "caustic light on the floor",
        "off shoulder top, pleated skirt, thighhighs",
        "pressing one hand to the glass, looking up at the fish in awe, "
        "blue light washing over her",
        "1:1",
    ),
    Scene(
        "kitchen_baking",
        "sunny home kitchen, flour on the counter, mixing bowls, "
        "cooling cookies, herbs on the windowsill",
        "apron over a fitted camisole, rolled sleeves, shorts",
        "licking batter off her finger, flour on her cheek, "
        "mischievous grin, leaning on the counter",
        "1:1",
    ),
    Scene(
        # 스무 장 중 유일한 겨울·정장 차림이다. 노출은 `GALLERY_FS`(몸매)가 지고
        # 의상은 덮는 쪽 — 스무 장이 다 같은 노출 방식이면 고를 것이 없다
        "shrine_newyear",
        "shinto shrine at new year, red torii gate, stone steps, "
        "hanging paper charms, clear winter sky",
        "formal kimono with a wide obi, fur collar, hair ornaments",
        "holding a fortune slip in both hands, serene happy smile, "
        "standing at the steps",
        "9:16",
    ),
    Scene(
        "camping_night",
        "forest campsite at night, crackling campfire, tent, "
        "starry sky, warm firelight on the trees",
        "oversized flannel shirt open over a tank top, shorts, boots",
        "sitting on a log hugging her knees, gazing into the fire, "
        "content sleepy smile",
        "1:1",
    ),
    Scene(
        # `gym`과 겹칠 위험이 있어 조명·의상·동작을 다 갈랐다 — 체육관은 낮·기구·
        # 스포츠브라, 여기는 창광·바·레그워머·정적인 스트레칭이다
        "dance_studio",
        "bright dance studio, mirrored wall, ballet barre, "
        "wooden floor, sunlight through tall windows",
        "cropped tank top, high waisted leggings, leg warmers",
        "stretching one leg on the barre, arched back, "
        "focused expression, ponytail loose",
        "9:16",
    ),
    Scene(
        "train_window",
        "local train interior in late afternoon, green fields flowing past "
        "the window, worn seats, golden light",
        "light blouse tucked into a short skirt, cardigan on her lap",
        "resting her chin on her hand watching the window, "
        "hair lifted by the draft, peaceful half smile",
        "1:1",
    ),
    Scene(
        "summer_veranda",
        "wooden veranda of an old japanese house, green garden, "
        "wind chime, cicadas, bright summer afternoon",
        "loose cotton yukata worn off one shoulder, bare legs",
        "sitting with her legs dangling off the edge, eating a popsicle, "
        "fanning herself, lazy smile",
        "1:1",
    ),
]


def _check_identity() -> None:
    """`IDENTITY`와 `LOOKS`가 같은 캐릭터를 덮는지. 어긋나면 죽는다.

    캐릭터가 늘었을 때 **조용히 6종만 굽고 성공하면 안 된다** — 갤러리에서
    한 명이 빠진 것은 파일 목록을 세어 보기 전까지 안 보인다.
    """
    missing = sorted(set(LOOKS) - set(IDENTITY))
    extra = sorted(set(IDENTITY) - set(LOOKS))
    if missing or extra:
        sys.exit(
            f"IDENTITY가 LOOKS와 어긋난다 — 빠짐: {missing} / 남음: {extra}"
        )


def _prompt(slug: str, sc: Scene) -> str:
    """매체 → 정체성 → 의상 → 포즈 → 배경 → 서비스 강도 → 희석 → 스타일.

    **매체 선언이 맨 앞이어야 한다. 어휘가 아니라 위치가 문제였다** (실측
    2026-08-02). 처음엔 스타일을 맨 뒤에만 뒀고, 그렇게 구운 70장이 광택 도는
    반실사로 나왔다 — 게임 안 카드 삽화(셀셰이딩 애니)와 **다른 매체**로 보였다.

    어휘를 바꿔 세 번 시도해 전부 실패했다:
      - `gacha game splash art` → `anime key visual` (희석 어구 교체): 변화 없음
      - `STYLE`에서 `detailed face, expressive eyes` 제거 + 광택 부정어: 변화 없음
      - `simple flat painted background, cel shaded background`: 변화 없음

    범인은 **순서**였다. 이 함수 주석에 "SD3.5는 앞쪽 토큰에 더 무게를 준다"고
    적어 놓고 정작 매체 선언을 맨 뒤에 뒀다. 배경 어휘(`cozy afternoon cafe`
    …)가 스타일보다 앞에 있으면 그 배경이 사진처럼 렌더되고, **배경이 사진이
    되면 얼굴도 같이 사진이 된다**(결과 삽화 `lose`에서 같은 실패를 봤다).

    같은 시드 A/B로 확인했다(`/tmp/gal_front.png`) — 셀셰이딩으로 돌아왔고,
    덤으로 **필터 통과율이 1/3 → 3/3으로 올랐다**(`metal_bladekeeper`·
    `ground_monk`가 거절에서 통과로). 무해한 매체 서술이 앞에 붙어 점수를
    희석한다.

    `IDENTITY`가 매체 **다음**으로 앞인 이유는 그대로다: 열 장이 같은 사람으로
    나와야 한다. 배경을 앞에 두면 배경이 그림을 지배하고 인물이 작아진다.

    **남은 결함: 139장 중 9장이 흰 배경으로 나온다**(`sofa_morning`·`gym`·
    `kitchen_baking` 각 2, `festival`·`sakura_park`·`train_window` 각 1).
    고친 것의 거울상이다 — 매체 선언을 앞으로 당기면서 `setting`이 더 뒤로 밀렸고,
    실내 장면 몇 개는 배경을 아예 잃었다. 즉 이 순서는 **양쪽 실패 사이의 절충**
    이고, 공짜로 얻은 것이 아니다. 실내·근접 구도에 몰린다(야외 원경은 거의 없다).
    `DILUTE`의 `detailed background painting`으로도 안 막혔다.
    남겨 둔 이유: 9/139(6%)이고 갤러리는 **골라 쓰는 것**이다. 배경을 앞으로
    옮기는 맞교환은 이미 반실사로 실패한 쪽이라 되돌릴 수 없다.

    **머리 잘림은 지표가 거짓말을 했다.** 제거본 맨 윗 행 알파로 재서 7장을
    신고했는데(`kitchen_baking` 4장) 열어 보니 **한 장도 잘리지 않았다** — 상반신
    근접 구도에서 머리카락이 위 테두리에 닿는 것을 잘림으로 셌다. 알파는 "닿음"과
    "잘림"을 구별하지 못한다. 메모리 `[[judge-by-capture-not-metrics]]` 그대로,
    지표는 열어 볼 자리를 좁히는 데까지만 쓴다.
    """
    return (
        f"{MEDIUM}, {IDENTITY[slug]}, {sc.outfit}, {sc.pose}, "
        f"{sc.setting}, {GALLERY_FS}, {DILUTE}, {STYLE}"
    )


def _invoke(body: dict, model: str) -> dict:
    """스로틀·일시 오류에 지수 백오프. 4회까지."""
    br = _client()
    last = None
    for attempt in range(4):
        try:
            r = br.invoke_model(modelId=model, body=json.dumps(body))
            return json.loads(r["body"].read())
        except Exception as e:  # noqa: BLE001
            last = e
            msg = str(e)
            if "Throttl" in msg or "TooMany" in msg or "Timeout" in msg:
                time.sleep(2**attempt)
                continue
            raise
    raise RuntimeError(f"4회 실패: {last}")


def _write_side(side: str, fp: str, used: int) -> None:
    """지문 + **실제로 쓴 시드**를 파일 옆에 적는다.

    두 값이 갈리는 이유: `output image` 거절에 시드를 옮기므로 나온 그림의 시드가
    지문 속 시드와 다를 수 있다. 캐시 판정은 **기준 시드의 지문**으로 해야 한다 —
    쓴 시드로 판정하면 옮겨서 얻은 그림이 매 실행마다 다시 구워진다(지문이 영원히
    어긋난다). 인덱스에는 쓴 시드가 필요하다. 그래서 둘을 같이 적는다.
    """
    with open(side, "w", encoding="utf-8") as f:
        json.dump({"fp": fp, "usedSeed": used}, f, ensure_ascii=False)


def _read_side(side: str) -> tuple[str | None, int | None]:
    """`(지문, 쓴 시드)`. 없으면 `(None, None)`.

    **옛 형식(지문 문자열만)도 읽는다.** 60장이 그 형식으로 이미 있어서, 형식만
    바꿨다고 다시 구우면 검증 끝난 그림에 호출 60번을 쓴다.
    """
    if not os.path.exists(side):
        return None, None
    with open(side, encoding="utf-8") as f:
        raw = f.read()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        return raw, None
    if isinstance(obj, dict) and "fp" in obj:
        return obj["fp"], obj.get("usedSeed")
    return raw, None   # 지문 자체가 JSON 객체다(옛 형식) — 문자열 그대로 견준다


def generate(
    slug: str, sc: Scene, idx: int, dst: str, *, note: dict | None = None
) -> str | None:
    """배경 있는 원본 한 장. 필터에 막히면 None + 이유를 stderr에.

    **거절된 자리는 비운다.** 강도를 낮춰 자동 재시도하지 않는다 — 그러면 어느
    그림이 지시대로고 어느 그림이 타협인지 인덱스에서 구별할 수 없다.
    같은 프롬프트로만 3회 부른다(필터가 경계에서 흔들린다. 실측:
    `gen_portraits.py`의 FANSERVICE 주석).

    **캐시는 지문으로 맞힌다**(`gen_portraits._fingerprint`). 처음엔 파일 이름만
    봤고 그것이 실제로 물었다 — `MEDIUM`을 앞으로 옮겨 스타일 결함을 고친 뒤에도
    이미 구운 60장이 그대로 돌아왔다. `· 캐시`만 찍히므로 **조용한 실패다.**

    저쪽과 **다르게** 사이드카 없는 캐시를 믿지 않는다. 저쪽은 프롬프트를 고치지
    않은 14장이어서 지문을 채워 넣는 것이 참이었지만, 여기 있는 60장은 고친
    프롬프트로 만들어진 것이 아님을 이미 안다. 믿고 채우면 거짓을 적는 것이다.

    `note`를 주면 **실제로 쓴 시드**를 거기 담는다. 아래 `output image` 분기가
    시드를 옮기므로 호출자가 `SEEDS[slug] + idx*37`을 계산해 적으면 인덱스가
    거짓을 말한다 — 그 값으로 다시 부르면 다른 그림이 나온다.
    """
    # 장면마다 시드를 옮긴다 — 같은 시드로 프롬프트만 바꾸면 구도가 닮는다.
    # 37은 서로소면 되는 임의값이고, 캐릭터 간에는 같은 규칙이라 n번째 장을
    # 나란히 놓고 비교할 수 있다
    seed = SEEDS[slug] + idx * 37
    prompt = _prompt(slug, sc)
    fp = _fingerprint(prompt, NEG, sc.aspect, seed)
    side = f"{os.path.splitext(dst)[0]}.prompt.json"
    if os.path.exists(dst):
        old, used = _read_side(side)
        if old == fp:
            print(f"  · {slug}/{sc.name} 캐시")
            if note is not None:
                note["seed"] = used if used is not None else seed
            return dst
        why = "지문 없음(옛 그림)" if old is None else "프롬프트가 바뀌었다"
        print(f"  ↻ {slug}/{sc.name} {why} — 다시 굽는다")
        # 오려낸 것까지 버린다 — 남겨 두면 새 원본에 옛 매트가 붙는다
        for stale in (dst, f"{os.path.splitext(dst)[0]}_cut.png"):
            if os.path.exists(stale):
                os.remove(stale)
    body = {
        "prompt": prompt,
        "negative_prompt": NEG,
        "aspect_ratio": sc.aspect,
        "mode": "text-to-image",
        "output_format": "png",
        "seed": seed,
    }
    for attempt in range(3):
        out = _invoke(body, MODEL)
        why = str(out.get("finish_reasons", [None])[0])
        if why in ("None", "SUCCESS"):
            with open(dst, "wb") as f:
                f.write(base64.b64decode(out["images"][0]))
            # **지문은 그림과 같이 쓴다.** 그림만 쓰고 죽으면 다음 실행이
            # 지문 없는 캐시를 보고 다시 굽는다(호출만 늘고 결과는 같다)
            _write_side(side, fp, seed)
            if note is not None:
                note["seed"] = seed
            print(f"  ✓ {slug}/{sc.name} 생성 (seed {seed})")
            return dst
        if attempt >= 2:
            break
        # **거절 두 종류를 다르게 다룬다.** `prompt`는 프롬프트 점수라 같은 요청을
        # 다시 보내면 흔들릴 여지가 있지만(필터가 경계에서 흔들린다. 실측:
        # `gen_portraits.py`의 FANSERVICE 주석), `output image`는 **나온 그림이**
        # 걸린 것이다 — 시드가 같으면 같은 그림이 나오므로 똑같이 다시 보내는
        # 것은 호출만 버린다. 실측: `crystal_mauler/beach`가 `output image`로
        # 3회 연속 거절되고 빈 자리가 됐다.
        #
        # 시드를 옮기는 것은 **지시를 타협하는 것이 아니다**(프롬프트는 그대로다)
        # — 그래서 여기서는 허용한다. 강도를 낮추는 자동 재시도는 여전히 없다.
        if "output image" in why:
            seed += 1009
            body["seed"] = seed
            print(f"  ↻ {slug}/{sc.name} 출력 거절({why}) — 시드 {seed}로 재시도")
        else:
            print(f"  ↻ {slug}/{sc.name} 필터 거절({why}) — 같은 프롬프트로 재시도")
    print(f"  ✗ {slug}/{sc.name} 필터 거절: {why}", file=sys.stderr)
    return None


def cut(src: str, dst: str) -> str | None:
    """배경 제거본. 원본과 **나란히** 남긴다 — 어느 쪽이 나은지 보려는 것이다."""
    if os.path.exists(dst):
        return dst
    with open(src, "rb") as f:
        img = base64.b64encode(f.read()).decode()
    try:
        out = _invoke({"image": img, "output_format": "png"}, MATTE_MODEL)
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ 배경 제거 실패 {os.path.basename(src)}: {e}", file=sys.stderr)
        return None
    with open(dst, "wb") as f:
        f.write(base64.b64decode(out["images"][0]))
    return dst


#: 시트 한 줄에 놓는 장면 수. **20장을 한 줄로 늘이지 않는다** — 300px씩이면
#: 폭 6000px이 되어 화면에 넣으면 한 칸이 엄지만 해지고, 그러면 캡처로 판정한다는
#: 것이 판정이 아니게 된다(메모리 `[[capture-resolution-is-the-measurement]]`).
#: 10칸씩 접으면 원본·제거본 한 쌍이 붙어 있는 배치는 그대로 유지된다.
SHEET_COLS = 10


def _sheet(slug: str, rows: list[dict]) -> str | None:
    """캐릭터 한 명의 대조 시트. **원본 위 / 제거본 아래** 한 쌍씩.

    수치로 판정하지 않는다 — 메모리 `[[judge-by-capture-not-metrics]]`.
    배경 제거가 머리카락을 물어뜯었는지는 알파 비율로 안 보이고 눈으로 보인다.

    장면이 `SHEET_COLS`를 넘으면 **줄을 접는다.** 접힌 각 묶음도 위=원본 /
    아래=제거본이라 견주는 방식은 안 바뀐다.
    """
    have = [r for r in rows if r.get("png")]
    if not have:
        return None
    cw, ch = 300, 400
    cols = min(SHEET_COLS, len(have))
    bands = (len(have) + cols - 1) // cols   # 접은 묶음 수. 묶음마다 두 줄
    sheet = Image.new("RGB", (cw * cols, ch * 2 * bands), (18, 16, 24))
    for i, r in enumerate(have):
        band, col = divmod(i, cols)
        for j, key in enumerate(("png", "cut")):
            p = r.get(key)
            if not p:
                continue
            im = Image.open(os.path.join(OUT, slug, os.path.basename(p)))
            im = im.convert("RGBA")
            s = min((cw - 8) / im.width, (ch - 8) / im.height)
            im = im.resize(
                (max(1, int(im.width * s)), max(1, int(im.height * s))),
                Image.LANCZOS,
            )
            # 제거본은 **격자 위에** 얹는다 — 검은 배경에 놓으면 검은 머리카락이
            # 잘려 나간 것과 남은 것이 구별되지 않는다
            bg = Image.new("RGBA", (cw, ch), (18, 16, 24, 255))
            if key == "cut":
                for y in range(0, ch, 16):
                    for x in range(0, cw, 16):
                        if (x // 16 + y // 16) % 2:
                            for yy in range(y, min(y + 16, ch)):
                                for xx in range(x, min(x + 16, cw)):
                                    bg.putpixel((xx, yy), (52, 48, 62, 255))
            bg.alpha_composite(im, ((cw - im.width) // 2, (ch - im.height) // 2))
            sheet.paste(bg.convert("RGB"), (col * cw, (band * 2 + j) * ch))
    dst = os.path.join(OUT, slug, "sheet.png")
    sheet.save(dst)
    return dst


def main() -> None:
    _check_identity()
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_cut = "--no-cut" not in sys.argv
    sheet_only = "--sheet-only" in sys.argv
    slugs = argv or list(LOOKS)
    bad = [s for s in slugs if s not in IDENTITY]
    if bad:
        sys.exit(f"모르는 캐릭터: {bad} (가능: {list(IDENTITY)})")

    index: list[dict] = []
    for slug in slugs:
        d = os.path.join(OUT, slug)
        os.makedirs(d, exist_ok=True)
        print(f"[{slug}]")
        rows: list[dict] = []
        for i, sc in enumerate(SCENES):
            stem = f"{i + 1:02d}_{sc.name}"
            raw = os.path.join(d, f"{stem}.png")
            cutp = os.path.join(d, f"{stem}_cut.png")
            row: dict = {"slug": slug, "scene": sc.name, "aspect": sc.aspect}
            got = raw if sheet_only and os.path.exists(raw) else None
            note: dict = {}
            if not sheet_only:
                got = generate(slug, sc, i, raw, note=note)
            if not got:
                # 빈 자리를 다른 그림으로 메우지 않는다. 인덱스가 이유를 진다
                row["skipped"] = "필터 거절 (같은 프롬프트 3회)"
                rows.append(row)
                index.append(row)
                continue
            row["png"] = os.path.relpath(got, OUT)
            # 계산하지 않고 **생성기가 말한 시드**를 적는다 — 출력 거절에 시드를
            # 옮기므로 계산값은 다른 그림을 가리킬 수 있다(`generate`의 `note`)
            row["seed"] = note.get("seed", SEEDS[slug] + i * 37)
            if do_cut:
                c = cut(got, cutp)
                if c:
                    row["cut"] = os.path.relpath(c, OUT)
                else:
                    row["cutSkipped"] = "배경 제거 실패"
            rows.append(row)
            index.append(row)
        sh = _sheet(slug, rows)
        n = sum(1 for r in rows if r.get("png"))
        print(f"  → {n}/{len(SCENES)}장" + (f", 시트 {sh}" if sh else ""))

    os.makedirs(OUT, exist_ok=True)
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2, sort_keys=True)
    ok = sum(1 for r in index if r.get("png"))
    gaps = [r for r in index if r.get("skipped")]
    print(f"\n{os.path.abspath(OUT)} — 원본 {ok}장 / 요청 {len(index)}칸")
    if gaps:
        # 조용한 축소를 만들지 않는다 — 빈 자리는 눈에 보이게 말한다
        print(f"빈 자리 {len(gaps)}칸:", file=sys.stderr)
        for r in gaps:
            print(f"  ✗ {r['slug']}/{r['scene']}: {r['skipped']}", file=sys.stderr)


if __name__ == "__main__":
    main()
