# Stage 1: Prune workspace for comments-ingestor
FROM node:22-alpine AS pruner
WORKDIR /app
COPY . .
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
RUN pnpm dlx turbo prune --scope=@postolio/comments-ingestor --docker --out-dir out

# Stage 2: Install dependencies in pruned workspace
FROM node:22-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter=@postolio/comments-ingestor build

# Stage 3: Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=installer /app .
ENV COMMENTS_INGESTOR_LOOP_MS=300000
CMD ["node","packages/services/comments-ingestor/dist/index.js"]

