#!/usr/bin/env python3
"""BGM 트랙의 게인 구간을 실측한다 — `src/shared/bgmRules.ts`의 표를 만드는 자.

설계 문서: docs/superpowers/specs/2026-08-08-four-roster-solo-bgm-design.md §4-3

## 왜 스크립트로 남기는가

`bgmRules.ts`의 게인은 실측에서 유도된 값이고, 그 실측은 node 테스트가 할 수
없다(ffmpeg·numpy가 필요하다). 유도를 문서에만 적으면 곡을 바꾸는 사람이 숫자를
**옮겨 적게** 되고, 그것이 0.22 사건의 형태다 — 상수는 그럴듯한데 어느 곡에서
나온 값인지 아무도 다시 못 잰다. 이 파일을 돌리면 표가 다시 나온다.

## 두 경계가 서로 다른 자로 재진다

- **하한**은 "들려야 한다"이고, 사람이 듣는 크기는 통합 라우드니스다 → LUFS
  (`ffmpeg -af ebur128`).
- **상한**은 "효과음이 묻히면 안 된다"이고, 마스킹은 **동시에 겹치는 순간의**
  레벨 문제다 → 400ms 창 RMS의 중앙값(dBFS).

**이 둘을 한 척도로 섞으면 상한이 조용히 느슨해진다.** 상한을 LUFS로 풀면
dive에서 0.518이 나오는데 실측 경계는 0.460이다 — 1.2dB 헐거운 게이트이고,
그 상태에서도 "게인이 상한 아래" 검사는 전부 통과한다. 그래서 `bgmRules.ts`의
상한은 트랙이 들고 있는 `bedUnityDbfs`(게인 1에서의 베드 레벨)에서 푼다.

## 마스킹 한계는 다시 유도하지 않고 **옮긴다**

한계 레벨(`MASK_BED_DBFS`)은 dive의 상한 0.46에서 나온 베드 레벨이다. 0.46은
효과음을 하나하나 재서 "신호가 6dB 남는 경계"로 확정된 값이고(`bgmRules.ts`
머리말의 두 표), **귀로 검증까지 지난 값**이다 — 0.22가 안 들린다는 보고를 받고
고친 그 회차다.

그 6dB 유도를 여기서 다시 돌리지 않는 이유: 원래 쓰인 창·가중이 코드에 안 남아
있어서 재현이 안 된다. 이 스크립트로 소박하게(창 최대 RMS 대 베드 중앙값) 다시
풀면 dive 상한이 0.204로 나오는데, 그건 **하한 0.409보다 낮다** — 겹치는 구간이
없다는 뜻이고, 실제로 그 게인으로 배포해서 "안 들린다"는 보고를 받은 방향이다.
즉 그 재유도는 방법이 틀렸다. 마스킹 한계는 **효과음의 성질**이고 효과음 파일이
안 바뀌었으므로, 재유도가 아니라 이미 검증된 경계를 레벨로 옮겨 적는 것이 맞다.

아래 `--check`가 그 이식이 자기일관적인지 되돌려 확인한다: 한계 레벨에서 dive의
상한을 다시 풀면 0.46이 나와야 한다.

사용법: python3 tools/measure_bgm_gain.py
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
MASTER = 0.8  # audio.ts의 MASTER_VOLUME
BED_MIN_LUFS = -30.0  # 휴대폰 스피커의 실질 가청 바닥

# dive의 검증된 상한 — 이 값에서 마스킹 한계 레벨을 뽑는다(위 "옮긴다" 절)
DIVE_SLUG = "dive_loop"
DIVE_VALIDATED_CEILING = 0.46

# 맥락으로만 찍는다 — 상한을 정하는 데 쓰지 않는다(위 절: 재유도는 방법이 틀렸다)
SIGNAL_SFX = {
    "cooldown_ready": 0.8,
    "gauge_danger": 0.85,
    "skill_cast": 0.9,
    "enemy_death": 0.75,
    "interference": 0.9,
}

ASSETS = Path(__file__).resolve().parent.parent / "public" / "assets"


def decode(path: Path) -> np.ndarray:
    """모노 44.1kHz float32로 디코드. 게임이 재생하는 것과 같은 파일을 읽는다."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


def window_rms_db(x: np.ndarray, ms: float) -> np.ndarray:
    """창 단위 RMS(dBFS). 마스킹은 순간의 문제이므로 창으로 잰다."""
    n = min(int(SR * ms / 1000), x.size)
    k = x.size // max(n, 1)
    if k == 0:
        return np.array([-120.0])
    frames = x[: k * n].reshape(k, n)
    return 20 * np.log10(np.maximum(np.sqrt((frames**2).mean(axis=1)), 1e-9))


def bed_unity_dbfs(path: Path) -> float:
    """게인 1에서의 베드 레벨 = 400ms 창 RMS의 **중앙값**.

    최대가 아니라 중앙값인 이유: 마스킹을 결정하는 것은 곡의 한 번뿐인 절정이
    아니라 **평소 깔려 있는 레벨**이다. 최대로 재면 조용한 곡이 시끄러운 곡보다
    엄한 상한을 받는다.
    """
    return float(np.median(window_rms_db(decode(path), 400)))


def integrated_lufs(path: Path) -> float:
    """`ffmpeg -af ebur128`의 통합 라우드니스. 하한은 이 자로 재진다."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    lines = proc.stderr.splitlines()
    for i, line in enumerate(lines):
        if "Summary" in line:
            for tail in lines[i:]:
                if tail.strip().startswith("I:"):
                    return float(tail.split()[1])
    sys.exit(f"{path}: ebur128 요약을 못 읽었다")


def gain_for_bed_dbfs(target_dbfs: float, bed_unity: float) -> float:
    return 10 ** ((target_dbfs - bed_unity) / 20) / MASTER


def gain_for_bed_lufs(target_lufs: float, source_lufs: float) -> float:
    return 10 ** ((target_lufs - source_lufs) / 20) / MASTER


def main() -> None:
    bgm_dir = ASSETS / "bgm"
    manifest = json.loads((bgm_dir / "bgm.json").read_text())

    # ① 마스킹 한계 레벨을 dive의 검증된 상한에서 뽑는다
    dive_bed = bed_unity_dbfs(bgm_dir / f"{DIVE_SLUG}.ogg")
    mask_bed = dive_bed + 20 * np.log10(DIVE_VALIDATED_CEILING * MASTER)
    print("== 마스킹 한계 레벨 (dive의 검증된 상한에서 이식)")
    print(f"  {DIVE_SLUG} 베드@g=1  {dive_bed:7.2f} dBFS")
    print(f"  × 게인 {DIVE_VALIDATED_CEILING} × 마스터 {MASTER}")
    print(f"  = 한계 레벨      {mask_bed:7.2f} dBFS   ← bgmRules.ts의 BGM_MASK_BED_DBFS")
    back = gain_for_bed_dbfs(mask_bed, dive_bed)
    ok = abs(back - DIVE_VALIDATED_CEILING) < 1e-3
    print(f"  되돌림 검사: 한계 레벨 → dive 상한 {back:.4f} "
          f"({'ok' if ok else 'FAIL — 이식이 자기일관적이지 않다'})")
    if not ok:
        sys.exit(1)

    # ② 맥락: 신호 효과음 레벨. 상한을 정하지는 않는다(머리말 참조)
    print()
    print("== 신호 효과음 400ms 최대 창 레벨 (맥락용, 상한을 정하지 않는다)")
    for sfx, vol in sorted(SIGNAL_SFX.items()):
        x = decode(ASSETS / "sfx" / f"{sfx}.ogg")
        print(f"  {sfx:16s} {window_rms_db(x, 400).max() + 20 * np.log10(vol):7.2f} dBFS")

    # ③ 트랙별 구간
    print()
    print("== 트랙별 게인 구간")
    print("| 트랙 | 소스 LUFS | 베드@g=1 (dBFS) | 하한 | 상한 | 중간 |")
    print("|---|---|---|---|---|---|")
    rows = []
    for track in manifest["tracks"]:
        path = bgm_dir / f"{track['slug']}.ogg"
        lufs = integrated_lufs(path)
        bed = bed_unity_dbfs(path)
        floor = gain_for_bed_lufs(BED_MIN_LUFS, lufs)
        ceiling = gain_for_bed_dbfs(mask_bed, bed)
        rows.append((track["slug"], floor, ceiling))
        print(
            f"| {track['slug']} | {lufs:.1f} | {bed:.2f} | "
            f"{floor:.4f} | {ceiling:.4f} | {(floor + ceiling) / 2:.4f} |"
        )

    # ④ 겹치는 구간이 없으면 게인으로 풀 수 없다 — 곡을 바꿔야 한다
    print()
    for slug, floor, ceiling in rows:
        if floor >= ceiling:
            print(f"  [FAIL] {slug}: 하한 {floor:.4f} ≥ 상한 {ceiling:.4f} — "
                  "게인으로 풀 수 없다. 곡이나 믹스를 바꿔야 한다(설계 §4-3)")
            sys.exit(1)
        print(f"  [ok  ] {slug}: 겹치는 구간 {floor:.4f}~{ceiling:.4f}")


if __name__ == "__main__":
    main()
