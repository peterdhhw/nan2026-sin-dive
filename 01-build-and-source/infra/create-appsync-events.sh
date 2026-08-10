#!/usr/bin/env bash
# Abyss Dive PvP — AppSync Event API 생성
#
# 필요 권한: appsync:CreateApi, appsync:CreateChannelNamespace, appsync:CreateApiKey
# 이 인스턴스의 기본 롤에는 없다. 권한 있는 자격증명으로 실행할 것.
#
# 사용: ./create-appsync-events.sh [api-name]
set -euo pipefail

REGION="${AWS_REGION:-ap-northeast-2}"
API_NAME="${1:-abyss-dive-pvp}"
NAMESPACE="pvp"
# API Key 유효기간 30일 (초). 공개 사이트에 노출되는 키이므로 길게 두지 않는다.
KEY_TTL_SECONDS=$(( 60 * 60 * 24 * 30 ))

echo "==> creating Event API '${API_NAME}' in ${REGION}"
API_JSON=$(aws appsync create-api \
  --region "${REGION}" \
  --name "${API_NAME}" \
  --event-config '{
    "authProviders": [{ "authType": "API_KEY" }],
    "connectionAuthModes": [{ "authType": "API_KEY" }],
    "defaultPublishAuthModes": [{ "authType": "API_KEY" }],
    "defaultSubscribeAuthModes": [{ "authType": "API_KEY" }]
  }')

API_ID=$(echo "${API_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["api"]["apiId"])')
# realtime/http 두 종류의 DNS가 나온다. SDK가 원하는 것은 HTTP 엔드포인트다.
HTTP_DNS=$(echo "${API_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["api"]["dns"]["HTTP"])')

echo "==> apiId=${API_ID}"

echo "==> creating channel namespace '${NAMESPACE}'"
aws appsync create-channel-namespace \
  --region "${REGION}" \
  --api-id "${API_ID}" \
  --name "${NAMESPACE}" >/dev/null

echo "==> creating API key (expires in 30 days)"
KEY_JSON=$(aws appsync create-api-key \
  --region "${REGION}" \
  --api-id "${API_ID}" \
  --description "abyss-dive pvp public client key" \
  --expires "$(( $(date +%s) + KEY_TTL_SECONDS ))")
API_KEY=$(echo "${KEY_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["apiKey"]["id"])')

cat <<EOF

==============================================
생성 완료. 아래를 submission/.env.local 에 넣으세요.
==============================================
VITE_APPSYNC_EVENTS_ENDPOINT=https://${HTTP_DNS}/event
VITE_APPSYNC_REGION=${REGION}
VITE_APPSYNC_API_KEY=${API_KEY}

apiId (삭제할 때 필요): ${API_ID}
키 만료: 30일 후 — 'aws appsync create-api-key --api-id ${API_ID}' 로 갱신
EOF
