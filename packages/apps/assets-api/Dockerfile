# Stage 1: Builder
# Mirrors the root Dockerfile to build the @postolio/assets service from the monorepo.
FROM node:22-alpine AS pruner
WORKDIR /app

# Install pnpm
RUN npm i -g pnpm

# Copy the entire monorepo context so Turborepo can resolve workspace deps
COPY . .

# Create a pruned workspace containing only the assets app and its deps
RUN pnpm dlx turbo prune --scope=@postolio/assets-api --docker --out-dir out


# Stage 2: Install pruned deps
FROM node:22-alpine AS installer
WORKDIR /app
RUN npm i -g pnpm

# Copy manifests from pruned workspace for deterministic install
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 3: Build in pruned workspace
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm and build tools
RUN npm i -g pnpm && apk add --no-cache libc6-compat python3 make g++ openssl

# Bring in node_modules and full sources
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/packages ./packages
COPY --from=installer /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/ ./

# Create .turbo directories with proper permissions before building
RUN mkdir -p packages/libs/database-assets/.turbo packages/libs/errors/.turbo packages/libs/logger/.turbo packages/apps/assets-api/.turbo

# Build shared logger, generate Prisma client for assets DB, and build the server
RUN pnpm --filter=@postolio/logger build \
  && pnpm --filter=@postolio/database-assets run db:generate \
  && pnpm --filter=@postolio/assets-api run build:server


# Stage 4: Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy pruned workspace (built output + node_modules)
COPY --from=builder --chown=nodejs:nodejs /app/ .

# Copy entrypoint script
COPY --from=pruner --chown=nodejs:nodejs /app/packages/apps/assets-api/docker-entrypoint.sh ./docker-entrypoint.sh

# Make entrypoint executable
RUN chmod +x ./docker-entrypoint.sh

# Set user and environment
USER nodejs
EXPOSE 3002
ENV PORT=3002
ENV NODE_ENV=dev

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3002/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Set entrypoint to handle ASSETS_DATABASE_URL construction and migrations
ENTRYPOINT ["./docker-entrypoint.sh"]

# Start the assets API server (path is relative to /app/packages/apps/assets-api set by entrypoint)
CMD ["node", "src/index.js"]
