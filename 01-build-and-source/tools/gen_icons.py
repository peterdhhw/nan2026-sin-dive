#!/usr/bin/env python3
"""스킬 아이콘 아틀라스 생성기 (7종 자작).

설계 문서: specs/2026-07-27-ux/02-components.md §C4,
          specs/2026-07-27-ux/07-scene-battle.md §7

**받을 데가 없어서 직접 그린다.** 스킬 개념이 우리 고유라 CC0 팩에 대응물이
없다. AI 생성도 쓰지 않는다(§01-5) — 대신 검·교차·파열·사슬·눈·화살표라는
**단순한 기하 형태**로 만든다. 슬롯 안에서 지름 60px로 보이는 아이콘이므로
디테일이 들어갈 자리가 애초에 없다.

4종 → 6종 → 7종으로 늘려 왔다. 늘어난 이유는 매번 같다: **공격 칸이 아이콘을
공유하면 그 칸들이 같은 그림이 되어 라벨을 읽어야 무엇인지 알게 되고, 그건
아이콘의 존재 이유와 반대다.** 6종은 공격 3칸까지였고, 네 번째 공격 칸이
생기면서 `skill_ult`가 붙었다.
(`skillSlotRules.iconRegionFor`가 쿨다운 세 문턱과 방해 종류로 갈라 준다.)

색은 런타임 `tint`로 넣지 않는다. 흰색 단색 실루엣이면 슬롯 안쪽 색과
명도가 붙어 형태가 사라지는데, 아이콘은 배경 위가 아니라 **색 원 안**에
놓이기 때문이다. 대신 흰색 + 어두운 아웃라인 2톤으로 그려서 어떤 kind
색 위에서도 형태가 읽히게 한다.

사용: python3 tools/gen_icons.py
출력: public/assets/icons/skills.png + icons.json
결정론적이다 — 난수를 쓰지 않으므로 항상 같은 바이트가 나온다.
"""
from __future__ import annotations

import json
import math
import os

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "public", "assets", "icons")

# 셀 하나의 크기. 슬롯 지름의 약 60%로 쓰이므로 128이면 2배 이상 여유가 있다.
CELL = 128
ATLAS_W = 512
# region 사이 여백이 **0이어도 안전하다**: 아이콘은 셀 안쪽 14~114 범위에만
# 그려지므로 좌우에 이미 14px 이상의 투명 여백이 있고, 선형 보간이 이웃
# region의 픽셀을 물어올 수 없다.
#
# 6종이 되면서 두 줄(512×256)이 되었다 — 한 줄에 4개까지다. 여백을 주면
# 한 줄에 3개만 들어가 세 줄(512×512)로 또 뛴다. 없어도 안전한 여백을
# 넣어서 텍스처를 두 배로 쓸 이유가 없다. 7종도 두 줄에 그대로 든다(4+3).
PAD = 0

# 흰 본체 + 어두운 아웃라인 2톤. UI_OUTLINE(#211c2e)과 같은 값이다 —
# 아이콘만 다른 어두운색을 쓰면 슬롯 테두리와 톤이 어긋난다.
BODY = (255, 255, 255, 255)
SHADE = (196, 186, 224, 255)
LINE = (33, 28, 46, 255)


def blank() -> Image.Image:
    return Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))


def outlined_polygon(d: ImageDraw.ImageDraw, pts, fill, width: int = 6) -> None:
    """면을 채우고 같은 경로에 두꺼운 어두운 테두리를 두른다 (§3-1).

    PIL의 polygon은 outline 두께를 지원하지 않으므로 line으로 닫아 그린다.
    """
    d.polygon(pts, fill=fill)
    d.line([*pts, pts[0]], fill=LINE, width=width, joint="curve")


def icon_slash() -> Image.Image:
    """연타(quick) — 검 한 자루 + 베기 궤적 호."""
    img = blank()
    d = ImageDraw.Draw(img)
    c = CELL / 2

    # 베기 궤적: 검이 지나간 자리를 덮는 초승달.
    # **양 끝이 뾰족해야 운동으로 읽힌다** — 두께가 일정하면 그냥 링 조각이고
    # "휘둘렀다"가 아니라 "고리가 있다"로 보인다. 안쪽 반지름을 사인으로
    # 부풀려 중앙이 가장 두껍고 끝이 0으로 수렴하게 만든다.
    a0, a1 = math.radians(150), math.radians(340)
    outer, thick = 54.0, 20.0
    arc = []
    steps = 40
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        arc.append((c + math.cos(a) * outer, c + math.sin(a) * outer))
    for i in range(steps + 1):
        t = 1.0 - i / steps
        a = a0 + (a1 - a0) * t
        r = outer - thick * math.sin(t * math.pi)
        arc.append((c + math.cos(a) * r, c + math.sin(a) * r))
    d.polygon(arc, fill=SHADE)

    # 검: 날 + 가드 + 손잡이. 좌하에서 우상으로 기울인다
    blade = [(38, 96), (52, 82), (100, 24), (108, 34), (56, 92)]
    outlined_polygon(d, blade, BODY, width=5)
    guard = [(30, 88), (48, 106), (40, 114), (22, 96)]
    outlined_polygon(d, guard, SHADE, width=5)
    d.line([(26, 100), (14, 112)], fill=LINE, width=11)
    d.line([(26, 100), (14, 112)], fill=SHADE, width=5)
    return img


def crescent(
    d: ImageDraw.ImageDraw,
    c: float,
    deg0: float,
    deg1: float,
    outer: float,
    thick: float,
    fill,
) -> None:
    """양 끝이 뾰족한 초승달 하나 — `icon_slash`의 궤적과 같은 방법이다.

    두께가 일정하면 "휘둘렀다"가 아니라 "고리가 있다"로 보인다. 안쪽 반지름을
    사인으로 부풀려 중앙이 가장 두껍고 끝이 0으로 수렴하게 만든다.
    """
    a0, a1 = math.radians(deg0), math.radians(deg1)
    pts = []
    steps = 40
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        pts.append((c + math.cos(a) * outer, c + math.sin(a) * outer))
    for i in range(steps + 1):
        t = 1.0 - i / steps
        a = a0 + (a1 - a0) * t
        r = outer - thick * math.sin(t * math.pi)
        pts.append((c + math.cos(a) * r, c + math.sin(a) * r))
    d.polygon(pts, fill=fill)
    d.line([*pts, pts[0]], fill=LINE, width=4, joint="curve")


def taper_stroke(
    d: ImageDraw.ImageDraw,
    p0: tuple[float, float],
    p1: tuple[float, float],
    thick: float,
    bow: float,
    fill,
) -> None:
    """한쪽 끝이 뾰족한 휜 획 하나 — 획의 **방향**이 읽히게 만든다.

    `bow`는 획이 휘는 쪽(수직 방향 부풀림, px). 직선으로 그으면 막대 두 개가
    겹친 것으로 보이고 "휘둘렀다"가 남지 않는다.
    """
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln, dx / ln
    steps = 24
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        # 중앙이 가장 두껍고 양 끝이 0으로 수렴한다
        w = thick * math.sin(t * math.pi) * 0.5
        bx = p0[0] + dx * t + nx * bow * math.sin(t * math.pi)
        by = p0[1] + dy * t + ny * bow * math.sin(t * math.pi)
        left.append((bx + nx * w, by + ny * w))
        right.append((bx - nx * w, by - ny * w))
    pts = left + right[::-1]
    d.polygon(pts, fill=fill)
    d.line([*pts, pts[0]], fill=LINE, width=5, joint="curve")


def icon_combo() -> Image.Image:
    """연격(combo) — X로 엇갈린 궤적 두 획.

    연타 아이콘과 갈라지는 축은 **획의 개수**다. 검을 두 자루 그리면 무기가
    다른 캐릭터로 읽히는데, 이 아이콘은 일곱 캐릭터가 다 쓴다(역할 아이콘이지
    캐릭터 아이콘이 아니다). 그래서 무기를 지우고 궤적만 남긴다 —
    실제 연출도 궤적 두 장이 X를 그리는 것이다(`ROLE_MOTIONS.combo`).

    **두 획을 같은 중심의 호로 그리면 안 된다.** 처음에 `crescent`를 반지름만
    다르게 두 번 깔았더니 두 호가 동심원이 되어 초승달 **하나**로 뭉쳤다 —
    슬롯 크기(85px)로 찍어서 확인했다. X는 두 획이 실제로 **교차**해야 나온다.
    """
    img = blank()
    d = ImageDraw.Draw(img)
    # 좌하 → 우상, 좌상 → 우하. 두 획이 중앙에서 교차한다
    taper_stroke(d, (22, 104), (106, 26), 26.0, 14.0, BODY)
    taper_stroke(d, (26, 30), (102, 108), 20.0, -12.0, SHADE)
    return img


def icon_burst() -> Image.Image:
    """마무리기(burst) — 중심에서 터지는 8방향 파열."""
    img = blank()
    d = ImageDraw.Draw(img)
    c = CELL / 2

    # 8갈래 별. 긴 갈래와 짧은 갈래를 번갈아 — 균등하면 톱니바퀴로 보인다
    pts = []
    for i in range(16):
        a = math.radians(i * 22.5 - 90)
        r = 56 if i % 2 == 0 else 22
        pts.append((c + math.cos(a) * r, c + math.sin(a) * r))
    outlined_polygon(d, pts, BODY, width=6)
    # 중심 공백 — "공허"가 안쪽에 있다
    d.ellipse([c - 15, c - 15, c + 15, c + 15], fill=LINE)
    d.ellipse([c - 9, c - 9, c + 9, c + 9], fill=SHADE)
    return img


def icon_ult() -> Image.Image:
    """네 번째 공격 칸(ult) — 앞으로 밀려가는 3중 파동 + 창끝.

    **네 공격 칸이 서로 다른 그림이어야 한다**(`iconRegionFor`의 근거). 이미
    쓰인 축은 검+궤적(연타), 엇갈린 두 획(연격), 방사 파열(마무리기)이다.
    남은 축은 **한 방향으로 겹쳐 밀려가는 것**이고, 그게 이 칸의 연출과 같다:
    접근은 연타처럼 빠르고 층이 여섯으로 가장 많다(`ROLE_MOTIONS.ult`).

    파열(burst)과 갈라지는 축은 **방향**이다 — 파열은 중심에서 사방으로
    터지고 이쪽은 왼쪽에서 오른쪽으로 몰아친다. 방사형을 두 칸에 쓰면
    "많이 터진다"가 같은 그림이 되어 두 칸을 눌러 보고 구별해야 한다.
    """
    img = blank()
    d = ImageDraw.Draw(img)
    c = CELL / 2

    # 뒤에서 따라오는 파동 3겹. 반지름·두께가 줄어들며 앞으로 수렴한다 —
    # 같은 크기로 깔면 동심원 세 개(=고리)로 보이고 운동이 남지 않는다
    for outer, thick, fill in ((58.0, 17.0, SHADE), (42.0, 14.0, SHADE), (27.0, 11.0, BODY)):
        crescent(d, c, 118, 242, outer, thick, fill)

    # 창끝. 파동이 밀고 가는 **끝점**이 있어야 방향이 읽힌다
    tip = [(c + 46, c), (c + 6, c - 26), (c + 16, c), (c + 6, c + 26)]
    outlined_polygon(d, tip, BODY, width=5)
    return img


def icon_chains() -> Image.Image:
    """타락의 사슬(slow) — 맞물린 고리 3개."""
    img = blank()
    d = ImageDraw.Draw(img)
    # 좌상 → 우하 대각으로 3개. 고리는 타원 링(두꺼운 테두리)이다
    for i, (cx, cy) in enumerate(((40, 40), (64, 64), (88, 88))):
        box = [cx - 26, cy - 18, cx + 26, cy + 18]
        d.ellipse(box, outline=LINE, width=13)
        d.ellipse(box, outline=BODY if i != 1 else SHADE, width=7)
    return img


def icon_veil() -> Image.Image:
    """심연의 장막(blind) — 가려진 눈.

    사슬과 갈라지는 축은 **무엇을 막는가**다. 사슬은 상대를 늦추고(수치),
    장막은 상대가 화면을 못 읽게 한다(시야) — 둘 다 "방해"라는 같은 아이콘을
    주면 두 칸이 무슨 차이인지 눌러 보고 알아내야 한다.
    """
    img = blank()
    d = ImageDraw.Draw(img)
    c = CELL / 2

    # 눈: 위아래 두 호가 만나는 아몬드 꼴. 타원으로 그리면 동공만 남아
    # "눈"이 아니라 "점"으로 보인다. 위로 올려 아래에 장막 자리를 비운다
    ey = c - 14
    lid = [
        (16, ey),
        (40, ey - 24),
        (c, ey - 31),
        (88, ey - 24),
        (112, ey),
        (88, ey + 24),
        (c, ey + 31),
        (40, ey + 24),
    ]
    outlined_polygon(d, lid, BODY, width=6)
    d.ellipse([c - 15, ey - 15, c + 15, ey + 15], fill=LINE)

    # 장막: 눈 **아래에서** 올라와 아래 절반을 덮는 커튼.
    #
    # 처음에는 눈을 가로지르는 띠 하나였는데, 슬롯 크기로 찍어 보니 띠가 눈을
    # 삼켜서 "가려진 눈"이 아니라 "사각형 위의 혹"으로 보였다. 덮는 것을
    # 보이게 하려면 **가려진 쪽과 안 가려진 쪽이 둘 다 남아야** 한다.
    veil = [(10, c + 40), (10, c + 4), (c, c + 18), (118, c + 4), (118, c + 40)]
    outlined_polygon(d, veil, SHADE, width=6)
    return img


def icon_frenzy() -> Image.Image:
    """buff — 아래로 향하는 3중 화살표 (하강 = 강화).

    **프리셋은 지금 버프 칸을 쓰지 않는다**(하강 광기를 지웠다 — 근거는
    `presetSkillsFor`의 결정 기록: 타락도 30이 100층 데모에서 거의 안 열린다).
    그래도 남긴다 — `iconRegionFor`가 `kind === "buff"`를 이 region으로
    보내므로, 지우면 버프 스킬을 하나 되돌리는 순간 아틀라스에 없는 region을
    찾아 아이콘이 빈 칸이 된다. 이 판단은 이미 한 번 값을 했다: 앞서 같은
    이유로 남겨 둔 덕분에 버프 칸을 되돌릴 때 아이콘 작업이 0이었다.
    """
    img = blank()
    d = ImageDraw.Draw(img)
    c = CELL / 2
    # 큰 화살촉 하나 + 위쪽에 작은 잔상 2개. 아래로 내려가는 운동이 읽힌다
    for i, (dy, scale, color) in enumerate(
        ((26, 1.0, BODY), (-6, 0.72, SHADE), (-32, 0.5, SHADE))
    ):
        w = 40 * scale
        hh = 30 * scale
        pts = [
            (c - w, c + dy - hh),
            (c + w, c + dy - hh),
            (c, c + dy + hh),
        ]
        outlined_polygon(d, pts, color, width=6 if i == 0 else 4)
    return img


# 키는 `src/shared/fxManifest.ts`의 `SKILL_ICON_REGIONS`와 같아야 한다
# (`tests/fxManifest.test.ts`가 대조한다).
ICONS = {
    "skill_attack": icon_slash,
    "skill_combo": icon_combo,
    "skill_burst": icon_burst,
    "skill_ult": icon_ult,
    "skill_interference": icon_chains,
    "skill_blind": icon_veil,
    "skill_buff": icon_frenzy,
}


def pack(images: dict[str, Image.Image]) -> tuple[Image.Image, dict]:
    """선반 패킹. 셀이 전부 같은 크기라 한 줄에 4개, 7종이면 두 줄이다."""
    order = sorted(images.keys())
    regions: dict[str, dict] = {}
    x = y = row_h = 0
    for key in order:
        im = images[key]
        if x + im.width > ATLAS_W:
            x = 0
            y += row_h + PAD
            row_h = 0
        regions[key] = {"x": x, "y": y, "w": im.width, "h": im.height}
        x += im.width + PAD
        row_h = max(row_h, im.height)
    total_h = y + row_h
    atlas_h = 1 << (total_h - 1).bit_length() if total_h > 0 else 1
    sheet = Image.new("RGBA", (ATLAS_W, atlas_h), (0, 0, 0, 0))
    for key in order:
        r = regions[key]
        sheet.alpha_composite(images[key], (r["x"], r["y"]))
    return sheet, regions


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    sheet, regions = pack({k: fn() for k, fn in ICONS.items()})
    path = os.path.join(OUT_DIR, "skills.png")
    sheet.save(path)
    print(f"wrote {path} ({sheet.width}x{sheet.height}, {len(regions)} regions)")

    manifest = {
        "skills": {
            "url": "assets/icons/skills.png",
            "w": sheet.width,
            "h": sheet.height,
            "regions": regions,
        }
    }
    out = os.path.join(OUT_DIR, "icons.json")
    with open(out, "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent=2, ensure_ascii=False)
        fp.write("\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
