# Multi-stage build for production
FROM node:20-alpine AS base

# Install necessary packages for building native dependencies
RUN apk add --no-cache python3 make g++ openssl

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client first, then build
RUN npx prisma generate

# Build application
RUN npm run build

# Production image, copy all the files and run next
FROM node:20-alpine AS runner
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache openssl

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy the built application from the builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

USER nodejs

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["npm", "start"]