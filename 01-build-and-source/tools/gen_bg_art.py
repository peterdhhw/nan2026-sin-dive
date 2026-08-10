#!/usr/bin/env python3
"""
배경 삽화 생성 — SD3.5 Large(Bedrock)로 테마별 패럴랙스 3겹을 **그린다**.

`gen_bg.py`(단색 실루엣 + 런타임 tint)를 대체한다. 그쪽 docstring은 "AI 이미지
생성을 쓰지 않는다"고 못박아 두었는데, 그 결정을 뒤집은 이유는 이렇다:

- tint 방식은 텍스처 1장으로 테마 2종을 만든다는 장점이 있었지만, 대가로
  **두 테마의 형태가 완전히 같았다.** 숲과 심연이 색만 다른 같은 나무였다.
- 단색 실루엣에는 명암이 없다. 원경/중경/근경을 알파와 색으로만 갈라 놓으면
  깊이가 "옅은 초록 / 진한 초록"으로만 읽혀서 세 겹이 한 덩어리로 보인다.
- 그래서 테마별로 삽화를 따로 굽는다(텍스처 2배). 라이선스 걱정은 없다 —
  파생물이 아니라 우리가 생성한 것이다.

## 왜 하늘은 여전히 코드가 그리는가

`background.ts`의 하늘은 Graphics 그라디언트로 남긴다. 삽화에 하늘을 넣으면
(1) 테마 크로스페이드가 텍스처 두 장을 동시에 들어야 하고 (2) 상대 필드는
위아래로 뒤집히므로 하늘이 아래에 깔린다. 색 보간은 공짜고 반전에 안전하다.
삽화는 **지평선 위가 투명**해야 한다.

## 그 투명을 어떻게 얻는가

SD3.5에 "평평한 단색 마젠타 하늘"을 그리게 하고, 그 마젠타를 **위에서 아래로
내려오며** 지운다(`_key_sky`). 색 일치만으로 지우면 그림 안쪽의 비슷한 색에도
구멍이 뚫리는데, 열마다 위에서 걸어 내려오면 하늘과 이어진 영역만 지워진다.
remove-background 모델은 쓰지 않는다 — 피사체 매팅용이라 풍경에서는 지평선을
못 찾는다.

## 가로 이음새

두 장을 이어 붙여 무한 스크롤하므로 타일은 좌우가 맞아야 한다(`_wrap_seam`).
오른쪽 띠를 왼쪽 띠로 크로스페이드한 다음 **왼쪽 띠를 잘라낸다** — 그래야
마지막 열과 새 첫 열이 원본에서 이웃하던 두 열이 되어 정확히 이어진다.

## 타일 폭을 여기서 정하지 않는다

첫 판에는 표시 크기를 (TILE_W=900, fieldH×0.42)로 고정하고 원본을 그 비율로
잘랐다. **틀렸다.** 900×176은 종횡비 5.1인데 SD3.5의 최대 가로비는 21:9(2.33)다.
아래를 고정해 자르니 나무 crown이 전부 잘려 나가고 밑동 풀만 남았다(384×1까지
찌그러진 적도 있다).

그래서 자르지 않는다. 표시 높이만 TS가 정하고(`SCENERY_LAYERS.contentRatio` ×
지면선) **타일 폭은 텍스처 종횡비에서 유도한다.** 그러면 그림이 안 늘어나고,
필드가 235px로 줄어도 비율이 유지된다. 대신 타일 폭이 필드 폭(720)보다 좁을 수
있으므로 런타임이 필요한 장수를 세어 깐다.

그 유도가 성립하려면 **투명한 여백이 없어야** 한다 — 위쪽 빈 하늘을 남겨 두면
"내용 높이"와 "텍스처 높이"가 달라져서 TS가 정한 비율이 내용에 안 걸린다.
`_trim_transparent`가 상하 빈 행을 잘라낸다.

## 해상도

캐릭터가 58px 원본을 ≈230px로 띄우는 픽셀아트다(4배). 배경만 매끈하면
"UI 해상도만 높아 보인다"의 배경판이 된다. 그래서 텍셀당 design px를 상수로
박고(`PX_PER_TEXEL`) 목표 폭을 거기서 **유도한다** — 폭을 직접 적으면 표시
높이를 바꿀 때 밀도만 조용히 달라진다.

캐릭터와 똑같이 4.0으로 맞추지는 않았다. 맞추면 중경이 92×44가 되는데, 그 폭에
나무 40그루가 들어가면 한 그루가 2px이라 숲이 얼룩이 된다. 2.5면 40색 양자화와
합쳐져 충분히 도트로 읽히면서 형태가 남는다.

사용법:
    python3 tools/gen_bg_art.py            # 6장 전부
    python3 tools/gen_bg_art.py surface_far  # 하나만 (프롬프트 실험용)
    python3 tools/gen_bg_art.py --no-gen   # 캐시된 raw로 후처리만 다시
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import time

import boto3
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public", "assets", "bg")
RAW = os.path.join(HERE, "..", ".cache", "bg_raw")
MANIFEST = os.path.join(PUB, "bg.json")

MODEL = "stability.sd3-5-large-v1:0"
REGION = "us-west-2"

# 하늘 키 색. 자연 풍경에 절대 안 나오는 색이어야 한다.
# (판정은 이 절대값이 아니라 `_is_key`의 색조 규칙이다 — SD가 그라디언트를 그린다)
KEY_RGB = (255, 0, 255)

# 진단 출력용 기준 필드 높이. `computeSplit(0).top.h`에서 온 값이다
# (720×1280, 게이지 중앙 → (1280 - 0.12·1280 - 0.18·1280 - 56)/2 = 420).
# **에셋에 굽지 않는다** — 아래 print에서 "이 해상도면 도트가 보이나"를 눈으로
# 재기 위한 것뿐이다. 실제 배율은 런타임이 그때의 fieldH로 계산한다.
REF_FIELD_H = 420.0

# 공통 스타일. 직업명사·캐릭터 서술은 넣지 않는다 — 넣으면 인물이 그려진다.
STYLE = (
    "2D game background art, side-scrolling parallax layer, hand-painted pixel art, "
    "muted desaturated palette, dark fantasy mood, flat solid uniform magenta sky, "
    "no gradient in sky, no clouds, no characters, no people, no creatures, "
    "horizontal composition, scenery only"
)
NEG = (
    "photorealistic, 3d render, text, watermark, signature, ui, frame, border, "
    "people, character, person, figure, animal, sky gradient, clouds, vignette, "
    "blurry, depth of field"
)
# 발광이 분홍으로 끌려가는 것(키색 오염)을 네거티브로 막으려 했더니 **하늘까지**
# 눌려서 (93,37,93)이 됐다 — 키색을 요구하면서 그 색을 금지하면 서로 싸운다.
# 발광색은 네거티브가 아니라 **포지티브로** 못박는다("indigo blue-violet").

# 텍셀 하나가 화면에서 차지하는 design px. 목표 폭을 이 값에서 유도한다.
# 근거·왜 4.0이 아닌지는 모듈 docstring "해상도" 참고.
PX_PER_TEXEL = 2.5

# ── 레이어 스펙
#
# `h_ratio` = 표시 높이 / fieldH (design px).
#
# **이 값을 TS에 복사하지 않는다.** `bg.json`의 region에 `ratio`로 써 넣고
# 런타임이 거기서 읽는다. 두 벌로 두면 여기서 0.42를 0.5로 고쳐도 화면은
# 안 바뀌고(TS가 옛 값을 들고 있다) 아무것도 안 깨진 채 밀도만 달라진다.
# 움직임(패럴랙스·알파)은 그림의 성질이 아니라 연출이라 TS에 남는다.
SPECS = [
    # far 두 장은 프롬프트를 한 번 고쳐 썼다. "distant mountain ridges"처럼
    # **장면**을 부르면 SD가 하늘까지 칠한 완성 풍경화를 그린다(키색이 5%만
    # 남아 불투명 사각형이 됐다). 지평선을 명시하고 "위쪽 절반은 하늘"이라고
    # 못박아야 띠가 나온다.
    # "hazy"/"misty"를 뺐다. 안개를 부르면 SD가 **하늘색을 봉우리에 섞어** 그리고,
    # 그 픽셀은 g가 살아 있어서(실측 (120,105,142), g=105) 키 판정도 despill도
    # 지나간다 — 능선 위에 분홍 테두리가 남았다. 색으로는 잡을 수 없고 잡아서도
    # 안 된다(진짜 그려진 내용이다). 안개는 어차피 런타임 alpha 0.45가 만든다.
    (
        "surface_far",
        "single row of distant mountain peaks along the bottom edge, "
        "faraway blue-green treeline, flat crisp silhouette shapes, "
        "upper half is empty flat magenta sky, sharp edges against the sky, "
        "low detail, nothing above the peaks",
        0.30,
    ),
    (
        "surface_mid",
        "row of tall dark pine and oak trees, dense mossy woodland, "
        "mid-distance forest wall, visible trunks",
        0.42,
    ),
    (
        "surface_near",
        "foreground overgrown forest edge, thick moss-covered rocks, ferns, "
        "gnarled roots, large dark shapes cropped at bottom",
        0.56,
    ),
    # abyss_far에서는 발광을 아예 요구하지 않는다. 색을 지정할수록(violet →
    # pink로 오염 → indigo로 교정) SD가 **하늘색까지** 그 색으로 끌고 갔다
    # (indigo를 넣으니 하늘이 (65,106,251)이 되어 키가 1%만 걸렸다). 원경은
    # 패럴랙스 0.15·알파 0.45로 거의 안 보이는 층이라 발광이 필요하지도 않다 —
    # 균열 발광은 근경(abyss_near)이 이미 갖고 있다.
    (
        "abyss_far",
        "single row of distant jagged dark violet cliff peaks along the bottom edge, "
        "plain dark rock, flat crisp silhouette shapes, "
        "bright magenta background fills every area that is not rock, "
        "low detail, nothing above the peaks",
        0.30,
    ),
    # 아치 **안쪽**의 하늘은 상단 플러드필이 못 닿는다(돌에 둘러싸여 있다).
    # 첫 판은 그 갇힌 하늘이 보라 불꽃 모양으로 남았다. 후처리로는 못 지운다 —
    # 그림 안의 닫힌 영역이라 위상으로도, 색으로도(우리 보라와 같은 색) 구분이
    # 안 된다. 그래서 **구도로** 푼다: 아치 대신 막힌 벽·기둥을 그리게 한다.
    (
        "abyss_mid",
        "row of solid ruined stone pillars and broken walls of a sunken temple, "
        "jagged rock spires, cold violet rim light, "
        "no archways, no openings, no gaps between the stones, solid silhouette",
        0.42,
    ),
    (
        "abyss_near",
        "foreground shattered obsidian rocks and glowing violet crystal clusters, "
        "cracked stone rubble, large dark shapes cropped at bottom",
        0.56,
    ),
]

# 시드는 스펙 순서로 고정한다. 마음에 안 드는 한 장만 다시 뽑을 때 나머지가
# 같이 바뀌면 비교가 성립하지 않는다.
# far 두 장은 첫 구도가 하늘까지 칠한 풍경화였다(위 주석) — 프롬프트를 고치면서
# 시드도 갈아야 새 구도가 나온다. 나머지는 채택한 그림이라 건드리지 않는다.
SEEDS = {name: 1700 + i * 13 for i, (name, *_rest) in enumerate(SPECS)}
SEEDS["surface_far"] = 5209
SEEDS["abyss_far"] = 8117
# abyss_mid는 기본 시드(1752)를 쓴다. 아치 사이에 갇힌 하늘은 시드가 아니라
# 프롬프트("no archways, no openings")로 없앴다 — 위상적으로 닿을 수 없는
# 구멍은 후처리로 못 지운다. 구도 문제는 구도 지시로 고치는 게 맞다.


def _client():
    return boto3.client("bedrock-runtime", region_name=REGION)


def generate(name: str, prompt: str) -> str:
    """SD3.5 호출 → raw PNG 경로. 이미 있으면 그대로 쓴다(스로틀·비용)."""
    os.makedirs(RAW, exist_ok=True)
    dst = os.path.join(RAW, f"{name}.png")
    if os.path.exists(dst):
        print(f"  · {name} raw 캐시 사용")
        return dst
    body = {
        "prompt": f"{prompt}, {STYLE}",
        "negative_prompt": NEG,
        # 21:9 = 1536x640. 패럴랙스 띠는 넓고 낮아야 한다
        "aspect_ratio": "21:9",
        "mode": "text-to-image",
        "output_format": "png",
        "seed": SEEDS[name],
    }
    br = _client()
    for attempt in range(4):
        try:
            r = br.invoke_model(modelId=MODEL, body=json.dumps(body))
            out = json.loads(r["body"].read())
            img = base64.b64decode(out["images"][0])
            with open(dst, "wb") as f:
                f.write(img)
            print(f"  ✓ {name} 생성")
            return dst
        except Exception as e:  # noqa: BLE001
            if "Throttl" in str(e) or "TooMany" in str(e):
                time.sleep(2**attempt)
                continue
            raise
    raise RuntimeError(f"{name} 생성 실패")


def _is_key(rgb: np.ndarray) -> np.ndarray:
    """
    마젠타 하늘 판정 → (h, w) bool.

    **색 거리로는 못 잡는다.** "flat solid magenta"를 지시해도 SD3.5는 위아래로
    밝기가 흐르는 그라디언트를 그린다(실측: 상단 (209,13,128) → 지평선 근처
    (144,8,90), 거리로 65 차이). 순수 (255,0,255)에서 tol=108로는 한 픽셀도
    안 걸려서 첫 판은 "하늘 0% 지움"이 나왔다.

    그래서 절대색이 아니라 **색조**로 판정한다: r과 b가 둘 다 g보다 훨씬 크면
    마젠타 계열이다. 명도가 어떻든 성립한다.

    두 번째 조건이 `r >= b - 12`("마젠타는 빨강 쪽")였는데 **그것도 틀렸다.**
    심연 테마의 하늘을 SD가 (186,16,212)로 — 파랑 쪽으로 기울여 — 그려서
    `abyss_mid`가 한 픽셀도 안 걸렸다(하늘 0% 지움). 대신 **g가 눌려 있는지**를
    본다: 키색은 SD가 "solid magenta"로 칠한 것이라 g가 거의 0인데, 우리 그림의
    보라(심연 발광 0x8a6ad0, g=0x6a)와 청록(숲 하늘 g=0xc0)은 g가 살아 있다.

    이 조건은 실측으로 세웠다: 여섯 장의 확실한 내용 영역(하단 30%)에서 오검출이
    2% 아래로 떨어지고, 그 2%도 들여다보니 바위 틈으로 보이는 진짜 하늘이었다.

    세 번째 실패도 있었다. `abyss_far`의 발광이 분홍으로 나와서 네거티브에
    "pink glow"를 넣었더니 **하늘까지 눌려** (93,37,93)이 됐다 — g/max = 0.40으로
    임계 위. 키색을 요구하면서 그 색을 금지하는 프롬프트는 서로 싸운다.

    네 번째 실패까지 갔다. 발광색을 고칠수록 SD가 **하늘색을 그 색으로** 끌고
    갔다: violet → 분홍 오염 → "indigo"로 교정하니 하늘이 (65,106,251) →
    "no glow"로 빼니 하늘이 흰색 (253,254,253). 프롬프트로 키색을 고정하는 싸움은
    이기지 못한다.

    그래서 **키색을 고정하지 않는다.** 색이 무엇이든(마젠타·흰색·어두운 보라)
    "위쪽에서 이어진 넓은 균일 영역"이 하늘이라는 성질만 쓴다. 판정은
    `_key_sky`의 상단 플러드필이 하고, 이 함수는 표집색과 색조 둘 다를
    후보 마스크로 내놓는다 — 플러드필이 그 안에서 하늘만 골라낸다.
    """
    a = rgb.astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    hue = (r > g + 45) & (b > g + 45) & (g < 0.35 * np.maximum(r, b))
    sky = _sample_sky(a)
    near = np.abs(a - sky[None, None, :]).sum(axis=2) < 60
    return hue | near


def _sample_sky(a: np.ndarray) -> np.ndarray:
    """상단 24행의 최빈색 = 하늘색. 패럴랙스 띠는 맨 위가 언제나 하늘이다."""
    top = a[:24].reshape(-1, 3)
    colors, counts = np.unique(top, axis=0, return_counts=True)
    return colors[int(np.argmax(counts))].astype(np.int16)


def _key_sky(rgb: np.ndarray) -> np.ndarray:
    """
    하늘을 지운다 → alpha (h, w) uint8.

    **열을 위에서 걸어 내려오는 방식은 틀렸다.** 그 방식은 열마다 첫 non-sky
    픽셀에서 멈추므로, 나무 꼭대기 아래의 하늘 — 즉 **줄기 사이로 보이는
    하늘** — 을 남긴다. 실측 16%만 지워졌고 남은 마젠타가 숲 안에 그대로
    박혀 있었다. 위에서 아래로 막힌 것이 없는 구도(맨 위가 통째로 하늘)를
    가정했던 것이 오류다.

    전역 마스크(`_is_key` 결과를 그대로 쓰기)도 틀렸다. 키색을 프롬프트로 고정할
    수 없다는 걸 알고 나면(`_is_key` docstring) 후보 마스크는 느슨해야 하는데,
    느슨한 마스크를 전역으로 쓰면 그림 안쪽이 뚫린다 — `abyss_near`의 검은 자갈이
    어두운 하늘색과 거리가 가까워 하단 6%가 걸렸고, 흰 하늘이 나온 `abyss_far`는
    하단 100%가 걸렸다.

    그래서 **상단 경계에서 플러드필**한다. 하늘은 위쪽 테두리에서 이어진 영역이라는
    성질만 쓰므로 색이 무엇이든(마젠타·흰색·어두운 보라) 성립하고, 그림 안쪽의
    비슷한 색은 하늘과 안 이어져 있으니 안전하다. 나무 꼭대기 아래로 돌아 내려오는
    하늘도 이어져 있으니 같이 지워진다 — 열 단위 하강이 못 했던 부분이다.
    """
    cand = _is_key(rgb)
    h, w = cand.shape
    sky = np.zeros_like(cand)
    from collections import deque

    q = deque()
    # 씨앗은 위쪽 한 행 전체. 좌우 테두리는 씨앗으로 쓰지 않는다 — 근경처럼
    # 화면을 가득 채운 그림은 좌우 끝이 내용이라 거기서 번지면 다 지워진다.
    for x in range(w):
        if cand[0, x] and not sky[0, x]:
            sky[0, x] = True
            q.append((0, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not sky[ny, nx]:
                sky[ny, nx] = True
                q.append((ny, nx))
    return np.where(sky, 0, 255).astype(np.uint8)


def _feather_edges(alpha: np.ndarray) -> np.ndarray:
    """
    투명/불투명 경계를 반투명 한 겹으로 눌러 준다.

    딱 자르면 nearest 확대에서 실루엣 윤곽이 계단으로 서고, 남은 경계 픽셀의
    마젠타 스필이 분홍 테두리로 보인다. 불투명 픽셀 중 투명과 접한 것만 낮춘다.
    """
    solid = alpha > 0
    pad = np.pad(solid, 1, constant_values=False)
    # 4이웃 중 하나라도 투명이면 경계
    nb = (
        pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
    )
    edge = solid & ~nb
    out = alpha.copy()
    out[edge] = 150
    return out


def _despill(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """
    남은 마젠타 스필을 눌러 준다.

    키 경계의 픽셀은 하늘색이 섞여 들어와 g가 비정상적으로 낮다. r·b를 g 쪽으로
    끌어내린다 — 안 하면 나무 윤곽에 분홍 테두리가 생긴다.
    """
    out = rgb.astype(np.int16)
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    spill = _is_key(rgb) & (alpha > 0)
    lim = g + 24
    r[spill] = np.minimum(r[spill], lim[spill])
    b[spill] = np.minimum(b[spill], lim[spill])
    return np.clip(out, 0, 255).astype(np.uint8)


def _trim_transparent(img: Image.Image) -> Image.Image:
    """
    상하 완전 투명 행을 잘라낸다.

    **왜 필수인가**: 런타임은 텍스처 높이를 "내용 높이"로 보고 표시 배율을
    정한다(모듈 docstring). 위에 빈 하늘 200행이 남아 있으면 그 200행까지
    contentRatio 안에 들어가서 나무가 지시한 것의 절반 크기로 그려진다.
    """
    a = np.array(img)[..., 3]
    rows = np.where(a.max(axis=1) > 0)[0]
    if rows.size == 0:
        return img
    return img.crop((0, int(rows[0]), img.width, int(rows[-1]) + 1))


def _wrap_seam(img: Image.Image, band_frac: float = 0.16) -> Image.Image:
    """
    좌우가 이어지는 타일로 만든다. 결과 폭은 원본 - 띠 폭이다.

    섞을 때 알파를 미리 곱한다 — `_downsample`과 같은 이유다. 안 곱하면 투명한
    하늘 쪽의 마젠타 RGB가 반대편 나무에 섞인다.
    """
    a = np.array(img).astype(np.float32) / 255.0
    h, w, _ = a.shape
    pm = np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])
    b = max(2, int(round(w * band_frac)))
    t = np.linspace(0.0, 1.0, b, dtype=np.float32)[None, :, None]
    pm[:, w - b :] = pm[:, w - b :] * (1.0 - t) + pm[:, :b] * t
    cut = pm[:, b:]
    sa = cut[..., 3:4]
    rgb = np.divide(cut[..., :3], sa, out=np.zeros_like(cut[..., :3]), where=sa > 0)
    out = np.dstack([np.clip(rgb, 0, 1), sa])
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def _downsample(img: Image.Image, target_w: int) -> Image.Image:
    """
    픽셀 격자로 내린다. BOX(면적 평균) — LANCZOS는 링잉으로 알파 경계에 반투명
    후광을 만들고, NEAREST는 세부가 지글거린다.

    **알파를 미리 곱해야 한다.** RGBA를 그냥 줄이면 PIL이 RGB와 A를 따로
    평균하는데, 투명 픽셀의 RGB는 지워진 하늘색(마젠타)이 그대로 남아 있으므로
    나뭇가지 사이 텍셀에 마젠타가 섞여 들어온다. 실제로 첫 결과의 수관이
    분홍빛으로 번졌다(스크린샷으로 확인) — 알파가 0이라 despill도 건너뛴 곳이다.
    곱해서 줄이고 나눠서 되돌리면 투명 픽셀은 가중치 0으로 빠진다.
    """
    if img.width <= target_w:
        return img
    k = target_w / img.width
    size = (target_w, max(1, round(img.height * k)))
    a = np.array(img).astype(np.float32) / 255.0
    alpha = a[..., 3:4]
    pm = np.dstack([a[..., :3] * alpha, alpha])
    # **채널을 float으로 줄인다.** 프리멀티플라이 값을 uint8로 반올림한 뒤 줄이면
    # 알파가 낮은 텍셀에서 색 정밀도가 사라진다: pm_r=1/255, sa=1/255를 나누면
    # r=1.0(=255)이 되고 g는 0으로 남아 **없던 마젠타가 만들어진다**. 실측으로
    # scrub 직후 0개였던 키색이 downsample 후 980개로 늘었다 — 범인이 여기였다.
    small = np.dstack(
        [
            np.array(Image.fromarray(pm[..., c], "F").resize(size, Image.BOX))
            for c in range(4)
        ]
    )
    sa = small[..., 3:4]
    # 거의 투명한 텍셀은 색을 복원해도 의미가 없고 팔레트만 오염시킨다.
    # 알파를 0으로 끊고 색은 버린다 (`_scrub_transparent`가 뒤에서 채운다).
    solid = sa > (2.0 / 255.0)
    rgb = np.divide(small[..., :3], sa, out=np.zeros_like(small[..., :3]), where=solid)
    out = np.dstack([np.clip(rgb, 0, 1), np.where(solid, sa, 0.0)])
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def _scrub_transparent(img: Image.Image) -> Image.Image:
    """
    완전 투명 픽셀의 RGB를 불투명부의 대표색으로 덮는다.

    **양자화가 알파를 안 본다.** `convert("RGB")`는 알파를 버리고 RGB만 남기는데,
    투명 영역의 RGB는 지워진 마젠타 그대로다. 그 마젠타가 40색 팔레트에 슬롯을
    차지하고, 그러면 경계의 반투명 텍셀이 **그 마젠타 슬롯으로 스냅된다** —
    수관에 (254,0,254) 픽셀이 박힌 이유가 이것이었다(alpha 8~14로 남아 눈에는
    분홍 얼룩으로 보인다). 프리멀티플라이 리사이즈로도 안 잡혔던 이유다:
    범인은 리사이즈가 아니라 그 뒤의 양자화였다.

    투명부를 불투명 중앙값으로 채우면 팔레트에 새 색이 안 생기고, 스냅되어도
    그림 안의 색이라 눈에 안 띈다.
    """
    a = np.array(img)
    opaque = a[..., 3] > 0
    if not opaque.any():
        return img
    med = np.median(a[opaque][:, :3], axis=0).astype(np.uint8)
    a[~opaque, :3] = med
    return Image.fromarray(a, "RGBA")


def _drop_faint(img: Image.Image, floor: int = 24) -> Image.Image:
    """
    알파가 `floor` 아래인 픽셀을 완전히 지운다.

    키 경계의 안티에일리어싱 픽셀은 하늘색이 절반 섞여 있어서 `_is_key`의 색조
    조건을 살짝 벗어난다(실측 (245,87,146): g=87이라 임계 위였다). 알파가 3~17
    이라 개별로는 안 보이지만 nearest로 2.5배 확대되면 분홍 얼룩으로 뭉친다.

    색조를 더 느슨하게 잡는 대신 알파로 끊는 이유: 느슨하게 잡으면 심연의 보라
    발광 같은 **진짜 내용**이 걸린다. 알파 24는 실측으로 정했다 — 여섯 장에서
    버리는 가시량(알파 가중 합)이 최대 0.43%다.
    """
    a = np.array(img)
    faint = a[..., 3] < floor
    a[faint] = 0
    return Image.fromarray(a, "RGBA")


def _drop_islands(img: Image.Image, min_texels: int = 12) -> Image.Image:
    """
    본체에서 떨어진 작은 섬을 지운다.

    알파 하한만으로는 안 잡히는 얼룩이 남았다. 실측하니 (120,105,142) 알파
    24~78 — 양자화가 프린지들을 팔레트 한 칸으로 뭉친 색이라 색조 조건(g 낮음)도,
    알파 하한도 통과한다. **색으로 잡을 수 없다.**

    잡을 수 있는 성질은 위상이다: `surface_far`의 섬 분포는 본체 3798텍셀 + 나머지
    11개가 전부 9텍셀 이하(합쳐 21텍셀)였다. 배경 삽화의 진짜 내용은 지면에서
    이어진 한 덩어리이므로, 떨어진 작은 조각은 정의상 하늘에 뜬 잔재다.

    (같은 판정을 무기 잔재 지우기에서도 썼다: 양이 아니라 "본체와 이어졌는지"가
    무해/유해를 가른다.)
    """
    a = np.array(img)
    solid = a[..., 3] > 0
    h, w = solid.shape
    seen = np.zeros_like(solid)
    from collections import deque

    for sy in range(h):
        for sx in range(w):
            if not solid[sy, sx] or seen[sy, sx]:
                continue
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            cells = []
            while q:
                cy, cx = q.popleft()
                cells.append((cy, cx))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(cells) < min_texels:
                for cy, cx in cells:
                    a[cy, cx] = 0
    return Image.fromarray(a, "RGBA")


def _quantize(img: Image.Image, colors: int = 40) -> Image.Image:
    """
    색을 줄인다. 삽화의 매끈한 그라디언트가 도트 캐릭터 옆에서 튀는 걸 막는다.
    알파는 따로 보존한다 — 팔레트 양자화가 알파를 뭉개면 지평선이 깨진다.
    """
    src = _scrub_transparent(img)
    rgb = src.convert("RGB").quantize(colors=colors, dither=Image.NONE)
    out = rgb.convert("RGB").convert("RGBA")
    out.putalpha(img.getchannel("A"))
    return out


def median_lum(img: Image.Image) -> float:
    """불투명 텍셀의 **중앙** 명도(0~1, Rec.709).

    캐릭터 쪽(`tools/import_chars.py median_lum`)과 같은 계수·같은 통계를 쓴다 —
    두 숫자를 비교해서 "캐릭터가 배경보다 밝은가"를 테스트가 판정하므로, 한쪽이
    평균이고 한쪽이 중앙값이면 비교가 성립하지 않는다.
    """
    a = np.array(img.convert("RGBA"), dtype=np.float32)
    vis = a[a[:, :, 3] >= 128]
    if vis.size == 0:
        return 0.0
    lum = (0.2126 * vis[:, 0] + 0.7152 * vis[:, 1] + 0.0722 * vis[:, 2]) / 255.0
    return float(np.median(lum))


def process(name: str, raw_path: str, h_ratio: float):
    """
    raw → 타일 1장. 잘라 맞추지 않고 **종횡비를 그대로 들고 나간다**
    (타일 폭은 런타임이 이 비율에서 유도한다).

    목표 높이는 표시 높이 ÷ PX_PER_TEXEL이다. 폭이 아니라 **높이**로 거는 이유:
    표시 높이만 TS가 정하므로 밀도를 지배하는 축이 높이다.
    """
    src = Image.open(raw_path).convert("RGB")
    arr = np.array(src)
    alpha = _feather_edges(_key_sky(arr))
    sky_frac = float((alpha == 0).mean())
    rgba = np.dstack([_despill(arr, alpha), alpha])
    img = Image.fromarray(rgba, "RGBA")
    img = _trim_transparent(img)
    # 섞기·줄이기 **전에** 투명부 색을 없앤다. 프리멀티플라이로 가중치는 0이
    # 되지만, 알파가 아주 낮은 텍셀(a=8)은 나눗셈에서 그 색이 되살아난다.
    img = _scrub_transparent(img)
    img = _wrap_seam(img)
    target_h = max(8, round(REF_FIELD_H * h_ratio / PX_PER_TEXEL))
    if img.height > target_h:
        img = _downsample(img, max(8, round(img.width * target_h / img.height)))
    # 희미한 프린지는 **줄인 뒤에** 끊는다. 원본에서 끊으면 면적 평균이 그 값을
    # 다시 만들어 내므로 의미가 없다.
    img = _drop_faint(img)
    img = _quantize(img)
    # 양자화 **뒤에** 섬을 센다 — 양자화가 프린지를 한 색으로 뭉치면서 알파는
    # 그대로 남기므로, 먼저 지우면 남을 얼룩이 그 뒤에 다시 생긴다.
    img = _drop_islands(img)
    px_per_texel = (REF_FIELD_H * h_ratio) / img.height
    print(
        f"  · {name}: 하늘 {sky_frac * 100:.0f}% 지움 → {img.width}x{img.height}"
        f" | 타일폭 {round(img.width * px_per_texel)}px"
        f" | 텍셀당 {px_per_texel:.1f} design px"
    )
    if sky_frac < 0.05:
        print(f"    ! {name}: 하늘을 거의 못 지웠다 — 마젠타가 안 그려졌을 수 있다")
    return img


def build_atlas(theme: str, layers: dict[str, tuple[Image.Image, float]]):
    """
    테마 하나 = PNG 1장. far/mid/near를 세로로 쌓고 2px 여백을 둔다.

    region에 `ratio`(= `h_ratio`)를 같이 쓴다 — 표시 높이를 정하는 값이
    그림과 **같은 파일**에 있어야 한다. TS에 복사하면 갈라진다(위 SPECS 주석).

    `medLum`(중앙 명도)도 같이 쓴다. **캐릭터가 이 배경보다 밝은지**를 테스트가
    대조하는 데 쓴다 — 캐릭터가 배경보다 어두우면 실루엣이 배경에 녹아 구멍처럼
    보인다(실제로 그랬다: 캐릭터 0.16 vs 배경 0.25). 시드를 다시 굴려 밝은 배경이
    나오면 캐릭터 쪽 조건도 같이 올라가야 하므로, 숫자가 그림 옆에 있어야 한다.
    """
    order = ["far", "mid", "near"]
    pad = 2
    w = max(layers[k][0].width for k in order)
    h = sum(layers[k][0].height for k in order) + pad * (len(order) - 1)
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    regions = {}
    y = 0
    for k in order:
        im, ratio = layers[k]
        sheet.paste(im, (0, y))
        regions[k] = {
            "x": 0,
            "y": y,
            "w": im.width,
            "h": im.height,
            "ratio": ratio,
            "medLum": round(median_lum(im), 4),
        }
        y += im.height + pad
    name = f"scenery_{theme}"
    os.makedirs(PUB, exist_ok=True)
    sheet.save(os.path.join(PUB, f"{name}.png"))
    return name, {
        "url": f"assets/bg/{name}.png",
        "w": sheet.width,
        "h": sheet.height,
        "regions": regions,
    }


def merge_manifest(entries: dict):
    """
    `bg.json`을 **덮어쓰지 않고 합친다** — props 아틀라스는 `gen_bg.py`가 쓴다.
    두 도구가 같은 파일을 만들므로, 통째로 쓰면 상대 도구의 출력이 사라진다.
    """
    data = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            data = json.load(f)
    data.update(entries)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print(f"  ✓ {MANIFEST} 갱신 ({', '.join(sorted(entries))})")


def main(argv: list[str]):
    no_gen = "--no-gen" in argv
    only = [a for a in argv if not a.startswith("--")]
    picked = [s for s in SPECS if not only or s[0] in only]
    if not picked:
        print(f"이름이 없다. 가능: {', '.join(s[0] for s in SPECS)}")
        return 2
    made: dict[str, dict[str, tuple[Image.Image, float]]] = {}
    for name, prompt, h_ratio in picked:
        raw = os.path.join(RAW, f"{name}.png")
        if not no_gen:
            raw = generate(name, prompt)
        if not os.path.exists(raw):
            print(f"  ! {name} raw 없음 (--no-gen이면 먼저 생성해야 한다)")
            continue
        img = process(name, raw, h_ratio)
        theme, layer = name.split("_", 1)
        made.setdefault(theme, {})[layer] = (img, h_ratio)
        # 낱장도 남긴다 — 1:1로 눈으로 확인하는 게 유일한 판정이다
        os.makedirs(os.path.join(RAW, "out"), exist_ok=True)
        img.save(os.path.join(RAW, "out", f"{name}.png"))
    entries = {}
    for theme, layers in made.items():
        if len(layers) < 3:
            print(f"  · {theme}: 3겹이 안 모여 아틀라스는 건너뛴다 ({sorted(layers)})")
            continue
        n, e = build_atlas(theme, layers)
        entries[n] = e
    if entries:
        merge_manifest(entries)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
