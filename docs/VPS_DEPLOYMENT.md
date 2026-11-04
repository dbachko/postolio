# VPS Deployment Pipeline

This pipeline builds the API, Assets API, Analytics ingestor (optional), and web UI Docker images, pushes them to GHCR, and deploys them to a single VPS via Docker Compose.

## What gets deployed

- `api` (`packages/apps/api`) on port 3000 (proxied)
- `assets-api` (`packages/apps/assets-api`) on port 3002 (proxied)
- `analytics-ingestor` (`packages/services/analytics-ingestor`) behind the optional `analytics` profile
- `web` (Vite build served by Nginx, proxies `/api/*` and `/assets-api/*`)
- Postgres (main + assets) and Valkey (Redis-compatible) on the VPS

## Prerequisites on the VPS

- Docker Engine + Docker Compose v2 installed (`docker compose version`)
- A non-root user with passwordless Docker access (or adjust the workflow to prefix `sudo docker`)
- Ports `80/443` open to the internet (or fronted by your own reverse proxy)
- DNS A/AAAA records pointing your app domain to the VPS IP
- S3 bucket + AWS credentials for assets storage (the Assets API requires S3)

## Required GitHub secrets

- `VPS_HOST`: VPS hostname or IP
- `VPS_USER`: SSH user
- `VPS_SSH_KEY`: private key for SSH
- `VPS_STACK_ENV`: contents of your `stack.env` (see `deploy/vps/stack.env.example`)
- `VPS_REGISTRY_TOKEN`: GHCR PAT with `read:packages` (recommended for pulls on the VPS)
- Optional: `VPS_SSH_PORT` (default `22`), `VPS_REGISTRY_USERNAME` (default repo owner)

## Workflow: `.github/workflows/deploy-vps.yml`

Trigger manually → **Deploy to VPS**.

Inputs:

- `ref`: git ref to deploy (default `main`)
- `imageTag`: override image tag (default commit SHA)
- `enableAnalytics`: include the analytics ingestor profile
- `remoteDir`: where stack files live on the VPS (default `/opt/postolio`)

Build args for the web image reuse existing repo variables (e.g. `VITE_API_URL`, `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID`, `VITE_FACEBOOK_APP_ID`, `VITE_SENTRY_FRONTEND_DSN`, etc.). Set both `VITE_API_URL` and `VITE_API_BASE_URL` (usually the same value) so frontend API calls resolve correctly.

Deploy steps performed by the workflow:

1. Build + push images to GHCR (`postolio-api`, `postolio-assets-api`, `postolio-web`, optional `postolio-analytics`)
2. SSH to the VPS, write `stack.env` from `VPS_STACK_ENV`
3. Download `deploy/vps/docker-compose.yml` for the selected ref
4. `docker compose pull && docker compose up -d --remove-orphans` (adds `--profile analytics` when enabled)

## Stack configuration (`deploy/vps/stack.env.example`)

Copy to your secrets as `VPS_STACK_ENV`, then adjust:

- `DATABASE_URL`, `ASSETS_DATABASE_URL`, `REDIS_URL`
- `JWT_SECRET`, `ASSETS_API_SERVICE_TOKEN`, `ASSETS_SERVICE_TOKEN`
- `API_URL`, `FRONTEND_URL`, `APP_URL`, `CORS_ORIGIN`
- `ASSETS_S3_BUCKET`, `ASSETS_CDN_DOMAIN`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Email: `USE_AWS_SES` + `SES_FROM_EMAIL` **or** SMTP settings
- AI keys: `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
- Frontend build flags: `VITE_*` values (or set via repo vars)
- Optional analytics profile: `TOKEN_SERVICE_URL`/`DUMMY_ACCESS_TOKEN`

## Custom domain & TLS

- Point your domain to the VPS IP.
- The web container serves HTTP on port 80 and proxies API traffic to the internal services.
- For TLS, terminate with a host-level proxy (e.g., Caddy/Traefik/NGINX with certbot) in front of the stack, or terminate at your cloud firewall/load balancer.

## Manual rollout (if needed)

SSH to the VPS and run:

```bash
cd /opt/postolio
IMAGE_TAG=<tag> IMAGE_NAMESPACE=<owner> REGISTRY=ghcr.io docker compose --env-file stack.env pull
IMAGE_TAG=<tag> IMAGE_NAMESPACE=<owner> REGISTRY=ghcr.io docker compose --env-file stack.env up -d --remove-orphans
```
