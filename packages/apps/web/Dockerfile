# Stage 1: prune workspace to only web and its deps
FROM node:22-alpine AS pruner
WORKDIR /app
RUN npm i -g pnpm
COPY . .
RUN pnpm dlx turbo prune --scope=@postolio/web --docker --out-dir out

# Stage 2: install pruned dependencies
FROM node:22-alpine AS installer
WORKDIR /app
RUN npm i -g pnpm
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

# Stage 3: build web bundle
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm && apk add --no-cache libc6-compat python3 make g++ openssl
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/packages ./packages
COPY --from=installer /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/ ./

# Frontend build-time env (defaults allow same-origin routing through the Nginx proxy)
ARG VITE_API_BASE_URL=
ARG VITE_API_URL=
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_FACEBOOK_APP_ID=
ARG VITE_AUTH_GOOGLE_ENABLED=true
ARG VITE_AUTH_FACEBOOK_ENABLED=true
ARG VITE_AUTH_MAGIC_LINK_ENABLED=true
ARG VITE_FEATURE_AI_SUGGESTIONS=true
ARG VITE_FEATURE_VIDEO_SUPPORT=false
ARG VITE_SENTRY_FRONTEND_DSN=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_FACEBOOK_APP_ID=${VITE_FACEBOOK_APP_ID}
ENV VITE_AUTH_GOOGLE_ENABLED=${VITE_AUTH_GOOGLE_ENABLED}
ENV VITE_AUTH_FACEBOOK_ENABLED=${VITE_AUTH_FACEBOOK_ENABLED}
ENV VITE_AUTH_MAGIC_LINK_ENABLED=${VITE_AUTH_MAGIC_LINK_ENABLED}
ENV VITE_FEATURE_AI_SUGGESTIONS=${VITE_FEATURE_AI_SUGGESTIONS}
ENV VITE_FEATURE_VIDEO_SUPPORT=${VITE_FEATURE_VIDEO_SUPPORT}
ENV VITE_SENTRY_FRONTEND_DSN=${VITE_SENTRY_FRONTEND_DSN}

RUN pnpm turbo run build --filter=@postolio/web...

# Stage 4: runtime image serving static assets + reverse proxy
FROM nginx:1.27-alpine AS runner
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/packages/apps/web/dist ./
COPY --from=pruner /app/packages/apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
