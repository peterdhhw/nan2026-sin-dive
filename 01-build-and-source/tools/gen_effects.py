#!/usr/bin/env python3
"""PvP 이펙트 스프라이트시트 생성기 — 2D 하드 픽셀 톤.

수동 아트 없이 심연 톤 이펙트를 만든다. 결정론적이므로 실행할 때마다
같은 결과가 나온다 — 커밋된 PNG와 재생성 결과가 일치한다.

**왜 다시 썼나**: 처음 판은 `GaussianBlur` + 반경 감쇠 글로우였다. 화면에서
그 결과는 이펙트가 아니라 **캐릭터를 덮는 흐릿한 흰 덩어리**였다 — 노라
위에 뜬 96px 임팩트를 "웅크린 회백색 아군"으로 잘못 읽을 정도였다
(스크린샷에서 확인). 원인은 두 가지다:

1. 캐릭터는 58px 피사체를 4배로 띄우는 하드 픽셀아트인데, 이펙트만 부드러운
   그라디언트였다. 같은 화면에 다른 해상도의 그림 두 벌이 섞인다.
2. 부드러운 흰 글로우는 어두운 심연 배경에서 **면적이 곧 밝기**가 되어
   무엇이 터졌는지가 아니라 "화면이 하얘졌다"만 남는다.

그래서 이 판의 규칙은 셋이다:
  - **블러 금지.** `ImageDraw`는 기본이 앨리어스 없음 — 저해상도 격자에
    그린 뒤 NEAREST로 4배 확대하면 캐릭터와 같은 픽셀 크기가 나온다.
  - **알파는 단계값만.** 연속 감쇠는 확대하면 다시 그라디언트가 된다.
  - **어두운 아웃라인**(01-art-direction.md §3-1)을 이펙트에도 넣는다.
    밝은 이펙트를 어두운 필드에 얹을 때 형태를 잡아 주는 유일한 수단이다.

사용: python3 tools/gen_effects.py
출력: public/assets/fx/{missile,impact,aura,slash,spark,dust}.png + fx.json
"""
from __future__ import annotations

import json
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "public", "assets", "fx",
)

# 심연 팔레트 (자보라 코어 → 청백 하이라이트)
CORE = (233, 220, 255)
MID = (154, 123, 216)
EDGE = (74, 42, 130)
# 01-art-direction.md §3-1 `UI_OUTLINE` — UI와 같은 값을 쓴다
OUTLINE = (33, 28, 46)

#: 허용 알파. 연속값을 쓰면 확대 후 그라디언트로 되살아난다
ALPHA_STEPS = (0, 70, 130, 195, 255)

#: 저해상도 격자 → 최종 프레임 배율. 캐릭터의 확대 배율(≈4배)과 맞춘다
UPSCALE = 4


def qa(alpha: float) -> int:
    """알파를 허용 단계로 스냅한다."""
    a = max(0, min(255, int(alpha)))
    return min(ALPHA_STEPS, key=lambda s: abs(s - a))


def rgba(color, alpha: float):
    return (color[0], color[1], color[2], qa(alpha))


def add_outline(img: Image.Image) -> Image.Image:
    """불투명 픽셀 바깥 1px에 어두운 테두리를 두른다.

    저해상도에서 1px이므로 확대 후 4px — 필·배지와 같은 두께다(§3-1).
    형태를 잡아 주지 않으면 밝은 이펙트가 어두운 필드에서 번진 빛으로만
    보인다.
    """
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] >= 100:
                continue
            # 4-이웃만 본다. 8-이웃이면 대각이 뭉쳐 형태가 통통해진다
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] >= 100:
                    dst[x, y] = (OUTLINE[0], OUTLINE[1], OUTLINE[2], 255)
                    break
    return out


def finish(cell: Image.Image, frame: int) -> Image.Image:
    """아웃라인을 두르고 NEAREST로 확대한다. **여기서만** 크기가 바뀐다."""
    cell = add_outline(cell)
    return cell.resize((frame, frame), Image.NEAREST)


def blank(n: int) -> Image.Image:
    return Image.new("RGBA", (n, n), (0, 0, 0, 0))


def disc(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, color, alpha: float) -> None:
    """앨리어스 없는 원. r이 1 미만이면 픽셀 하나로 떨어진다."""
    if r < 0.6:
        d.point((round(cx), round(cy)), fill=rgba(color, alpha))
        return
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba(color, alpha))


def ring_band(
    cell: Image.Image, cx: float, cy: float, r_out: float, r_in: float,
    a0: float, a1: float, color, alpha: float,
) -> None:
    """극좌표 밴드(부채꼴 띠)를 픽셀 단위로 채운다 — 베기 궤적용.

    `ImageDraw.arc`는 두께를 각도에 따라 균일하게 못 잡아서 얇은 곳이 끊긴다.
    픽셀을 직접 판정하면 저해상도에서도 궤적이 이어진다.
    """
    px = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = math.hypot(dx, dy)
            if not (r_in <= dist <= r_out):
                continue
            ang = math.atan2(dy, dx) % (2 * math.pi)
            lo, hi = a0 % (2 * math.pi), a1 % (2 * math.pi)
            inside = lo <= ang <= hi if lo <= hi else (ang >= lo or ang <= hi)
            if inside:
                px[x, y] = rgba(color, alpha)


def make_missile(frame: int = 64, frames: int = 8) -> Image.Image:
    """회전하는 공허 탄환. 하드 코어 + 계단식 꼬리."""
    n = frame // UPSCALE
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        cell = blank(n)
        d = ImageDraw.Draw(cell)
        c = (n - 1) / 2.0
        # 맥동은 픽셀 단위로만 — 소수 반경은 확대하면 티가 안 난다
        pulse = 1 if i % 2 == 0 else 0
        disc(d, c, c, n * 0.30 + pulse, EDGE, 255)
        disc(d, c, c, n * 0.21, MID, 255)
        disc(d, c, c, n * 0.11, CORE, 255)
        # 꼬리 — 진행 방향(-x) 반대로 늘어나는 계단. 삼각형을 저해상도에
        # 그리면 앨리어스 없이도 계단이 생기고, 그게 이 톤에서 맞다
        tail = n * (0.30 + 0.06 * (i % 3))
        d.polygon(
            [(c + n * 0.05, c - n * 0.10),
             (c + n * 0.05, c + n * 0.10),
             (c + n * 0.05 - tail, c)],
            fill=rgba(MID, 195),
        )
        cell = cell.rotate(i * (360.0 / frames), resample=Image.NEAREST)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


def make_impact(frame: int = 96, frames: int = 6) -> Image.Image:
    """방사형 임팩트. 커지며 **단계적으로** 사라진다.

    스파이크를 9개에서 6개로 줄였다 — 저해상도 격자에서 9개는 중심에서
    뭉쳐 별이 아니라 원반이 된다.
    """
    n = frame // UPSCALE
    spikes = 6
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        t = i / (frames - 1)
        cell = blank(n)
        d = ImageDraw.Draw(cell)
        c = (n - 1) / 2.0
        outer = n * (0.18 + 0.30 * t)
        inner = outer * 0.40
        alpha = 255 if t < 0.5 else (195 if t < 0.8 else 130)
        for s in range(spikes):
            a0 = 2 * math.pi * s / spikes + (math.pi / spikes) * (i % 2)
            aw = math.pi / spikes * 0.5
            d.polygon(
                [(c + math.cos(a0) * outer, c + math.sin(a0) * outer),
                 (c + math.cos(a0 + aw) * inner, c + math.sin(a0 + aw) * inner),
                 (c + math.cos(a0 - aw) * inner, c + math.sin(a0 - aw) * inner)],
                fill=rgba(CORE, alpha),
            )
        # 코어는 첫 두 프레임만 — 계속 있으면 흰 점이 남아 잔상으로 보인다
        if i < 2:
            disc(d, c, c, max(1.0, inner * 0.7), CORE, 255)
        else:
            disc(d, c, c, max(1.0, inner * 0.6), MID, alpha)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


def make_aura(frame: int = 80, frames: int = 8) -> Image.Image:
    """캐릭터 발밑 버프 링. 하드 점선 타원 + 도는 입자."""
    n = frame // UPSCALE
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        phase = 2 * math.pi * i / frames
        cell = blank(n)
        d = ImageDraw.Draw(cell)
        c = (n - 1) / 2.0
        rw = n * 0.42 * (1.0 + 0.06 * math.sin(phase))
        rh = rw * 0.34
        # 점선 링 — 실선을 저해상도에 그리면 위아래가 두껍고 좌우가 끊긴다.
        # 처음부터 점선으로 그리면 그 불균일이 의도로 읽힌다
        for k in range(16):
            a = 2 * math.pi * k / 16 + phase * 0.5
            disc(d, c + math.cos(a) * rw, c + math.sin(a) * rh, 0.5, MID, 255)
        for p in range(6):
            a = phase + 2 * math.pi * p / 6
            disc(d, c + math.cos(a) * rw, c + math.sin(a) * rh, 1.0, CORE, 255)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


def make_slash(frame: int = 96, frames: int = 5) -> Image.Image:
    """베기 궤적 — 초승달이 훑고 지나간다 (리제·실비아 계열).

    검을 쓰는 캐릭터의 임팩트다. 원형 폭발은 "터졌다"만 말하지만 궤적은
    **어느 방향으로 그었는지**를 말한다 — 근접이 접촉으로 읽히는 데 필요하다.
    """
    n = frame // UPSCALE
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        t = i / (frames - 1)
        cell = blank(n)
        c = (n - 1) / 2.0
        # 호가 자라며 얇아진다 — 휘두른 뒤 흩어지는 잔상.
        # **두께를 반경의 1/4 아래로 유지한다.** 저해상도(n=24)에서 그 이상이면
        # 안쪽 반경이 중심에 닿아 초승달이 아니라 채워진 부채꼴이 된다
        r_out = n * (0.34 + 0.14 * t)
        thick = max(1.5, r_out * (0.30 - 0.14 * t))
        # 위 → 아래로 훑는다. 처음부터 넓게 열어 둔다 — 좁게 시작하면 호가
        # 아니라 삼각 조각으로 보인다
        a0 = -math.pi * (0.70 - 0.34 * t)
        a1 = a0 + math.pi * (0.62 + 0.28 * t)
        alpha = 255 if t < 0.4 else (195 if t < 0.7 else 130)
        # 날 안쪽(어두운 겹)을 먼저 깔고 밝은 심을 위에 얹는다 — 순서가 바뀌면
        # 밝은 심이 덮여서 칼자국이 아니라 보라 띠가 된다
        ring_band(cell, c, c, r_out, r_out - thick * 1.7, a0 + 0.25, a1 - 0.25, MID, 195)
        ring_band(cell, c, c, r_out, r_out - thick, a0, a1, CORE, alpha)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


def make_spark(frame: int = 64, frames: int = 5) -> Image.Image:
    """타격 스파크 — 짧은 파편이 튄다 (노라·클로에 계열).

    둔기·주먹처럼 **점에서 터지는** 타격이다. 궤적(`slash`)과 짝을 이뤄
    캐릭터별 손맛을 갈라 놓는다.
    """
    n = frame // UPSCALE
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        t = i / (frames - 1)
        cell = blank(n)
        d = ImageDraw.Draw(cell)
        c = (n - 1) / 2.0
        alpha = 255 if t < 0.5 else (195 if t < 0.8 else 130)
        # 파편 8개가 바깥으로 날아간다. 길이를 번갈아 줘서 방사형 대칭을 깬다
        for s in range(8):
            a = 2 * math.pi * s / 8 + math.pi / 8
            near = n * (0.10 + 0.26 * t)
            far = near + n * (0.16 if s % 2 == 0 else 0.09) * (1.0 - 0.5 * t)
            d.line(
                [(c + math.cos(a) * near, c + math.sin(a) * near),
                 (c + math.cos(a) * far, c + math.sin(a) * far)],
                fill=rgba(CORE if s % 2 == 0 else MID, alpha),
                width=1,
            )
        # 중심 섬광은 초반만 — 끝까지 두면 파편이 아니라 별이 된다
        if i < 2:
            disc(d, c, c, n * 0.10, CORE, 255)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


def make_dust(frame: int = 64, frames: int = 6) -> Image.Image:
    """발밑 먼지 — 돌진 출발·착지에 깔린다.

    접근이 "순간이동"으로 안 읽히게 하는 값싼 수단이다. 발이 지면을 밀었다는
    증거가 화면에 있어야 달려온 것으로 보인다.
    """
    n = frame // UPSCALE
    sheet = Image.new("RGBA", (frame * frames, frame), (0, 0, 0, 0))
    for i in range(frames):
        t = i / (frames - 1)
        cell = blank(n)
        d = ImageDraw.Draw(cell)
        c = (n - 1) / 2.0
        # 지면에 붙는다 — 셀 아래쪽에 깔린다. 중앙에 두면 공중 연기다
        gy = n * 0.72
        alpha = 195 if t < 0.35 else (130 if t < 0.7 else 70)
        for p in range(5):
            # 좌우로 퍼지며 살짝 뜬다. 위상은 고정 — 결정론이어야 한다
            side = -1 if p % 2 == 0 else 1
            spread = n * (0.08 + 0.30 * t) * (0.4 + 0.3 * p)
            x = c + side * spread
            y = gy - n * 0.18 * t * (0.5 + 0.2 * p)
            r = max(0.6, n * (0.11 - 0.05 * t) * (1.0 - 0.1 * p))
            disc(d, x, y, r, MID if p % 2 == 0 else EDGE, alpha)
        sheet.alpha_composite(finish(cell, frame), (i * frame, 0))
    return sheet


# (key, 생성 함수, 프레임 크기, 프레임 수, fps)
SPECS = [
    ("missile", make_missile, 64, 8, 24),
    ("impact", make_impact, 96, 6, 20),
    ("aura", make_aura, 80, 8, 12),
    # 근접 전용 3종. `slash`/`spark`는 캐릭터별로 갈라 쓰고 `dust`는 발밑에 깔린다
    ("slash", make_slash, 96, 5, 22),
    ("spark", make_spark, 64, 5, 24),
    ("dust", make_dust, 64, 6, 16),
]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = {}
    for key, fn, frame, frames, fps in SPECS:
        # 프레임 크기가 배율로 나눠지지 않으면 NEAREST 확대가 어긋난다
        assert frame % UPSCALE == 0, f"{key}: frame {frame} % {UPSCALE} != 0"
        sheet = fn()
        path = os.path.join(OUT_DIR, f"{key}.png")
        sheet.save(path)
        manifest[key] = {
            "url": f"assets/fx/{key}.png",
            "frameW": frame,
            "frameH": frame,
            "frames": frames,
            "fps": fps,
        }
        print(f"wrote {path} ({sheet.width}x{sheet.height}, {frames} frames)")
    with open(os.path.join(OUT_DIR, "fx.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {os.path.join(OUT_DIR, 'fx.json')}")


if __name__ == "__main__":
    main()
