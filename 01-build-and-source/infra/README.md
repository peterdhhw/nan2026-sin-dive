# PvP AWS 인프라

두 부분이다.

1. **사람 대전** — AppSync Event API 1개. Lambda·DynamoDB·상시 서버 없음.
   매칭 상태는 채널 메시지로만 합의한다 (`src/net/appsync/protocol.ts` 참조).
2. **배포** — ECS Fargate + ALB + CloudFront + Route53.

## 이 문서의 값 표기

이 레포는 공개되므로 **계정 고유값을 적지 않는다.** 아래 자리표시자를 자기 값으로
바꿔 읽으면 된다. 실제 값은 `infra/deploy.env`(gitignore)에 넣고, 재배포
스크립트가 거기서 읽는다 — `infra/deploy.env.example` 참조.

| 자리표시자 | 뜻 |
|---|---|
| `<ACCOUNT_ID>` | 12자리 AWS 계정 번호 |
| `<REGION>` | 리전 (우리는 `ap-northeast-2`) |
| `<APPSYNC_API_ID>` | AppSync Event API ID |
| `<APPSYNC_ENDPOINT>` | AppSync Event API HTTP 엔드포인트 |
| `<CLUSTER>` / `<SERVICE>` / `<ECR_REPO>` | ECS 클러스터·서비스·ECR 리포 이름 |
| `<CF_DIST_ID>` | CloudFront 배포 ID |
| `<ALB_SG>` / `<TASK_SG>` | 보안 그룹 ID |
| `<VPC>` / `<SUBNET_A>` / `<SUBNET_B>` | VPC·서브넷 ID |
| `<DOMAIN>` | 서비스 도메인 |

```bash
export AWS_PROFILE=<프로파일> AWS_REGION=<REGION>
```

---

## 1. 사람 대전 (AppSync Event API)

### 구성

| 항목 | 값 |
|---|---|
| API ID | `<APPSYNC_API_ID>` |
| HTTP 엔드포인트 | `<APPSYNC_ENDPOINT>` |
| 채널 네임스페이스 | `pvp` |
| 인증 | API_KEY (pub/sub 전부) |
| API Key 만료 | 30일 |

만드는 명령은 하나다:

```bash
./create-appsync-events.sh <api-name>
```

출력된 엔드포인트·키를 `.env.local`에 넣는다 (`.env.example`이 형식이다).
**키 값은 커밋하지 않는다** — `.env.local`은 `.gitignore`에 있다.

### API Key 갱신 (30일마다)

```bash
aws appsync create-api-key --api-id <APPSYNC_API_ID> \
  --expires $(( $(date +%s) + 60*60*24*30 ))
```

새 키를 `.env.local`에 반영한 뒤 `./deploy-ecs.sh`로 재배포한다.
**키는 빌드 타임에 번들로 인라인되므로 재배포 없이는 반영되지 않는다.**

### 보안 메모

API Key는 정적 사이트 번들에 그대로 들어간다. 이 키로 가능한 일은 `pvp`
네임스페이스의 pub/sub뿐이며 계정 자원에는 접근할 수 없다. 그래도 만료를 짧게
유지하고, 남용이 보이면 키를 폐기하고 새로 만든다. 더 필요하면 Cognito 또는
Lambda authorizer로 승급한다.

### 키가 없을 때

`.env.local`이 없거나 비어 있으면 게임은 **자동으로 로컬 AI 대전으로 동작한다.**
사람 매칭만 빠지고 게임 자체는 정상 플레이된다 — 심사·리뷰용으로 클론했다면
AWS 설정 없이 `npm run dev`만으로 전부 플레이할 수 있다.

---

## 2. 배포 (ECS + ALB + CloudFront + Route53)

### 리소스

| 리소스 | 값 |
|---|---|
| ECR | `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/<ECR_REPO>` |
| ECS 클러스터 | `<CLUSTER>` |
| ECS 서비스 | `<SERVICE>` — Fargate, desired 2, 256 CPU / 512 MB |
| ALB | internet-facing, HTTP:80 |
| 타깃 그룹 | IP 타깃 8080, 헬스체크 `/healthz` |
| ALB SG | `<ALB_SG>` |
| 태스크 SG | `<TASK_SG>` |
| CloudFront | `<CF_DIST_ID>` |
| ACM (us-east-1) | `<DOMAIN>` |
| Route53 | `<DOMAIN>` A ALIAS → CloudFront |
| 로그 | CloudWatch `/ecs/<SERVICE>` (14일 보존) |
| VPC / 서브넷 | `<VPC>` / `<SUBNET_A>`, `<SUBNET_B>` |

컨테이너는 nginx 하나다 (`Dockerfile`, `infra/nginx.conf`) — `dist/`를 서빙하고
`/healthz`에 200을 준다. SPA가 아니라 정적 파일이므로 런타임 상태가 없다.

### 네트워크 잠금 (중요)

**ALB는 절대 열려 있지 않다.** 인바운드는 CloudFront 관리형 프리픽스 리스트
(`com.amazonaws.global.cloudfront.origin-facing`) 80포트 **하나뿐**이다.
`0.0.0.0/0` 규칙은 없다.

```
ALB SG  : tcp/80   ← CloudFront 프리픽스 리스트만
Task SG : tcp/8080 ← ALB SG만
```

확인 방법 — ALB DNS로 직접 붙으면 타임아웃이 나야 정상이다:

```bash
curl -m 10 http://<ALB_DNS>/          # → 000 (차단)
curl https://<DOMAIN>/healthz         # → ok
```

규칙을 되돌릴 일이 있어도 **ALB에 `0.0.0.0/0`을 넣지 마라.** CloudFront를 우회해
TLS 없이 오리진이 노출된다.

### 재배포

```bash
cp infra/deploy.env.example infra/deploy.env   # 최초 1회, 자기 계정 값으로 채운다
./infra/deploy-ecs.sh                          # 테스트 → 빌드 → ECR → ECS 롤링 → CF 무효화
```

`VITE_*`는 **빌드 타임 인라인**이라 `.env.local`을 build-arg로 넘긴다.
런타임 환경변수로는 바꿀 수 없으니 키를 바꾸면 반드시 재배포해야 한다.

### 상태 확인

```bash
aws ecs describe-services --cluster <CLUSTER> --services <SERVICE> \
  --query 'services[0].{running:runningCount,desired:desiredCount,deploy:deployments[0].rolloutState}'
aws logs tail /ecs/<SERVICE> --since 10m
```

### 비용 메모

ALB(~$16/월)와 Fargate 태스크 2개(0.25 vCPU, ~$18/월)가 상시 과금된다.
잠시 내려두려면 태스크만 줄인다 (ALB는 남는다):

```bash
aws ecs update-service --cluster <CLUSTER> --service <SERVICE> --desired-count 0
```

### 전체 삭제

```bash
aws ecs update-service --cluster <CLUSTER> --service <SERVICE> --desired-count 0
aws ecs delete-service --cluster <CLUSTER> --service <SERVICE> --force
aws cloudfront get-distribution-config --id <CF_DIST_ID>   # Enabled:false로 수정 후 delete
aws elbv2 delete-load-balancer --load-balancer-arn <ALB_ARN>
aws elbv2 delete-target-group  --target-group-arn <TG_ARN>
aws appsync delete-api --api-id <APPSYNC_API_ID>
```

CloudFront는 비활성화 → 배포 완료까지 기다린 뒤에야 삭제된다 (15분 정도).
