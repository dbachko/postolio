########## Stage 1: Prune monorepo to web-only workspace ##########
FROM node:22-alpine AS pruner
WORKDIR /app
RUN npm i -g pnpm

# Copy entire monorepo context
COPY . .

# Create pruned workspace for the web package and deps
RUN pnpm dlx turbo prune --scope=@postolio/web --docker --out-dir out


########## Stage 2: Install pruned deps ##########
FROM node:22-alpine AS installer
WORKDIR /app
RUN npm i -g pnpm

# Copy manifests for install layer
COPY --from=pruner /app/out/json/ ./
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies
RUN pnpm install --frozen-lockfile


########## Stage 3: Build web ##########
FROM node:22-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm

# Bring in node_modules and full sources
COPY --from=installer /app/node_modules ./node_modules
COPY --from=installer /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/full/ ./

# Build args for Vite environment
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_FACEBOOK_APP_ID
ARG VITE_API_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID
ENV VITE_API_URL=$VITE_API_URL

# Build the web app
RUN pnpm turbo run build --filter=@postolio/web


########## Stage 4: Runtime (nginx) ##########
FROM nginx:alpine AS runner

# Copy built assets from builder (dist lives under the package dir in the pruned workspace)
COPY --from=builder /app/packages/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration from source
COPY --from=pruner /app/packages/apps/web/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
