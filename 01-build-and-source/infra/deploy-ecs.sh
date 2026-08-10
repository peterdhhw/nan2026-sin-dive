#!/usr/bin/env bash
# SIN DIVE — 컨테이너 빌드 → ECR 푸시 → ECS 롤링 배포 → CloudFront 무효화
#
# 인프라(ALB/CloudFront/Route53/보안그룹)는 최초 1회만 만들면 되고 이 스크립트는
# **재배포만** 한다. 최초 생성 절차는 infra/README.md 참조.
#
# 계정 고유값은 **환경변수로 받는다** — 이 레포는 공개되므로 계정 ID·배포 ID를
# 파일에 적지 않는다. `infra/deploy.env.example`을 `infra/deploy.env`로 복사해
# 채우면 이 스크립트가 자동으로 읽는다(`deploy.env`는 .gitignore에 있다).
#
# 사용: ./infra/deploy-ecs.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# 계정 설정 — 파일이 있으면 읽고, 없으면 이미 export된 환경변수를 쓴다
if [[ -f infra/deploy.env ]]; then
  # shellcheck disable=SC1091
  set -a; source infra/deploy.env; set +a
fi

PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-ap-northeast-2}"

# 필수값 — 하나라도 비어 있으면 여기서 멈춘다. 빈 값으로 진행하면
# `.dkr.ecr...` 같은 잘못된 주소로 docker login을 시도하고 에러가 엉뚱하게 난다.
: "${AWS_ACCOUNT_ID:?infra/deploy.env 에 AWS_ACCOUNT_ID 를 채워라 (예: 123456789012)}"
: "${ECS_CLUSTER:?infra/deploy.env 에 ECS_CLUSTER 를 채워라}"
: "${ECS_SERVICE:?infra/deploy.env 에 ECS_SERVICE 를 채워라}"
: "${ECR_REPO:?infra/deploy.env 에 ECR_REPO 를 채워라}"
: "${CLOUDFRONT_DIST_ID:?infra/deploy.env 에 CLOUDFRONT_DIST_ID 를 채워라}"

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${ECR_REPO}:latest"

# VITE_* 는 빌드 타임에 인라인된다 → .env.local 값을 build-arg로 넘겨야 한다.
# 파일이 없으면 빈 값으로 빌드되고, 게임은 로컬 AI 대전으로 동작한다.
ENDPOINT=""; KEY=""; APPSYNC_REGION="${REGION}"
if [[ -f .env.local ]]; then
  # shellcheck disable=SC1091
  set -a; source .env.local; set +a
  ENDPOINT="${VITE_APPSYNC_EVENTS_ENDPOINT:-}"
  KEY="${VITE_APPSYNC_API_KEY:-}"
  APPSYNC_REGION="${VITE_APPSYNC_REGION:-$REGION}"
fi
if [[ -z "${ENDPOINT}" || -z "${KEY}" ]]; then
  echo "!! AppSync 설정이 없다 — 사람 대전 없이(로컬 AI만) 배포된다" >&2
fi

echo "==> test + typecheck (깨진 걸 배포하지 않는다)"
npm test
npm run typecheck

echo "==> docker build"
docker build \
  --build-arg "VITE_APPSYNC_EVENTS_ENDPOINT=${ENDPOINT}" \
  --build-arg "VITE_APPSYNC_REGION=${APPSYNC_REGION}" \
  --build-arg "VITE_APPSYNC_API_KEY=${KEY}" \
  -t "${ECR_REPO}:latest" .

echo "==> ECR push"
aws ecr get-login-password --profile "${PROFILE}" --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"
docker tag "${ECR_REPO}:latest" "${IMAGE}"
docker push "${IMAGE}"

echo "==> ECS 롤링 배포 (force-new-deployment: 태그가 latest라 이미지만 갱신됨)"
aws ecs update-service --profile "${PROFILE}" --region "${REGION}" \
  --cluster "${ECS_CLUSTER}" --service "${ECS_SERVICE}" --force-new-deployment >/dev/null
aws ecs wait services-stable --profile "${PROFILE}" --region "${REGION}" \
  --cluster "${ECS_CLUSTER}" --services "${ECS_SERVICE}"

echo "==> CloudFront 캐시 무효화 (index.html 구버전이 남지 않도록)"
aws cloudfront create-invalidation --profile "${PROFILE}" \
  --distribution-id "${CLOUDFRONT_DIST_ID}" --paths '/*' \
  --query 'Invalidation.Id' --output text

echo "==> done: ${PUBLIC_URL:-배포 URL은 infra/deploy.env 의 PUBLIC_URL 에 적어라}"
