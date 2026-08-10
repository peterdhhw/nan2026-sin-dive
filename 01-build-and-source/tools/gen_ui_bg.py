#!/usr/bin/env python3
"""
UI 배경(키 아트) 생성 — 로딩(S0)·타이틀(S1)의 **한 장짜리 전면 배경**.

`gen_bg_art.py`(전투 필드의 패럴랙스 3겹)와 왜 다른 도구인가:

- 필드 배경은 **무한 스크롤 띠**다. 좌우 이음새를 맞추고(`_wrap_seam`)
  하늘을 지워(`_key_sky`) 코드가 그린 그라디언트 위에 얹는다. 그 그림을
  로딩 화면에 그대로 깔면 타일 두 장이 이어진 자리와 떠 있는 천체·프롭이
  같이 나오는데, 그게 "덜 만든 것처럼" 보인 원인이다 — 실제로 그렇다:
  그 무대는 캐릭터가 달리는 전투용이고 로딩 화면은 정지 화면이다.
- 그래서 여기서는 **9:16 한 장**을 그린다. 잘라 붙이지 않고, 하늘도 지우지
  않는다(스크롤도 반전도 없으므로 그림에 하늘이 있어도 안전하다).

## 왜 세로(9:16)인가

화면이 720×1280(0.5625)이다. 21:9 띠를 늘려 채우면 3.6배로 늘어나 도트가
가로로 찢어진다. SD3.5는 9:16(768×1344 = 0.571)을 직접 그리므로 거의 그대로
덮인다 — 짧은 축을 채우는 cover 배율이 1.0에 가깝다(`uiBackdropRules`).

## 구도를 프롬프트로 못박는 이유

로딩 화면은 위젯 자리가 정해져 있다(로고 38%, 바 62%, 팁 84%). 그 띠에
디테일이 몰리면 글자가 그림에 먹힌다 — 실제로 그랬다(캡처에서 `이펙트
불러오는 중 19%`가 폐허 기둥에 걸려 반쯤 사라졌다). 그래서 "가운데는 비우고
디테일은 위아래 가장자리로" 를 프롬프트에 넣는다. 어둡게 덮는 것으로는
해결되지 않는다: 덮으면 그림도 같이 사라져서 배경을 새로 뽑은 의미가 없다.

## 도트로 읽히게 하는 후처리

캐릭터는 58px 원본을 ≈230px로 띄운다. 배경만 매끈하면 "UI만 고해상도"가 된다.
`gen_bg_art.py`와 **같은 텍셀 밀도 상수**를 쓴다(`PX_PER_TEXEL = 2.5`) — 두
도구가 다른 밀도를 쓰면 같은 화면에서 배경 두 장의 도트 크기가 다르다.

사용법:
    python3 tools/gen_ui_bg.py               # 전부
    python3 tools/gen_ui_bg.py boot          # 하나만 (프롬프트 실험용)
    python3 tools/gen_ui_bg.py --no-gen      # 캐시된 raw로 후처리만 다시
    python3 tools/gen_ui_bg.py boot --seed 7 # 시드만 바꿔 다시 뽑는다
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
RAW = os.path.join(HERE, "..", ".cache", "ui_bg_raw")
MANIFEST = os.path.join(PUB, "ui.json")

MODEL = "stability.sd3-5-large-v1:0"
REGION = "us-west-2"

# 디자인 해상도. 후처리 목표 크기를 여기서 유도한다 (`viewport.ts`와 같은 값).
DESIGN_W = 720
DESIGN_H = 1280

# 텍셀 하나가 화면에서 차지하는 design px. `gen_bg_art.PX_PER_TEXEL`과 같아야
# 한다 — 한 화면에 두 도구의 그림이 같이 나오는 경우(타이틀의 캐릭터 프리뷰가
# 필드 삽화 위에 서던 시절)에 도트 크기가 갈리면 둘 중 하나가 저해상도로 보인다.
PX_PER_TEXEL = 2.5

# 공통 스타일. `gen_bg_art.STYLE`에서 하늘 키잉 지시(마젠타)만 뺀 것이다 —
# 여기서는 하늘을 지우지 않으므로 그 요구가 오히려 그림을 망친다.
#
# 직업명사·인물 서술은 여기도 넣지 않는다. 넣으면 인물이 그려지고, 타이틀은
# 그 자리에 **우리 캐릭터 스프라이트**가 선다(두 사람이 겹친다).
STYLE = (
    "2D game key art background, hand-painted pixel art, dark fantasy mood, "
    "muted desaturated palette, no characters, no people, no creatures, "
    "no text, no logo, no ui, scenery only"
)
NEG = (
    "photorealistic, 3d render, text, letters, watermark, signature, ui, hud, "
    "frame, border, people, character, person, figure, face, animal, "
    "busy center, clutter, blurry, depth of field, lens flare, vignette"
)

# ── 스펙
#
# `ground_ratio` = 그림의 지평선 y ÷ 높이. 타이틀의 캐릭터 프리뷰가 이 선에
# 발을 붙인다 — **매니페스트에 써서 런타임이 읽는다**(TS에 복사하면 그림을
# 다시 뽑아 지평선이 옮겨가도 캐릭터는 옛 자리에 뜬다).
#
# 로딩 화면은 캐릭터가 없으므로 지평선을 쓰지 않는다. 그래도 값을 적는 이유는
# 매니페스트 스키마를 한 벌로 두기 위한 것이다(런타임은 title만 읽는다).
SPECS = [
    (
        "boot",
        "boot",
        # 로딩 화면. 위젯이 38%~89%를 쓰므로 **가운데를 비운다**.
        # "abyss"만 부르면 SD가 화면을 꽉 채운 폐허를 그린다 — 빈 공간을
        # 명사로 요구해야(void, empty darkness) 그 띠가 생긴다.
        "looking straight down into a vast bottomless abyss, "
        "huge empty void of deep darkness filling the center of the frame, "
        "jagged rock walls only along the left and right edges, "
        "faint cold indigo light from far below at the very bottom, "
        "vertical composition, symmetrical, calm, minimal, "
        "empty dark middle, detail only at the edges",
        0.88,
    ),
    (
        "title",
        "title",
        # 타이틀. 캐릭터가 66%에 서므로 **지평선을 그 자리에** 요구한다.
        # 아래 1/3은 조용해야 한다(버튼 셋이 72%~93%에 있다).
        "a wide stone cliff ledge in the lower third of the frame, "
        "horizon line two thirds down the image, "
        "behind it a colossal dark chasm opening in a dead forest valley, "
        "twilight sky with thin cold clouds in the upper third, "
        "plain flat empty stone ground in the bottom third, "
        "vertical composition, wide open space, quiet, minimal",
        0.66,
    ),
]

# 시드. 뽑아 놓고 눈으로 골랐다 — 값 자체에 의미는 없고, **바뀌면 그림이
# 바뀐다**는 것이 의미다(캡처로 판정한 결과를 이 숫자가 고정한다).
SEEDS = {"boot": 4102, "title": 7731}


def _client():
    return boto3.client("bedrock-runtime", region_name=REGION)


def generate(name: str, prompt: str, seed: int) -> str:
    """SD3.5 호출 → raw PNG 경로. 이미 있으면 그대로 쓴다(스로틀·비용)."""
    os.makedirs(RAW, exist_ok=True)
    dst = os.path.join(RAW, f"{name}_{seed}.png")
    if os.path.exists(dst):
        print(f"  · {name} raw 캐시 사용 (seed {seed})")
        return dst
    body = {
        "prompt": f"{prompt}, {STYLE}",
        "negative_prompt": NEG,
        # 9:16 = 768x1344. 화면(0.5625)에 가장 가까운 SD3.5 비율이다
        "aspect_ratio": "9:16",
        "mode": "text-to-image",
        "output_format": "png",
        "seed": seed,
    }
    br = _client()
    for attempt in range(4):
        try:
            r = br.invoke_model(modelId=MODEL, body=json.dumps(body))
            out = json.loads(r["body"].read())
            with open(dst, "wb") as f:
                f.write(base64.b64decode(out["images"][0]))
            print(f"  ✓ {name} 생성 (seed {seed})")
            return dst
        except Exception as e:  # noqa: BLE001
            if "Throttl" in str(e) or "TooMany" in str(e):
                time.sleep(2**attempt)
                continue
            raise
    raise SystemExit(f"{name}: 4번 던졌는데 스로틀만 돌아왔다")


def _downsample(img: Image.Image, target_w: int) -> Image.Image:
    """
    BOX 축소. 알파가 없으므로(전면 배경은 불투명) 프리멀티플라이가 필요 없다 —
    `gen_bg_art._downsample`이 그것을 하는 이유는 지평선 위가 투명해서다.
    """
    h = max(1, round(img.height * target_w / img.width))
    return img.resize((target_w, h), Image.BOX)


def _quantize(img: Image.Image, colors: int = 40) -> Image.Image:
    """
    색을 줄인다 — 매끈한 그라디언트가 도트 캐릭터 옆에서 튀는 걸 막는다.
    색 수는 `gen_bg_art._quantize`와 같은 40이다(두 배경이 같은 화면에 뜬다).
    """
    return img.convert("RGB").quantize(colors=colors, dither=Image.NONE).convert("RGB")


def median_lum(img: Image.Image) -> float:
    """
    중앙 명도(0~1, Rec.709). `gen_bg_art.median_lum`·`import_chars.median_lum`과
    같은 계수·같은 통계다 — **캐릭터가 이 배경보다 밝은가**를 테스트가 대조하는데
    한쪽이 평균이고 한쪽이 중앙값이면 비교가 성립하지 않는다.
    """
    a = np.array(img.convert("RGB"), dtype=np.float32)
    lum = (0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]) / 255.0
    return float(np.median(lum))


def band_lum(img: Image.Image, y0: float, y1: float) -> float:
    """
    가로 띠 하나의 중앙 명도. **위젯이 앉는 띠가 얼마나 밝은지**를 재려고 있다.
    전체 중앙값만 보면 가운데가 하얗게 밝아도 통과한다(가장자리가 어두우므로).
    """
    a = np.array(img.convert("RGB"), dtype=np.float32)
    h = a.shape[0]
    seg = a[int(h * y0) : max(int(h * y0) + 1, int(h * y1))]
    lum = (0.2126 * seg[:, :, 0] + 0.7152 * seg[:, :, 1] + 0.0722 * seg[:, :, 2]) / 255.0
    return float(np.median(lum))


def process(name: str, raw_path: str) -> Image.Image:
    """
    raw → 전면 배경 1장.

    목표 폭은 **디자인 폭 ÷ 텍셀당 px**에서 유도한다(720 / 2.5 = 288). 폭을
    직접 적으면 텍셀 밀도가 조용히 달라진다 — `gen_bg_art`와 같은 규칙이다.
    자르지 않는다: 종횡비가 이미 화면과 거의 같고, cover 배율은 런타임이
    매니페스트의 w/h에서 계산한다(`uiBackdropRules.backdropCover`).
    """
    src = Image.open(raw_path).convert("RGB")
    img = _downsample(src, max(8, round(DESIGN_W / PX_PER_TEXEL)))
    img = _quantize(img)
    px_per_texel = DESIGN_W / img.width
    print(
        f"  · {name}: {src.width}x{src.height} → {img.width}x{img.height}"
        f" | 텍셀당 {px_per_texel:.1f} design px"
        f" | 중앙명도 {median_lum(img):.3f}"
    )
    return img


def main(argv: list[str]) -> int:
    no_gen = "--no-gen" in argv
    seed_override = None
    if "--seed" in argv:
        seed_override = int(argv[argv.index("--seed") + 1])
    only = [a for a in argv if not a.startswith("--") and not a.isdigit()]
    picked = [s for s in SPECS if not only or s[0] in only]
    if not picked:
        print(f"이름이 없다. 가능: {', '.join(s[0] for s in SPECS)}")
        return 2

    entries: dict[str, dict] = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            entries = json.load(f)

    for name, key, prompt, ground_ratio in picked:
        seed = seed_override if seed_override is not None else SEEDS[name]
        raw = os.path.join(RAW, f"{name}_{seed}.png")
        if not no_gen:
            raw = generate(name, prompt, seed)
        if not os.path.exists(raw):
            print(f"  ! {name} raw 없음 (--no-gen이면 먼저 생성해야 한다)")
            continue
        img = process(name, raw)
        os.makedirs(PUB, exist_ok=True)
        out = f"ui_{name}.png"
        img.save(os.path.join(PUB, out))
        entries[key] = {
            "url": f"assets/bg/{out}",
            "w": img.width,
            "h": img.height,
            "groundRatio": ground_ratio,
            "medLum": round(median_lum(img), 4),
            # 위젯 띠 명도. 로고·바·버튼이 앉는 곳이 밝으면 글자가 먹힌다 —
            # 테스트가 이 값으로 "그 띠는 어둡다"를 강제한다(§캡처로 판정하되
            # 회귀는 숫자로 잡는다).
            "midLum": round(band_lum(img, 0.30, 0.70), 4),
            # 바닥 띠. **`midLum`이 못 재는 자리다** — 두 그림 다 아래쪽 협곡
            # 바닥이 가장 밝은데 30~70% 밖이라 그 지표가 침묵했고, 로딩의
            # 팁(84%)·타이틀의 요약(93%)이 거기 앉아 캡처에서 먹혔다. 런타임은
            # 이 자리에만 스크림을 깐다(`footerScrimBands`)
            "lowLum": round(band_lum(img, 0.80, 1.00), 4),
        }

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print(f"  ✓ {MANIFEST} 갱신 ({', '.join(sorted(entries))})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
