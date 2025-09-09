# Stage 1: Builder
# Mirrors the root Dockerfile to build the @postolio/api service from the monorepo.
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm and necessary build tools
RUN npm i -g pnpm
RUN apk add --no-cache libc6-compat python3 make g++ openssl

# Copy the entire monorepo context so Turborepo can resolve workspace deps
COPY . .

# Install all dependencies using the lockfile
RUN pnpm install --frozen-lockfile

# Build the target application (@postolio/api) and its dependencies
RUN pnpm turbo run build --filter=@postolio/api...

# Create a pruned, production-ready deployment for the api service
# The output will be in /app/out/api
RUN pnpm deploy --filter=@postolio/api --prod out/api


# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy the pruned deployment from the builder stage
COPY --from=builder /app/out/api /app

# Copy other necessary assets from the builder stage
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/scripts/start-with-migration.sh ./start-with-migration.sh
COPY --from=builder --chown=nodejs:nodejs /app/legal ./legal

# Make startup script executable
RUN chmod +x ./start-with-migration.sh

# Set user and environment
USER nodejs
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start command
CMD ["./start-with-migration.sh"]

