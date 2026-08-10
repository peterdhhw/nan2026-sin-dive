#!/usr/bin/env bash
#
# CC0 무료 에셋 다운로드 + 라이선스 기록 생성.
#
# 설계 문서: specs/2026-07-27-ux/01-art-direction.md §5 (에셋 라이선스 정책)
#
# 원칙:
#   - **이 스크립트가 받는 팩은** CC0만이다. 상용 판매 시 문제가 없어야 한다.
#   - 원본 아카이브는 ~/asset-research/downloads/ 에 두고 리포에 커밋하지 않는다.
#   - 가공 산출물만 public/assets/ 에 커밋한다.
#   - 받은 모든 것을 public/assets/CREDITS.md 에 파일 단위로 기록한다.
#
# **캐릭터는 이 스크립트가 받지 않는다.** 주인공 7종은 chierit CC-BY 4.0이고
# `tools/import_chars.py`가 별도로 팩한다. 그래서 크레딧의 캐릭터 표는 여기에
# 손으로 적지 않고 `chars.json`에서 **뽑는다** — 손으로 적었더니 로스터를
# chierit로 갈아탄 뒤에도 지워진 자체 생성 4종(리제·노라·실비아·클로에)이
# 그대로 남아 있었다. 표기 의무가 있는 트랙에서 그 어긋남은 라이선스 위반이다.
#
# 사용법: tools/fetch_assets.sh
# 멱등하다 — 이미 받은 아카이브는 다시 받지 않는다.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOWNLOAD_DIR="${HOME}/asset-research/downloads"
EXTRACT_DIR="${HOME}/asset-research/extracted"
CREDITS="${REPO_ROOT}/public/assets/CREDITS.md"
CHARS_JSON="${REPO_ROOT}/public/assets/chars/chars.json"
BGM_JSON="${REPO_ROOT}/public/assets/bgm/bgm.json"

mkdir -p "$DOWNLOAD_DIR" "$EXTRACT_DIR" "$(dirname "$CREDITS")"

# name|url|license|source_page
# 전부 Kenney.nl — CC0, 출처 표기 의무조차 없으나 감사 가능성을 위해 기록한다.
PACKS=(
  "kenney_impact-sounds|https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip|CC0|https://kenney.nl/assets/impact-sounds"
  "kenney_ui-audio|https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip|CC0|https://kenney.nl/assets/ui-audio"
  "kenney_interface-sounds|https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip|CC0|https://kenney.nl/assets/interface-sounds"
  "kenney_music-jingles|https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip|CC0|https://kenney.nl/assets/music-jingles"
  "kenney_background-elements|https://kenney.nl/media/pages/assets/background-elements/b66a1ddec7-1677670395/kenney_background-elements.zip|CC0|https://kenney.nl/assets/background-elements"
  "kenney_foliage-sprites|https://kenney.nl/media/pages/assets/foliage-sprites/b65bd70c69-1677495980/kenney_foliage-sprites.zip|CC0|https://kenney.nl/assets/foliage-sprites"
)

echo "== CC0 에셋 다운로드"
for entry in "${PACKS[@]}"; do
  IFS='|' read -r name url license page <<<"$entry"
  zip="${DOWNLOAD_DIR}/${name}.zip"

  if [[ -f "$zip" ]]; then
    echo "  [skip] ${name} (이미 있음)"
  else
    echo "  [get ] ${name}"
    # -f: HTTP 에러를 실패로 취급 (부분 파일이 남지 않게)
    curl -fsSL "$url" -o "${zip}.part"
    mv "${zip}.part" "$zip"
  fi

  dest="${EXTRACT_DIR}/${name}"
  if [[ -d "$dest" ]]; then
    echo "  [skip] ${name} 압축 해제됨"
  else
    mkdir -p "$dest"
    unzip -q "$zip" -d "$dest"
    echo "  [unzip] ${name}"
  fi
done

echo
echo "== 라이선스 검수 (CC0 이외가 섞이면 즉시 중단)"
for entry in "${PACKS[@]}"; do
  IFS='|' read -r name url license page <<<"$entry"
  if [[ "$license" != "CC0" ]]; then
    echo "  [FAIL] ${name}: ${license} — CC0만 허용된다 (01-art-direction.md §5-1)" >&2
    exit 1
  fi
  # 팩에 동봉된 라이선스 파일이 실제로 CC0라고 말하는지 확인한다.
  lic_file="$(find "${EXTRACT_DIR}/${name}" -maxdepth 2 -iname 'license*' -o -maxdepth 2 -iname 'readme*' | head -1)"
  if [[ -n "$lic_file" ]] && grep -qi 'CC0' "$lic_file"; then
    echo "  [ok  ] ${name}: 동봉 파일에서 CC0 확인"
  else
    echo "  [warn] ${name}: 동봉 라이선스 파일에서 CC0 문구를 못 찾았다 — 수동 확인 필요" >&2
  fi
done

echo
echo "== CREDITS.md 생성"
# 날짜는 인자로 받을 수 있게 한다 (재현 가능한 기록을 위해)
STAMP="${ASSET_FETCH_DATE:-$(date +%Y-%m-%d)}"

# 캐릭터 표를 `chars.json`에서 뽑는다. 인자는 `kind` 목록(hero / minion / boss).
#
# **손으로 적지 않는 이유**: CC-BY는 표기가 라이선스 조건이라, 로스터와 문서가
# 어긋나면 그 자체가 위반이다. 스프라이트가 곧 매니페스트이므로 매니페스트를
# 읽으면 어긋날 수 없다.
chars_table() {
  python3 - "$CHARS_JSON" "$@" <<'PY'
import json, sys

path, kinds = sys.argv[1], set(sys.argv[2:])
chars = json.load(open(path))["chars"]
rows = [(s, d) for s, d in chars.items() if d["kind"] in kinds]
if not rows:
    sys.exit(f"chars.json 에 {sorted(kinds)} 종류가 없다 — 표가 조용히 비면 표기 의무를 놓친다")

print("| 슬러그 | 이름 | 작가 | 라이선스 | 원본 |")
print("|--------|------|------|----------|------|")
for slug, d in rows:
    name = d.get("displayName") or d["name"]
    author = "우리 (자체 생성)" if d["generated"] else d["author"]
    url = d.get("url") or "—"
    print(f"| `{slug}` | {name} | {author} | {d['license']} | {url} |")
PY
}

# 음악 표를 `bgm.json`에서 뽑는다 — 캐릭터 표와 같은 이유다(위 주석).
#
# **BGM은 이 스크립트가 받지 않는다.** CC-BY라 `tools/fetch_bgm.sh`가 따로
# 받는다(여기 라이선스 검수가 CC0 아닌 것에서 죽는다 — 그 게이트는 나머지 6개
# 팩을 지키는 검사라 우회하지 않는다). 표기 의무는 아래 표가 진다.
#
# 매니페스트가 없으면 **표를 조용히 비우지 않고 죽는다** — CC-BY에서 빠진 표기는
# 그 자체가 위반이고, 조용히 비면 아무도 눈치채지 못한다.
bgm_table() {
  python3 - "$BGM_JSON" <<'PY'
import json, sys

path = sys.argv[1]
try:
    tracks = json.load(open(path))["tracks"]
except FileNotFoundError:
    sys.exit(f"{path} 이 없다 — tools/fetch_bgm.sh 를 먼저 돌려라 "
             "(CC-BY 표기가 빠진 채로 크레딧을 만들 수 없다)")
if not tracks:
    sys.exit("bgm.json 의 tracks 가 비었다 — 표가 조용히 비면 표기 의무를 놓친다")

need = ("title", "author", "license", "licenseUrl", "attribution", "modifications")
for t in tracks:
    missing = [k for k in need if not t.get(k)]
    if missing:
        sys.exit(f"{t.get('slug')}: {missing} 가 비었다 — CC-BY 4항목이 다 있어야 한다")

print("| 파일 | 곡 | 작가 | 라이선스 | 원본 | 받은 날 |")
print("|------|-----|------|----------|------|--------|")
for t in tracks:
    files = " / ".join(f"`{f}`" for f in t.get("files", []))
    print(f"| {files} | {t['title']} | {t['author']} | "
          f"[{t['license']}]({t['licenseUrl']}) | {t.get('sourcePage','—')} | "
          f"{t.get('downloadedAt','—')} |")
print()
print("**요구되는 표기 문구** (Incompetech FAQ가 준 형식 그대로 — 줄여 쓰면 형식 위반이다):")
for t in tracks:
    print()
    print("```")
    print(t["attribution"])
    print("```")
print()
print("**변경 고지** (CC-BY 4항목 중 ④):")
print()
for t in tracks:
    print(f"- `{t['slug']}` — {t['modifications']}")
    if t.get("usedIn"):
        print(f"  - 쓰이는 곳: {t['usedIn']}")
PY
}

{
  echo "# 에셋 출처·라이선스"
  echo
  echo "> 이 파일은 \`tools/fetch_assets.sh\`가 생성한다. 직접 수정하지 말 것."
  echo "> 정책: [01-art-direction.md §5](../../docs/specs/2026-07-27-ux/01-art-direction.md) —"
  echo "> **CC0 · 우리가 만든 것 · 표기하는 CC-BY**만 쓴다 (전파형·비상업용은 금지)."
  echo
  echo "상용 판매를 포함한 모든 용도로 사용 가능하다. **세 트랙**이 섞여 있다:"
  echo
  echo "| 트랙 | 표기 의무 | 어디에 |"
  echo "|------|-----------|--------|"
  echo "| 남의 CC0 | 없음 (감사 가능하도록 기록한다) | 사운드·배경 원본 팩, 잡몹·보스 스프라이트 |"
  echo "| 우리가 만든 것 | 해당 없음 (소유권이 우리에게 있다) | 이펙트·아이콘·배경 삽화 |"
  echo "| **chierit, CC-BY 4.0** | **있음 — 아래 주인공 표가 그 표기다** | 주인공 7종 스프라이트 |"
  echo "| **Kevin MacLeod, CC-BY 4.0** | **있음 — 아래 음악 표가 그 표기다** | BGM 2곡 (타이틀·하강) |"
  echo
  echo "CC-BY는 §5-1에서 \"크레딧 화면을 만든 뒤에만 허용\"인 등급이다. 이 파일이"
  echo "그 기록이고, 앱 안 크레딧 화면은 타이틀 씬 몫으로 남아 있다(§04-6, 9단계)."
  echo "**CC-BY-SA와 재배포금지(Clembod)는 여전히 금지**다 — \`import_chars.py\`가"
  echo "매니페스트의 \`license\`를 검사해서 막고, 음악은 \`fetch_bgm.sh\`가 CC-BY"
  echo "이외를 거부한다."
  echo
  echo "## 다운로드한 원본 팩"
  echo
  echo "| 팩 | 라이선스 | 출처 | 다운로드일 |"
  echo "|----|----------|------|-----------|"
  # **다운로드일은 아카이브의 mtime이다. `STAMP`가 아니다.**
  #
  # 이 스크립트는 멱등해서 이미 있는 zip을 다시 받지 않는데(`[skip] 이미 있음`),
  # 그때도 `STAMP`(오늘)를 찍으면 표가 "오늘 받았다"고 말한다. 실제로 그렇게
  # 어긋나 있었다: 07-27에 받은 zip이 표에는 08-02로 적혀 있었고, 다시 돌리자
  # 08-09가 됐다 — 매 실행마다 조용히 오늘로 밀리는 값이었다. 실물의 mtime은
  # 밀리지 않으므로 표가 아카이브와 갈릴 수 없다(매니페스트를 쓰는 것과 같은 이유).
  for entry in "${PACKS[@]}"; do
    IFS='|' read -r name url license page <<<"$entry"
    zip="${DOWNLOAD_DIR}/${name}.zip"
    got="$([[ -f "$zip" ]] && date -r "$zip" +%Y-%m-%d || echo "$STAMP")"
    echo "| \`${name}\` | ${license} | ${page} | ${got} |"
  done
  echo
  echo "원본 아카이브 위치: \`~/asset-research/downloads/\` (용량 때문에 리포에 커밋하지 않는다)"
  echo
  echo "## 음악 (BGM) — Kevin MacLeod, CC-BY 4.0 ★ 표기 의무"
  echo
  echo "\`tools/fetch_bgm.sh\`가 받아 루프로 가공한다. **이 표는 \`bgm/bgm.json\`에서"
  echo "뽑은 것이다** — 캐릭터 표와 같은 이유로 손으로 적지 않는다(표기가 라이선스"
  echo "조건이라, 곡을 바꾼 날 문서만 옛것으로 남으면 그 어긋남이 곧 위반이다)."
  echo
  bgm_table
  echo
  echo "**BGM은 화면마다 다른 곡이다** — 타이틀·선택은 \`title_loop\`, 하강은"
  echo "\`dive_loop\`다. 대전에는 넣지 않는다: 스펙 §01-7이 적은 \"120초 대전에서"
  echo "루프가 어색하다\"가 그쪽에서는 아직 맞다(163초 루프는 한 바퀴도 못 돈다)."
  echo "타이틀은 머무는 시간이 짧아 89초 루프로 충분하다."
  echo
  echo "전환은 **크로스페이드가 아니라 순차다.** 겹치면 두 곡의 조성이 부딪히는데"
  echo "그건 진폭 지표에 안 걸린다 — 나가는 페이드(600ms)가 끝난 뒤 들어오는"
  echo "페이드(1200ms)가 시작한다."
  echo
  echo "게인은 **곡마다 다시 유도한다**(\`src/shared/bgmRules.ts\`의 표,"
  echo "\`tools/measure_bgm_gain.py\`가 만든다). 양쪽에서 조인다: 위로는 효과음이"
  echo "묻히면 층 돌파·보스 신호를 소리로 알 수 없고, 아래로는 음악이 들려야 넣은"
  echo "값을 한다(베드 ≥ −30 LUFS). 실측 구간이 dive 0.409~0.460(쓰는 값 0.44),"
  echo "title 0.325~0.339(쓰는 값 0.33)이다."
  echo
  echo "두 경계는 **서로 다른 자로** 재진다. 하한은 사람이 듣는 크기이므로 통합"
  echo "라우드니스(LUFS), 상한은 겹치는 순간의 마스킹이므로 400ms 창 dBFS다."
  echo "한 자로 섞으면 상한이 dive에서 1.2dB 헐거워지는데 그 상태로도 모든 검사가"
  echo "통과한다 — 그래서 트랙이 \`sourceLufs\`와 \`bedUnityDbfs\`를 둘 다 든다."
  echo
  echo "**같은 게인을 두 곡에 쓸 수 없다.** 라우드니스가 곡의 성질이라(dive"
  echo "−20.3 LUFS, title −18.3) dive의 0.44를 타이틀에 쓰면 마스킹 한계를"
  echo "2.27dB 넘는다. 후보였던 \`Ossuary 6 - Air\`는 하한이 상한을 넘어 **게인으로"
  echo "풀 수 없어** 탈락했다 — 그때 바꾸는 것은 상수가 아니라 곡이다."
  echo
  echo "처음에는 상한만 유도해 0.22를 썼고 **배포본에서 안 들렸다**(−35.4 LUFS)."
  echo "하한 없는 조건은 무음도 만족시킨다 — 그것이 하한을 코드에 남긴 이유다."
  echo
  echo "## 자작 에셋 (우리 소유)"
  echo
  echo "| 파일 | 생성 도구 |"
  echo "|------|-----------|"
  echo "| \`fx/fx.json\` + png | \`tools/gen_effects.py\` |"
  echo "| \`bg/props.png\` | \`tools/gen_bg.py\` (지면 장식·구름 — 위 CC0 팩을 실루엣으로 변환 + 일부 PIL 직접 그리기) |"
  echo "| \`bg/scenery_surface.png\`, \`bg/scenery_abyss.png\` | \`tools/gen_bg_art.py\` (Bedrock SD3.5 Large로 테마별 원경·중경·근경 3겹) |"
  echo "| \`icons/skills.png\` | \`tools/gen_icons.py\` (전부 자작 — 우리 고유 개념. 6칸: 공격 3등급·방해 2종·버프) |"
  echo "| \`portraits/*.png\` + \`portraits.json\` | \`tools/gen_portraits.py\` (SD3.5 Large + 배경 제거 모델. 주인공 7종 × 카드·선택·승리 3장 = 21장) |"
  echo
  echo "배경·인물 삽화는 **우리가 SD3.5로 생성한 것**이라 CC0가 아니지만 소유권이 우리에게"
  echo "있다(캐릭터 트랙과 같은 근거). 예전에는 \`bg/silhouette.png\` 하나를 런타임"
  echo "\`tint\`로 물들여 두 테마에 돌려 썼는데, 그러니 지상과 심연이 \"같은 나무의 색만"
  echo "다른 것\"이 됐다 — 지금은 테마마다 그린 삽화를 쓴다."
  echo
  echo "인물 삽화(\`portraits/\`)는 주인공 7종과 **같은 캐릭터를 그린 별개 저작물**이다."
  echo "chierit 스프라이트를 입력으로 넣지 않았다(텍스트 프롬프트만 썼다) — 원소·색·의상"
  echo "서술이 \`gen_portraits.py\`의 \`LOOKS\`에 있다. 즉 CC-BY 4.0의 변형물이 아니므로"
  echo "표기 의무가 삽화에는 따라붙지 않는다. 스프라이트 쪽 표기는 아래 주인공 표가 그대로 진다."
  echo
  echo "## 별도 관리"
  echo
  echo "| 에셋 | 라이선스 | 비고 |"
  echo "|------|----------|------|"
  echo "| Galmuri11 (\`public/assets/fonts/\`) | SIL OFL 1.1 | 도트 한글 폰트. 리포에 woff2로 실려 있다 (CDN 의존 없음). Regular·Bold **두 파일** — 도트 폰트를 합성 볼드하면 획이 반 칸 번져 도트가 아니게 된다 |"
  echo
  echo "Spine 리그(hero/alien)는 폐기했다: 리그가 한 벌뿐이라 999층을 내려가도"
  echo "같은 적만 나왔고, 3/4 뷰라 횡스크롤 옆모습 조건에도 안 맞았다"
  echo "(\`~/asset-research/sidescroll/DECISION.md\`)."
  echo
  echo "## 캐릭터 스프라이트"
  echo
  echo "\`tools/import_chars.py\`가 팩한다. 트랙은 \`chars.json\`의 \`license\`와"
  echo "\`generated\` 플래그로 구분된다 — 섞이면 무엇을 팔 수 있는지 되짚을 수 없다."
  echo "**아래 두 표는 \`chars.json\`에서 뽑은 것이다.** 손으로 적으면 로스터를"
  echo "바꿨을 때 문서만 옛것으로 남는다 (실제로 그랬다: 교체된 자체 생성 4종이"
  echo "지워진 뒤에도 표에 남아 있었다)."
  echo
  echo "### 주인공 7종 — chierit Elementals, CC-BY 4.0 ★ 표기 의무"
  echo
  echo "**저작자 표시: chierit** (https://chierit.itch.io). 이 표기가 사용 조건이다."
  echo "우리는 시트를 크롭·재배치하고 콤보 클립의 앞 타 재생분을 잘라내 재배포하므로"
  echo "산출물은 2차 저작물이다 — CC-BY는 2차 저작물에도 표시를 요구하지만"
  echo "CC-BY-SA와 달리 라이선스 전파는 없어서 우리 코드는 오염되지 않는다."
  echo
  chars_table hero
  echo
  echo "**왜 교체했는가**: 앞선 자체 생성 4종(리제·노라·실비아·클로에)은 AI 메시"
  echo "리깅 병목으로 43액션 중 16개만 통과했고, 공격 클립이 세 개뿐이라 \"내 공격 3"
  echo "+ 상대 방해 2\" 5슬롯을 각 캐릭터의 자기 클립으로 채울 수 없었다. chierit는"
  echo "캐릭터마다 \`1/2/3_atk + sp_atk\` 네 공격과 접근 동작 2종을 갖고 있다."
  echo "그 트랙의 파이프라인(SD3.5 → TRELLIS 메시 → Quaternius UAL 리그(CC0) →"
  echo "직교 옆모습 렌더)과 임포터의 \`generated\` 검사는 남겨 뒀다."
  echo
  echo "### 잡몹·보스 13종 — LuizMelo, CC0"
  echo
  echo "표기 의무가 없는 트랙이다 (감사 가능성을 위해 기록한다)."
  echo
  chars_table minion boss
  echo
  # **이 절은 손으로 CREDITS.md에 적혀 있었고 이 스크립트가 한 번 지웠다.**
  # 생성기가 파일 전체를 덮으므로(`>"$CREDITS"`) 산출물에 직접 적은 것은 다음
  # 실행에서 사라진다 — 그게 CC-BY ④(변경 고지)라면 그 삭제가 곧 위반이다.
  # 그래서 여기 옮겼다. 표기에 관한 문장은 예외 없이 생성기가 갖는다.
  echo "### 변경 고지 — 리컬러 4종 (CC-BY 4항목 ④)"
  echo
  echo "네 시트·카드·초상화의 **색만** 바꿨다. 실루엣·알파는 원본과 0px 같고"
  echo "(팔레트 스왑이므로 픽셀 위치가 하나도 안 바뀐다), 프레임 구성·셀 좌표도 그대로다."
  echo "근거·게이트는 \`docs/superpowers/specs/2026-08-08-four-roster-solo-bgm-design.md\` §2."
  echo
  echo "**첫 칸이 슬러그가 아니라 파일명이다.** 위 로스터 표는 \`chars.json\`에서 뽑은"
  echo "것이고 검사가 \"크레딧 표 == 매니페스트 키\"를 정확히 대조한다"
  echo "(\`charManifest.test.ts\`) — 여기 슬러그로 적으면 같은 캐릭터가 두 줄이 되어"
  echo "그 검사가 깨진다. 형식을 비틀어 검사를 피한 것이 아니다: 이 표는 로스터가"
  echo "아니라 **바꾼 파일 목록**이고, 그 캐릭터의 출처는 이미 위 표에 한 줄로 있다."
  echo
  echo "| 시트 파일 | 색 이동 | 같이 바꾼 것 |"
  echo "|-----------|---------|--------------|"
  echo "| \`chars/metal_bladekeeper.png\` | 회색 흉갑 → 적색 h2° s0.55 (무채색 선택: 채도 ≤0.15 · 휘도 0.15–0.80, 7/15색) | 카드 10 · 초상화 5 |"
  echo "| \`chars/leaf_ranger.png\` | 녹청 망토 → 순백 h210° s0.05 · 휘도 0.72–0.98로 재사상 (시트 밴드 140–200°, 4/23색 / 삽화 밴드 95–200°) | 카드 10 · 초상화 5 |"
  echo "| \`chars/water_priestess.png\` | 청 254.4° → 자 275° (밴드 180–270°, 3/10색) | 카드 10 · 초상화 5 |"
  echo "| \`chars/wind_hashashin.png\` | 황갈 31.2° → 핑크 335° (시트 밴드 15–50°, 7/11색 / 삽화 밴드 200–300°) | 카드 10 · 초상화 5 |"
  echo
  echo "**밴드가 두 개인 슬러그가 둘 있다**(\`leaf_ranger\`·\`wind_hashashin\`). 이유는 서로"
  echo "다르다. 클로에는 카드·초상화가 아예 딴 인물이어서(시트는 황갈 팔레트, 삽화는"
  echo "회보라 보디슈트) 시트 밴드로 옮길 색이 없다 — 15–50°로 잡으면 15장 중 3장이"
  echo "변경 0.0%였다. 노라는 같은 인물인데 삽화의 초록이 시트보다 노랗다(h 85–128° vs"
  echo "140–200°): 시트 밴드로는 넓은 망토만 희어지고 안에 입은 초록 튜닉이 남아"
  echo "반만 리톤된 사람이 됐다. 어느 쪽이든 색이 도달하는 목표(각 335°·210°)는 두"
  echo "밴드가 같다 — 밴드는 **무엇을 고르나**만 다르다."
  echo
  echo "**나머지 3종은 픽셀을 안 건드렸다** — \`fire_knight\`·\`crystal_mauler\`·"
  echo "\`ground_monk\`은 PvP 상대 전용이고 원본 색·원본 이름 그대로다. 안 바꾼 것에"
  echo "\"변경함\"을 적으면 그 표기 자체가 거짓이 된다. 앞선 회차의 이 표는"
  echo "\`crystal_mauler\`를 바꿨다고 적고 있었는데, 배정이 겉모습 우선으로 옮겨 가면서"
  echo "그 리컬러는 되돌렸다(변경 고지는 산출물이 아니라 **지금 실린 파일**을 말해야 한다)."
  echo "카드 실루엣(\`_s\`)도 안 건드렸다(2색이라 옮길 색이 없다)."
} >"$CREDITS"

echo "  wrote ${CREDITS}"
echo
echo "완료. 다음: tools/gen_bg.py (프롭 변환), tools/gen_sfx.py (효과음 선별·변환)"
echo "배경 삽화(scenery_*)는 이 스크립트와 무관하다 — tools/gen_bg_art.py 가 Bedrock으로 만든다"
