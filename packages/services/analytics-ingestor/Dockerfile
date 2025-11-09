# Stage 1: Prune workspace for analytics-ingestor
FROM node:22-alpine AS pruner
WORKDIR /app

# Install pnpm
RUN npm i -g pnpm

# Copy monorepo
COPY . .

# Create pruned workspace for the ingestor and its dependencies
RUN pnpm dlx turbo prune --scope=@postolio/analytics-ingestor --docker --out-dir out


# Stage 2: Install pruned deps
FROM node:22-alpine AS installer
WORKDIR /app
RUN npm i -g pnpm

COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Use non-frozen install since pruned workspace + local edits may change workspace graph
RUN pnpm install --no-frozen-lockfile


# Stage 3: Build in pruned workspace
FROM node:22-alpine AS builder
WORKDIR /app

RUN npm i -g pnpm && apk add --no-cache libc6-compat python3 make g++ openssl

COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/packages ./packages
COPY --from=installer /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/ ./

# Ensure turbo cache directories exist
RUN mkdir -p packages/libs/database/.turbo packages/libs/connectors/.turbo packages/services/analytics-ingestor/.turbo

# Build required libs then the ingestor
RUN pnpm --filter=@postolio/aws build \
  && pnpm --filter=@postolio/database build \
  && pnpm --filter=@postolio/connectors build \
  && pnpm --filter=@postolio/analytics-ingestor build


# Stage 4: Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nodejs

# Copy built workspace
COPY --from=builder --chown=nodejs:nodejs /app/ .

USER nodejs

# Default envs (overridden by ECS)
ENV NODE_ENV=dev
ENV INGESTOR_LOOP_MS=60000

# No healthcheck port; rely on logs and ECS task metrics

# Start the ingestion loop
CMD ["node", "packages/services/analytics-ingestor/dist/index.js"]
