# `src/single/` — 싱글플레이 (담당: 정호)

층을 내려가는 방치 RPG. **구현되어 있다** (2026-08-03) — 진입은 타이틀의
[심연 하강] 버튼 또는 `?scene=dive`.

## 파일 지도

| 파일 | 무엇 |
|------|------|
| `session.ts` / `sessionRules.ts` | 세션 조립(층 진행·딜·강화·타락도·저장) / 순수 규칙(창·러시·콤보·배율) |
| `diveScene.ts` | 씬 셸 + 스와이프 제스처 배선 (세션을 만들고 파괴한다) |
| `swipeRules.ts` | 제스처 판정 — **위로 스와이프 = 하강 가속** (팀 데모·숏츠 문법) |
| `economyRules.ts` | 골드·강화 4종 곡선 (페이스는 `tests/singlePacing.test.ts`가 고정) |
| `saveRules.ts` | `sin.single.*` 저장 스키마 (잔고 실패 ≠ 0) |
| `idleRules.ts` | 오프라인 방치 보상 (경과 시간은 인자 — Date.now 금지) |
| `diveHud.ts` / `diveHudRules.ts` | 층·페이즈·타락도·골드·콤보 HUD |
| `upgradePanel.ts` / `upgradePanelRules.ts` | 강화 줄 + 접이식 시트 |
| `storyOverlay.ts` / `storyRules.ts` | 프롤로그·심연의 선택·엔딩·보스 문구 |

층 생성기는 `core/phase/phaseWaves.ts`(100층 보스·10층 미니보스),
타락도는 `core/corruption/corruption.ts`다.

## 시작하기 전에 읽어라

| 순서 | 문서 |
|------|------|
| 1 | [`docs/START-HERE.md`](../../docs/START-HERE.md) — 읽는 순서·담당 경계·금지 사항 |
| 2 | [`docs/SINGLE-BRIEF.md`](../../docs/SINGLE-BRIEF.md) — **만들 것 · 가져다 쓸 것 · 붙이는 자리 4곳** |
| 3 | [`docs/SHARED-API.md`](../../docs/SHARED-API.md) — `shared/`·`core/`가 이미 주는 것 |
| 4 | [`docs/ASSETS.md`](../../docs/ASSETS.md) — 에셋 로더와 **함정 7개** |

## 이 폴더의 규칙

- **`../pvp/`를 import할 수 없다.** `npm run check:boundaries`가 막는다. 필요한 것이 저쪽에 있으면 `shared/`로 올릴 신호다 ([`SHARED-API.md`](../../docs/SHARED-API.md) §7에 모듈별 대안이 있다)
- `../net/`·`../ai/`도 쓰지 않는다 (싱글은 네트워크가 없다)
- **수치·판정은 `*Rules.ts`에 둬라.** `pixi.js`를 import하는 모듈은 Vitest(node)에서 불러올 수 없다 — 규칙이 Pixi 파일 안에 있으면 테스트를 붙일 방법이 없다
- 난수는 `core/rng.ts`의 `createRng(seed)`. 경과 시간은 **인자로 받아라** (`Date.now()`를 계산 안에서 읽으면 그 계산엔 테스트를 못 붙인다)
- 씬을 갈아치울 때 `destroy()`를 빠뜨리면 캐릭터가 누적된다 — 화면에는 안 보인다

## 파일 이름 제안

`docs/SINGLE-BRIEF.md` §3의 순서와 같다:

```
single/
  diveScene.ts        하강 씬 (Pixi)
  session.ts          층 진행·딜·시간을 묶는 것 (Pixi)
  sessionRules.ts     그 순수 규칙
  swipeRules.ts       스와이프 판정 (순수) — 지금 코드에 제스처 처리가 없다
  idleRules.ts        방치 보상 (순수)
```

층 → 페이즈 → HP는 이미 `core/phase/floors.ts`에 있다. 웨이브 생성기만 만들면 된다.
