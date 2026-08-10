# 효과음 파일별 출처

> `tools/gen_sfx.sh`가 생성한다. 직접 수정하지 말 것.
> 전부 **CC0** — 상용 판매 포함 모든 용도로 사용 가능하다. 팩 단위 기록은 [../CREDITS.md](../CREDITS.md).

| 출력 | 원본 | 팩 | 길이 상한 |
|------|------|-----|-----------|
| `hit_0.ogg` / `.m4a` | `impactPunch_medium_000.ogg` | `kenney_impact-sounds` | 0.30s |
| `hit_1.ogg` / `.m4a` | `impactPunch_medium_001.ogg` | `kenney_impact-sounds` | 0.30s |
| `hit_2.ogg` / `.m4a` | `impactPunch_medium_002.ogg` | `kenney_impact-sounds` | 0.30s |
| `skill_cast.ogg` / `.m4a` | `confirmation_004.ogg` | `kenney_interface-sounds` | 0.49s |
| `cooldown_ready.ogg` / `.m4a` | `confirmation_001.ogg` | `kenney_interface-sounds` | 0.30s |
| `enemy_death.ogg` / `.m4a` | `impactSoft_heavy_000.ogg` | `kenney_impact-sounds` | 0.45s |
| `ui_tap.ogg` / `.m4a` | `click_001.ogg` | `kenney_interface-sounds` | 0.12s |
| `ui_locked.ogg` / `.m4a` | `error_002.ogg` | `kenney_interface-sounds` | 0.20s |
| `win.ogg` / `.m4a` | `jingles_STEEL02.ogg` | `kenney_music-jingles` | 1.50s |
| `lose.ogg` / `.m4a` | `jingles_STEEL01.ogg` | `kenney_music-jingles` | 1.50s |
| `gauge_danger.ogg` / `.m4a` | `minimize_006.ogg` | `kenney_interface-sounds` | 0.40s |
| `interference.ogg` / `.m4a` | `switch_001.ogg` | `kenney_interface-sounds` | 0.62s |

가공: 모노 44.1kHz, 피크 정규화(목표 -3dBFS + 역할별 보정), 꼬리 컷, 40ms 페이드아웃.
