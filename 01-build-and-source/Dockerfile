# Abyss Dive PvP — 정적 사이트 컨테이너 (ECS Fargate + ALB)
#
# VITE_* 는 **빌드 타임에 인라인**된다 (런타임 env가 아니다).
# 그래서 AppSync 키를 넣으려면 build-arg로 넘겨야 한다.
# 값이 비면 게임은 자동으로 로컬 AI 대전으로 동작한다 (설계 스펙 §7).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_APPSYNC_EVENTS_ENDPOINT=""
ARG VITE_APPSYNC_REGION="ap-northeast-2"
ARG VITE_APPSYNC_API_KEY=""
ENV VITE_APPSYNC_EVENTS_ENDPOINT=$VITE_APPSYNC_EVENTS_ENDPOINT \
    VITE_APPSYNC_REGION=$VITE_APPSYNC_REGION \
    VITE_APPSYNC_API_KEY=$VITE_APPSYNC_API_KEY

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# 8080 리스닝 — 컨테이너를 non-root로 돌릴 수 있고, 다른 게임들과 규약이 같다
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
