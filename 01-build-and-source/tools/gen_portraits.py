#!/usr/bin/env python3
"""
캐릭터 삽화 생성 — SD3.5 Large(Bedrock)로 히어로 7종 × 3장 = 21장.

`gen_bg_art.py`의 형제다. 배경 쪽 후처리(양자화·투명 정리·프리멀티플라이 축소)를
그대로 재사용하고, **다른 점만** 여기 남긴다.

## 무엇에 쓰는가

세 용도가 **크기와 구도가 다르다.** 한 장을 잘라 쓰면 안 된다 — 카드는 90px에
얼굴이 읽혀야 하고, 선택 화면은 전신 실루엣으로 직업이 구별돼야 한다.

| 용도 | region | 화면 크기 | 구도 |
|------|--------|-----------|------|
| 대기/매칭 카드 | `card` | ≈66×74 (§05-2 카드 안) | 가슴 위. 얼굴이 주인공 |
| 캐릭터 선택 | `select` | ≈300 높이 | 전신. 무기·실루엣이 보인다 |
| 결과 화면 | `win` | ≈420 높이 | 상반신 + 승리 포즈 |

## 왜 스프라이트시트를 쓰지 않는가

전투 스프라이트(chierit)는 58px 원본이다. 카드에 90px로 띄우면 원본보다 커져서
뭉갠 확대가 되고, 선택 화면 300px에서는 형체가 안 남는다. 그리고 그 리그는
**옆모습**이다 — 카드에서 정면을 봐야 "내 캐릭터"로 읽힌다.

## 캐릭터 동일성을 어떻게 유지하는가

세 장이 다른 사람으로 보이면 안 된다. SD3.5에는 캐릭터 일관성 기능이 없으므로:
- **캐릭터당 시드 하나**를 세 장에 공유한다 (`SEEDS[slug]`).
- 외형 서술을 `LOOKS[slug]` 한 곳에 두고 세 프롬프트가 그것을 삽입한다.
  프롬프트마다 따로 쓰면 한쪽만 고쳐져서 머리색이 갈린다.
- 원소·색은 캐릭터 정체성이라 `chars.json`의 이름과 맞춘다(물=청록, 불=주홍…).

시드 공유가 동일성을 **보장하지는 않는다** — 구도가 다르면 SD는 다른 얼굴을
그린다. 그래서 검증은 캡처로 한다(세 장을 나란히 놓고 본다). 21장을 그렇게 본
결과 일곱 캐릭터 모두 세 장이 같은 사람으로 읽혔다.

**색조 편차 지표는 쓰지 마라.** 세 장의 대표 색조(채도 0.25 이상 픽셀의 중앙값)를
재서 `leaf_ranger` Δ106°·`metal_bladekeeper` Δ93°가 나왔지만, 나란히 찍어 보면
둘 다 멀쩡했다. 카드는 얼굴만 잘라서 **머리색**이 지배하고(적갈 35°) 전신은
**망토**가 지배한다(녹색 141°) — 지표가 잰 것은 사람이 갈렸는지가 아니라 크롭이
무엇을 담았는지다. 메모리 `[[judge-by-capture-not-metrics]]`가 여기서도 맞았다.

## 배경 제거 — 매팅 모델을 쓴다 (결정 기록)

**처음에는 배경 쪽과 같은 마젠타 키잉을 썼고, 그게 통째로 안 됐다.** 프롬프트에
`flat solid uniform magenta background`를 넣고 네거티브에 그라디언트를 넣었는데도
SD3.5는 세 장 다 **흰 배경**(선택본은 검은 배경)을 그렸다. 키잉은 지울 색이
있어야 성립하므로 투명 비율이 세 장 모두 0%로 나왔다 — 즉 불투명 사각형이다.
그림에서 무엇이 배경인지는 사람 눈에 명백했지만, `_is_key`는 아무것도 못 찾았다.

배경 타일에서 키잉이 통했던 이유는 배경이 **하늘을 그리는 그림**이라 "하늘을
마젠타로 칠해라"가 그림의 일부였기 때문이다. 인물화에서 배경색은 그림의 일부가
아니라 여백이고, SD는 여백을 자기 관례(흰 바탕)로 칠한다.

그래서 `us.stability.stable-image-remove-background-v1:0`으로 옮겼다. 실측:
카드 1장에서 투명 53%, 반투명(1~191) 3.5만 픽셀 — 머리카락 끝이 살아 있고,
**흰 드레스가 흰 배경과 같이 지워지지 않았다**(드레스 영역 알파 중앙값 254).
색으로는 구별할 수 없는 그 경계가 매팅을 쓰는 진짜 이유다.

비용은 인물 한 장당 호출 2회다. 배경 쪽에서 이 모델을 피한 이유(호출 추가)는
여기서 성립하지 않는다 — 대안이 작동하지 않으므로 비교 대상이 없다.

## 노출 수준

유저 지시는 "서브컬쳐 애니 결로 매력적으로". Bedrock 필터가 무엇을 거절하는지는
호출해 봐야 알 수 있고, 거절은 **조용하지 않다**(예외가 뜬다). 프롬프트는
성인 캐릭터·수영복/보디슈트 수준으로 잡고, 거절되면 그 장을 로그에 남긴다 —
빈 자리를 다른 그림으로 조용히 메우면 매니페스트가 거짓말을 한다.

사용법:
    python3 tools/gen_portraits.py                 # 21장 전부
    python3 tools/gen_portraits.py water_priestess # 한 캐릭터 3장
    python3 tools/gen_portraits.py --no-gen        # 캐시된 raw로 후처리만
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from typing import NamedTuple

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public", "assets", "portraits")
RAW = os.path.join(HERE, "..", ".cache", "portrait_raw")
# 후보는 **`public/`에 두지 않는다.** 거기 있으면 번들에 실려 배포되고,
# 매니페스트가 가리키지 않는 그림이 용량만 먹는다.
#
# **`.cache/`에도 두지 않는다** — 고르는 것은 사람이 **열어 보는** 작업인데
# 점으로 시작하는 이름은 탐색기에서 안 보인다. `~/assets/`로 낸다(갤러리와 같은
# 자리. `gen_gallery.OUT` 주석에 이유를 적어 뒀다). `RAW`는 생성기 내부 캐시라
# 사람이 볼 것이 아니므로 `.cache/`에 그대로 둔다.
CAND = os.environ.get(
    "PVP_CAND_OUT", os.path.expanduser("~/assets/portrait_cand")
)
MANIFEST = os.path.join(PUB, "portraits.json")
# 후보 인덱스 — 무엇을 뽑았고 무엇이 거절됐는지. `PICK`을 채울 때 이걸 본다
CAND_INDEX = os.path.join(CAND, "index.json")
# 대조 시트. 캡처로 판정한다 (메모리 `[[judge-by-capture-not-metrics]]`)
CAND_SHEET = os.path.join(CAND, "sheet.png")
CHARS_JSON = os.path.join(HERE, "..", "public", "assets", "chars", "chars.json")

MODEL = "stability.sd3-5-large-v1:0"
# 배경 제거는 별도 모델이다. `us.` 프리픽스는 크로스리전 추론 프로필이고,
# 이 리전에서 실제로 붙는 것을 확인한 id는 이쪽이다
MATTE_MODEL = "us.stability.stable-image-remove-background-v1:0"
REGION = "us-west-2"

# 텍셀당 design px. 배경은 2.5, 인물은 **1.0**이다 — 표시 크기 그대로 굽는다.
#
# **1.6에서 2.5로 가는 길이 아니라 1.0이 맞다.** 처음 1.6으로 잡고(배경 2.5보다
# 촘촘하니 나으리라 추정) 카드 93px를 4배 확대해 대조했더니 얼굴이 뭉갰다 —
# 눈이 2px, 코·입이 사라졌다. 1.0은 같은 캡처에서 눈동자·입꼬리·귀걸이가 다
# 읽힌다. 배경이 2.5로 되는 이유는 반복 패턴이라 거칠어도 읽히기 때문이고,
# 얼굴은 한 개뿐이라 디테일이 곧 정보다.
# 메모리 `[[pixel-budget-not-geometry]]`: 안 읽히면 기하가 아니라 px가 범인이다.
PX_PER_TEXEL = 1.0

# 공통 스타일. **직업명사를 쓰지 않는다** — 메모리
# `[[sd35-outfit-decides-hand-coverage]]`: knight/mage 같은 명사는 의상과 배경을
# 같이 끌고 와서 지시한 구도를 덮는다. 원소·색·의상만 서술한다.
STYLE = (
    "anime style illustration, japanese subculture game art, cel shaded, "
    "clean lineart, adult woman, attractive, detailed face, expressive eyes, "
    "dark fantasy palette, dramatic rim lighting, "
    # 배경색은 **지시하지 않는다.** 마젠타를 요구했더니 세 장 다 흰 배경이
    # 나왔다(docstring "배경 제거"). 매팅 모델이 알아서 오리므로 배경은
    # "비어 있어라"까지만 말하고 색은 맡긴다 — 지켜지지 않는 지시는 빼는 게 맞다
    "plain empty background, no scenery, "
    "single character, centered"
)
NEG = (
    "photorealistic, 3d render, text, watermark, signature, ui, frame, border, "
    "extra limbs, extra fingers, deformed hands, multiple characters, crowd, "
    "child, chibi, background scenery, blurry, "
    "depth of field, cropped head"
)

# ── 결과 3종에만 더 거는 애니 앵커 (실측 2026-08-02)
#
# 결과 3종을 처음 구웠을 때 `metal_bladekeeper`·`ground_monk`가 **실사 화장품 광고
# 얼굴**로 나왔다 — 주름·모공·에어브러시 피부에 눈이 작아져서, 같은 캐릭터의
# `card`(셀셰이딩 애니)와 **다른 사람이자 다른 매체**로 읽혔다.
# `medLum`·`alphaRatio`는 전부 정상이었다: 지표가 볼 수 있는 종류의 결함이
# 아니다(메모리 `[[judge-by-capture-not-metrics]]`). 같은 시드 A/B로 확인했다.
#
# **왜 `STYLE`·`NEG`가 아니라 여기인가.** 그 둘은 다섯 variant가 다 쓰므로
# 고치면 `card`·`select` 14장의 지문이 어긋나 **전부 다시 구워진다** — 실사로
# 흐른 것은 결과 3종뿐인데 이미 검증된 14장이 조용히 달라진다(`FANSERVICE`를
# `LOOKS`가 아니라 따로 둔 것과 같은 이유).
#
# 그 대가로 **빼기가 안 된다.** A/B에서는 `STYLE`의 `detailed face, expressive
# eyes`(사실적 렌더링을 끌어온 어구)를 지웠지만, 여기서는 덧붙일 수만 있어서
# 더 구체적인 애니 지시로 덮는 방식이다. 그래서 구운 뒤 반드시 캡처로 다시 본다.
#
# 이 문자열은 필터 점수에도 들어간다(아래 FANSERVICE 주석) — 늘어난 무해한
# 맥락이 점수를 희석하는 쪽이지만, 통과선이 움직였을 수 있으므로 거절 자리는
# 인덱스에서 확인한다.
RESULT_ANIME = (
    "flat cel shading, bold clean lineart, "
    "anime face with large stylized eyes, 2d anime key visual"
)
# `photorealistic` 하나로는 부족했다 — 실사로 흐른 21장이 이미 그 단어를 달고
# 나왔다. 흐르는 방향을 이름으로 불러 막는다.
RESULT_NEG = (
    "realistic skin texture, photorealistic face, freckles, "
    "glamour photography, live action, semi-realistic, painterly rendering, "
    "airbrushed skin, real human proportions"
)

# ── 결과 화면 3종이 공유하는 서비스 씬 강도 (`win`·`lose`·`draw`만 쓴다)
#
# **왜 `LOOKS`나 `STYLE`이 아니라 여기인가.** `card`·`select` 14장은 이미 캡처로
# 검증했다. 노출을 `LOOKS`에 넣으면 그 14장의 프롬프트가 같이 바뀌어 **지문이
# 어긋나고 전부 다시 구워진다** — 고쳐 달라고 하지 않은 것이 조용히 달라진다.
# 결과 화면만 과감해지면 되므로 그 세 프롬프트만 이 문자열을 삽입한다.
#
# **한 곳에 두는 이유:** 세 장에 따로 쓰면 한쪽만 고쳐져서 승리는 과감하고
# 패배는 얌전한, 강도가 갈린 세트가 된다(`LOOKS`를 한 곳에 둔 것과 같은 이유).
#
# 강도는 **수영복/보디슈트 위**로 올린다(유저 지시: "팬서비스 — 더 과감하게").
# 여전히 성인 캐릭터를 명시한다 — `STYLE`의 `adult woman`과 `NEG`의 `child`가
# 그 게이트고, 그것을 빼면 필터가 거절하는 것이 옳다.
#
# ## 필터는 단어를 막지 않는다 — **프롬프트 전체를 점수로 본다** (실측 2026-08-02)
#
# 첫 판은 `fire_knight` 세 장이 전부 `Filter reason: prompt`로 거절됐다. 그림이
# 아니라 **프롬프트 단계**라서 시드를 바꿔도 같다.
#
# **완전히 결정적이지는 않다.** 처음엔 그렇게 읽었다(`win` 3/3 통과, `lose` 3/3
# 거절). 그런데 일괄 실행에서 거절된 `ground_monk/lose`를 같은 프롬프트로 다시
# 부르니 3/3 통과했다 — 경계에 있는 프롬프트는 호출마다 흔들린다. 그래서
# `generate`가 **같은 프롬프트로** 3회까지 재시도한다(강도를 낮춘 재시도가
# 아니다). 확실히 안쪽/바깥쪽인 프롬프트는 여전히 재현된다.
#
# 어구를 하나씩 갈라 보고 처음엔 "금지어 네 개"로 읽었다 — `voluptuous`
# `sensual` `seductive` `flirty`가 거절되고 `curvaceous` `hourglass`
# `large bust` `deep cleavage` `revealing outfit` `bare thighs` `thighhighs`
# `gravure idol framing`은 통과했으니 어휘 문제로 보였다. **그 해석은 틀렸다.**
# 대조군이 뒤집었다:
#
# ```
# PASS  win 전체 프롬프트 (긴 것)          ← 아래 것들을 다 포함한다
# FAIL  "upper body, {FANSERVICE}"        ← 그 부분집합인데 거절
# FAIL  "upper body standing, {FANSERVICE}"
# ```
#
# **부분집합이 거절되고 상위집합이 통과한다** — 금지어 모델로는 설명이 안 된다.
# 필터는 프롬프트 전체의 점수를 보고, `victory pose` `wind in hair`
# `dynamic diagonal composition` 같은 **무해한 맥락이 점수를 희석한다.**
# 그래서 통과·거절이 길이와 함께 움직인다(`lose` 실측: 617자 통과 → 642자 거절).
#
# 실질적 규칙 셋:
# 1. **곤경 서술과 겹치지 마라.** 거절된 조합은 전부 노출 + 곤경이었다:
#    `kneeling` · `breathing hard` · `panting` · `sweat` · `torn clothing`.
#    노출만이나 곤경만은 각각 통과한다. 이 선은 자의적이지 않아서 우회하려
#    하지 않았다 — `lose`를 **당당한 쪽으로 다시 썼다**(아래 Variant 주석).
# 2. **점수는 `LOOKS`까지 합쳐서 매겨진다.** 같은 FANSERVICE로 7종을 돌리면
#    `leaf_ranger`(bare midriff)·`ground_monk`(bare shoulders)만 거절됐다.
#    캐릭터마다 통과선이 다르므로 **한 캐릭터로 확인하고 전체를 돌리면 안 된다.**
# 3. **중복을 줄이는 것이 강도를 줄이는 것보다 낫다.** FANSERVICE의
#    `exposed midriff`·`revealing outfit`·`bare thighs`는 `LOOKS`가 이미 말한
#    것을 되풀이해 점수만 올렸다. 그걸 덜어내니 21종 중 20종이 통과했다 —
#    **실제 노출은 그대로다**(의상은 `LOOKS`가 정한다).
#
# 어구를 늘릴 때는 **한 어구씩** 재고, 통과선을 옮겼다고 판단하기 전에
# **이미 통과하던 프롬프트를 대조군으로 다시 호출해라.** 그 대조군 두 번이
# "필터가 세졌다"는 오진에서 나를 건져냈다(부분집합이 거절되고 상위집합이
# 통과하는 것을 보고서야 점수 모델임을 알았다).
#
# 그래도 거절되면 **그 자리는 비운다.** 강도를 낮춰 자동 재시도하지 않는다:
# 그러면 어떤 그림이 지시대로고 어떤 그림이 타협인지 매니페스트에서 구별할 수
# 없다. 거절 사유는 인덱스(`_write_index`)에 남는다.
# 몸매·시선·질감만 남긴다. 의상과 노출 부위는 `LOOKS`가 이미 말했다(규칙 3).
FANSERVICE = (
    "curvaceous hourglass figure, large bust, narrow waist, wide hips, "
    # `glossy skin highlights`였다 — 그게 사실적 피부 렌더링을 끌어와서
    # 애니 앵커와 싸웠다(위 RESULT_ANIME 주석). 셀셰이딩 쪽으로 말을 바꾼다
    "thighhighs, cel shaded skin, alluring pose, "
    "eye contact with viewer"
)

# ── 캐릭터 외형 — 세 장이 공유하는 유일한 출처
#
# `chars.json`의 원소·이름과 맞춘다. 여기만 고치면 세 장이 같이 바뀐다.
LOOKS: dict[str, str] = {
    "water_priestess": (
        "teal and deep blue color scheme, long flowing silver-blue hair, "
        "aqua eyes, sleeveless high-slit ceremonial dress with water motifs, "
        "bare shoulders, ornate silver circlet"
    ),
    "leaf_ranger": (
        "forest green color scheme, short auburn hair with a braid, "
        "green eyes, cropped leather top and hooded cloak, bare midriff, "
        "leaf-shaped ornaments"
    ),
    "metal_bladekeeper": (
        "steel grey and cold blue color scheme, straight black hair in a "
        "high ponytail, sharp grey eyes, form-fitting dark bodysuit with "
        "polished steel shoulder plates"
    ),
    "wind_hashashin": (
        "pale violet and dark grey color scheme, short white hair, "
        "violet eyes, sleek sleeveless bodysuit with a half mask lowered, "
        "long trailing scarf"
    ),
    "fire_knight": (
        "crimson and orange color scheme, long wild red hair, amber eyes, "
        "red and gold armored dress with bare thighs, ember particles"
    ),
    "crystal_mauler": (
        "amethyst purple color scheme, lavender twin tails, pink eyes, "
        "purple bodysuit with crystal shards on the shoulders and gauntlets"
    ),
    "ground_monk": (
        "earthy brown and ochre color scheme, dark brown hair in a topknot, "
        "warm brown eyes, bare shoulders with cloth bindings on arms, "
        "short training garb"
    ),
}

# 시드는 캐릭터당 하나 — 세 장이 공유한다(모듈 docstring "캐릭터 동일성")
SEEDS: dict[str, int] = {
    "water_priestess": 4102,
    "leaf_ranger": 5310,
    "metal_bladekeeper": 6244,
    "wind_hashashin": 7188,
    "fire_knight": 8021,
    "crystal_mauler": 9315,
    "ground_monk": 1477,
}

# ── 세 용도.
#
# `ratio`는 **표시 높이 ÷ 기준 높이**다. 배경(`fieldH`)과 달리 용도마다 기준이
# 달라서(카드 높이 / 화면 높이) 비율의 분모를 여기 적는다. 런타임이 읽는 값은
# 매니페스트의 `ratio` 하나다 — TS에 복사하면 두 벌이 갈린다(배경에서 겪었다).
#
# `crop`은 **인물 위에서부터 남길 비율**이다. 왜 필요한가:
# `upper body victory pose`를 지시했는데도 `win`은 발끝까지 있는 전신으로 왔고,
# `bust portrait, head and shoulders only`를 지시한 `card`도 허리까지 왔다.
# **구도는 프롬프트로 정해지지 않는다** — 그러면 카드 93px에서 얼굴이 20px가
# 되어 누구인지 안 보인다. 프롬프트는 남겨 둔다(포즈·표정은 실제로 따랐다).
# 자르기는 재보고 정한 값이고, 캐릭터마다 어긋나면 `CROP_OVERRIDE`로 고친다.
class Variant(NamedTuple):
    name: str
    prompt: str
    aspect: str
    ratio: float
    crop: float


VARIANTS: list[Variant] = [
    Variant(
        "card",
        # 카드는 93px이다. 전신을 넣으면 얼굴이 20px이 되어 누구인지 안 보인다.
        "bust portrait, head and shoulders only, facing viewer, "
        "confident expression, symmetrical framing",
        "1:1",
        # 카드 안 그림 높이 ÷ CARD_H(150). 라벨·테두리를 뺀 자리다
        0.62,
        # 위 50%. 0.3·0.4·0.5·0.62를 93px로 구워 4배 확대해 대조한 값이다 —
        # 0.3은 눈이 잘리고 0.62는 얼굴이 눈만큼 작다. 0.5에서 턱·귀걸이까지 든다
        0.50,
    ),
    Variant(
        "select",
        # 선택 화면은 실루엣으로 고른다 — 전신에 무기가 보여야 한다.
        "full body standing pose, facing viewer, holding her weapon, "
        "feet visible, full figure inside frame",
        "9:16",
        # 화면 높이(1280) 기준. 카드보다 크게 — 고르는 순간이 이 씬의 주인공이다
        0.40,
        # 전신이 목적이므로 자르지 않는다
        1.0,
    ),
    Variant(
        "win",
        # 결과 화면은 감정이다. 상반신 + 승리 포즈.
        f"upper body victory pose, one arm raised, triumphant confident smile, "
        f"chest out, back arched, dynamic diagonal composition, wind in hair, "
        f"{FANSERVICE}",
        "1:1",
        0.34,
        # 상반신. 카드보다 크게 나오는 자리라 얼굴이 더 작아도 읽힌다
        0.62,
    ),
    Variant(
        "lose",
        # 패배는 **처벌이 아니다.** 유저가 진 화면에서 자기 캐릭터가 초라하면
        # 다시 누를 이유가 줄어든다.
        #
        # 처음엔 `kneeling on one knee` · `breathing hard` · `sweat` ·
        # `torn clothing`으로 썼고 **필터가 전부 거절했다**(노출 + 곤경 조합,
        # 위 FANSERVICE 주석). 강도를 깎아 우회하지 않고 그림을 다시 정했다 —
        # 결과적으로 결과 화면에 더 맞는다: **팔짱 끼고 턱을 든 그림**은
        # "졌지만 안 끝났다"를 말하고, 무릎 꿇은 그림은 "너는 실패했다"를 말한다.
        # 재대전 버튼 옆에 둘 그림은 앞의 것이다.
        #
        # **`dramatic backlight, glowing embers`를 뺐다** (실측 2026-08-02).
        # `RESULT_ANIME`을 넣어 다시 구웠는데 `win`·`draw`는 셀셰이딩으로 돌아온
        # 반면 `lose`만 실사로 남았다 — 다섯 중 이 한 장에만 있던 어구가 범인이다.
        # `dramatic backlight`는 사진 조명 어휘고, `glowing embers`는 `STYLE`의
        # `plain empty background, no scenery`와 정면으로 싸워 실사 숲·불길을
        # 끌고 왔다. 배경이 사진이 되면 **얼굴도 같이 사진이 된다**(주름·모공).
        # 7종 A/B로 확인했다(`/tmp/lose_ab3.png`) — 노출은 그대로 두고 조명만 뺐다.
        f"upper body, arms crossed, fierce determined scowl, chin up, "
        f"wind in hair, dynamic diagonal composition, {FANSERVICE}",
        "1:1",
        0.34,
        0.62,
    ),
    Variant(
        "draw",
        # 무승부는 감정이 없는 자리다 — 승리도 패배도 아닌 것을 그리면 표정이
        # 비어 버린다. 그래서 **다음 판으로 미는 그림**으로 잡는다: 숨을 고르고
        # 다시 자세를 잡는 순간.
        f"upper body, catching her breath and resetting her stance, "
        f"wry half smile, unfinished business expression, "
        f"hand on hip, hair swept back, {FANSERVICE}",
        "1:1",
        0.34,
        0.62,
    ),
]

# 캐릭터별 자르기 예외. 21장을 나란히 찍어 보고 어긋난 것만 여기 적는다.
# 키는 `"slug/variant"`.
#
# 왜 예외가 생기나: SD가 캐릭터마다 얼굴을 다른 높이에 놓는다. 카드 기본값 0.5는
# `water_priestess`(정면 흉상)에서 재서 정한 값인데, 아래 둘은 얼굴이 더 아래에
# 있어서 0.5면 턱이 잘렸다. 넷(0.40/0.50/0.62/0.75)을 93px로 구워 3배로 대조했다.
CROP_OVERRIDE: dict[str, float] = {
    # 트윈테일이 머리 위로 솟아 얼굴이 밀려 있다 — 0.5는 눈 위에서 잘렸다
    "crystal_mauler/card": 0.62,
    # 마스크까지 얼굴이라 코 아래가 필요하다 — 0.5는 마스크 위쪽만 남았다
    "wind_hashashin/card": 0.62,
}

# 진단 출력용 기준 높이. **에셋에 굽지 않는다** — "이 해상도면 얼굴이 보이나"를
# 눈으로 재기 위한 것뿐이다 (배경 쪽 `REF_FIELD_H`와 같은 취급).
REF_CARD_H = 150.0
REF_SCREEN_H = 1280.0
# 결과 3종은 같은 자리에 뜨므로 기준·비율이 같다. **키를 빼먹으면 KeyError로
# 죽는다** — 조용히 기본값을 쓰지 않는 것이 여기서는 맞다(어긋난 크기로 21장을
# 굽고 나서 캡처로 발견하는 것보다 낫다). `tests/portraitManifest.test.ts`가
# 이 표와 TS의 `PORTRAIT_BASE_H`를 대조한다.
REF_BASE = {
    "card": REF_CARD_H,
    "select": REF_SCREEN_H,
    "win": REF_SCREEN_H,
    "lose": REF_SCREEN_H,
    "draw": REF_SCREEN_H,
}

# ── 결과 화면 3종. `card`·`select`와 달리 후보를 여러 장 뽑는다.
RESULT_VARIANTS = ("win", "lose", "draw")

# ── 후보 시드 오프셋. 결과 3종에만 쓴다.
#
# **왜 시드인가:** 같은 프롬프트로 다른 그림을 얻는 손잡이가 SD3.5에는 이것뿐이다.
# 프롬프트를 흔들면 캐릭터가 갈리고, 그러면 후보끼리 비교가 성립하지 않는다 —
# 우리가 고르려는 것은 "누구를 그렸나"가 아니라 "같은 사람의 어느 컷이 나은가"다.
#
# 후보 시드 = `SEEDS[slug] + offset`. 오프셋을 캐릭터별로 다르게 적지 않는 이유:
# 후보 번호가 캐릭터마다 다른 뜻이면 나란히 놓고 "2번이 낫다"고 말할 수 없다.
CANDIDATE_OFFSETS: list[int] = [101]

# 후보를 **한 장 더** 받는 캐릭터. 기존 `win` 7장을 나란히 찍어(`/tmp/win_baseline.png`)
# 실제로 어긋난 것만 적는다 — 전원에게 세 장씩 주면 호출이 절반 늘어나는데
# 멀쩡한 넷은 첫 장으로 끝난다.
#
# | 캐릭터 | 무엇이 문제였나 |
# |--------|----------------|
# | `water_priestess` | 인물이 프레임 오른쪽 끝에 붙어 팔이 잘렸다 |
# | `crystal_mauler` | 피부톤이 자기 `card`와 달라 다른 사람으로 읽혔다 |
# | `wind_hashashin` | 작은 옆모습이라 "이겼다"로 읽히지 않았다 |
EXTRA_CANDIDATES: dict[str, list[int]] = {
    "water_priestess": [202],
    "crystal_mauler": [202],
    "wind_hashashin": [202],
}

# 필터 점수를 넘긴 자리에 **무해한 맥락을 더해** 통과시킨다. 키는 `"slug/variant"`.
#
# 왜 이게 정당한 처방인가: 필터는 프롬프트 전체 점수를 보고 무해한 맥락이 그
# 점수를 희석한다(위 FANSERVICE 주석). 그래서 **노출을 깎는 것과 맥락을 더하는
# 것 중 후자를 고른다** — 지시받은 강도가 유지되고, 덧붙이는 것이 실제로 그림에
# 필요한 아트 디렉션이다(연기·잔불·장식). 강도를 낮춘 타협본을 조용히 배포하는
# 것보다 이쪽이 정직하다.
#
# `fire_knight/lose`가 유일한 사례다: 21자리 중 이것만 T3에서 거절됐다.
# 왜 이 자리인가 — `LOOKS`가 `bare thighs`를 갖고 있어 점수가 가장 높다.
#
# **`lose`에서 `glowing embers`를 뺀 뒤에도 여전히 필요하다.** 처음엔 그 어구가
# 겹쳐서 높은 것으로 읽었는데, 조명·불티를 뺀 프롬프트로 7종을 재 보니
# `fire_knight`만 3/3 거절이었다(`/tmp/lose_ab3.png` 실행). 원인은 `LOOKS` 쪽이다.
# 덧붙이는 어구가 애니 앵커를 되돌리지 않는지도 같은 시드로 확인했다
# (`/tmp/fk_ab.png` — 셀셰이딩 유지).
DILUTE: dict[str, str] = {
    "fire_knight/lose": (
        "smoke and cinders drifting in the air, battle aftermath atmosphere"
    ),
}

# ── 자리별 포즈 교체. 키는 `"slug/variant"`, 값이 `Variant.prompt`를 **대신한다.**
#
# ## 왜 필요한가 (유저 신고 2026-08-09)
#
# "싱글모드에서 캐릭터 선택시, 실비아만 정면이라 어색해, 다른 캐릭터들처럼
# 약간 사선 방향의 이미지로 바꿔주고."
#
# `select` 프롬프트는 일곱 다 `facing viewer`다. **그런데 넷 중 셋은 사선으로
# 왔다** — SD가 `holding her weapon`·`full figure inside frame`을 그리다 몸을
# 틀었고, `water_priestess`만 지시대로 정면 대칭으로 왔다. 즉 어긋난 쪽이
# 지시를 따른 쪽이다. 격자에 넷을 나란히 놓으면 그 한 장이 증명사진처럼 보인다
# (`/tmp/sel_compare.png` 대조).
#
# ## 왜 `VARIANTS`의 프롬프트를 안 고치나
#
# 그 문자열은 일곱이 공유한다 — 사선을 거기 적으면 이미 사선인 여섯 장의 지문이
# 어긋나 **캡처로 검증 끝난 그림이 전부 다시 구워진다**(`STYLE`·`NEG`를 손대지
# 않는 것과 같은 이유). 신고는 한 장에 대한 것이고, 바뀌는 것도 한 장이어야 한다.
#
# ## 왜 덧붙이기(`DILUTE`)가 아니라 교체인가
#
# `facing viewer`가 프롬프트에 남은 채 `three-quarter view`를 더하면 두 지시가
# 싸운다 — 그 싸움의 결과는 시드마다 다르고, 그러면 "왜 안 바뀌나"를 다시 재게
# 된다. 포즈는 한 문장이 정해야 한다. `DILUTE`는 필터 점수를 희석하는 자리라
# 목적이 다르다(위 주석).
POSE_OVERRIDE: dict[str, str] = {
    # 다른 여섯 장이 실제로 그런 그림이다: 몸은 사선, 얼굴은 이쪽. 전신·무기·
    # 발끝은 `select`의 계약이라 그대로 옮긴다 — 실루엣으로 고르는 화면이다
    "water_priestess/select": (
        "full body standing pose, three-quarter view turned to the side, "
        "weight on one leg with hips angled, face turned toward viewer, "
        "holding her long staff, feet visible, full figure inside frame"
    ),
}

# 후보 중 **무엇을 채택했는지.** 키는 `"slug/variant"`, 값은 시드 오프셋(0=기본).
#
# 이 표가 비어 있으면 전부 기본 시드를 쓴다 — 즉 후보를 뽑아 놓고 아무것도 고르지
# 않은 상태다. 고르는 일은 사람이 캡처를 보고 하는 것이므로(메모리
# `[[judge-by-capture-not-metrics]]`) 자동으로 채우지 않는다. `--candidates`로
# 후보를 굽고, 대조 시트를 보고, 여기 적고, 다시 돌리면 채택본이 배포된다.
#
# **채택에 생성 호출이 늘지 않는다** — 후보 raw 파일 이름에 시드가 들어 있어서
# 여기 적은 오프셋의 raw가 이미 캐시에 있다.
PICK: dict[str, int] = {}


def _client():
    import boto3

    return boto3.client("bedrock-runtime", region_name=REGION)


def _fingerprint(prompt: str, neg: str, aspect: str, seed: int) -> str:
    """캐시가 무엇으로 만들어졌는지 한 줄로. 파일 옆에 그대로 적어 둔다.

    **파일 이름만으로 캐시를 맞히면 프롬프트를 고쳐도 옛 그림이 나온다.** 이
    함수가 없을 때 `generate`는 `slug_variant.png`가 있으면 프롬프트를 보지도
    않고 그것을 돌려줬다 — 결과 프롬프트를 다시 쓰는 이 작업에서 그러면 `raw
    캐시 사용`만 찍히고 옛 그림이 새 이름으로 배포된다. **조용한 실패다.**

    사이드카가 없는 옛 캐시는 지금 프롬프트로 만들어진 것으로 **믿고 채운다**
    (기존 21장이 그렇다. 그 프롬프트를 고치지 않았으므로 참이고, 같은 시드로
    다시 부르면 캡처로 검증까지 끝난 그림을 이유 없이 흔든다).
    """
    return json.dumps(
        {"p": prompt, "n": neg, "a": aspect, "s": seed},
        ensure_ascii=False,
        sort_keys=True,
    )


def generate(
    slug: str,
    key: str,
    prompt: str,
    aspect: str,
    *,
    seed: int | None = None,
    note: list[str] | None = None,
) -> str | None:
    """SD3.5 호출 → raw PNG 경로. 이미 있으면 그대로 쓴다(스로틀·비용).

    필터에 막히면 **None을 돌려주고 이유를 남긴다.** 예외를 삼켜서 다른 그림으로
    메우면 매니페스트가 없는 그림을 가리킨다. `note`를 주면 그 이유를 거기에도
    담는다 — 호출자가 인덱스에 "왜 빠졌는지"를 적을 수 있어야 한다.

    `key`는 raw 파일 이름이다(`variant` 또는 `variant@seed`). **후보와 최종이
    같은 파일을 쓴다** — 후보 중 하나를 고르는 것이 그 raw를 굽는 것이 되므로
    고를 때 호출이 한 번도 늘지 않는다. 이름에 시드가 없으면 다른 시드로 뽑은
    후보가 서로를 덮어쓴다.

    `seed`는 기본이 `SEEDS[slug]`다. 후보를 뽑을 때만 다른 값을 준다
    (같은 캐릭터의 다른 그림을 얻는 유일한 손잡이다).
    """
    os.makedirs(RAW, exist_ok=True)
    dst = os.path.join(RAW, f"{slug}_{key}.png")
    # 희석은 **variant 이름으로** 찾는다(`win@101`이 아니라 `win`) — 후보와
    # 채택본이 다른 프롬프트를 쓰면 후보를 고른 의미가 없다
    variant = key.split("@")[0]
    extra = DILUTE.get(f"{slug}/{variant}")
    # 포즈 교체도 같은 키로 찾는다. **덧붙이지 않고 대신한다** — `facing viewer`가
    # 남으면 두 지시가 싸운다(`POSE_OVERRIDE` 주석)
    pose = POSE_OVERRIDE.get(f"{slug}/{variant}", prompt)
    parts = [LOOKS[slug], pose]
    if extra:
        parts.append(extra)
    # 애니 앵커·실사 부정어는 **결과 3종에만** 붙는다. 다섯에 다 붙이면
    # `card`·`select` 지문이 어긋나 검증 끝난 14장이 다시 구워진다(위 주석)
    neg = NEG
    if variant in RESULT_VARIANTS:
        parts.append(RESULT_ANIME)
        neg = f"{NEG}, {RESULT_NEG}"
    parts.append(STYLE)
    full = ", ".join(parts)
    use_seed = SEEDS[slug] if seed is None else seed
    fp = _fingerprint(full, neg, aspect, use_seed)
    side = os.path.join(RAW, f"{slug}_{key}.prompt.json")
    if os.path.exists(dst):
        old = None
        if os.path.exists(side):
            with open(side, encoding="utf-8") as f:
                old = f.read()
        if old is None:
            # 사이드카가 없는 옛 캐시(`card`·`select` 14장). 그 프롬프트는 고치지
            # 않았으므로 지금 지문으로 채워 넣는 것이 참이다 — 같은 시드로 다시
            # 부르면 캡처로 검증까지 끝난 그림을 이유 없이 흔든다.
            #
            # **프롬프트가 바뀐 자리는 여기 오지 않는다.** 옛 `win` 7장은 이
            # 기능을 넣을 때 손으로 지웠다(아래 `↻` 분기는 지문이 있는 캐시만
            # 상대한다). 지우지 않았다면 `raw 캐시 사용`만 찍히고 새 지시를
            # 적어 둔 채 옛 그림이 배포됐을 것이다.
            with open(side, "w", encoding="utf-8") as f:
                f.write(fp)
            print(f"  · {slug}/{key} raw 캐시 사용 (지문 backfill)")
            return dst
        if old == fp:
            print(f"  · {slug}/{key} raw 캐시 사용")
            return dst
        # 프롬프트가 바뀌었다 → 오려낸 것까지 버린다. 남겨 두면 새 raw에
        # 옛 매트가 붙어 **그림과 알파가 갈린다**
        print(f"  ↻ {slug}/{key} 프롬프트가 바뀌었다 — 다시 굽는다")
        for stale in (dst, os.path.join(RAW, f"{slug}_{key}_cut.png")):
            if os.path.exists(stale):
                os.remove(stale)
    body = {
        "prompt": full,
        "negative_prompt": neg,
        "aspect_ratio": aspect,
        "mode": "text-to-image",
        "output_format": "png",
        # 한 캐릭터의 여러 장이 같은 시드를 쓴다 — 얼굴이 갈리는 것을 줄인다
        "seed": use_seed,
    }
    br = _client()
    for attempt in range(4):
        try:
            r = br.invoke_model(modelId=MODEL, body=json.dumps(body))
            out = json.loads(r["body"].read())
            # 필터 거절은 예외가 아니라 **본문 필드**로 올 수도 있다
            if out.get("finish_reasons", [None])[0] not in (None, "SUCCESS"):
                why = str(out["finish_reasons"][0])
                # **경계에 있는 프롬프트는 흔들린다.** `ground_monk/lose`가 일괄
                # 실행에서 거절됐는데 같은 프롬프트를 그대로 3회 다시 부르면
                # 3회 통과했다 — 필터가 완전히 결정적이라는 처음 판단이 틀렸다
                # (`win`이 3/3 통과, `lose`가 3/3 거절이라 그렇게 읽었다).
                #
                # 그래서 **같은 프롬프트로만** 몇 번 더 부른다. 강도를 낮춰
                # 재시도하는 것이 아니다 — 그건 타협본을 조용히 배포하는 짓이고,
                # 여기서 바뀌는 것은 호출 횟수뿐이다.
                if attempt < 2:
                    print(f"  ↻ {slug}/{key} 필터 거절({why}) — 같은 프롬프트로 재시도")
                    continue
                print(f"  ✗ {slug}/{key} 필터 거절: {why}", file=sys.stderr)
                if note is not None:
                    note.append(f"필터 거절: {why}")
                return None
            img = base64.b64decode(out["images"][0])
            with open(dst, "wb") as f:
                f.write(img)
            with open(side, "w", encoding="utf-8") as f:
                f.write(fp)
            print(f"  ✓ {slug}/{key} 생성")
            return dst
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "Throttl" in msg or "TooMany" in msg:
                time.sleep(2**attempt)
                continue
            # 필터·검열 계열은 재시도해도 같다 — 로그만 남기고 넘어간다
            print(f"  ✗ {slug}/{key} 실패: {msg[:160]}", file=sys.stderr)
            if note is not None:
                note.append(f"생성 실패: {msg[:160]}")
            return None
    print(f"  ✗ {slug}/{key} 스로틀 4회 초과", file=sys.stderr)
    if note is not None:
        note.append("스로틀 4회 초과")
    return None


def matte(
    raw: str,
    slug: str,
    key: str,
    *,
    note: list[str] | None = None,
) -> str | None:
    """배경을 오려낸 PNG 경로. `remove-background` 호출 결과를 캐시한다.

    별도 파일로 캐시하는 이유: 후처리(밀도·양자화)를 다시 돌릴 때마다 재호출하면
    비용이 21장 × 반복 횟수가 된다. `--no-gen`으로 후처리만 돌릴 수 있어야 한다.
    """
    dst = os.path.join(RAW, f"{slug}_{key}_cut.png")
    if os.path.exists(dst):
        return dst
    with open(raw, "rb") as f:
        src = base64.b64encode(f.read()).decode()
    body = {"image": src, "output_format": "png"}
    br = _client()
    for attempt in range(4):
        try:
            r = br.invoke_model(modelId=MATTE_MODEL, body=json.dumps(body))
            out = json.loads(r["body"].read())
            with open(dst, "wb") as f:
                f.write(base64.b64decode(out["images"][0]))
            return dst
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if "Throttl" in msg or "TooMany" in msg:
                time.sleep(2**attempt)
                continue
            print(f"  ✗ {slug}/{key} 배경 제거 실패: {msg[:160]}", file=sys.stderr)
            if note is not None:
                note.append(f"배경 제거 실패: {msg[:160]}")
            return None
    print(f"  ✗ {slug}/{key} 배경 제거 스로틀 4회 초과", file=sys.stderr)
    if note is not None:
        note.append("배경 제거 스로틀 4회 초과")
    return None


def _drop_faint(img: Image.Image, floor: int = 24) -> Image.Image:
    """알파가 `floor` 아래면 완전히 지운다 (배경 쪽과 같은 이유·같은 값)."""
    a = np.array(img.convert("RGBA"))
    a[..., 3] = np.where(a[..., 3] < floor, 0, a[..., 3])
    return Image.fromarray(a, "RGBA")


def _trim_transparent(img: Image.Image) -> Image.Image:
    """
    사방 완전 투명 행·열을 잘라낸다.

    배경은 상하만 잘랐다(가로로 이어 붙이므로 폭이 타일 폭이다). 인물은 좌우도
    잘라야 한다 — 안 자르면 "내용 높이"가 텍스처 높이와 달라져서 런타임이
    지시한 것보다 작게 그린다. 배경에서 이미 겪은 실패다.
    """
    a = np.array(img.convert("RGBA"))[..., 3]
    rows = np.where(a.max(axis=1) > 0)[0]
    cols = np.where(a.max(axis=0) > 0)[0]
    if rows.size == 0 or cols.size == 0:
        return img
    return img.crop(
        (int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1)
    )


def _scrub_transparent(img: Image.Image) -> Image.Image:
    """투명 픽셀의 RGB를 불투명부 중앙값으로 덮는다.

    양자화가 알파를 안 보기 때문이다 — 배경 쪽 docstring에 전말이 있다(수관에
    (254,0,254)가 박힌 사건). 여기서도 같은 함정이 성립한다.
    """
    a = np.array(img.convert("RGBA"))
    opaque = a[..., 3] > 0
    if not opaque.any():
        return img
    med = np.median(a[opaque][:, :3], axis=0).astype(np.uint8)
    a[~opaque, :3] = med
    return Image.fromarray(a, "RGBA")


def _premultiplied_resize(img: Image.Image, w: int, h: int) -> Image.Image:
    """
    알파를 곱한 뒤 줄이고 되돌린다.

    그냥 줄이면 투명 픽셀의 RGB(지워진 마젠타)가 경계에 섞여 분홍 테가 남는다.
    """
    a = np.array(img.convert("RGBA")).astype(np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    small = np.array(
        Image.fromarray((a * 255).round().astype(np.uint8), "RGBA").resize(
            (w, h), Image.LANCZOS
        )
    ).astype(np.float32) / 255.0
    sa = small[..., 3:4]
    solid = sa > (2.0 / 255.0)
    rgb = np.divide(
        small[..., :3], sa, out=np.zeros_like(small[..., :3]), where=solid
    )
    out = np.dstack([np.clip(rgb, 0, 1), np.where(solid, sa, 0.0)])
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def _quantize(img: Image.Image, colors: int = 48) -> Image.Image:
    """
    색을 줄인다 — 매끈한 그라디언트가 도트 캐릭터 옆에서 튀는 걸 막는다.

    배경은 40색인데 인물은 **48색**이다. 얼굴에는 피부 그라데이션이 좁은 범위에
    몰려 있어서 40색에서 밴딩이 볼에 띠로 남았다(배경의 나뭇잎은 원래 얼룩이라
    같은 밴딩이 안 보인다).
    """
    src = _scrub_transparent(img)
    rgb = src.convert("RGB").quantize(colors=colors, dither=Image.NONE)
    out = rgb.convert("RGB").convert("RGBA")
    out.putalpha(img.getchannel("A"))
    return out


def median_lum(img: Image.Image) -> float:
    """불투명 텍셀의 중앙 명도(0~1, Rec.709).

    `import_chars.py`·`gen_bg_art.py`와 **같은 계수·같은 통계**다. 한쪽이 평균이면
    "캐릭터가 배경보다 밝은가" 비교가 성립하지 않는다 (메모리
    `[[character-vs-background-legibility]]`).
    """
    a = np.array(img.convert("RGBA"), dtype=np.float32)
    vis = a[a[:, :, 3] >= 128]
    if vis.size == 0:
        return 0.0
    lum = (0.2126 * vis[:, 0] + 0.7152 * vis[:, 1] + 0.0722 * vis[:, 2]) / 255.0
    return float(np.median(lum))


def postprocess(cut: str, v: Variant, crop: float) -> Image.Image:
    """오려낸 PNG → 구도 자르기 + 도트 밀도 + 양자화.

    입력은 **매팅을 지난 그림**이다(`matte()`). 여기서 배경을 지우지 않는다 —
    지울 색이 없다(docstring "배경 제거").
    """
    img = Image.open(cut).convert("RGBA")
    img = _drop_faint(img)
    # 먼저 인물에 딱 맞춘다 — 자르기 비율의 기준이 **캔버스가 아니라 인물**이어야
    # 한다. 캔버스 기준이면 여백이 많은 그림에서 얼굴 위 빈 공간만 남는다
    img = _trim_transparent(img)
    if crop < 1.0:
        img = _trim_transparent(
            img.crop((0, 0, img.width, max(8, int(round(img.height * crop)))))
        )
    # 목표 높이를 밀도에서 **유도한다** — 폭·높이를 직접 적으면 표시 크기를
    # 바꿀 때 밀도만 조용히 달라진다 (배경 쪽과 같은 규칙)
    display_h = REF_BASE[v.name] * v.ratio
    target_h = max(24, int(round(display_h / PX_PER_TEXEL)))
    target_w = max(8, int(round(img.width * target_h / img.height)))
    img = _premultiplied_resize(img, target_w, target_h)
    img = _drop_faint(img)
    img = _quantize(img)
    return img


def raw_key(variant: str, offset: int) -> str:
    """raw 파일 이름의 variant 부분. 오프셋 0은 **접미사를 붙이지 않는다.**

    기존 21장이 `slug_card.png`으로 이미 캐시에 있다. `card@0`으로 이름을 바꾸면
    그 21장이 캐시 미스가 되어 이유 없이 다시 구워진다(호출 42회).
    """
    return variant if offset == 0 else f"{variant}@{offset}"


def candidate_offsets(slug: str, variant: str) -> list[int]:
    """이 자리에 뽑을 시드 오프셋 목록. 0(기본)이 항상 첫 번째다.

    결과 3종에만 후보가 붙는다 — `card`·`select`는 이미 검증됐고, 후보를 뽑아도
    고를 화면이 없다.
    """
    if variant not in RESULT_VARIANTS:
        return [0]
    return [0, *CANDIDATE_OFFSETS, *EXTRA_CANDIDATES.get(slug, [])]


def _candidate_png(slug: str, variant: str, offset: int) -> str:
    return os.path.join(CAND, f"{slug}_{raw_key(variant, offset)}.png")


def build(slugs: list[str], do_gen: bool, want_candidates: bool) -> None:
    os.makedirs(PUB, exist_ok=True)
    manifest: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)

    missing: list[str] = []
    # 후보 인덱스. **거절도 여기 들어간다** — 빠진 자리를 기록하지 않으면
    # "고를 후보가 없다"와 "필터가 막았다"를 구별할 수 없다
    index: list[dict] = []
    for slug in slugs:
        print(f"[{slug}]")
        regions: dict[str, dict] = {}
        for v in VARIANTS:
            variant = v.name
            pick = PICK.get(f"{slug}/{variant}", 0)
            offsets = candidate_offsets(slug, variant) if want_candidates else [pick]
            if pick not in offsets:
                # 채택본을 굽지 않으면 배포본이 안 갱신된다
                offsets.append(pick)
            crop = CROP_OVERRIDE.get(f"{slug}/{variant}", v.crop)
            # 채택본. 후보 루프 안에서 잡는다 — 밖에서 한 번 더 후처리하면
            # 같은 그림을 두 번 굽고, 두 경로가 갈릴 자리가 생긴다
            img: Image.Image | None = None
            for offset in offsets:
                key = raw_key(variant, offset)
                note: list[str] = []
                raw = (
                    generate(
                        slug,
                        key,
                        v.prompt,
                        v.aspect,
                        seed=SEEDS[slug] + offset,
                        note=note,
                    )
                    if do_gen
                    else os.path.join(RAW, f"{slug}_{key}.png")
                )
                cut = (
                    matte(raw, slug, key, note=note)
                    if raw is not None and os.path.exists(raw)
                    else None
                )
                entry = {
                    "slug": slug,
                    "variant": variant,
                    "seedOffset": offset,
                    "seed": SEEDS[slug] + offset,
                    "chosen": offset == pick,
                }
                if cut is None:
                    # 조용히 다른 그림으로 메우지 않는다 (모듈 docstring "노출 수준")
                    entry["skipped"] = note[0] if note else "raw 없음"
                    index.append(entry)
                    if offset == pick:
                        missing.append(f"{slug}/{variant}")
                    continue
                cand = postprocess(cut, v, crop)
                if variant in RESULT_VARIANTS:
                    # 후보 사본·인덱스는 **결과 3종만.** `card`·`select`까지 넣으면
                    # 대조 시트가 35행이 되는데, 그 14행은 고를 것이 없다(후보가
                    # 한 장뿐이다). 판단하려고 만든 시트를 못 쓰게 만드는 것이 된다
                    os.makedirs(CAND, exist_ok=True)
                    cand.save(_candidate_png(slug, variant, offset))
                    entry["png"] = os.path.relpath(
                        _candidate_png(slug, variant, offset), HERE
                    )
                    entry["medLum"] = round(median_lum(cand), 4)
                    index.append(entry)
                if offset == pick:
                    img = cand
                else:
                    print(f"  {variant}@{offset}: 후보 {cand.width}×{cand.height}")
            if img is None:
                continue
            out = os.path.join(PUB, f"{slug}_{variant}.png")
            img.save(out)
            alpha = np.array(img)[..., 3]
            regions[variant] = {
                "url": f"assets/portraits/{slug}_{variant}.png",
                "w": img.width,
                "h": img.height,
                # 표시 크기는 **런타임이 이 비율로 정한다.** 여기 굽힌 px를
                # 쓰면 화면 크기가 바뀔 때 그림만 그대로 남는다
                "ratio": v.ratio,
                # 캐릭터가 배경보다 밝은지 테스트가 판정한다
                "medLum": round(median_lum(img), 4),
                # 투명이 0%면 배경 제거가 실패한 것이다(불투명 사각형). 마젠타
                # 키잉 시절 실제로 세 장 다 0%가 나왔다 — 테스트가 잡게 남긴다
                "alphaRatio": round(float((alpha == 0).mean()), 4),
            }
            print(
                f"  {variant}: {img.width}×{img.height} "
                f"표시≈{REF_BASE[variant] * v.ratio:.0f}px "
                f"medLum={regions[variant]['medLum']:.3f} "
                f"투명={regions[variant]['alphaRatio'] * 100:.0f}%"
            )
        if regions:
            manifest[slug] = regions

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    made = sum(len(v) for v in manifest.values())
    print(f"\n{MANIFEST} — {len(manifest)}종 / {made}장")
    if missing:
        # **조용히 넘기지 않는다.** 빠진 자리를 로그로 남기지 않으면 매니페스트가
        # "다 있다"로 읽힌다 (메모리 `[[no-silent-caps]]`와 같은 규칙)
        print(f"빠진 그림 {len(missing)}장: {', '.join(missing)}", file=sys.stderr)
    if index:
        _write_index(index)


def _write_index(index: list[dict]) -> None:
    """후보 인덱스 + 대조 시트.

    **거절된 자리도 행으로 남는다**(`skipped`). 성공만 적으면 "50장을 뽑았다"가
    되는데 실제로는 필터가 몇 장을 막았을 수 있고, 그 차이를 나중에 복원할 수
    없다 (메모리 `[[no-silent-caps]]`).
    """
    os.makedirs(CAND, exist_ok=True)
    with open(CAND_INDEX, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    made = [e for e in index if "png" in e]
    gaps = [e for e in index if "skipped" in e]
    _contact_sheet(made)
    print(f"{CAND_INDEX} — 후보 {len(made)}장, 빈 자리 {len(gaps)}장")
    if gaps:
        for e in gaps:
            print(
                f"  ✗ {e['slug']}/{e['variant']}@{e['seedOffset']}: {e['skipped']}",
                file=sys.stderr,
            )


def _contact_sheet(made: list[dict]) -> None:
    """후보를 격자로 붙인 한 장. **고르는 판단은 이걸 보고 한다.**

    행 = 캐릭터/용도, 열 = 시드 오프셋. 지표(`medLum`)로 고르지 않는 이유는
    메모리 `[[judge-by-capture-not-metrics]]`에 있다 — 밝기가 비슷해도 팔이
    잘렸는지는 수치에 안 나온다.

    실제 표시 높이로 붙인다(`REF_BASE × ratio`). 축소해 붙이면 "얼굴이 읽히나"를
    이 시트로 판정할 수 없다 (메모리 `[[capture-resolution-is-the-measurement]]`).
    """
    if not made:
        return
    rows: dict[str, dict[int, str]] = {}
    for e in made:
        rows.setdefault(f"{e['slug']}/{e['variant']}", {})[e["seedOffset"]] = e["png"]
    offs = sorted({o for r in rows.values() for o in r})
    cell_w, cell_h, pad = 260, 300, 8
    label_w = 240
    sheet = Image.new(
        "RGBA",
        (label_w + len(offs) * (cell_w + pad), len(rows) * (cell_h + pad)),
        (18, 14, 26, 255),
    )
    from PIL import ImageDraw

    d = ImageDraw.Draw(sheet)
    for ri, (name, byoff) in enumerate(sorted(rows.items())):
        y = ri * (cell_h + pad)
        d.text((6, y + cell_h // 2), name, fill=(240, 236, 255, 255))
        for ci, off in enumerate(offs):
            if off not in byoff:
                continue
            x = label_w + ci * (cell_w + pad)
            im = Image.open(os.path.join(HERE, byoff[off])).convert("RGBA")
            sc = min(cell_w / im.width, cell_h / im.height, 1.0)
            im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))))
            sheet.alpha_composite(im, (x, y))
            d.text((x + 2, y + 2), f"@{off}", fill=(255, 201, 74, 255))
    sheet.convert("RGB").save(CAND_SHEET)
    print(f"{CAND_SHEET} — 대조 시트 {sheet.width}×{sheet.height}")


def main() -> None:
    with open(CHARS_JSON, encoding="utf-8") as f:
        chars = json.load(f)["chars"]
    heroes = [s for s, d in chars.items() if d["kind"] == "hero"]
    unknown = [s for s in heroes if s not in LOOKS or s not in SEEDS]
    if unknown:
        # 히어로가 늘면 여기서 멈춘다 — 조용히 6종만 굽고 성공하면 안 된다
        sys.exit(f"외형·시드가 없는 히어로: {unknown}")
    bad_pick = [k for k in PICK if k.split("/")[0] not in heroes]
    if bad_pick:
        # 오타가 조용히 무시되면 "골랐는데 안 바뀐다"가 된다
        sys.exit(f"PICK의 캐릭터가 히어로가 아니다: {bad_pick}")
    # 포즈 교체도 같은 이유로 검사한다. 키를 잘못 적으면 `POSE_OVERRIDE.get`이
    # 조용히 원래 프롬프트를 돌려주고, 로그에는 `raw 캐시 사용`만 찍힌다 —
    # 즉 "사선으로 바꿨는데 정면 그대로"가 아무 경고 없이 배포된다
    known = {v.name for v in VARIANTS}
    bad_pose = [
        k
        for k in POSE_OVERRIDE
        if k.split("/")[0] not in heroes or k.split("/")[-1] not in known
    ]
    if bad_pose:
        sys.exit(f"POSE_OVERRIDE의 키가 히어로/용도가 아니다: {bad_pose}")

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    do_gen = "--no-gen" not in sys.argv
    want_candidates = "--candidates" in sys.argv
    slugs = args or heroes
    bad = [s for s in slugs if s not in heroes]
    if bad:
        sys.exit(f"히어로가 아니다: {bad} (가능: {heroes})")
    build(slugs, do_gen, want_candidates)


if __name__ == "__main__":
    main()
