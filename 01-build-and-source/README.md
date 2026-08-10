# 1. 플레이 가능한 빌드 및 소스 코드

> 제출 항목 #1 — 전체 소스 + 웹 실행. 루트 [`README.md`](../README.md)의 링크 표에
> 플레이 링크가 있다.

지하 9,999층 '제로 프론티어'로 하강하는 요원들. 세로 화면 웹 게임이다.
**두 모드가 같은 에셋·같은 전투 코드를 쓴다** — 층을 내려가는 싱글플레이와
상/하 2분할 줄다리기 대전.

플레이: **https://abyss.agenticmind.cloud/**

## 실행

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # dist/ 정적 산출물
```

`npm run dev`만으로 **전부 플레이된다** — AWS 설정은 필요 없다. 사람 대전만
환경변수가 있을 때 켜지고, 없으면 자동으로 로컬 AI 대전이 된다(아래 §사람 대전).

### 검사

```bash
npm test                 # Vitest — 95개 파일 / 1,758개 테스트
npm run typecheck        # tsc --noEmit
npm run check:boundaries # 폴더 경계 검사 (아래 §규칙)
```

### 디버그 쿼리 (dev 빌드에서만 동작한다)

프로덕션 빌드에서는 전부 무시된다 — URL로 게이지를 옮길 수 있으면 디버그가
아니라 치트다.

| 쿼리 | 뜻 |
|------|-----|
| `?seed=1234` | 웨이브를 고정한다 |
| `?scene=boot\|title\|match\|vs\|battle\|result` | 그 씬으로 직행 (매칭 대기도 건너뛴다) |
| `?result=win\|lose\|draw\|forfeit` | 결과 씬을 이 결과로 띄운다 |
| `?nowait` | 매칭 대기 없이 즉시 AI 확정 |
| `?gauge=-0.72` · `?wave=3` | 시작 게이지·웨이브를 지정한다 |
| `?debug=1` | 탭 카운터·dps 표기 |
| `?gallery=1` | 대전 없이 공용 위젯 갤러리만 띄운다 |

## 폴더 구조

```
src/
  core/     L1 — 결정론 순수 TS. 의존성 0
  shared/   L2 — 두 모드가 함께 쓴다 (전투 필드·캐릭터·배경·UI 위젯)
  pvp/         상/하 2분할 줄다리기
  single/      층 하강 RPG
  net/  ai/ L3 — AppSync 매칭 · Bedrock 전략
  main.ts   씬 배선. net·ai를 아는 유일한 곳은 appRuntime.ts
public/assets/   스프라이트시트·Spine 리그·BGM·SFX
tools/           에셋 생성 스크립트(Python) · 헤드리스 캡처 · 경계 검사
tests/           Vitest
infra/           AppSync 생성 · ECS 배포 · nginx 설정
```

### 규칙 — CI가 검사한다

1. **의존은 한 방향으로만 흐른다: `core` → `shared` → {`pvp`, `single`}.**
   `shared/`가 `pvp/`를 import하면 "공용"이 거짓이 된다. `single/`이 `pvp/`를
   보는 것도 막는다 — 서로를 잠그면 한쪽 수정이 다른 쪽을 깬다.
   → `npm run check:boundaries`

   > 이 검사는 장식이 아니다. 도입할 때 **이미 위반이 4건 있었다**. 어겨도
   > 타입은 통과하고 화면도 멀쩡해서 눈으로는 안 잡힌다.
2. **폴더가 담당자다.** 남의 폴더를 고쳐야 하면 그건 `shared/`로 올릴 신호다.
3. **L1(`core/`)은 `Math.random`/`Date.now`/DOM/`fetch`/AWS SDK를 쓰지 않는다.**
   이 규칙이 결정론 테스트를 가능하게 한다. 난수가 필요하면 `core/rng.ts`의
   `createRng(seed)`를 받아 쓴다 — 양 팀이 같은 시드로 같은 적과 싸우는 근거다.

## 웹 스택

Vite 5 + Pixi.js 8 + TypeScript 5.5 (Vitest). 도트(픽셀아트) 렌더이므로
텍스처는 `shared/pixelTexture.ts`를 거친다 — Pixi 기본값은 도트를 뭉갠다.

## 사람 대전 (선택)

환경변수 세 개가 다 있으면 사람을 10초 기다리고, 없거나 연결이 실패하면
**즉시 로컬 AI 대전**으로 동작한다.

```bash
cp .env.example .env.local   # infra/create-appsync-events.sh 출력을 채운다
```

**비밀값은 커밋하지 않는다.** AppSync API 키는 `.env.local`에만 두고
`.gitignore`로 막는다. 이 레포는 public이므로 키가 한 번이라도 커밋되면
히스토리 재작성 없이는 회수할 수 없다.

계정 고유값(계정 ID·ECR 주소·CloudFront 배포 ID)도 같은 이유로 파일에 적지
않는다 — `infra/deploy.env.example`을 복사해 채우면 배포 스크립트가 읽는다.
자세한 절차는 [`infra/README.md`](./infra/README.md).

AI 전략은 `npm run dev`에서만 Bedrock Haiku로 갱신된다 (Vite 미들웨어가 대리
호출 — 브라우저에 자격증명을 노출하지 않기 위해). 배포된 정적 사이트는 로컬
프리셋만 쓴다.

## 배포

ECS Fargate + ALB + CloudFront + Route53. 재배포는 `./infra/deploy-ecs.sh`
(테스트 → 빌드 → ECR → ECS 롤링 → CloudFront 무효화).

**ALB는 절대 열려 있지 않다.** 인바운드는 CloudFront 관리형 프리픽스 리스트
80포트 하나뿐이다. 규칙을 되돌릴 일이 있어도 ALB에 `0.0.0.0/0`을 넣지 마라 —
CloudFront를 우회해 TLS 없이 오리진이 노출된다.

## 함정

이 목록은 실제로 한 번씩 밟은 것들이다.

- `@esotericsoftware/spine-pixi-v8`은 **4.2.119에 정확히 고정**돼 있다. 에셋이
  Spine 4.2 export이므로 4.3.x로 올리면 즉시 *"Unable to render skeleton"*이
  난다. 캐럿(`^`)을 붙이지 마라.
- Spine 스킨 교체는 4.2 API인 `setSkinByName()` + `setSlotsToSetupPose()`를 쓴다.
- Spine 캐릭터 톤은 `skeleton.color.set()`으로 준다. `Container.tint`는 Spine
  메시에 확실히 전파되지 않는다.
- 이펙트 스프라이트시트는 `tools/gen_effects.py`가 만든다. 수치를 바꾸면
  `src/shared/fxManifest.ts`도 같이 바꿔야 한다 (테스트가 불일치를 잡는다).
- **`pixi.js`를 import하는 모듈은 Vitest(node 환경)에서 불러올 수 없다**
  (`navigator is not defined`). 그래서 순수 규칙은 항상 Pixi 없는 짝 모듈로
  분리하고 Pixi 모듈이 re-export한다 — `fxMapping`/`effects`,
  `skillRules`/`skillBar`, `loopMath`/`loop`, `sessionRules`/`session`,
  `screenText`/`screens`, `sceneRules`/`sceneManager` (그 외 씬도 전부 같은 짝).
- **씬(L2)은 `src/net/`·`src/ai/`를 런타임에 import하지 않는다**(타입만 허용).
  배선은 `src/appRuntime.ts` 한 곳에만 있고 씬은 `pvp/runtime.ts`의 `Runtime`
  인터페이스만 본다.
- **다음 판을 `location.reload()`로 시작하지 않는다.** 씬을 갈아치운다
  (`SceneManager`) — 리로드하면 Spine·아틀라스를 다시 받고 흰 화면이 번쩍인다.
- 헤드리스 검증은 `node tools/shot.mjs <url> <out.png> [waitMs] [--click x,y@delayMs]`
  를 쓴다. Chrome의 `--virtual-time-budget`은 `createImageBitmap()`을 절대
  resolve하지 않아 Pixi 텍스처 로드가 영구 대기에 걸린다.
- **게이지 push는 초당(dps) 단위 계약이다.** 새 `OpponentSource`를 만들면
  스냅샷에 `windowMs`(그 `rawDamage`가 몇 ms 구간의 합인지)를 반드시 실어야
  한다. 빼먹으면 코어가 "이미 초당 값"으로 보고, 200ms를 모아 보내는 쪽이
  12배 강해진다.
- **스킬 딜은 절대 한 틱에 몰아넣지 않는다** — `core/castQueue.ts`를 쓴다. 초당
  환산 때문에 650딜 1틱이 39,000dps 스파이크가 되어 스킬 한 번이 승패를 결정한다.
- **dps는 프레임이 아니라 200ms 창으로 잰다** (`core/dpsWindow.ts`).
  `dpsToPush`가 `sqrt`라서 프레임 단위로 재면 몰아서 낸 딜이 20% 깎인다 —
  스킬을 쓸수록 손해가 된다. 양 팀 모두 같은 창을 쓴다.
- **상대 AI는 인원당 쿨다운 추적기 하나다** (`ai/aiOpponentSource.ts`의
  `members`). 팀에 하나면 2인 팀 상대가 1인분만 시전해서 대전에 패배가
  사라진다 — 그 구조가 빠진 것을 `damageScale`로 덮으려 하면 방치를 지게 만드는
  값과 조작이 이기는 값이 겹치지 않는다.
- **연타는 쿨다운으로 못 막는다** (`shared/castGateRules.ts`). 쿨다운은 칸마다
  따로 도니까 1번 직후 2번이 통과하는데, 전장은 새 시전이 오면 진행 중인
  모션을 끊는다 — 2번의 돌진이 1번의 타격 프레임을 지운다. 시전자별 **모션
  게이트**가 그걸 막고, 거부된 탭은 흔들림 + 잠김 소리로 응답한다.
- 밸런스는 `GAUGE_RATE`(`core/gauge.ts`, 판의 길이)와 AI `damageScale`(난이도)
  두 상수만 만진다. `tests/pacing.test.ts`가 **"조작하면 이기고 방치하면
  진다"**를 회귀 테스트로 고정한다 — 승자를 직접 묻는다(`Math.abs(gauge)`로
  부호를 지웠던 판본이 입력 0회 전승을 "박빙"으로 통과시켰다).
