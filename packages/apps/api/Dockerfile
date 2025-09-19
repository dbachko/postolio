# Stage 1: Builder
# Mirrors the root Dockerfile to build the @postolio/api service from the monorepo.
FROM node:22-alpine AS pruner
WORKDIR /app

# Install pnpm
RUN npm i -g pnpm

# Copy the entire monorepo context so Turborepo can resolve workspace deps
COPY . .

# Create a pruned workspace containing only the API and its deps
RUN pnpm dlx turbo prune --scope=api --docker --out-dir out


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

# Rebuild native modules for Alpine Linux
RUN pnpm rebuild bcrypt

# Build the API (and any required deps per turbo pipeline)
RUN pnpm turbo run build --filter=api


# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy pruned workspace (built output + node_modules)
COPY --from=builder --chown=nodejs:nodejs /app/ .

# Copy startup script and legal docs from source
COPY --from=pruner --chown=nodejs:nodejs /app/scripts/start-with-migration.sh ./start-with-migration.sh
COPY --from=pruner --chown=nodejs:nodejs /app/legal ./legal

# Make startup script executable
RUN chmod +x ./start-with-migration.sh

# Set user and environment
USER nodejs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=dev

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start command
CMD ["./start-with-migration.sh"]
