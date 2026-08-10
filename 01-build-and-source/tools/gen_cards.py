#!/usr/bin/env python3
"""수집 카드 — 갤러리 삽화 5장을 **게임이 읽는 에셋**으로 굽는다.

`gen_gallery.py`는 사람이 보고 고르는 아카이브를 만든다(`~/assets/`, 528MB,
1024px 원본, 게임이 안 읽는다). 이 스크립트는 그중 **다섯 장면만 골라** 카드로
가공해 `public/`에 넣는다 — 게임이 런타임에 받는 것은 여기 산출물뿐이다.

**모델을 호출하지 않는다.** 그림은 이미 있다(`~/assets/portrait_gallery/`).
여기서 하는 일은 자르기·축소·양자화·실루엣 추출이므로, 돌려도 돈이 들지 않고
결과가 결정론적이다. 그래서 `gen_gallery.py`와 한 파일에 두지 않았다 —
저쪽을 한 번 돌리려면 140회 생성(비용·40분)을 감수해야 한다.

## 왜 세 장씩 굽는가 (`full` / `thumb` / `sil`)

한 장을 잘라 돌려 쓸 수 없다.

| 산출 | 쓰는 곳 | 크기 근거 |
|---|---|---|
| `full` | 카드 상세(탭하면 확대) | 320×560 — 화면 폭 720의 44%, 세로 4:7 |
| `thumb` | 카드함 격자 3열 | 110×147 — 격자 칸 폭에서 유도(3:4) |
| `sil` | **미획득 칸** | `thumb`과 같은 격자. 알파만 남긴 흰 실루엣 |

`full`을 격자에 축소해 쓰면 3열 21칸에 320px 텍스처 21장(=14MB 디코드)을
올린다. 반대로 `thumb`을 확대하면 얼굴이 안 읽힌다.

**실루엣을 런타임 필터로 만들지 않는 이유:** 미획득 칸은 원본 그림을 아예
받지 않아야 한다. 텍스처를 받아 놓고 흰색으로 덮으면 **네트워크 탭에 안 딴
카드가 다 보인다** — 수집의 의미가 없어진다. 실루엣은 0.8KB짜리 별도 파일이라
안 딴 카드의 그림은 클라이언트에 오지 않는다.

## 산출

    public/assets/cards/<slug>_<NN>.png        full 320×560
    public/assets/cards/<slug>_<NN>_t.png      thumb 110×147
    public/assets/cards/<slug>_<NN>_s.png      sil  110×147
    public/assets/cards/cards.json             매니페스트(런타임이 읽는다)

사용:

    python3 tools/gen_cards.py                 # 7종 × 5장
    python3 tools/gen_cards.py fire_knight     # 한 캐릭터만
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(HERE, "..", "public", "assets", "cards")
MANIFEST = os.path.join(PUB, "cards.json")

#: 갤러리 아카이브. `gen_gallery.OUT`과 같은 자리 — 같은 환경변수로 덮는다
GALLERY = os.environ.get(
    "PVP_GALLERY_OUT", os.path.expanduser("~/assets/portrait_gallery")
)

# ── 다섯 장면. **20장 중에서 고른 것이다**
#
# 고른 기준은 세 가지다.
#
# 1. **7/7 전원이 성공한 장면.** `index.json`에서 확인했다 — `beach`는
#    `crystal_mauler`가 필터 거절이라(같은 프롬프트 3회) 그 캐릭터만 4장이 된다.
#    카드는 "n/35"로 세는 물건이라 캐릭터마다 장 수가 다르면 진행률이 깨진다.
# 2. **원본이 9:16.** 카드는 세로다(`full` 4:7). 1:1 원본을 세로로 자르면 인물이
#    화면 밖으로 나가거나(`poolside`는 앉은 자세라 가로로 넓다) 위아래 여백만
#    남는다. 20장 중 9:16이 10장이고 그중에서 골랐다.
# 3. **서로 다른 계절·시간대·실내외.** 다섯 장이 다 여름 낮이면 다섯 장이
#    아니다 — 온천(황혼) · 축제(밤) · 꽃밭(봄 낮) · 신사(겨울) · 연습실(실내).
#
# 순서가 곧 카드 번호(01~05)다. 바꾸면 이미 딴 카드의 번호가 밀린다 —
# `localStorage`에 번호로 저장하므로 **순서를 고치면 안 된다.** 늘릴 때는 뒤에 붙인다.
SCENES: list[tuple[str, str]] = [
    ("03_onsen_town", "온천 마을"),
    ("04_festival", "여름 축제"),
    ("09_flower_field", "꽃밭"),
    ("16_shrine_newyear", "새해 신사"),
    ("18_dance_studio", "연습실"),
]

#: 카드 상세 크기(디자인 px). 세로 4:7 — 화면(9:16)보다 살짝 통통해야 좌우 여백이 남는다
FULL_W, FULL_H = 320, 560
#: 격자 칸 크기. 3:4 — 얼굴 위주라 세로를 덜 쓴다
THUMB_W, THUMB_H = 110, 147
#: 색 수. `gen_portraits._quantize`와 같은 48색 — 인물 피부 그라데이션이 40색에서 볼에 띠로 남는다
COLORS = 48
#: 실루엣 알파 문턱. 반투명 머리카락 끝을 실루엣에 넣을지 정한다
SIL_ALPHA = 110


def _crop_ratio(im: Image.Image, ratio: float) -> Image.Image:
    """가운데를 기준으로 `ratio`(= w/h) 비율로 자른다.

    **위에서 자른다, 가운데가 아니다** — 세로로 긴 원본을 더 세로로 자를 때
    가운데를 남기면 머리가 잘린다. 인물의 얼굴은 위쪽에 있다.
    """
    w, h = im.size
    want_h = int(round(w / ratio))
    if want_h <= h:
        return im.crop((0, 0, w, want_h))
    want_w = int(round(h * ratio))
    x = (w - want_w) // 2
    return im.crop((x, 0, x + want_w, h))


def _silhouette(cut: Image.Image, w: int, h: int) -> Image.Image:
    """알파만 남긴 흰 실루엣.

    RGB를 흰색으로 **덮는다** — 원본 색을 남기면 파일에 그림이 그대로 들어가서
    미획득 카드의 그림이 클라이언트에 도착한다(docstring "실루엣을 런타임
    필터로 만들지 않는 이유"). 흰색이므로 런타임에서 `tint`로 아무 색이나 된다.
    """
    a = np.array(cut.convert("RGBA").resize((w, h), Image.LANCZOS))[..., 3]
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = 255
    out[..., 3] = np.where(a >= SIL_ALPHA, 255, 0)
    return Image.fromarray(out)


def build(slugs: list[str]) -> None:
    os.makedirs(PUB, exist_ok=True)
    manifest: dict[str, list[dict]] = {}
    missing: list[str] = []

    for slug in slugs:
        cards: list[dict] = []
        for i, (scene, title) in enumerate(SCENES, 1):
            raw_p = os.path.join(GALLERY, slug, f"{scene}.png")
            cut_p = os.path.join(GALLERY, slug, f"{scene}_cut.png")
            if not (os.path.exists(raw_p) and os.path.exists(cut_p)):
                # **빈 자리를 다른 그림으로 메우지 않는다.** 다섯 장 중 하나가
                # 없으면 그 칸은 없는 것이고, 로그가 이유를 말한다
                missing.append(f"{slug}/{scene}")
                continue
            raw = Image.open(raw_p).convert("RGB")
            cut = Image.open(cut_p)
            num = f"{i:02d}"

            full = _crop_ratio(raw, FULL_W / FULL_H).resize(
                (FULL_W, FULL_H), Image.LANCZOS
            )
            full = full.quantize(colors=COLORS, dither=Image.NONE)
            full_name = f"{slug}_{num}.png"
            full.save(os.path.join(PUB, full_name), optimize=True)

            th_src = _crop_ratio(raw, THUMB_W / THUMB_H)
            thumb = th_src.resize((THUMB_W, THUMB_H), Image.LANCZOS).quantize(
                colors=COLORS, dither=Image.NONE
            )
            thumb_name = f"{slug}_{num}_t.png"
            thumb.save(os.path.join(PUB, thumb_name), optimize=True)

            sil = _silhouette(
                _crop_ratio(cut, THUMB_W / THUMB_H), THUMB_W, THUMB_H
            )
            sil_name = f"{slug}_{num}_s.png"
            sil.save(os.path.join(PUB, sil_name), optimize=True)

            # 실루엣이 비면(알파 0%) 미획득 칸이 **빈 사각형**이 된다 — 카드가
            # 있다는 것도 안 읽힌다. 테스트가 잡게 비율을 남긴다
            silRatio = float(
                (np.array(sil)[..., 3] > 0).mean()
            )
            cards.append(
                {
                    "id": f"{slug}_{num}",
                    "no": i,
                    "scene": scene,
                    "title": title,
                    "full": f"assets/cards/{full_name}",
                    "thumb": f"assets/cards/{thumb_name}",
                    "sil": f"assets/cards/{sil_name}",
                    "fullW": FULL_W,
                    "fullH": FULL_H,
                    "thumbW": THUMB_W,
                    "thumbH": THUMB_H,
                    "silRatio": round(silRatio, 4),
                }
            )
            print(f"  {slug}/{num} {title} sil={silRatio * 100:.0f}%")
        if cards:
            manifest[slug] = cards

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    total = sum(len(v) for v in manifest.values())
    print(f"\n{MANIFEST} — {len(manifest)}종 / 카드 {total}장")
    if missing:
        # 조용히 넘기지 않는다 (메모리 `[[no-silent-caps]]`)
        print(f"빠진 그림 {len(missing)}장: {', '.join(missing)}", file=sys.stderr)


def main() -> None:
    index_p = os.path.join(GALLERY, "index.json")
    if not os.path.exists(index_p):
        print(
            f"갤러리가 없다: {index_p}\n"
            "먼저 `python3 tools/gen_gallery.py`를 돌려라 (또는 PVP_GALLERY_OUT을 세워라)",
            file=sys.stderr,
        )
        raise SystemExit(1)
    with open(index_p, encoding="utf-8") as f:
        index = json.load(f)
    all_slugs = sorted({row["slug"] for row in index})
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    slugs = args or all_slugs
    unknown = [s for s in slugs if s not in all_slugs]
    if unknown:
        raise SystemExit(f"갤러리에 없는 슬러그: {', '.join(unknown)}")
    build(slugs)


if __name__ == "__main__":
    main()
