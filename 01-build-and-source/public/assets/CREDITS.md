# 에셋 출처·라이선스

> 이 파일은 `tools/fetch_assets.sh`가 생성한다. 직접 수정하지 말 것.
> 정책: [01-art-direction.md §5](../../docs/specs/2026-07-27-ux/01-art-direction.md) —
> **CC0 · 우리가 만든 것 · 표기하는 CC-BY**만 쓴다 (전파형·비상업용은 금지).

상용 판매를 포함한 모든 용도로 사용 가능하다. **세 트랙**이 섞여 있다:

| 트랙 | 표기 의무 | 어디에 |
|------|-----------|--------|
| 남의 CC0 | 없음 (감사 가능하도록 기록한다) | 사운드·배경 원본 팩, 잡몹·보스 스프라이트 |
| 우리가 만든 것 | 해당 없음 (소유권이 우리에게 있다) | 이펙트·아이콘·배경 삽화 |
| **chierit, CC-BY 4.0** | **있음 — 아래 주인공 표가 그 표기다** | 주인공 7종 스프라이트 |
| **Kevin MacLeod, CC-BY 4.0** | **있음 — 아래 음악 표가 그 표기다** | BGM 2곡 (타이틀·하강) |

CC-BY는 §5-1에서 "크레딧 화면을 만든 뒤에만 허용"인 등급이다. 이 파일이
그 기록이고, 앱 안 크레딧 화면은 타이틀 씬 몫으로 남아 있다(§04-6, 9단계).
**CC-BY-SA와 재배포금지(Clembod)는 여전히 금지**다 — `import_chars.py`가
매니페스트의 `license`를 검사해서 막고, 음악은 `fetch_bgm.sh`가 CC-BY
이외를 거부한다.

## 다운로드한 원본 팩

| 팩 | 라이선스 | 출처 | 다운로드일 |
|----|----------|------|-----------|
| `kenney_impact-sounds` | CC0 | https://kenney.nl/assets/impact-sounds | 2026-07-27 |
| `kenney_ui-audio` | CC0 | https://kenney.nl/assets/ui-audio | 2026-07-27 |
| `kenney_interface-sounds` | CC0 | https://kenney.nl/assets/interface-sounds | 2026-07-27 |
| `kenney_music-jingles` | CC0 | https://kenney.nl/assets/music-jingles | 2026-07-27 |
| `kenney_background-elements` | CC0 | https://kenney.nl/assets/background-elements | 2026-07-27 |
| `kenney_foliage-sprites` | CC0 | https://kenney.nl/assets/foliage-sprites | 2026-07-27 |

원본 아카이브 위치: `~/asset-research/downloads/` (용량 때문에 리포에 커밋하지 않는다)

## 음악 (BGM) — Kevin MacLeod, CC-BY 4.0 ★ 표기 의무

`tools/fetch_bgm.sh`가 받아 루프로 가공한다. **이 표는 `bgm/bgm.json`에서
뽑은 것이다** — 캐릭터 표와 같은 이유로 손으로 적지 않는다(표기가 라이선스
조건이라, 곡을 바꾼 날 문서만 옛것으로 남으면 그 어긋남이 곧 위반이다).

| 파일 | 곡 | 작가 | 라이선스 | 원본 | 받은 날 |
|------|-----|------|----------|------|--------|
| `dive_loop.ogg` / `dive_loop.m4a` | Oppressive Gloom | Kevin MacLeod | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?keywords=Oppressive+Gloom | 2026-08-07 |
| `title_loop.ogg` / `title_loop.m4a` | Crypto | Kevin MacLeod | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://incompetech.com/music/royalty-free/index.html?keywords=Crypto | 2026-08-08 |

**요구되는 표기 문구** (Incompetech FAQ가 준 형식 그대로 — 줄여 쓰면 형식 위반이다):

```
Oppressive Gloom Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/
```

```
Crypto Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/
```

**변경 고지** (CC-BY 4항목 중 ④):

- `dive_loop` — 모노 44.1kHz로 변환, 앞에서 163.20초(40마디)만 남기고 뒤를 잘라냄(원본 끝이 페이드아웃이라 그대로는 루프가 안 된다), 루프 이음새를 프레이즈 한 개(8.16초, 2마디) 등파워 크로스페이드로 이어 붙임, 56k ogg/m4a로 인코딩
  - 쓰이는 곳: 하강(싱글) 모드 배경음
- `title_loop` — 모노 44.1kHz로 변환, 앞에서 89.16초(30마디)만 남기고 뒤를 잘라냄(원본 끝이 페이드아웃이라 그대로는 루프가 안 된다), 루프 이음새를 프레이즈 한 개(5.94초, 2마디) 등파워 크로스페이드로 이어 붙임, 56k ogg/m4a로 인코딩
  - 쓰이는 곳: 타이틀·선택 화면 배경음

**BGM은 화면마다 다른 곡이다** — 타이틀·선택은 `title_loop`, 하강은
`dive_loop`다. 대전에는 넣지 않는다: 스펙 §01-7이 적은 "120초 대전에서
루프가 어색하다"가 그쪽에서는 아직 맞다(163초 루프는 한 바퀴도 못 돈다).
타이틀은 머무는 시간이 짧아 89초 루프로 충분하다.

전환은 **크로스페이드가 아니라 순차다.** 겹치면 두 곡의 조성이 부딪히는데
그건 진폭 지표에 안 걸린다 — 나가는 페이드(600ms)가 끝난 뒤 들어오는
페이드(1200ms)가 시작한다.

게인은 **곡마다 다시 유도한다**(`src/shared/bgmRules.ts`의 표,
`tools/measure_bgm_gain.py`가 만든다). 양쪽에서 조인다: 위로는 효과음이
묻히면 층 돌파·보스 신호를 소리로 알 수 없고, 아래로는 음악이 들려야 넣은
값을 한다(베드 ≥ −30 LUFS). 실측 구간이 dive 0.409~0.460(쓰는 값 0.44),
title 0.325~0.339(쓰는 값 0.33)이다.

두 경계는 **서로 다른 자로** 재진다. 하한은 사람이 듣는 크기이므로 통합
라우드니스(LUFS), 상한은 겹치는 순간의 마스킹이므로 400ms 창 dBFS다.
한 자로 섞으면 상한이 dive에서 1.2dB 헐거워지는데 그 상태로도 모든 검사가
통과한다 — 그래서 트랙이 `sourceLufs`와 `bedUnityDbfs`를 둘 다 든다.

**같은 게인을 두 곡에 쓸 수 없다.** 라우드니스가 곡의 성질이라(dive
−20.3 LUFS, title −18.3) dive의 0.44를 타이틀에 쓰면 마스킹 한계를
2.27dB 넘는다. 후보였던 `Ossuary 6 - Air`는 하한이 상한을 넘어 **게인으로
풀 수 없어** 탈락했다 — 그때 바꾸는 것은 상수가 아니라 곡이다.

처음에는 상한만 유도해 0.22를 썼고 **배포본에서 안 들렸다**(−35.4 LUFS).
하한 없는 조건은 무음도 만족시킨다 — 그것이 하한을 코드에 남긴 이유다.

## 자작 에셋 (우리 소유)

| 파일 | 생성 도구 |
|------|-----------|
| `fx/fx.json` + png | `tools/gen_effects.py` |
| `bg/props.png` | `tools/gen_bg.py` (지면 장식·구름 — 위 CC0 팩을 실루엣으로 변환 + 일부 PIL 직접 그리기) |
| `bg/scenery_surface.png`, `bg/scenery_abyss.png` | `tools/gen_bg_art.py` (Bedrock SD3.5 Large로 테마별 원경·중경·근경 3겹) |
| `icons/skills.png` | `tools/gen_icons.py` (전부 자작 — 우리 고유 개념. 6칸: 공격 3등급·방해 2종·버프) |
| `portraits/*.png` + `portraits.json` | `tools/gen_portraits.py` (SD3.5 Large + 배경 제거 모델. 주인공 7종 × 카드·선택·승리 3장 = 21장) |

배경·인물 삽화는 **우리가 SD3.5로 생성한 것**이라 CC0가 아니지만 소유권이 우리에게
있다(캐릭터 트랙과 같은 근거). 예전에는 `bg/silhouette.png` 하나를 런타임
`tint`로 물들여 두 테마에 돌려 썼는데, 그러니 지상과 심연이 "같은 나무의 색만
다른 것"이 됐다 — 지금은 테마마다 그린 삽화를 쓴다.

인물 삽화(`portraits/`)는 주인공 7종과 **같은 캐릭터를 그린 별개 저작물**이다.
chierit 스프라이트를 입력으로 넣지 않았다(텍스트 프롬프트만 썼다) — 원소·색·의상
서술이 `gen_portraits.py`의 `LOOKS`에 있다. 즉 CC-BY 4.0의 변형물이 아니므로
표기 의무가 삽화에는 따라붙지 않는다. 스프라이트 쪽 표기는 아래 주인공 표가 그대로 진다.

## 별도 관리

| 에셋 | 라이선스 | 비고 |
|------|----------|------|
| Galmuri11 (`public/assets/fonts/`) | SIL OFL 1.1 | 도트 한글 폰트. 리포에 woff2로 실려 있다 (CDN 의존 없음). Regular·Bold **두 파일** — 도트 폰트를 합성 볼드하면 획이 반 칸 번져 도트가 아니게 된다 |

Spine 리그(hero/alien)는 폐기했다: 리그가 한 벌뿐이라 999층을 내려가도
같은 적만 나왔고, 3/4 뷰라 횡스크롤 옆모습 조건에도 안 맞았다
(`~/asset-research/sidescroll/DECISION.md`).

## 캐릭터 스프라이트

`tools/import_chars.py`가 팩한다. 트랙은 `chars.json`의 `license`와
`generated` 플래그로 구분된다 — 섞이면 무엇을 팔 수 있는지 되짚을 수 없다.
**아래 두 표는 `chars.json`에서 뽑은 것이다.** 손으로 적으면 로스터를
바꿨을 때 문서만 옛것으로 남는다 (실제로 그랬다: 교체된 자체 생성 4종이
지워진 뒤에도 표에 남아 있었다).

### 주인공 7종 — chierit Elementals, CC-BY 4.0 ★ 표기 의무

**저작자 표시: chierit** (https://chierit.itch.io). 이 표기가 사용 조건이다.
우리는 시트를 크롭·재배치하고 콤보 클립의 앞 타 재생분을 잘라내 재배포하므로
산출물은 2차 저작물이다 — CC-BY는 2차 저작물에도 표시를 요구하지만
CC-BY-SA와 달리 라이선스 전파는 없어서 우리 코드는 오염되지 않는다.

| 슬러그 | 이름 | 작가 | 라이선스 | 원본 |
|--------|------|------|----------|------|
| `water_priestess` | 실비아 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-water-priestess |
| `leaf_ranger` | 노라 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-leaf-ranger |
| `metal_bladekeeper` | 리제 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-metal-bladekeeper |
| `wind_hashashin` | 클로에 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-wind-hashashin |
| `fire_knight` | 이리스 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-fire-knight |
| `crystal_mauler` | 미라 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-crystal-mauler |
| `ground_monk` | 셀린 | chierit | CC-BY 4.0 | https://chierit.itch.io/elementals-ground-monk |

**왜 교체했는가**: 앞선 자체 생성 4종(리제·노라·실비아·클로에)은 AI 메시
리깅 병목으로 43액션 중 16개만 통과했고, 공격 클립이 세 개뿐이라 "내 공격 3
+ 상대 방해 2" 5슬롯을 각 캐릭터의 자기 클립으로 채울 수 없었다. chierit는
캐릭터마다 `1/2/3_atk + sp_atk` 네 공격과 접근 동작 2종을 갖고 있다.
그 트랙의 파이프라인(SD3.5 → TRELLIS 메시 → Quaternius UAL 리그(CC0) →
직교 옆모습 렌더)과 임포터의 `generated` 검사는 남겨 뒀다.

### 잡몹·보스 13종 — LuizMelo, CC0

표기 의무가 없는 트랙이다 (감사 가능성을 위해 기록한다).

| 슬러그 | 이름 | 작가 | 라이선스 | 원본 |
|--------|------|------|----------|------|
| `goblin` | Goblin | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy |
| `mushroom` | Mushroom | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy |
| `skeleton` | Skeleton | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy |
| `slime` | Slime | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy-2 |
| `rat` | Rat | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy-2 |
| `bat` | Bat | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy-2 |
| `flying_eye` | Flying Eye | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy |
| `fire_worm` | Fire Worm | LuizMelo | CC0 | https://luizmelo.itch.io/fire-worm |
| `mimic` | Mimic | LuizMelo | CC0 | https://luizmelo.itch.io/monsters-creatures-fantasy-2 |
| `evil_wizard` | Evil Wizard 2 | LuizMelo | CC0 | https://luizmelo.itch.io/evil-wizard-2 |
| `evil_wizard3` | Evil Wizard 3 | LuizMelo | CC0 | https://luizmelo.itch.io/evil-wizard-3 |
| `wizard_pack` | Wizard | LuizMelo | CC0 | https://luizmelo.itch.io/wizard-pack |
| `medieval_king` | Medieval King (Boss) | LuizMelo | CC0 | https://luizmelo.itch.io/medieval-king-pack-2 |

### 변경 고지 — 리컬러 4종 (CC-BY 4항목 ④)

네 시트·카드·초상화의 **색만** 바꿨다. 실루엣·알파는 원본과 0px 같고
(팔레트 스왑이므로 픽셀 위치가 하나도 안 바뀐다), 프레임 구성·셀 좌표도 그대로다.
근거·게이트는 `docs/superpowers/specs/2026-08-08-four-roster-solo-bgm-design.md` §2.

**첫 칸이 슬러그가 아니라 파일명이다.** 위 로스터 표는 `chars.json`에서 뽑은
것이고 검사가 "크레딧 표 == 매니페스트 키"를 정확히 대조한다
(`charManifest.test.ts`) — 여기 슬러그로 적으면 같은 캐릭터가 두 줄이 되어
그 검사가 깨진다. 형식을 비틀어 검사를 피한 것이 아니다: 이 표는 로스터가
아니라 **바꾼 파일 목록**이고, 그 캐릭터의 출처는 이미 위 표에 한 줄로 있다.

| 시트 파일 | 색 이동 | 같이 바꾼 것 |
|-----------|---------|--------------|
| `chars/metal_bladekeeper.png` | 회색 흉갑 → 적색 h2° s0.55 (무채색 선택: 채도 ≤0.15 · 휘도 0.15–0.80, 7/15색) | 카드 10 · 초상화 5 |
| `chars/leaf_ranger.png` | 녹청 망토 → 순백 h210° s0.05 · 휘도 0.72–0.98로 재사상 (시트 밴드 140–200°, 4/23색 / 삽화 밴드 95–200°) | 카드 10 · 초상화 5 |
| `chars/water_priestess.png` | 청 254.4° → 자 275° (밴드 180–270°, 3/10색) | 카드 10 · 초상화 5 |
| `chars/wind_hashashin.png` | 황갈 31.2° → 핑크 335° (시트 밴드 15–50°, 7/11색 / 삽화 밴드 200–300°) | 카드 10 · 초상화 5 |

**밴드가 두 개인 슬러그가 둘 있다**(`leaf_ranger`·`wind_hashashin`). 이유는 서로
다르다. 클로에는 카드·초상화가 아예 딴 인물이어서(시트는 황갈 팔레트, 삽화는
회보라 보디슈트) 시트 밴드로 옮길 색이 없다 — 15–50°로 잡으면 15장 중 3장이
변경 0.0%였다. 노라는 같은 인물인데 삽화의 초록이 시트보다 노랗다(h 85–128° vs
140–200°): 시트 밴드로는 넓은 망토만 희어지고 안에 입은 초록 튜닉이 남아
반만 리톤된 사람이 됐다. 어느 쪽이든 색이 도달하는 목표(각 335°·210°)는 두
밴드가 같다 — 밴드는 **무엇을 고르나**만 다르다.

**나머지 3종은 픽셀을 안 건드렸다** — `fire_knight`·`crystal_mauler`·
`ground_monk`은 PvP 상대 전용이고 원본 색·원본 이름 그대로다. 안 바꾼 것에
"변경함"을 적으면 그 표기 자체가 거짓이 된다. 앞선 회차의 이 표는
`crystal_mauler`를 바꿨다고 적고 있었는데, 배정이 겉모습 우선으로 옮겨 가면서
그 리컬러는 되돌렸다(변경 고지는 산출물이 아니라 **지금 실린 파일**을 말해야 한다).
카드 실루엣(`_s`)도 안 건드렸다(2색이라 옮길 색이 없다).
