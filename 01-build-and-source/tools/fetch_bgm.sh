#!/usr/bin/env bash
#
# BGM 다운로드 + 루프 가공. **CC-BY 트랙이라 `fetch_assets.sh`와 분리한다.**
#
# 설계 문서: specs/2026-07-27-ux/01-art-direction.md §5 (라이선스), §7 (오디오)
#          docs/superpowers/specs/2026-08-08-four-roster-solo-bgm-design.md §4
#
# ## 왜 별도 스크립트인가
#
# `fetch_assets.sh`는 **CC0가 아닌 항목을 만나면 즉시 죽는다** (거기 §라이선스
# 검수). 그 게이트는 우회하지 않는다 — 그것이 나머지 6개 팩을 지키는 검사이고,
# 예외를 한 줄 넣으면 다음에 CC-BY-SA가 섞여도 안 울린다. 표기 의무가 있는
# 트랙은 검사가 **더 엄격해야** 하므로(작가·제목·라이선스 URL·변경 고지 4항목이
# 다 있어야 통과) 그 규칙을 여기 따로 쓴다.
#
# ## 왜 매니페스트를 쓰는가
#
# `bgm.json`을 만들고 `fetch_assets.sh`가 CREDITS.md의 음악 표를 **거기서
# 뽑는다.** `chars.json`과 같은 이유다(그 스크립트 머리말): 표기가 라이선스
# 조건이므로 손으로 적으면 곡을 바꾼 날 문서만 옛것으로 남고, 그 어긋남 자체가
# 위반이다. 매니페스트가 실물과 같이 움직이면 어긋날 수 없다.
#
# ## 왜 잘라서 크로스페이드하는가
#
# 원본은 끝이 페이드아웃이다(카탈로그 설명에도 "you need to trim the end"라고
# 적혀 있다). 꼬리 RMS가 −76dB이라 그대로 반복하면 **한 바퀴마다 정적이 낀다**
# — 4시간 하강에서 곡이 72번 도므로 72번 낀다.
#
# 루프 길이는 임의로 못 정한다. dive 트랙의 실측 박이 1.0200s(58.8bpm, 카탈로그
# 58bpm과 일치)이고 마디는 4.08s인데, **마디에 맞추는 것으로는 부족했다**: 마디
# 수 36·38·40이 좋고 37·39가 나쁜 교대 패턴이 나와서 진짜 단위가 **2마디
# 프레이즈(8.16s)**임이 드러났다. 짝수 마디에서 이음새 도약이 0.06~0.08이고
# 홀수에서 0.41~0.48이다.
#
# 판정 기준은 절대값이 아니라 **곡 자신의 전이 분포**다. 이 곡은 0.5초마다
# 스펙트럼이 원래 변한다(중앙 0.236 · 90분위 0.654) — 물어야 하는 것은
# "이음새가 이 곡에서 이상한가"다. 40마디 이음새는 0.076 = 곡의 약 15분위이므로
# 되감기는 순간이 곡 안의 평범한 순간보다 **덜** 튄다.
#
# 크로스페이드 길이는 거의 영향이 없었다(같은 지점에서 2s~8s가 0.068~0.130).
# 그래도 8.16s = 프레이즈 한 개로 둔다 — 임의의 초가 아니라 음악 단위여야
# 다음 사람이 이 숫자를 안 바꾼다.
#
# **이 방법은 곡마다 다시 돌린다.** 위 짝수/홀수 교대는 dive 트랙의 성질이고
# 타이틀 곡(Crypto)에서는 성립하지 않는다(29마디가 32마디보다 좋다) — 마디 수를
# 옮겨 적는 것이 아니라 곡 자신의 전이 분포로 다시 고른 값이 `TRACKS`에 있다.
#
# 사용법: tools/fetch_bgm.sh [--only <slug>]
# 멱등하다 — 이미 받은 원본은 다시 받지 않는다.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="${HOME}/asset-research/downloads/bgm"
OUT_DIR="${REPO_ROOT}/public/assets/bgm"
MANIFEST="${OUT_DIR}/bgm.json"

mkdir -p "$DOWNLOAD_DIR" "$OUT_DIR"

# `--only <slug>`이면 그 트랙만 가공한다. **매니페스트는 여전히 전 트랙을 쓴다**
# — 한 트랙만 다시 받았을 때 `bgm.json`에서 다른 트랙이 사라지면 CREDITS.md의
# 표기가 조용히 빠지고, 그것이 곧 라이선스 위반이다.
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift 2 ;;
    *) echo "알 수 없는 인자: $1 (사용법: tools/fetch_bgm.sh [--only <slug>])" >&2; exit 2 ;;
  esac
done

# ── 트랙 정의 ─────────────────────────────────────────────────────────────
#
# CC-BY 4.0의 표기 4항목(BY-SA와 달리 전파는 없다):
#   ① 저작자  ② 제목  ③ 라이선스 이름 + URL  ④ 변경했다는 고지
# Incompetech FAQ가 요구하는 문구 형식이 `ATTRIBUTION`이다 — 그 페이지가 준
# 형식을 **글자 그대로** 쓴다. "Music by Kevin MacLeod" 한 줄은 ③④가 없어서
# 형식 위반이고, 진짜 위험은 소송이 아니라 **심사**다.
#
# **트랙마다 게인이 다르다.** 라우드니스가 곡의 성질이므로 같은 게인이 두 곡에서
# 다른 크기로 들린다 — 실측으로 dive의 0.44를 타이틀에 쓰면 마스킹 상한을 1.9dB
# 넘는다(설계 §4-3). 게인은 `src/shared/bgmRules.ts`가 들고, 이 스크립트는 파일과
# 표기만 만든다. 두 곳에 두는 이유: 게인은 **믹스**의 성질이라 곡을 다시 받지
# 않고도 바뀔 수 있다.
#
# 배열이고 연관배열이 아닌 이유: bash 연관배열은 순서를 안 지키고, 순서가
# `bgm.json`의 순서이며 그것이 CREDITS.md 표의 순서다.
#
# 필드 순서: SLUG|TITLE|AUTHOR|LICENSE|TRACK_URL|ISRC|BARS|BEAT_S|XFADE_BARS|USED_IN
TRACKS=(
  "dive_loop|Oppressive Gloom|Kevin MacLeod|CC-BY 4.0|https://incompetech.com/music/royalty-free/mp3-royaltyfree/Oppressive%20Gloom.mp3|USUAN1100885|40|1.0200|2|하강(싱글) 모드 배경음"
  # 타이틀 곡. 실측 박이 0.7430s(80.75bpm, 카탈로그 80과 일치) — 온셋 자기상관의
  # 최대는 0.3715s(반박)에 있고 그것을 박으로 쓰면 마디가 절반이 되어 프레이즈가
  # 어긋난다. 30마디를 고른 근거는 이음새 전이 0.466 = 이 곡 자신의 6.4분위다
  # (짝수/홀수 교대는 이 곡에서 성립하지 않는다 — 29마디가 32마디보다 좋다).
  "title_loop|Crypto|Kevin MacLeod|CC-BY 4.0|https://incompetech.com/music/royalty-free/mp3-royaltyfree/Crypto.mp3|USUAN1600013|30|0.7430|2|타이틀·선택 화면 배경음"
)

# 라이선스 URL과 표기 문구 형식은 두 트랙이 공유한다 (같은 작가·같은 라이선스)
LICENSE_URL="https://creativecommons.org/licenses/by/4.0/"
attribution_for() {  # $1=title
  echo "$1 Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 ${LICENSE_URL}"
}
source_page_for() { # $1=title — 공백을 +로
  echo "https://incompetech.com/music/royalty-free/index.html?keywords=${1// /+}"
}

# 가공 파라미터 — 트랙별 값(박·마디·크로스페이드)은 위 배열에 있고 여기는 공용만
BITRATE=56k        # 모노. §용량은 아래 검사가 지킨다
MAX_BYTES=1400000  # 한 포맷당 상한 — 넘으면 실패한다(조용히 커지지 않게)

# 이번 실행에서 **실제로 원본을 받은** 슬러그. 매니페스트의 `downloadedAt`을
# 이 목록에 있는 트랙만 오늘로 찍는다 (아래 다운로드 절의 주석).
FETCHED_NEW=()

for spec in "${TRACKS[@]}"; do
  IFS='|' read -r SLUG TITLE AUTHOR LICENSE TRACK_URL ISRC BARS BEAT_S XFADE_BARS USED_IN <<<"$spec"
  ATTRIBUTION="$(attribution_for "$TITLE")"
  SOURCE_PAGE="$(source_page_for "$TITLE")"
  LOOP_S=$(python3 -c "print(f'{$BEAT_S*4*$BARS:.4f}')")
  XFADE_S=$(python3 -c "print(f'{$BEAT_S*4*$XFADE_BARS:.4f}')")

  if [[ -n "$ONLY" && "$ONLY" != "$SLUG" ]]; then
    echo "== [skip] ${SLUG} (--only ${ONLY})"
    continue
  fi
  echo "== ${SLUG} — ${TITLE}"

  echo "== 원본 다운로드"
  SRC="${DOWNLOAD_DIR}/${TITLE}.mp3"
  if [[ -f "$SRC" ]]; then
    echo "  [skip] ${TITLE} (이미 있음)"
  else
    echo "  [get ] ${TITLE}"
    curl -fsSL "$TRACK_URL" -o "${SRC}.part"
    mv "${SRC}.part" "$SRC"
    # **받은 날은 실제로 받은 트랙만 갱신한다.** 이 스크립트는 멱등해서 대개
    # 아무것도 받지 않는데, 그때도 오늘 날짜를 찍으면 CREDITS.md가 "오늘 받았다"고
    # 말한다 — 일주일 전에 받은 파일에 대해서. 표기 표의 목적이 감사 가능성이므로
    # 그 거짓은 표를 쓸모없게 만든다(실제로 한 번 그렇게 덮였다).
    FETCHED_NEW+=("$SLUG")
  fi

  echo
  echo "== 표기 항목 검수 (하나라도 비면 중단)"
  # **양이 아니라 항목의 존재를 묻는다.** CC-BY에서 빠진 항목은 화면이 안 죽는
  # 실패다 — 배포된 뒤에 심사자가 발견한다.
  fail=0
  for pair in "저작자:$AUTHOR" "제목:$TITLE" "라이선스:$LICENSE" \
              "라이선스URL:$LICENSE_URL" "출처페이지:$SOURCE_PAGE" "표기문구:$ATTRIBUTION"; do
    label="${pair%%:*}"; value="${pair#*:}"
    if [[ -z "$value" ]]; then echo "  [FAIL] ${label}가 비었다" >&2; fail=1; fi
  done
  # 표기 문구가 4항목을 실제로 담고 있는지 — 형식이 조건이다
  for must in "$TITLE" "$AUTHOR" "creativecommons.org/licenses/by/4.0"; do
    if [[ "$ATTRIBUTION" != *"$must"$'\n'* && "$ATTRIBUTION" != *"$must"* ]]; then
      echo "  [FAIL] 표기 문구에 '${must}'가 없다" >&2; fail=1
    fi
  done
  if [[ "$LICENSE" != CC-BY* ]]; then
    echo "  [FAIL] ${LICENSE} — 이 스크립트는 CC-BY 전용이다. CC0는 fetch_assets.sh, 전파형(CC-BY-SA)·비상업은 금지(§5-1)" >&2
    fail=1
  fi
  [[ $fail -eq 0 ]] || exit 1
  echo "  [ok  ] 4항목(작가·제목·라이선스+URL·변경 고지) 확보"

  echo
  echo "== 루프 가공 (${BARS}마디 = ${LOOP_S}s, 크로스페이드 ${XFADE_BARS}마디 = ${XFADE_S}s)"
  ffmpeg -v error -y -i "$SRC" -ac 1 -ar 44100 -f f32le "${DOWNLOAD_DIR}/_src.f32"

  # 히어독 본문과 종료 표시(`PY`)는 들여쓰지 않는다 — 종료 표시에 공백이 붙으면
  # 히어독이 안 닫히고, 본문을 들여쓰면 python이 IndentationError로 죽는다.
  python3 - "${DOWNLOAD_DIR}/_src.f32" "${DOWNLOAD_DIR}/_loop.f32" "$LOOP_S" "$XFADE_S" <<'PY'
import sys, numpy as np
SR = 44100
src, dst, L, xf = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
x = np.fromfile(src, dtype=np.float32).astype(np.float64)
b, n = int(L * SR), int(xf * SR)
if x.size < b + n:
    sys.exit(f"원본이 짧다: {x.size/SR:.1f}s < {(b+n)/SR:.1f}s")

# **겹치는 자리가 앞머리다.** 되감기는 지점은 `out[-1] → out[0]`이므로,
# 섞어야 하는 것은 루프의 **앞머리**와 루프 끝 직후의 재료(x[b:b+n])다.
# 처음에 `out[-n:] = x[-n:]*fo + x[b:b+n]*fi`로 썼는데 그건 인접한 두 구간을
# 섞은 것이라 되감기는 지점을 전혀 매끄럽게 하지 않았다 — 진폭 점프가
# 0.34로 남았고 RMS가 8.9dB 어긋났다. 앞머리에 겹치면 x[b-1] 다음에 오는
# 첫 샘플이 이미 x[b]를 품고 있어서 양쪽이 다 연속이다.
t = np.linspace(0, 1, n, endpoint=False)
out = x[:b].copy()
out[:n] = x[:n] * np.sin(t * np.pi / 2) + x[b:b + n] * np.cos(t * np.pi / 2)  # 등파워

peak = np.abs(out).max()
if peak > 0.999:
    out *= 0.999 / peak   # 겹친 구간이 클리핑되면 이음새에서 지글거린다
out.astype(np.float32).tofile(dst)
print(f"  루프 {b/SR:.2f}s (앞머리 {n/SR:.2f}s에 끝 직후 재료를 겹쳤다)")
PY

  for fmt in ogg m4a; do
    case "$fmt" in
      ogg) codec=libvorbis ;;
      m4a) codec=aac ;;   # ogg를 못 읽는 사파리용 — sfx와 같은 폴백 규약
    esac
    ffmpeg -v error -y -f f32le -ar 44100 -ac 1 -i "${DOWNLOAD_DIR}/_loop.f32" \
      -c:a "$codec" -b:a "$BITRATE" "${OUT_DIR}/${SLUG}.${fmt}"
    size=$(stat -c%s "${OUT_DIR}/${SLUG}.${fmt}")
    if (( size > MAX_BYTES )); then
      echo "  [FAIL] ${SLUG}.${fmt} ${size}B > 상한 ${MAX_BYTES}B" >&2
      exit 1
    fi
    echo "  [ok  ] ${SLUG}.${fmt} ${size}B"
  done

  rm -f "${DOWNLOAD_DIR}/_src.f32" "${DOWNLOAD_DIR}/_loop.f32"
  echo
done

echo
echo "== ${MANIFEST}"
STAMP="${ASSET_FETCH_DATE:-$(date +%Y-%m-%d)}"
# 트랙 정의를 python에 그대로 넘긴다 — bash에서 JSON을 조립하면 따옴표가 섞인다.
#
# **인자로 넘긴다. 파이프로는 안 된다** — `python3 -`는 *프로그램*을 stdin에서
# 읽으므로 히어독(`<<'PY'`)이 이미 stdin을 쓰고 있다. 거기에 `printf | `를 더하면
# 히어독이 이기고 `sys.stdin.read()`가 빈 문자열을 준다. 그 상태의 증상은 조용하지
# 않고 "트랙이 2개 미만" 게이트로 죽는다 — 그 게이트가 없었으면 트랙 0개짜리
# 매니페스트를 쓰고 CREDITS.md의 음악 표가 통째로 비었을 것이다.
#
# `FETCHED_NEW`는 **이번에 실제로 받은** 트랙이다. 빈 배열이면 `--` 뒤가 비므로
# 구분자를 항상 넣고 python이 그 뒤를 목록으로 읽는다.
python3 - "$MANIFEST" "$STAMP" "$OUT_DIR" "$BITRATE" "$LICENSE_URL" \
  "${TRACKS[@]}" -- ${FETCHED_NEW[@]+"${FETCHED_NEW[@]}"} <<'PY'
import json, sys, os
manifest, stamp, out_dir, bitrate, license_url = sys.argv[1:6]
rest = sys.argv[6:]
sep = rest.index("--")
track_lines, fetched_new = rest[:sep], set(rest[sep + 1:])

# **받은 날은 안 받은 트랙에서 옛 값을 지킨다.** 이 스크립트는 멱등해서 보통
# 아무것도 받지 않는데, 그때도 오늘로 찍으면 CREDITS.md의 표기 표가 "오늘 받았다"고
# 거짓을 말한다(실제로 한 번 dive_loop의 08-07이 오늘로 덮였다). 표의 목적이
# 감사 가능성이므로 그 거짓은 표를 쓸모없게 만든다.
prev_stamp = {}
if os.path.exists(manifest):
    try:
        for t in json.load(open(manifest))["tracks"]:
            prev_stamp[t["slug"]] = t["downloadedAt"]
    except (ValueError, KeyError):
        pass  # 깨진 매니페스트는 오늘로 다시 쓴다 — 없는 것과 같다

tracks = []
for line in track_lines:
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    slug, title, author, lic, url, isrc, bars, beat, xbars, used_in = line.split("|")
    bars, xbars, beat = int(bars), int(xbars), float(beat)
    loop = round(beat * 4 * bars, 4)
    xf = round(beat * 4 * xbars, 4)
    files = [f"{slug}.ogg", f"{slug}.m4a"]
    # **파일이 없는 트랙을 적지 않는다.** 적으면 CREDITS.md에 표기만 있고 실물이
    # 없는 줄이 생기고, 게임은 404를 무음으로 삼킨다(`audio.loadBgm`의 폴백).
    missing = [f for f in files if not os.path.exists(os.path.join(out_dir, f))]
    if missing:
        sys.exit(f"{slug}: {missing} 가 없다 — --only 없이 한 번 돌려라 "
                 "(매니페스트에 실물 없는 트랙을 적을 수 없다)")
    # ④ 변경 고지 — CC-BY가 요구하는 항목이다. 무엇을 어떻게 바꿨는지 적는다.
    mods = (
        f"모노 44.1kHz로 변환, 앞에서 {loop:.2f}초({bars}마디)만 남기고 뒤를 잘라냄"
        f"(원본 끝이 페이드아웃이라 그대로는 루프가 안 된다), "
        f"루프 이음새를 프레이즈 한 개({xf:.2f}초, {xbars}마디) 등파워 크로스페이드로 이어 붙임, "
        f"{bitrate} ogg/m4a로 인코딩"
    )
    tracks.append({
        "slug": slug, "title": title, "author": author,
        "license": lic, "licenseUrl": license_url,
        "sourcePage": "https://incompetech.com/music/royalty-free/index.html?keywords="
                      + title.replace(" ", "+"),
        "trackUrl": url, "isrc": isrc,
        "attribution": f"{title} {author} (incompetech.com) Licensed under Creative Commons:"
                       f" By Attribution 4.0 {license_url}",
        # 이번에 받았으면 오늘, 아니면 옛 값(없으면 오늘 — 첫 기록이다)
        "downloadedAt": stamp if slug in fetched_new else prev_stamp.get(slug, stamp),
        "usedIn": used_in, "modifications": mods,
        "loopSeconds": loop, "bars": bars, "beatSeconds": beat,
        "files": files,
    })
if len(tracks) < 2:
    sys.exit("트랙이 2개 미만이다 — 타이틀/인게임 분리가 이 회차의 목표다")
m = {
    "note": "tools/fetch_bgm.sh가 생성한다. 직접 수정하지 말 것 — CREDITS.md의 음악 표를 여기서 뽑는다.",
    "tracks": tracks,
}
json.dump(m, open(manifest, "w"), ensure_ascii=False, indent=2)
open(manifest, "a").write("\n")
print(f"  wrote {manifest} ({len(tracks)} tracks)")
PY

echo
echo "완료. 다음: tools/fetch_assets.sh (CREDITS.md의 음악 표를 이 매니페스트에서 다시 뽑는다)"
