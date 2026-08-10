#!/usr/bin/env python3
"""횡뷰 픽셀아트 캐릭터를 게임 에셋으로 임포트한다.

원본: ~/asset-research/sidescroll
  - `catalog.json`  + `packed/<slug>/<action>.png`      — CC0 픽셀아트(잡몹·보스)
  - `catalog3d_p4.json` + `packed3d_p4/<slug>/<a>.png`  — 자체 생성 3D 렌더(주인공)
결과: public/assets/chars/<slug>.png + chars.json

**왜 다시 팩하는가**: 원본은 액션 하나가 PNG 하나다. 17종 × 9액션 =
150개가 넘는 파일을 boot에서 받으면 모바일 첫 진입이 요청 대기로 채워진다.
슬러그당 한 장으로 합쳐 17요청으로 줄인다.

**세 트랙이 섞여 있다**:
  - 잡몹·보스는 CC0 픽셀아트(LuizMelo)다. 표기 의무도 재배포 제약도 없다.
  - 주인공 7종은 **chierit Elementals(CC-BY 4.0)**다. 상용 이용이 허용되고
    조건은 크레딧 표기 하나뿐이다 — `CREDITS.md`에 `chierit`를 적고 여기서
    명시적으로 통과시킨다. 재배포 금지(Clembod)는 여전히 막는다.
  - 자체 생성 트랙(`aiGenerated`)은 3D 렌더 주인공 4종이 쓰던 길이다. 로스터를
    chierit로 교체해 지금 쓰는 캐릭터는 없지만, 검사와 파이프라인은 남겨 둔다.

트랙이 섞이면 무엇을 팔 수 있는지 되짚을 수 없으므로 매니페스트에
`license`/`generated`를 그대로 남긴다.

**왜 주인공을 교체했는가**: 자체 생성 4종은 리깅 병목(§AI 메시 리깅)으로 43액션
중 16개만 통과했고, 공격 클립이 `attack1/attack2/special` 세 개뿐이라 "내 공격 3
+ 방해 2" 5슬롯을 채울 수 없었다. chierit는 캐릭터마다 `1/2/3_atk + sp_atk` 네
공격과 접근 2종을 다 갖고 있다.

등신비가 에셋마다 제각각이므로 표시 크기는 `refSubjH`(기준 액션 피사체 높이)로
정규화하고 종별 배율을 따로 곱한다.

사용: python3 tools/import_chars.py [--src DIR]
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

from PIL import Image

# 우리가 쓰는 액션만 가져온다. jump/fall/defend 등은 전투에 안 쓴다 —
# 안 쓰는 액션을 넣으면 시트가 커지고 boot가 느려진다.
WANT_2D = ["idle", "walk", "run", "attack1", "attack2", "attack3", "hit", "death"]

# 주인공은 근접 돌진을 하므로 접근 동작이 두 벌(`run`/`roll`) 필요하고,
# 캐릭터마다 다른 공격이 필요해 `special`까지 가져온다. `attack3`는 3D 리그에
# 없다(UAL 43액션에 3연타가 없다) — 없는 이름은 팩에서 조용히 빠진다.
WANT_3D = [
    "idle",
    "walk",
    "run",
    "attack1",
    "attack2",
    "special",
    "roll",
    "hit",
    "death",
]

# chierit 주인공. 공격이 네 벌(1/2/3_atk + sp_atk)이라 스킬바의 공격 네 칸을
# **각자 자기 클립으로** 채울 수 있다 — 이것이 교체 이유다. 네 칸이 네 벌을
# 하나씩 받으므로 여유분이 0이고, 액션 하나를 빼면 두 칸이 같은 동작을 낸다.
# `walk`는 water_priestess만 있고 나머지는 `run`뿐이다(그 반대도 있다).
# 둘 중 하나만 있어도 `spriteChar` 대체 사슬이 메우므로 둘 다 요청한다.
WANT_CHIERIT = [
    "idle",
    "walk",
    "run",
    "attack1",
    "attack2",
    "attack3",
    "special",
    "roll",
    "hit",
    "death",
]

# 액션별 재생 FPS. 원본 카탈로그에 fps가 없다 (프레임 수만 있다).
# 공격이 느리면 타격 순간이 흐려지고, idle이 빠르면 안절부절해 보인다.
FPS = {
    "idle": 8,
    "walk": 9,
    "run": 12,
    "attack1": 14,
    "attack2": 14,
    "attack3": 14,
    "special": 12,
    # 회피 굴르기는 붙었다 떨어지는 사이에 끝나야 한다 — 느리면 데굴거린다
    "roll": 16,
    "hit": 14,
    "death": 9,
}

# 반복 재생 여부. 공격·피격·사망·굴르기는 1회다 (호출자가 다음 루프를 지정한다).
LOOP = {"idle": True, "walk": True, "run": True}

# 원본 액션명이 우리 이름과 다른 경우. `rat`은 공격·사망이 `attack_bite`/
# `rat_death`라서 그냥 두면 물지도 죽지도 않는 쥐가 된다.
ALIAS = {"rat": {"attack1": "attack_bite", "death": "rat_death"}}

# 3D 렌더는 512px에서 128px로 픽셀화된 상태로 들어온다. 게임 표시 높이는
# 아군 231px(필드 높이 420 × 0.55)이므로 128px 원본은 배율 2배 = 픽셀이
# 뭉개지지도, 커지지도 않는 어정쩡한 크기가 된다. **절반으로 한 번 더 줄여**
# 표시 배율을 4배로 만든다(픽셀이 픽셀로 읽힌다). 실측: 4종 합계
# 3269KB → 535KB. 홀수 셀은 반으로 못 자르므로 거기서 멈춘다.
HERO3D_HALVE = True

# chierit 셀은 288×128인데 캐릭터는 그 안에서 26~50px밖에 안 쓴다 —
# 나머지는 이펙트가 뻗는 여백이다. 캔버스째 팩하면 7종이 **34.5M px = GPU
# 132MB**가 된다(현재 17종 전체가 70MB다). 셀을 다시 자른다.
#
# **자르는 기준이 bbox 여서는 안 된다.** 액션마다 이펙트가 다른 쪽으로 뻗으므로
# (필살기는 앞으로 200px, 사망은 아래로) 액션별 bbox 로 자르면 액션마다 캐릭터의
# 셀 내 위치가 달라지고, 앵커는 셀 비율이라 전환할 때마다 캐릭터가 튄다.
# 그래서 **idle 몸통의 가로 중심**을 잡아 좌우 대칭으로 자른다 — 몸이 셀 중앙에
# 남으므로 앵커 규칙(0.5, footY/cellH)이 그대로 성립하고, 이펙트는 어느 쪽으로
# 뻗어도 잘리지 않는다. 세로는 위만 자른다(발밑은 하단 기준이라 못 건드린다).
CHIERIT_CROP = True
# 자른 뒤 남기는 여유(px). 0으로 자르면 액션 중 한 프레임이라도 측정 bbox 밖으로
# 1px 새면 팔 끝이 잘린다 — 잘린 것은 화면에서 "이펙트가 사각형에서 끝난다"로
# 보이고, 원인이 임포터라는 것을 알 방법이 없다.
CHIERIT_CROP_PAD = 2
# 팔레트 색 수. 3D 렌더는 그라디언트라 색이 7500종이다 — 픽셀아트로 읽히게
# 줄이면서 용량도 준다(24색: 4종 535KB, 16색: 438KB지만 얼굴 명암이 뭉친다).
HERO3D_COLORS = 24

# 주인공 시트의 목표 중앙 명도.
#
# **왜 필요한가**: 3D 렌더의 밝기가 캐릭터마다 6배 넘게 벌어진다 — 조명은
# 4종이 같은데(`render_sprites.py --light flat`) 원화 의상 알베도가 다르다.
# 실측 중앙 명도: 리제 0.063(진홍 유니타드) / 실비아 0.057(보라) vs
# 노라 0.403 / 클로에 0.243. 즉 노출 사고이지 연출이 아니다.
# 배경을 삽화로 바꿔 밝아지자 앞의 둘이 **배경보다 어두워져서**(0.16 vs 0.25)
# 캐릭터가 구멍처럼 보였다.
#
# 런타임 `tint`로는 고칠 수 없다 — 곱셈이라 밝힐 수 없고, 테마 환경광은 네
# 캐릭터에 같은 값으로 걸리므로 캐릭터별 편차를 지울 수 없다. 에셋에서 맞춘다.
#
# **값의 유래** (눈대중 금지 — 처음 0.32로 적었다가 테스트에 걸렸다):
#   가장 밝은 배경 층      0.328 (`bg.json` scenery_surface/far `medLum`)
#   ÷ 가장 어두운 환경광    0.916 (`theme.ts` THEME_ABYSS.ambient = 0xeee6ff)
#   = 0.358                       ← 여기서 **딱 같아진다**(= 녹는다)
#   × 여유 1.06            = 0.38
# 환경광을 빼먹으면 화면에서 다시 녹는다 — `tint`가 캐릭터에만 곱해지므로
# 캐릭터는 0.916배로 어두워지지만 배경은 그대로다.
#
# 배경 시드를 다시 굴려 더 밝은 삽화가 나오면 이 값도 올려야 한다.
# `tests/charManifest.test.ts`가 두 매니페스트를 대조해서 잡는다.
#
# 이미 이 값 이상인 캐릭터는 **건드리지 않는다**(내리면 원화 의도를 깎는다) —
# 올리기만 한다. 노라(0.403)가 그 경우다.
HERO3D_TARGET_LUM = 0.38

# 명도 리프트 감마의 하한 = 안전장치. 실제 값은 결과를 재서 찾는다(아래
# `lift_luminance`) — 이 상수는 "여기까지 갔으면 리프트로 고칠 문제가 아니다"의
# 선이다. 붙으면 경고를 찍는다: 조용히 클램프하면 "왜 아직 어둡지"가 된다.
#
# **어림값이 아니라 실측이다.** 처음 0.36을 눈대중으로 적었는데, 그 값을 정당화할
# 지표를 재 보니 채도(100% 유지)도 양자화 후 색 수(24색 고정)도 감마에 **무관**
# 했다 — 즉 하한이 아무것도 지키지 않고 리제만 0.28에서 막고 있었다.
# 실제로 나빠지는 것은 상한에 박힌 픽셀의 **명암 계조**다(고유색 수로 잰다).
# 0.30에서 리제 고유색이 원본의 76%까지 떨어지고 그 아래는 급히 무너진다.
LUM_GAMMA_FLOOR = 0.30

# CC0 잡몹·보스는 리프트하지 않는다. 손으로 그린 픽셀아트의 명암은 작가의
# 선택이고(박쥐 0.071·이블위저드 0.120은 "어두운 적"이 의도다), 감마로 들면
# 팔레트가 씻겨 도트가 뭉갠 것처럼 보인다. 3D 렌더만이 노출 사고다.


# 주인공 — chierit Elementals 7종. 표시 순서가 `HERO_SLUGS`와 같아야 한다.
# 2:2 대전에서 내가 하나를 고르고 나머지 셋(아군 1·상대 2)을 시드가 뽑는다
# (session.ts `theirSlugs`, matchScene 캐릭터 선택).
#
# 7종이라 네 자리가 겹치지 않는다 — 4종이던 시절에는 내 팀 둘을 뽑으면 상대 팀이
# 남은 둘로 **강제**되어 매판 같은 조합이었다.
# 기획서 4인(리제·노라·실비아·클로에)이 앞 넷이 **아니다** — 슬러그 순서는
# 격자와 독립이고(`charManifest.PICK_SLUGS`가 자기 순서를 갖는다), 이름은
# 리톤한 슬러그에 붙는다. 배정이 겉모습 우선으로 바뀌면서 리제가
# `fire_knight` → `metal_bladekeeper`로, 클로에가 `crystal_mauler` →
# `wind_hashashin`으로 옮겼다(`female-recolor/tools/spec.py` 참조).
# 남은 셋은 PvP 상대 전용이라 기획서에 없는 원래 이름을 쓴다 — **비워 두거나
# 기획서 이름을 겹쳐 쓰면 안 된다**(실측: 겹쳐 두는 동안 리제가 둘이었다).
HEROES = [
    ("water_priestess", "실비아"),
    ("leaf_ranger", "노라"),
    ("metal_bladekeeper", "리제"),
    ("wind_hashashin", "클로에"),
    ("fire_knight", "이리스"),
    ("crystal_mauler", "미라"),
    ("ground_monk", "셀린"),
]

# 잡몹. hMul = 같은 슬롯 높이에 대한 종별 배율 (쥐가 해골만큼 크면 안 된다).
# lift = 지면에서 띄우는 비율 (공중 몹).
MINIONS = [
    ("goblin", 0.80, 0.0),
    ("mushroom", 0.70, 0.0),
    ("skeleton", 1.00, 0.0),
    ("slime", 0.55, 0.0),
    ("rat", 0.50, 0.0),
    ("bat", 0.55, 0.30),
    ("flying_eye", 0.62, 0.26),
    ("fire_worm", 0.85, 0.0),
    ("mimic", 0.62, 0.0),
]

BOSSES = [
    ("evil_wizard", 1.15),
    ("evil_wizard3", 1.05),
    ("wizard_pack", 1.10),
    ("medieval_king", 1.00),
]


def frame_cells(m: dict, im: Image.Image) -> list[Image.Image]:
    """액션 스트립을 프레임 단위로 쪼갠다."""
    cw, ch, cols = m["cellW"], m["cellH"], m["cols"]
    out = []
    for i in range(m["frames"]):
        c, r = i % cols, i // cols
        out.append(im.crop((c * cw, r * ch, c * cw + cw, r * ch + ch)))
    return out


def diff_px(a: Image.Image, b: Image.Image) -> int:
    """두 프레임에서 **다른 픽셀 수**. RGBA 어느 채널이라도 다르면 센다."""
    return sum(
        1
        for pa, pb in zip(a.getdata(), b.getdata())
        if pa != pb
    )


def motion_px(cells: list[Image.Image]) -> int:
    """이 클립에서 **한 프레임 넘어갈 때 바뀌는 픽셀 수**의 중앙값.

    "많이 닮았다"의 기준을 클립 자신에게서 뽑기 위한 값이다 — 절대 픽셀 수로
    임계를 잡으면 캐릭터마다 몸집·이펙트 크기가 달라 어디서는 헐렁하고
    어디서는 빡빡하다. 평균이 아니라 중앙값이다: 이펙트가 터지는 한두 프레임이
    평균을 몇 배로 끌어올려 "이 클립은 원래 많이 변한다"로 오독하게 만든다.
    """
    if len(cells) < 2:
        return 0
    d = sorted(diff_px(cells[i - 1], cells[i]) for i in range(1, len(cells)))
    return d[len(d) // 2]


# 앞 타의 재생분으로 인정하는 상한 — **클립 자신의 프레임간 변화량 대비** 비율.
#
# 정확히 같은 그림(해시 일치)으로 잡으면 안 된다. ground_monk 는 앞 타를 다시
# 그리면서 몇 픽셀을 손봐서(프레임당 460px 중 14~26px, 비 0.03~0.16) 해시가
# 어긋나고, 그래서 "누적이 아니다"로 잘못 읽혔다 — attack3 의 23프레임 중 10이
# 남의 공격인 채로 통과했다.
#
# 0.35 의 근거는 실측 분포의 **빈 구간**이다(7종 × 2쌍 = 14회, 프레임 단위):
#   · 앞 타 재생분    : 0.00 ~ 0.16
#   · 자기 동작 프레임: 0.42 ~ 5.68
# 두 무리 사이가 2.6배 벌어져 있어서 그 사이 아무 값이나 골라도 같은 답이 나온다.
# 경계에 걸린 값이 없다는 것이 이 상수의 유일한 근거다 — 값을 바꿔야 할 만큼
# 애매한 캐릭터가 나오면 그때는 상수를 조이는 게 아니라 캡처로 판정해야 한다.
COMBO_SAME_RATIO = 0.35

# 앞 타를 담고 있을 수 있는 클립 = 콤보의 2·3타. 여기 있는 이름만 `comboTrim`을
# 기록한다(재 봤다는 증거). attack1 은 앞 타가 없고, special 은 콤보가 아니다
COMBO_CLIPS = ("attack2", "attack3")


def shared_prefix(
    prev: list[Image.Image], cur: list[Image.Image], scale: int
) -> int:
    """`cur` 앞부분 중 `prev`와 (거의) 같은 그림인 프레임 수."""
    if scale <= 0:
        return 0
    n = 0
    for a, b in zip(prev, cur):
        if diff_px(a, b) > scale * COMBO_SAME_RATIO:
            break
        n += 1
    return n


def trim_combo_prefix(strips: list) -> list:
    """콤보 클립에서 **앞 타의 재생분**을 잘라낸다.

    chierit 는 `2_atk` 를 "1타 + 2타", `3_atk` 를 "1·2타 + 3타"로 그려 놨다 —
    콤보를 **누적**으로 제공한다(7종 중 4종. 프레임 해시로 실측). 게임은 세 공격을
    **독립 슬롯**으로 쓰므로 그대로 넣으면 두 가지가 동시에 깨진다:

    1. `attack3` 을 누르면 1타·2타를 다 재생한 뒤에야 3타가 나온다. fire_knight 는
       28프레임 중 18이 앞 타 재생이라 2초 클립의 앞 1.3초가 남의 공격이다.
    2. `impact_frame` 이 **전역 argmax** 라 그 앞 타에 임팩트가 잡힌다. 실측:
       metal_bladekeeper 는 attack1/2/3 이 셋 다 impact=1 로 들어왔다 — 세 공격이
       같은 순간에 때리므로 화면에서 구별이 안 되고, 3타는 칼을 휘두르기
       1.2초 전에 HP가 깎인다.

    이건 캡처로 확인했다(`/tmp/strip_fire_knight_attack3.png`): attack2 = attack1 +
    두 번째 베기, attack3 = attack2 + 화염 마무리. 수치만 보면 "impact=1 이 이상한데"
    까지고, 왜 이상한지는 그림을 봐야 나온다.

    **프레임 수 차이로 추정하면 안 된다** — 누적이 아닌 캐릭터(leaf_ranger·
    crystal_mauler)까지 자른다. **해시 일치로 잡아도 안 된다**: chierit 는 앞 타를
    다시 그리면서 몇 픽셀을 손보는 경우가 있어서(ground_monk) 그림은 같은데 해시가
    어긋나고, 그러면 조용히 안 잘린다. 그래서 "다른 픽셀 수"를 **그 클립 자신의
    프레임간 변화량**과 견준다(`COMBO_SAME_RATIO`) — 캐릭터 몸집·이펙트 크기에
    무관한 비율이라 절대 임계값을 손으로 고르지 않아도 된다.

    실측(7종): water_priestess·metal_bladekeeper·wind_hashashin·fire_knight·
    ground_monk 5종이 누적, leaf_ranger·crystal_mauler 2종은 독립이라 0프레임이
    잘린다.
    """
    by = {n: (m, im) for n, m, im in strips}
    cells = {n: frame_cells(m, im) for n, m, im in strips}
    cut: dict[str, int] = {}
    for name, prev in (("attack2", "attack1"), ("attack3", "attack2")):
        if name not in by or prev not in by:
            continue
        # 기준 배율은 **뒤 클립**의 자기 움직임이다. 앞 클립으로 재면 짧은 클립
        # (attack1 6프레임)의 큰 이펙트 변화가 기준을 부풀려 다 같다고 나온다
        n = shared_prefix(cells[prev], cells[name], motion_px(cells[name]))
        # 전부 같으면 자르지 않는다(빈 클립이 되면 그 공격이 사라진다)
        if 0 < n < by[name][0]["frames"]:
            cut[name] = n
    out = []
    for name, m, im in strips:
        if name not in COMBO_CLIPS:
            out.append((name, m, im))
            continue
        # **0도 기록한다.** 안 적으면 "재 봤더니 안 겹친다"와 "아예 안 쟀다"가
        # 구별되지 않는다 — 해시 판정이 5종을 놓쳤을 때 조용히 통과한 이유가
        # 이것이다. 측정하지 않은 것을 성공으로 취급하면 안 된다
        n = cut.get(name, 0)
        if not n:
            out.append((name, {**m, "comboTrim": 0}, im))
            continue
        nm, nim = drop_frames(m, im, n)
        out.append((name, {**nm, "comboTrim": n}, nim))
        print(f"  · {name}: 앞 {n}프레임이 앞 타의 재생분 → 잘라냄 "
              f"({m['frames']} → {m['frames'] - n})")
    return out


def drop_frames(m: dict, im: Image.Image, n: int) -> tuple:
    """스트립 앞에서 `n` 프레임을 버리고 격자를 다시 채운다.

    `cols` 를 유지하면서 남은 프레임을 앞으로 당긴다 — 행 수가 줄 수 있으므로
    캔버스를 다시 만든다. `boxes` 도 같이 잘라야 `union_box` 가 사라진 프레임의
    이펙트까지 감싸지 않는다(감싸면 그림자·HP바가 캐릭터에서 떨어진다).
    """
    cw, ch, cols = m["cellW"], m["cellH"], m["cols"]
    keep = m["frames"] - n
    rows = math.ceil(keep / cols)
    out = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for j in range(keep):
        i = j + n
        sc, sr = i % cols, i // cols
        dc, dr = j % cols, j // cols
        out.paste(
            im.crop((sc * cw, sr * ch, sc * cw + cw, sr * ch + ch)),
            (dc * cw, dr * ch),
        )
    nm = dict(m)
    nm["frames"] = keep
    nm["rows"] = rows
    nm["boxes"] = m["boxes"][n:]
    return nm, out


def crop_window(strips: list, pad: int) -> tuple[int, int, int, int]:
    """모든 액션에 **공통으로** 쓸 셀 안의 잘라낼 창 (x0, y0, x1, y1).

    **액션별 bbox 로 자르면 안 된다.** 이펙트가 액션마다 다른 쪽으로 뻗으므로
    (필살기는 앞으로 200px, 사망은 아래로) 액션마다 셀 안의 캐릭터 위치가
    달라지고, 앵커는 셀에 대한 **비율**이라 액션이 바뀔 때마다 캐릭터가 튄다.

    그래서 `idle` 몸통의 가로 중심을 잡아 **좌우 대칭**으로 자른다. 몸이 잘린 셀의
    중앙에 남으므로 `anchor.set(0.5, …)`가 그대로 성립하고, 이펙트는 어느 쪽으로
    뻗어도 안 잘린다. 세로는 위만 자른다 — 발밑은 셀 하단에서 `baseGap`으로
    재는 값이라 아래를 건드리면 전부 어긋난다.
    """
    ref = next((m for n, m, _ in strips if n == "idle"), None) or strips[0][1]
    rb = [b for b in ref["boxes"] if b]
    if not rb:
        return 0, 0, ref["cellW"], ref["cellH"]
    # 기준 액션의 몸통 가로 중심. 정지 자세라 이펙트가 없어서 몸 그대로다
    body_cx = (min(b[0] for b in rb) + max(b[0] + b[2] for b in rb)) / 2
    cw = max(m["cellW"] for _, m, _ in strips)
    ch = max(m["cellH"] for _, m, _ in strips)
    boxes = [b for _, m, _ in strips for b in m["boxes"] if b]
    left = min(b[0] for b in boxes)
    right = max(b[0] + b[2] for b in boxes)
    top = min(b[1] for b in boxes)
    half = math.ceil(max(body_cx - left, right - body_cx)) + pad
    x0 = max(0, math.floor(body_cx) - half)
    x1 = min(cw, math.floor(body_cx) + half)
    return x0, max(0, top - pad), x1, ch


def recut(m: dict, im: Image.Image, win: tuple[int, int, int, int]) -> tuple:
    """셀 격자를 `win` 창으로 다시 자른다. 격자 배치(cols/rows)는 유지한다.

    좌표 메타(`boxes`)도 같이 옮긴다 — 안 옮기면 `union_box`가 잘린 셀 밖을
    가리켜서 그림자·HP바가 캐릭터에서 떨어진 곳에 붙는다.
    `dy`는 `cellH - foot` 차이로 만든 값이라 위만 자르면 그대로다.
    """
    x0, y0, x1, y1 = win
    cw, ch = x1 - x0, y1 - y0
    cols, rows = m["cols"], m["rows"]
    out = Image.new("RGBA", (cols * cw, rows * ch), (0, 0, 0, 0))
    for i in range(m["frames"]):
        c, r = i % cols, i // cols
        cell = im.crop(
            (c * m["cellW"] + x0, r * m["cellH"] + y0,
             c * m["cellW"] + x1, r * m["cellH"] + y1)
        )
        out.paste(cell, (c * cw, r * ch))
    nm = dict(m)
    nm["cellW"], nm["cellH"] = cw, ch
    nm["boxes"] = [
        [b[0] - x0, b[1] - y0, b[2], b[3]] if b else b for b in m["boxes"]
    ]
    nm["foot"] = m["foot"] - y0
    return nm, out


def pack(
    pack_dir: Path,
    slug: str,
    actions: dict,
    want: list[str],
    div: int = 1,
    crop_pad: int | None = None,
    trim_combos: bool = False,
) -> tuple[Image.Image, dict]:
    """액션 스트립들을 위에서 아래로 쌓아 한 장으로 만든다.

    액션마다 셀 크기가 다르므로(150×150, 70×70 …) 격자를 통일하지 않는다.
    각 액션의 원본 배치를 그대로 두고 y 오프셋만 기록한다 — 재배치하면
    카탈로그가 측정한 `boxes`/`foot` 좌표가 전부 무의미해진다.

    `div`는 셀 크기를 나눌 정수 배율이다(3D 렌더 축소용). 셀 크기와 좌표를
    **같은 수로** 나눠야 발밑 앵커가 유지된다 — 이미지만 줄이면 캐릭터가 뜬다.

    `crop_pad`가 주어지면 셀을 공통 창으로 다시 자른다(chierit 288×128 여백).
    `trim_combos`면 콤보 클립에서 앞 타의 재생분을 잘라낸다(chierit 누적 콤보).
    """
    alias = ALIAS.get(slug, {})
    strips = []
    for name in want:
        raw = alias.get(name, name)
        m = actions.get(raw)
        if m is None:
            continue
        p = pack_dir / slug / f"{raw}.png"
        if not p.exists():
            continue
        im = Image.open(p).convert("RGBA")
        exp_w, exp_h = m["cols"] * m["cellW"], m["rows"] * m["cellH"]
        if im.size != (exp_w, exp_h):
            raise SystemExit(
                f"{slug}/{name}: 시트 {im.size} != 메타 {(exp_w, exp_h)} — "
                "카탈로그를 다시 생성해야 한다"
            )
        strips.append((name, m, im))
    if not strips:
        raise SystemExit(f"{slug}: 가져올 액션이 없다")

    # 콤보 누적분은 **가장 먼저** 잘라낸다. 창 계산(`crop_window`)이 `boxes`를
    # 읽으므로, 사라질 프레임의 이펙트까지 감싸면 창이 필요 이상으로 넓어진다
    if trim_combos:
        strips = trim_combo_prefix(strips)

    # 자르기는 축소보다 **먼저** 한다. 축소 뒤에 자르면 창 좌표를 배율로 나누면서
    # 반 픽셀이 생겨 옆 프레임 팔이 비쳐 보인다
    if crop_pad is not None:
        win = crop_window(strips, crop_pad)
        strips = [(name, *recut(m, im, win)) for name, m, im in strips]
        print(
            f"  · {slug}: 셀 {strips[0][1]['cellW']}x{strips[0][1]['cellH']}"
            f" (원본 288x128에서 잘라냄)"
        )

    # 셀이 배율로 안 나눠지면 축소를 포기한다 — 반 픽셀 격자는 프레임이
    # 서로 침범해 옆 프레임 팔이 비쳐 보인다
    if div > 1 and any(
        m["cellW"] % div or m["cellH"] % div for _, m, _ in strips
    ):
        print(f"  ! {slug}: 셀이 {div}로 안 나눠져 원본 해상도로 둔다")
        div = 1

    strips = [(name, m, downscale(im, div)) for name, m, im in strips]

    w = max(im.width for _, _, im in strips)
    h = sum(im.height for _, _, im in strips)
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out: dict[str, dict] = {}
    y = 0
    for name, m, im in strips:
        sheet.paste(im, (0, y))
        out[name] = {
            "y": y,
            "cols": m["cols"],
            "cellW": m["cellW"] // div,
            "cellH": m["cellH"] // div,
            "frames": m["frames"],
            "fps": FPS[name],
            "loop": LOOP.get(name, False),
            # dy = 액션 간 발밑 편차. 안 더하면 액션이 바뀔 때 캐릭터가 튄다.
            # 축소하면 편차도 같이 줄어든다 — 안 줄이면 발이 땅에 박힌다
            "dy": round(m["dy"] / div),
            # 알파 박스 합집합 — HP바·사슬·그림자 정렬에 쓴다.
            # 프레임별로 쓰면 매 프레임 배율이 바뀌어 캐릭터가 펄떡인다
            "box": [v // div for v in union_box(m)],
        }
        if "comboTrim" in m:
            # 앞 타의 재생분으로 잘라낸 프레임 수. **런타임은 안 쓴다 — 테스트가
            # 쓴다.** 0을 포함해 남겨야 "재 봤다"는 증거가 된다
            out[name]["comboTrim"] = m["comboTrim"]
        if name in IMPACT_ACTIONS:
            out[name]["impact"] = impact_frame(im, m, div)
        # `want`에 idle이 있어도 **에셋에** 없을 수 있다(flying_eye·bat) —
        # 실제로 팩된 스트립 목록으로 물어야 그 둘이 조용히 빠지지 않는다
        has_idle = any(n == "idle" for n, _, _ in strips)
        if name == "idle" or (name == "walk" and not has_idle):
            # 대기 자세의 몸통 폭 — 아군 간격 검사가 쓴다(테스트 전용).
            # `idle`이 없는 에셋은 `walk`로 대체한다(mimic/flying_eye)
            out[name]["bodyW"] = body_width(
                im,
                {**m, "cellW": m["cellW"] // div, "cellH": m["cellH"] // div},
            )
        y += im.height
    return sheet, out


# 임팩트 프레임을 재야 하는 액션 — 이 프레임에 HP가 깎이고 이펙트가 뜬다.
# 나머지(idle/walk/run/roll/hit/death)는 타격 순간이 없다.
IMPACT_ACTIONS = {"attack1", "attack2", "attack3", "special"}


def impact_frame(im: Image.Image, m: dict, div: int) -> int:
    """이 공격 클립에서 **때리는 순간**의 프레임 번호.

    **왜 재는가**: 손으로 적으면 4캐릭터 × 3공격 = 12개를 눈으로 맞춰야 하고,
    리그를 다시 렌더하면 전부 어긋난다. HP가 깎이는 시점이 팔이 뻗는 시점과
    다르면 "맞았는데 안 아파 보인다"가 되므로 프레임에서 직접 뽑는다.

    **판정은 bbox 로 하면 안 된다.** `attack2`/`special` 은 bbox 오른쪽 끝이
    12프레임 내내 같다(±1px) — 팔은 뻗지만 무기 잔재·머리카락이 더 바깥에
    있어서 실루엣 폭이 안 변한다. bbox argmax 를 쓰면 0번이나 마지막 프레임이
    잡혀 "칼을 뽑기 전에 HP가 깎인다".

    그래서 **몸통 앞쪽 대역의 픽셀 수**로 잰다: 팔이 앞으로 나가면 그 대역이
    채워지고, 되돌아오면 빈다. 첫 프레임을 기준으로 **증가분**을 보므로
    가만히 있는 부분(머리카락·무기 잔재)은 상쇄된다.
    """
    cw, ch = m["cellW"] // div, m["cellH"] // div
    cols, n = m["cols"], m["frames"]
    a = im.getchannel("A")
    # 정면(오른쪽) 절반의 위쪽 2/3 — 팔이 뻗는 대역이다. 아래는 다리라
    # 걸음에 따라 흔들려서 넣으면 발 딛는 프레임이 임팩트로 잡힌다
    x0, x1 = cw // 2, cw
    y1 = int(ch * 0.66)
    counts = []
    for i in range(n):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        band = a.crop((cx + x0, cy, cx + x1, cy + y1))
        counts.append(sum(1 for v in band.getdata() if v >= 128))
    if not counts:
        return 0
    # 첫 프레임 = 준비 자세. 그 대비 가장 많이 뻗은 프레임이 타격 순간이다
    gain = [c - counts[0] for c in counts]
    best = max(range(n), key=lambda i: gain[i])
    # 증가가 없으면(팔을 안 뻗는 클립) 클립 중간을 쓴다 — 0번을 쓰면
    # 모션이 시작하기도 전에 HP가 깎인다
    if gain[best] <= 0:
        return n // 2
    return best


def downscale(im: Image.Image, div: int) -> Image.Image:
    """NEAREST 정수 축소 + 알파 이진화.

    LANCZOS는 픽셀을 죽이고, 알파를 반투명으로 남기면 축소한 외곽선이
    유령처럼 흐려진다(원본 파이프라인 `pixelize.py`와 같은 규칙).
    """
    if div <= 1:
        return im
    small = im.resize((im.width // div, im.height // div), Image.NEAREST)
    a = small.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    small.putalpha(a)
    return small


def luminance(r: int, g: int, b: int) -> float:
    """Rec.709 상대 명도(0~1). TS 쪽 테스트와 같은 계수를 쓴다."""
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def median_lum(im: Image.Image) -> float:
    """불투명 픽셀의 **중앙** 명도.

    평균이 아니라 중앙값을 쓴다: 머리카락 하이라이트·무기 반사 같은 소수의
    밝은 픽셀이 평균을 끌어올려서, 평균으로 보면 "괜찮은데?"가 되지만
    화면에서 읽히는 몸통은 여전히 검다(리제 평균 0.068 vs 중앙 0.063 —
    노라는 평균 0.348 < 중앙 0.403으로 방향이 반대다).
    """
    px = [p for p in im.convert("RGBA").getdata() if p[3] >= 128]
    if not px:
        return 0.0
    lums = sorted(luminance(r, g, b) for r, g, b, _ in px)
    return lums[len(lums) // 2]


def body_width(im: Image.Image, m: dict) -> int:
    """대기 자세의 **몸통 폭**(원본 px) — 행 폭의 중앙값.

    **알파 bbox 폭으로 재면 안 된다.** fire_knight 는 대검을 등 뒤로 늘어뜨려서
    bbox 가 표시 195px 인데(간격 173px 보다 넓다) 몸은 75px 다 — 두 아군을 실제
    자리에 세워 보면 몸이 서로 닿지도 않는다(`/tmp/gap_fk_lr.png`). bbox 로 재면
    "무기를 든 캐릭터는 전부 겹친다"가 되어, 진짜 겹침(노라 `run` 219px, 몸이
    관통했다)과 칼끝이 옆칸에 걸치는 것을 구별할 수 없다.

    중앙값을 쓰는 이유는 `median_lum` 과 같다 — 무기가 가로로 뻗은 몇 행이
    평균·최대를 그 폭까지 끌어올린다(fire_knight 최대 행 188px, 중앙 75px).
    "행의 절반 이상이 이 폭보다 좁다"가 몸통 폭의 뜻이다.

    프레임 **합집합**에서 잰다: 대기는 8~12프레임이고 호흡으로 어깨가 움직이므로
    한 프레임만 보면 그 프레임의 우연에 걸린다.
    """
    a = im.convert("RGBA").getchannel("A")
    cw, ch, cols = m["cellW"], m["cellH"], m["cols"]
    rows: list[list[bool]] = [[False] * cw for _ in range(ch)]
    for i in range(m["frames"]):
        c, r = i % cols, i // cols
        cell = a.crop((c * cw, r * ch, c * cw + cw, r * ch + ch))
        px = cell.load()
        for y in range(ch):
            row = rows[y]
            for x in range(cw):
                if px[x, y] > 0:
                    row[x] = True
    widths = []
    for row in rows:
        on = [x for x, v in enumerate(row) if v]
        if on:
            widths.append(on[-1] - on[0] + 1)
    if not widths:
        return 0
    widths.sort()
    return widths[len(widths) // 2]


def apply_gamma(px: list[tuple[int, int, int, int]], gamma: float) -> list:
    """명도에 감마를 걸어 밝힌다. 색상(hue)은 최대한 지키고 알파는 안 건드린다.

    **채널을 따로 감마하지 않는다.** 채널별로 하면 채도가 낮아져(진홍 → 분홍)
    의상색이 바뀐다 — 명도만 올리고 RGB 비율을 그대로 곱한다.

    **비율만 지키면 목표에 못 닿는다.** 진홍(리제)은 채도가 높아 최대 채널이
    명도보다 훨씬 크다 — 비율을 유지한 채로는 명도 0.37이 천장이고, 그 전에
    픽셀이 상한에 박혀 **명암이 한 색으로 뭉갠다**(감마 0.36에서 43%가 박히고
    고유색이 64%로 준다 = 옷 주름이 사라진다).

    그래서 상한에 박힌 픽셀만 **부족분을 흰색 혼합으로 메운다.** 그 픽셀은
    채도를 조금 잃지만 밝기 순서가 살아남는다 — 실측: 리제가 목표 0.32에 닿는
    감마 0.42에서 채도 94% / 고유색 79% 유지(비율 전용은 0.28에서 멈추고 64%).
    이미 밝은 픽셀은 상한에 안 걸리므로 그림 대부분은 색이 그대로다.
    """
    # 명도 → 배율 LUT. 명도는 0~255의 이산값 256개뿐이라 픽셀마다 pow를
    # 부르지 않아도 된다(시트가 20만 픽셀이다)
    ratio = [1.0] * 256
    for i in range(1, 256):
        v = i / 255.0
        ratio[i] = (v**gamma) / v
    out = []
    for r, g, b, a in px:
        if a == 0:
            out.append((r, g, b, a))
            continue
        li = luminance(r, g, b)
        k = ratio[min(255, round(li * 255))]
        hi = max(r, g, b)
        if hi > 0 and hi * k > 255:
            # 비율 유지 상한까지만 곱하고, 남은 부족분은 흰쪽으로 메운다
            kc = 255.0 / hi
            fr, fg, fb = r * kc, g * kc, b * kc
            head = 255.0 - luminance(fr, fg, fb) * 255.0
            t = min(1.0, (li * k * 255.0 - luminance(fr, fg, fb) * 255.0) / head) if head > 1e-6 else 0.0
            t = max(0.0, t)
            fr += (255.0 - fr) * t
            fg += (255.0 - fg) * t
            fb += (255.0 - fb) * t
        else:
            fr, fg, fb = r * k, g * k, b * k
        out.append(
            (
                min(255, round(fr)),
                min(255, round(fg)),
                min(255, round(fb)),
                a,
            )
        )
    return out


def lift_luminance(im: Image.Image, target: float, label: str) -> Image.Image:
    """중앙 명도를 `target`까지 끌어올린다. 색상(hue)과 알파는 지킨다.

    **곱셈 상수가 아니라 감마다.** 상수배(`×5`)로 올리면 이미 밝은 픽셀이
    255에 박혀 얼굴 하이라이트가 흰 판이 되고, 명암 단계가 위에서 뭉갠다.
    감마는 어두운 쪽을 많이, 밝은 쪽을 적게 올려서 계조를 남긴다.

    **감마를 공식으로 계산하면 목표에 못 닿는다.** `log(target)/log(med)`는
    모든 픽셀이 감마를 온전히 받는다는 가정인데, 비율 유지 상한이 걸리는
    픽셀에서는 덜 오른다 — 리제는 37%가 상한에 걸려 0.32를 노린 감마가 실제로는
    0.251에 떨어졌다(공식만 믿었다면 "리프트했으니 됐다"로 넘어갔다).
    그래서 **결과를 재서** 감마를 이분탐색한다.

    이미 목표 이상이면 그대로 돌려준다 — 어둡게 하는 쪽으로는 쓰지 않는다.
    """
    src = im.convert("RGBA")
    px = list(src.getdata())
    med = median_lum(src)
    if med <= 0 or med >= target:
        return im

    def med_after(gamma: float) -> float:
        lums = sorted(
            luminance(r, g, b) for r, g, b, a in apply_gamma(px, gamma) if a >= 128
        )
        return lums[len(lums) // 2] if lums else 0.0

    # 감마가 작을수록 밝아진다. 하한에서도 목표에 못 닿으면 색상을 지키면서
    # 더 밝힐 방법이 없다 = 렌더가 그만큼 어둡다는 뜻이므로 남기고 넘어간다
    lo, hi = LUM_GAMMA_FLOOR, 1.0
    if med_after(lo) < target:
        print(
            f"  ! {label}: 중앙 명도 {med:.3f} → 감마 하한 {lo}에서도"
            f" {med_after(lo):.3f}로 목표 {target}에 못 닿는다. 렌더 조명을 손볼 것"
        )
    else:
        # lo = "목표를 만족하는 감마", hi = "못 만족하는 감마". 감마가 작을수록
        # 밝으므로 만족하는 쪽이 lo다. 10회면 해상도 6e-4 — 중앙 명도 한 단계
        # (1/255 = 0.004)보다 촘촘하다
        for _ in range(10):
            mid = (lo + hi) / 2
            if med_after(mid) >= target:
                lo = mid
            else:
                hi = mid
    out = Image.new("RGBA", src.size)
    out.putdata(apply_gamma(px, lo))
    return out


def quantize(im: Image.Image, colors: int) -> Image.Image:
    """팔레트를 `colors`색으로 줄인다. 알파는 건드리지 않는다.

    투명 픽셀의 RGB가 팔레트 자리를 먹지 않도록 배경을 한 색으로 밀어 두고
    양자화한다 — 안 밀면 7500색 중 배경 그라디언트가 색 예산을 태운다.
    """
    a = im.getchannel("A")
    flat = Image.composite(im.convert("RGB"), Image.new("RGB", im.size, (0, 0, 0)), a)
    q = flat.quantize(
        colors=colors, method=Image.MEDIANCUT, dither=Image.NONE
    ).convert("RGBA")
    q.putalpha(a)
    return q


def union_box(m: dict) -> list[int]:
    x0, y0, x1, y1 = 1 << 30, 1 << 30, -1, -1
    for b in m["boxes"]:
        if not b:
            continue
        x0, y0 = min(x0, b[0]), min(y0, b[1])
        x1, y1 = max(x1, b[0] + b[2]), max(y1, b[1] + b[3])
    if x1 < 0:
        return [0, 0, m["cellW"], m["cellH"]]
    return [x0, y0, x1 - x0, y1 - y0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--src", default=str(Path.home() / "asset-research" / "sidescroll")
    )
    args = ap.parse_args()
    src = Path(args.src)
    cat = json.loads((src / "catalog.json").read_text())
    by_slug = {a["slug"]: a for a in cat["assets"]}
    # 주인공은 별도 카탈로그다 — 팩 폴더·해상도·라이선스 트랙이 다르다
    cat3d = json.loads((src / "catalog3d_p4.json").read_text())
    for a in cat3d["assets"]:
        if a["slug"] in by_slug:
            raise SystemExit(f"{a['slug']}: 두 카탈로그에 중복으로 있다")
        by_slug[a["slug"]] = a

    out_dir = Path(__file__).resolve().parent.parent / "public" / "assets" / "chars"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    manifest: dict[str, object] = {"chars": {}}
    chars: dict[str, object] = manifest["chars"]  # type: ignore[assignment]
    total = 0

    def add(slug: str, kind: str, extra: dict) -> None:
        nonlocal total
        a = by_slug.get(slug)
        if a is None:
            raise SystemExit(f"{slug}: 카탈로그에 없다")
        generated = bool(a.get("aiGenerated"))
        chierit = a["author"] == "chierit"
        if a["license"] != "CC0" and not generated and not chierit:
            # 상용 판매 조건 — **재배포 금지**(Clembod)는 여기서 막는다.
            # 예외는 둘: 우리가 만든 것(소유권이 우리에게 있다)과 chierit
            # CC-BY 4.0(상용 허용, 조건은 크레딧 표기 하나뿐 — `CREDITS.md`).
            raise SystemExit(f"{slug}: 라이선스가 CC0가 아니다 ({a['license']})")
        if chierit and "CC-BY" not in a["license"]:
            # 작가 이름만 보고 통과시키면, 이 작가가 나중에 다른 조건으로 낸 팩이
            # 조용히 들어온다. 통과 근거는 이름이 아니라 라이선스다
            raise SystemExit(
                f"{slug}: chierit 트랙인데 CC-BY가 아니다 ({a['license']})"
            )
        # 3D 렌더 트랙은 팩 폴더가 다르고(`packDir`) 액션도 한 벌 더 온다
        pack_dir = src / a.get("packDir", "packed").rstrip("/")
        want = WANT_CHIERIT if chierit else WANT_3D if generated else WANT_2D
        div = 2 if generated and HERO3D_HALVE else 1
        crop_pad = CHIERIT_CROP_PAD if chierit and CHIERIT_CROP else None
        sheet, actions = pack(
            pack_dir, slug, a["actions"], want, div, crop_pad,
            trim_combos=chierit,
        )
        if generated:
            # 명도 리프트를 **양자화 앞에** 둔다. 뒤에 두면 24색 팔레트를 어두운
            # 색으로 만든 뒤 그걸 밝히는 셈이라, 어두운 쪽 계조가 이미 뭉갠
            # 상태에서 늘어나 밴딩이 보인다
            sheet = lift_luminance(sheet, HERO3D_TARGET_LUM, slug)
            # 3D 렌더는 색이 7500종이다 — 팔레트를 줄여야 픽셀아트로 읽힌다
            sheet = quantize(sheet, HERO3D_COLORS)
        elif chierit:
            # **주인공만 리프트한다.** 잡몹은 어두워도 되지만(어두운 적이 의도다)
            # 주인공은 배경보다 어두우면 실루엣이 배경에 녹아 구멍처럼 보인다 —
            # 불의 기사 0.116, 물의 여사제 0.117이 배경 최대 0.328보다 어둡다.
            #
            # **손으로 그린 픽셀아트를 감마로 들면 팔레트가 씻긴다**는 것이
            # 잡몹을 안 건드리는 이유였는데, chierit 시트에서 재 보니 고유색이
            # 100% 유지된다(불의 기사 10색 → 10색). 팔레트가 10~17색뿐이라 감마가
            # 단조 함수로서 색을 서로 겹치게 만들 만큼 촘촘하지 않다.
            # 3D 렌더(7500색, 37%가 상한에 박혔다)와 사정이 다르다.
            sheet = lift_luminance(sheet, HERO3D_TARGET_LUM, slug)
            # 양자화는 하지 않는다 — 이미 픽셀아트 팔레트다. 24색으로 줄이면
            # 17색짜리 잎의 레인저는 그대로지만 이펙트 계조가 뭉갠다
        sheet.save(out_dir / f"{slug}.png", optimize=True)
        total += (out_dir / f"{slug}.png").stat().st_size
        # 저장한 시트를 그대로 다시 재서 매니페스트에 남긴다(양자화 **뒤**의 값).
        # 리프트 전 값을 적으면 화면과 다른 숫자를 검사하게 된다
        med = median_lum(sheet)
        chars[slug] = {
            "kind": kind,
            "name": a["name"],
            "author": a["author"],
            "license": a["license"],
            "url": a["url"],
            "female": bool(a.get("female")),
            # baseGap = 기준 액션의 발밑과 셀 하단 사이 여백. 안 더하면
            # 에셋마다 최대 83px 공중에 뜬다. 축소하면 여백도 같이 줄어든다
            "baseGap": round(a["baseGap"] / div),
            "refSubjH": round(a["refSubjH"] / div),
            "w": sheet.width,
            "h": sheet.height,
            # 라이선스 감사용 트랙 표시 — CC0 목록과 자작 목록을 섞으면
            # 나중에 무엇을 팔 수 있는지 되짚을 수 없다
            "generated": generated,
            # 시트의 중앙 명도. **런타임은 안 쓴다 — 테스트가 쓴다.**
            # 이 숫자가 없으면 어두운 재렌더가 조용히 돌아올 수 있다(리제
            # 0.063·실비아 0.057이 그렇게 들어왔고, 배경이 밝아질 때까지
            # 아무도 몰랐다). PNG를 디코드하는 의존성을 테스트에 넣는 대신
            # 임포터가 재서 남긴다
            "medLum": round(med, 4),
            "actions": actions,
            **extra,
        }
        print(
            f"  {slug:18s} {sheet.width}x{sheet.height} "
            f"{len(actions)}액션 lum={med:.3f}"
        )

    print("== 주인공")
    for slug, display in HEROES:
        # faces = 시트에 그려진 원본 방향. **chierit는 오른쪽을 본다**(자체 생성
        # 3D 렌더 4인은 왼쪽이었다 — 로스터를 교체했으므로 이 값도 바뀐다).
        # 틀리면 런타임이 반대로 뒤집어서 주인공이 등을 보인 채 뒷걸음질로 적에게
        # 다가가고, 달리기가 진행 방향과 반대로 다리를 젓는다. 좌표는 다 맞기
        # 때문에 코드를 읽어서는 안 잡힌다.
        add(slug, "hero", {"displayName": display, "faces": 1})
    print("== 잡몹")
    for slug, hmul, lift in MINIONS:
        add(slug, "minion", {"hMul": hmul, "lift": lift})
    print("== 보스")
    for slug, hmul in BOSSES:
        add(slug, "boss", {"hMul": hmul, "lift": 0.0})

    (out_dir / "chars.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    )
    print(f"\n{len(chars)}종 / {total / 1024:.0f}KB → {out_dir}")


if __name__ == "__main__":
    main()
