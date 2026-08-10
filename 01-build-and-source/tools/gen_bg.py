#!/usr/bin/env python3
"""배경 프롭·천체 아틀라스 생성기 (지면 장식·구름·균열).

설계 문서: specs/2026-07-27-ux/07-scene-battle.md §2 (BackgroundStage),
          specs/2026-07-27-ux/01-art-direction.md §5 (에셋 라이선스 정책)

**AI 이미지 생성을 쓰지 않는다.** Kenney의 CC0 팩(`tools/fetch_assets.sh`가
받아 둔 것)에서 형태만 가져와 **단색 실루엣으로 변환**하고, 우리 게임에만
있는 작은 것(자갈·수정·균열)만 PIL로 직접 그린다.

여기 있는 것들은 **지면 위에 놓는 작은 개체**다. 단색+런타임 `tint`가 맞다:
  - 크기가 작아서(28~168px) 색을 그려 넣어도 안 보인다.
  - 테마별로 색만 다르면 되고(풀=연두 / 수정=보라), 개체를 결정론으로
    뿌리는 쪽이 그림 한 장보다 자연스럽다.

**배경 삽화(원경·중경·근경)는 여기 없다.** `tools/gen_bg_art.py`가 SD3.5로
테마별로 그린다. 예전에는 실루엣 10종을 여기서 만들어 뿌렸는데, 나무 5그루가
흩어진 그림밖에 안 나오고 지상·심연이 "같은 나무의 tint만 다른 것"이 됐다 —
그게 배경이 허접했던 원인이다.

실루엣화는 파생물(derivative)이므로 CC0가 아닌 소스는 절대 쓰지 않는다 —
전파 조건이 있는 라이선스(CC-BY-SA)는 변형물에도 따라붙는다.

사용: python3 tools/gen_bg.py
출력: public/assets/bg/props.png + bg.json (삽화 항목은 건드리지 않는다)
결정론적이다 — 같은 소스에서 항상 같은 아틀라스가 나온다.
"""
from __future__ import annotations

import json
import math
import os

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public", "assets", "bg")

# fetch_assets.sh가 풀어 둔 위치. 없으면 즉시 실패한다 — 조용히 빈 아틀라스를
# 내보내면 런타임에 배경이 사라진 이유를 찾느라 시간을 버린다.
SRC = os.path.expanduser("~/asset-research/extracted")
BG_PACK = os.path.join(SRC, "kenney_background-elements", "PNG", "Flat")
FOLIAGE = os.path.join(SRC, "kenney_foliage-sprites", "PNG", "Flat")

# 아틀라스 폭은 고정, 높이는 선반 패킹 결과에서 정한다.
# 512로 잡는다. 256이면 선반이 3줄이 되어 높이가 512로 올라가고,
# 512면 2줄 → 256이라 텍스처 메모리가 절반이다 (같은 내용, 같은 픽셀)
PROP_ATLAS_W = 512
# 구름·균열의 최대 변. 프롭은 필드 높이의 5.5~20%로만 뜨므로 이 이상은 안 보인다
PROP_MAX = 128
# 여백 — 이웃 region의 픽셀이 선형 보간으로 새는 것을 막는다
PAD = 2


def load(path: str) -> Image.Image:
    if not os.path.isfile(path):
        raise SystemExit(
            f"소스 에셋이 없다: {path}\n먼저 tools/fetch_assets.sh 를 실행할 것."
        )
    return Image.open(path).convert("RGBA")


def silhouette(img: Image.Image, max_side: int) -> Image.Image:
    """알파만 남긴 흰색 실루엣. RGB를 흰색으로 밀어 런타임 tint가 그대로 색이 된다."""
    bbox = img.getchannel("A").getbbox()
    if bbox is not None:
        img = img.crop(bbox)
    # 축소를 먼저 한다 — 알파 경계가 부드러워져 계단이 덜 보인다
    k = max_side / max(img.width, img.height)
    if k < 1:
        img = img.resize(
            (max(1, round(img.width * k)), max(1, round(img.height * k))),
            resample=Image.LANCZOS,
        )
    alpha = img.getchannel("A")
    # 8 이하의 잔여 알파는 버린다. 남겨두면 tint된 뒤 사각형 테두리로 보인다
    alpha = alpha.point(lambda v: 0 if v <= 8 else v)
    out = Image.new("RGBA", img.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    white = Image.new("RGBA", img.size, (255, 255, 255, 255))
    white.putalpha(alpha)
    return white


def draw_pebble() -> Image.Image:
    """지면 자갈. 받아올 데가 없는 작은 도형은 코드로 그린다."""
    im = Image.new("RGBA", (28, 18), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([1, 4, 20, 17], fill=(255, 255, 255, 255))
    d.ellipse([13, 7, 27, 17], fill=(255, 255, 255, 255))
    return im


def draw_crystal() -> Image.Image:
    """심연 지면의 수정 조각 — 위로 뾰족한 육각 기둥."""
    im = Image.new("RGBA", (26, 52), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    d.polygon(
        [(13, 0), (24, 20), (21, 50), (5, 50), (2, 20)],
        fill=(255, 255, 255, 255),
    )
    return im


#: 균열이 쓸 수 있는 알파 — `gen_effects.py`의 `ALPHA_STEPS`와 같은 이유다.
#: 연속 감쇠는 확대하면 그라디언트로 되살아난다.
CRACK_ALPHA_STEPS = (0, 90, 160, 255)

#: 균열의 저해상도 격자 → 최종 배율. 캐릭터·이펙트의 확대 배율과 맞춘다
CRACK_UPSCALE = 4


def draw_crack() -> Image.Image:
    """심연 하늘의 보라 균열. 가운데가 밝은 세로 번개 형태 — 런타임에서 가산 합성한다.

    **블러를 쓰지 않는다 (2026-08-07).** 예전 판은 `GaussianBlur(1.6)`로 끝났고,
    산출물의 보이는 픽셀 중 **59%가 알파 128 아래**(평균 103)였다. 화면에서 그
    결과는 균열이 아니라 하늘에 번진 보라 얼룩이다 — 가산 합성이라 면적이 곧
    밝기가 되어 형태가 사라진다. 이펙트 생성기가 같은 실패를 먼저 겪고 규칙을
    셋으로 정리해 뒀다(`gen_effects.py` 머리주석): 저해상도 격자에 그리고,
    NEAREST로 확대하고, 알파는 단계값만 쓴다. 균열도 같은 화면에 있으므로
    같은 규칙을 따라야 한다 — 안 그러면 해상도가 다른 그림 두 벌이 섞인다.

    밝기 단계는 알파로 만든다(런타임 `tint` 한 색을 곱하므로 색으로는 못 나눈다):
    심(중심선) 255 → 몸통 160 → 가지 90. 세 단계면 "가운데가 밝다"가 읽히고,
    그 이상은 확대 뒤 구분이 안 된다.
    """
    w, h = 56, 168
    n_w, n_h = w // CRACK_UPSCALE, h // CRACK_UPSCALE  # 14 × 42
    im = Image.new("RGBA", (n_w, n_h), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)

    # 지그재그 중심선. 결정론이어야 하므로 난수 대신 사인 합으로 흔든다.
    # 좌표를 정수로 스냅한다 — 소수 좌표는 확대 전 격자에서 이웃 칸으로 새고,
    # 그러면 폭 1의 심이 두 칸에 걸쳐 흐려진다
    pts = []
    for i in range(13):
        t = i / 12
        x = n_w / 2 + math.sin(t * 7.3) * (11 / CRACK_UPSCALE) + math.sin(t * 17.1) * (
            5 / CRACK_UPSCALE
        )
        pts.append((round(x), round(t * (n_h - 1))))

    # 몸통(중간 밝기) 먼저, 심(최대)을 그 위에. 순서가 뒤면 심이 덮인다
    d.line(pts, fill=(255, 255, 255, CRACK_ALPHA_STEPS[2]), width=3, joint="curve")
    d.line(pts, fill=(255, 255, 255, CRACK_ALPHA_STEPS[3]), width=1, joint="curve")

    # 가지 2개 — 한 줄만 있으면 균열이 아니라 막대로 보인다. 가장 어두운 단계다:
    # 몸통과 같은 밝기면 가지가 또 하나의 균열로 읽힌다.
    # 폭은 2다 — 1이면 격자에서 한 칸(확대 후 4px)이고, 어두운 단계까지 겹쳐서
    # 하늘에 얹으면 가지가 사라진다(가산 합성 근사로 나란히 구워 확인했다)
    for start, end, dx in ((3, 6, -15), (7, 10, 16)):
        branch = [pts[start]]
        for j in range(start + 1, end + 1):
            f = (j - start) / (end - start)
            branch.append(
                (
                    round(pts[j][0] + (dx / CRACK_UPSCALE) * f),
                    round(pts[j][1] + (6 / CRACK_UPSCALE) * f),
                )
            )
        d.line(branch, fill=(255, 255, 255, CRACK_ALPHA_STEPS[1]), width=2, joint="curve")

    # NEAREST 확대 — 픽셀 하나가 4×4 블록이 된다. 여기서 보간을 쓰면 위의
    # 모든 노력이 지워진다
    return im.resize((w, h), resample=Image.NEAREST)


def build_props() -> dict[str, Image.Image]:
    f = lambda n: os.path.join(FOLIAGE, n)  # noqa: E731
    p = lambda n: os.path.join(BG_PACK, n)  # noqa: E731
    return {
        # 풀 뭉치 3종 (Kenney foliage — 1024² 캔버스라 알파 bbox로 잘라낸다)
        "tuft_a": silhouette(load(f("sprite_0001.png")), 56),
        "tuft_b": silhouette(load(f("sprite_0005.png")), 56),
        "tuft_c": silhouette(load(f("sprite_0011.png")), 56),
        "pebble": draw_pebble(),
        "crystal": draw_crystal(),
        "cloud_a": silhouette(load(p("cloud1.png")), PROP_MAX),
        "cloud_b": silhouette(load(p("cloud5.png")), PROP_MAX),
        "crack": draw_crack(),
    }


def pack(images: dict[str, Image.Image], atlas_w: int) -> tuple[Image.Image, dict]:
    """선반(shelf) 패킹. region이 10개 남짓이라 정교한 패커가 필요 없다.

    키 순서로 넣으면 재실행 시 배치가 흔들려 커밋 diff가 커진다 —
    **높이 내림차순 + 이름 오름차순**으로 고정해 결정론을 보장한다.
    """
    order = sorted(images.keys(), key=lambda k: (-images[k].height, k))
    regions: dict[str, dict] = {}
    x = y = row_h = 0
    for key in order:
        im = images[key]
        if x + im.width + PAD > atlas_w:
            x = 0
            y += row_h + PAD
            row_h = 0
        regions[key] = {"x": x, "y": y, "w": im.width, "h": im.height}
        x += im.width + PAD
        row_h = max(row_h, im.height)
    total_h = y + row_h
    # 2의 거듭제곱까지 올린다 — 밉맵·일부 드라이버에서 안전하다
    atlas_h = 1 << (total_h - 1).bit_length() if total_h > 0 else 1
    sheet = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    for key in order:
        r = regions[key]
        sheet.alpha_composite(images[key], (r["x"], r["y"]))
    # JSON은 이름 순으로 쓴다 (사람이 읽기 위해서 — 배치는 이미 확정됐다)
    return sheet, {k: regions[k] for k in sorted(regions)}


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for name, images, atlas_w in (("props", build_props(), PROP_ATLAS_W),):
        sheet, regions = pack(images, atlas_w)
        path = os.path.join(OUT_DIR, f"{name}.png")
        sheet.save(path)
        manifest[name] = {
            "url": f"assets/bg/{name}.png",
            "w": sheet.width,
            "h": sheet.height,
            "regions": regions,
        }
        print(f"wrote {path} ({sheet.width}x{sheet.height}, {len(regions)} regions)")

    # **덮어쓰지 않고 합친다** — 같은 파일에 `gen_bg_art.py`가 삽화 아틀라스를
    # 쓴다. 통째로 쓰면 상대 도구의 출력이 조용히 사라지고, 그러면 배경 3겹이
    # 전부 안 그려진 채 하늘만 남는다.
    out = os.path.join(OUT_DIR, "bg.json")
    data = {}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fp:
            data = json.load(fp)
    # 합치기만 하면 폐기한 아틀라스가 영원히 남는다(`silhouette`이 그랬다).
    # png가 없는 항목은 지운다 — 런타임이 404를 먹고 경고만 남기므로
    # 매니페스트만 보고는 죽은 항목을 알 수 없다.
    data = {
        k: v
        for k, v in data.items()
        if os.path.exists(os.path.join(OUT_DIR, f"{k}.png"))
    }
    data.update(manifest)
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(data, fp, indent=2, ensure_ascii=False, sort_keys=True)
        fp.write("\n")
    print(f"wrote {out} ({', '.join(sorted(data))})")


if __name__ == "__main__":
    main()
