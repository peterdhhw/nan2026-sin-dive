#!/usr/bin/env bash
#
# CC0 원본 → 게임용 효과음 12종(ogg + m4a = 24파일) 생성.
#
# 설계 문서: specs/2026-07-27-ux/01-art-direction.md §7 (사운드)
#
# 하는 일:
#   1. Kenney 팩(~/asset-research/extracted)에서 아래 표대로 파일을 고른다.
#   2. 모노 44.1kHz로 통일하고, 꼬리를 잘라 짧게 만든다(타격음이 뭉치지 않게).
#   3. 피크를 PEAK_TARGET_DB로 정규화한다 — 팩마다 음량이 달라서 이걸 안 하면
#      효과음 하나가 유독 크게 들린다.
#   4. `.ogg`(주) + `.m4a`(사파리 폴백) 두 포맷으로 인코딩한다.
#   5. **인코딩 결과의 피크를 다시 재서** 목표를 벗어나면 보정 후 재인코딩한다.
#      코덱 오버슈트 때문에 입력만 맞춰서는 출력이 맞지 않는다.
#   6. 파일당 ≤40KB / 합계 ≤400KB 예산을 검사한다.
#
# 선행: tools/fetch_assets.sh
# 사용법: tools/gen_sfx.sh

set -euo pipefail

SRC="${HOME}/asset-research/extracted"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${REPO_ROOT}/public/assets/sfx"

mkdir -p "$OUT"

command -v ffmpeg >/dev/null || { echo "ffmpeg이 필요하다" >&2; exit 1; }
[[ -d "$SRC" ]] || { echo "원본이 없다. tools/fetch_assets.sh를 먼저 실행할 것" >&2; exit 1; }

# out_name|source_relative_path|max_seconds|gain_dB
#
# 선정 근거 (직접 들어볼 수 없으므로 스펙트럼으로 검증했다):
#   hit_*          impactPunch_medium — 근접 타격. 3종 로테이션(§01-7)
#   skill_cast     confirmation_004 — 664→3302Hz 상승. "발동"의 고조
#                  (아래 "왜 maximize_005를 버렸나" 참조)
#   cooldown_ready confirmation_001 — 393→1170Hz 상승. 짧은 준비 완료 차임
#   enemy_death    impactSoft_heavy — 무른 타격. 생물이 무너지는 소리
#   ui_tap         click_001
#   ui_locked      error_002
#   win            jingles_STEEL02 — 298→469Hz 상승
#   lose           jingles_STEEL01 — 421→264Hz 하강
#   gauge_danger   minimize_006  — 529→276Hz 낮은 하강. 가라앉는 압박
#   interference   switch_001    — 4329→102Hz 급락 스윕. 뭔가 방해받은 느낌
#
# 음량은 역할별로 손으로 맞춘다. 타격음은 초당 여러 번 겹치므로 조금 낮춘다.
#
# ## 왜 maximize_005를 버렸나 — 발생률이 스펙트럼을 곱한다 (2026-08-07)
#
# 선정 기준이 "상승 스윕이라 발동으로 들린다"뿐이었고, **얼마나 자주 울리는지를
# 곱하지 않았다.** 스킬 쿨은 2.5~14초라 `skill_cast`는 분당 47회, 4시간 하강이면
# 11,280회다. 그 소리의 에너지 60.2%가 2~5kHz — 사람 귀가 가장 예민한 대역이다.
#
# 출하된 12종을 다 재보니 이 대역을 쓰는 것은 셋뿐이었다:
#   skill_cast 4602Hz(2-5k 60.2%) · ui_locked 6224Hz(19.5%) · interference 4288Hz(94.4%)
# 나머지 아홉은 97~788Hz로 깨끗하다. 뒤 둘은 발생률이 낮다(`ui_locked`는 오조작,
# `interference`는 PvP 전용) — 즉 **피로는 파일 하나에서 나왔다.**
#
# 1분 세션을 합성해 2~5kHz 절대 에너지로 후보를 줄 세웠다(타격 140/분 · 처치
# 28/분을 같이 깔았다 — 단독 파일 스펙트럼은 실제로 귀에 들어오는 것이 아니다):
#   타격·처치만(바닥)  68.5dB
#   maximize_005      97.7dB   ← 바닥보다 29dB
#   confirmation_004  89.5dB
#   question_001      68.5dB   ← 바닥
#
# `question_001`이 수치는 가장 깨끗하지만 **하강** 윤곽(1568→735Hz)이라 "취소"로
# 들린다 — 발동음이 취소로 읽히면 수치를 얻고 인과를 잃는다. `confirmation_004`는
# 상승 윤곽을 유지하면서 8.2dB를 줄이고, `cooldown_ready`(confirmation_001)와
# 같은 계열이라 준비→발동이 한 세트로 묶인다.
#
# **`cooldown_ready`는 건드리지 않는다.** 함께 분당 47회 울려서 같이 의심했는데
# 665Hz(0.5~2kHz에 94%)로 이 대역과 무관했다 — 껐다 켠 합성에서 2~5kHz가
# 97.7dB → 97.7dB로 **변하지 않았다.** 발생률이 높다는 것만으로 범인이 되지
# 않는다. 묻는 것은 발생률 × 그 소리가 쓰는 대역이다.
SFX=(
  "hit_0|kenney_impact-sounds/Audio/impactPunch_medium_000.ogg|0.30|-4"
  "hit_1|kenney_impact-sounds/Audio/impactPunch_medium_001.ogg|0.30|-4"
  "hit_2|kenney_impact-sounds/Audio/impactPunch_medium_002.ogg|0.30|-4"
  "skill_cast|kenney_interface-sounds/Audio/confirmation_004.ogg|0.49|0"
  "cooldown_ready|kenney_interface-sounds/Audio/confirmation_001.ogg|0.30|-3"
  "enemy_death|kenney_impact-sounds/Audio/impactSoft_heavy_000.ogg|0.45|-2"
  "ui_tap|kenney_interface-sounds/Audio/click_001.ogg|0.12|-3"
  "ui_locked|kenney_interface-sounds/Audio/error_002.ogg|0.20|-3"
  "win|kenney_music-jingles/Audio/Steel jingles/jingles_STEEL02.ogg|1.50|0"
  "lose|kenney_music-jingles/Audio/Steel jingles/jingles_STEEL01.ogg|1.50|-1"
  "gauge_danger|kenney_interface-sounds/Audio/minimize_006.ogg|0.40|-2"
  "interference|kenney_interface-sounds/Audio/switch_001.ogg|0.62|-1"
)

# 정규화 목표 피크.
# −1dBFS로 맞췄더니 vorbis 재인코딩 오버슈트로 출력이 0.0dB가 됐다.
# 게임에선 타격음·UI음·게이지음이 동시에 울리므로 헤드룸이 더 필요하다.
PEAK_TARGET_DB=-3

measure_peak() {
  # 파일의 피크(dBFS)를 잰다.
  #
  # `-v info`가 필수다. volumedetect의 리포트는 info 레벨로 나오므로
  # `-v error`로는 아무것도 못 읽고 조용히 0으로 떨어진다 —
  # 즉 정규화가 안 된 채 통과한다. 실제로 한 번 그렇게 당했다.
  local f="$1" max
  max="$(ffmpeg -v info -i "$f" -af volumedetect -f null - 2>&1 |
    grep -oE 'max_volume: -?[0-9.]+ dB' | grep -oE '\-?[0-9.]+' | head -1)"
  [[ -n "$max" ]] || { echo "  [FAIL] volumedetect 실패: ${f}" >&2; exit 1; }
  printf '%s' "$max"
}

encode() {
  # $1 원본  $2 게인dB  $3 최대초  $4 출력경로
  local src="$1" gain="$2" maxsec="$3" out="$4" fade_start
  local -a codec
  fade_start="$(awk -v d="$maxsec" 'BEGIN{ printf "%.3f", (d > 0.04 ? d - 0.04 : 0) }')"
  # fade out 40ms로 자른 끝의 클릭 노이즈를 막는다.
  local filter="volume=${gain}dB,atrim=0:${maxsec},afade=t=out:st=${fade_start}:d=0.04"
  case "$out" in
    *.ogg) codec=(-c:a libvorbis -q:a 3) ;;
    *)     codec=(-c:a aac -b:a 96k) ;;
  esac
  ffmpeg -v error -y -i "$src" -ac 1 -ar 44100 -af "$filter" "${codec[@]}" "$out"
}

echo "== 효과음 생성"
total=0
for entry in "${SFX[@]}"; do
  IFS='|' read -r name rel maxsec extra <<<"$entry"
  src="${SRC}/${rel}"
  [[ -f "$src" ]] || { echo "  [FAIL] 원본 없음: ${rel}" >&2; exit 1; }

  # 목표 피크 = 공통 목표 + 역할별 보정
  want="$(awk -v t="$PEAK_TARGET_DB" -v e="$extra" 'BEGIN{ printf "%.2f", t + e }')"
  gain="$(awk -v w="$want" -v p="$(measure_peak "$src")" 'BEGIN{ printf "%.2f", w - p }')"

  for ext in ogg m4a; do
    out="${OUT}/${name}.${ext}"
    encode "$src" "$gain" "$maxsec" "$out"
    # 코덱 오버슈트 보정: 출력을 실측해서 0.5dB 이상 벗어나면 차이만큼 물려 재인코딩한다.
    # 입력 피크만 맞춰서는 출력이 맞지 않는다 — vorbis가 위로 넘긴다.
    got="$(measure_peak "$out")"
    err="$(awk -v w="$want" -v g="$got" 'BEGIN{ printf "%.2f", w - g }')"
    if awk -v e="$err" 'BEGIN{ exit !(e > 0.5 || e < -0.5) }'; then
      encode "$src" "$(awk -v g="$gain" -v e="$err" 'BEGIN{ printf "%.2f", g + e }')" "$maxsec" "$out"
      got="$(measure_peak "$out")"
    fi
    eval "peak_${ext}=\$got"
  done

  o=$(stat -c%s "${OUT}/${name}.ogg")
  m=$(stat -c%s "${OUT}/${name}.m4a")
  total=$((total + o + m))
  flag=""
  # 예산은 포맷별로 본다 (§01-7: 파일당 ≤40KB)
  if (( o > 40960 || m > 40960 )); then flag="  ⚠ 40KB 초과"; fi
  printf "  %-16s 목표 %6sdB  ogg %6sB %6sdB  m4a %6sB %6sdB%s\n" \
    "$name" "$want" "$o" "$peak_ogg" "$m" "$peak_m4a" "$flag"
done

# 파일 단위 출처 기록 (설계 문서 01-5-3). CREDITS.md는 팩 단위라 여기서 파일 단위를 남긴다.
# 별도 파일로 쓰는 이유: CREDITS.md는 fetch_assets.sh가 덮어쓰므로 여기서 쓰면 지워진다.
{
  echo "# 효과음 파일별 출처"
  echo
  echo "> \`tools/gen_sfx.sh\`가 생성한다. 직접 수정하지 말 것."
  echo "> 전부 **CC0** — 상용 판매 포함 모든 용도로 사용 가능하다. 팩 단위 기록은 [../CREDITS.md](../CREDITS.md)."
  echo
  echo "| 출력 | 원본 | 팩 | 길이 상한 |"
  echo "|------|------|-----|-----------|"
  for entry in "${SFX[@]}"; do
    IFS='|' read -r name rel maxsec extra <<<"$entry"
    pack="${rel%%/*}"
    echo "| \`${name}.ogg\` / \`.m4a\` | \`$(basename "$rel")\` | \`${pack}\` | ${maxsec}s |"
  done
  echo
  echo "가공: 모노 44.1kHz, 피크 정규화(목표 ${PEAK_TARGET_DB}dBFS + 역할별 보정), 꼬리 컷, 40ms 페이드아웃."
} >"${OUT}/SOURCES.md"
echo "  wrote ${OUT}/SOURCES.md"

echo
printf "합계 %sB (%s KB) / 예산 400KB\n" "$total" "$((total / 1024))"
if (( total > 409600 )); then
  echo "  [FAIL] 총 용량 예산 초과 (§01-7)" >&2
  exit 1
fi
echo "  [ok] 용량 예산 통과"
