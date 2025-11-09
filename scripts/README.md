# Deployment Scripts

This directory contains essential production scripts for deploying and managing Postolio infrastructure.

## Available Scripts

- **`deploy-stack.sh`** - Local CDK stack deployment with environment variable mapping
- **`get-app-urls.sh`** - Utility to retrieve deployed application URLs and resource information
- **`README.md`** - This documentation file

---

## Local HTTPS: ai.localhost (macOS)

Postolio dev runs over HTTPS on the `ai.localhost` domain to support OAuth and Instagram flows that require SSL.

### Prerequisites

- macOS (recommended for this helper)
- mkcert (local CA + dev cert generator)
  - Install via Homebrew:
    - `brew install mkcert`
    - Optional (Firefox trust): `brew install nss`

### One‑time Setup

```
pnpm run setup:ai-localhost
```

This script:

- Installs/trusts the mkcert local CA (if not already installed)
- Generates repo‑local certificates under `certs/`:
  - `certs/ai.localhost.pem`
  - `certs/ai.localhost-key.pem`
- Writes `.env` pointers for API and Web:
  - `packages/apps/api/.env`: `SSL_CERT_PATH`, `SSL_KEY_PATH`, `NODE_ENV=dev`
  - `packages/apps/web/.env`: `SSL_CERT_PATH`, `SSL_KEY_PATH`

### Run Locally

```
pnpm --filter api dev            # Fastify API on https://ai.localhost:3000
pnpm --filter @postolio/web dev  # Vite UI on https://ai.localhost:5173
```

Notes:

- No `/etc/hosts` changes are needed — `.localhost` domains resolve to loopback.
- The API and Web servers read SSL paths from their `.env` files (or default to `../../certs/...`).
- CORS in the API includes `https://ai.localhost:5173` out of the box.

### Troubleshooting

- mkcert not found: install with `brew install mkcert`, then re‑run the setup command.
- Browser trust warnings: run `mkcert -install` (the script does this), then restart your browser.
- Regenerate certs: delete the `certs/` files and re‑run `pnpm run setup:ai-localhost`.

---

## Get Application URLs

The `get-app-urls.sh` script retrieves URLs and resource information from your deployed stacks.

### Usage

```bash
# Get URLs for dev environment (default)
./scripts/get-app-urls.sh

# Get URLs for staging environment
./scripts/get-app-urls.sh staging

# Get URLs for production environment
./scripts/get-app-urls.sh prod
```

### Output

The script displays:

- **Application URLs**: Frontend (CloudFront), Backend API (ALB)
- **Useful Endpoints**: Auth, Brands, Campaigns, Instagram OAuth
- **AWS Resources**: Database, Redis, ECR, VPC, S3
- **Stack Status**: Current deployment status of all stacks

### Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 Postolio Application URLs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Environment: dev
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 APPLICATION URLS
===================
🌐 Frontend:         https://d1234567890.cloudfront.net
🚀 Backend API:      https://postolio.example
💊 Health Check:     https://postolio.example/api/health

📊 USEFUL ENDPOINTS
====================
Auth Login:         https://postolio.example/api/auth/login
Auth Register:      https://postolio.example/api/auth/register
Brands:             https://postolio.example/api/brands/list
Campaigns:          https://postolio.example/api/campaign/list
Instagram OAuth:    https://postolio.example/api/auth/instagram/authorize

🔧 AWS RESOURCES
=================
Database:           postolio-db.us-east-1.rds.amazonaws.com:5432
Redis:              postolio-redis.cache.amazonaws.com:6379
ECR Repository:     123456789.dkr.ecr.us-east-1.amazonaws.com/postolio
VPC ID:             vpc-abc123
S3 Bucket:          postolio-frontend-dev

📦 STACK STATUS
===============
Foundation:         UPDATE_COMPLETE
API:                UPDATE_COMPLETE
Web:                UPDATE_COMPLETE

✅ All stacks deployed successfully!
🚀 Open the frontend URL in your browser to get started.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Local Stack Deployment

The `deploy-stack.sh` script allows you to deploy individual CDK stacks locally using environment variables from your `.env` file. It mirrors the GitHub Actions CI/CD deployment process.

### Prerequisites

1. **AWS CLI configured**: Run `aws configure` with your credentials
2. **pnpm installed**: `npm install -g pnpm`
3. **Environment variables**: Create a `.env` file in the project root (see `.env.example`)

### Usage

```bash
# Deploy a single stack
./scripts/deploy-stack.sh <stack>

# Deploy with options
./scripts/deploy-stack.sh [OPTIONS] <stack>
```

### Available Stacks

| Stack            | Description                                                         | Dependencies                             |
| ---------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `foundation`     | ECR Registry, VPC, Database, Redis                                  | None                                     |
| `auth`           | Token Service (OAuth, JWT)                                          | Foundation                               |
| `scheduling`     | Schedule Management, Cleanup, Status Sync                           | Auth                                     |
| `brand-analysis` | Brand Analysis (DynamoDB + Lambdas: service, projection, scheduler) | Foundation, Scheduling                   |
| `publishing`     | Publisher, Retry Handler, DLQ Processors                            | Auth, Scheduling                         |
| `api`            | Backend API (ECS Fargate)                                           | Foundation, Auth, Scheduling, Publishing |
| `web`            | Frontend (S3 + CloudFront)                                          | API                                      |
| `all`            | Deploy all stacks in order                                          | -                                        |

### Options

```bash
-e, --env ENV          Environment (dev|staging|prod) [default: dev]
-f, --env-file FILE    Path to .env file [default: .env]
-t, --image-tag TAG    Docker image tag [default: api-{env}-latest]
-h, --help             Show help message
```

### Examples

#### Deploy API Stack

```bash
# Deploy API stack to dev environment (default)
./scripts/deploy-stack.sh api

# Deploy API stack to staging
./scripts/deploy-stack.sh -e staging api

# Deploy with custom .env file
./scripts/deploy-stack.sh -f .env.production api
```

#### Deploy All Stacks

```bash
# Deploy all stacks in dependency order
./scripts/deploy-stack.sh all

# Deploy all stacks to production
./scripts/deploy-stack.sh -e prod all
```

#### Deploy Foundation

````bash
# Deploy foundation stack
./scripts/deploy-stack.sh foundation

#### Deploy Brand Analysis

```bash
# Deploy Brand Analysis stack (requires Foundation + Scheduling)
./scripts/deploy-stack.sh brand-analysis
````

````

#### Deploy Analytics (ingestor) with higher rate limit

```bash
# Build and push the analytics image as linux/amd64 for ECS
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 000000000000.dkr.ecr.us-east-1.amazonaws.com
docker buildx create --use --name postolio-builder || true
docker buildx build --platform linux/amd64 \
  -f packages/services/analytics-ingestor/Dockerfile \
  -t 000000000000.dkr.ecr.us-east-1.amazonaws.com/postolio:analytics-dev-latest \
  . --push

# Deploy Analytics with increased rate limit for dev testing
RATE_LIMIT_PER_HOUR=1000 \
  ./scripts/deploy-stack.sh -e dev analytics
```


### Environment Variables

The script reads environment variables from your `.env` file. Here are the required variables:

#### Required for API Stack

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Facebook/Instagram (Meta App)
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
INSTAGRAM_REDIRECT_URI=https://postolio.example/api/auth/instagram/callback

# LinkedIn OAuth
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...

# TikTok OAuth
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
````

#### Optional Variables

```bash
# Configuration
NODE_ENV=dev
LOG_LEVEL=debug
ENABLE_MONITORING=true
AWS_REGION=us-east-1

# Custom Domain (if Route53 hosted zone exists, CDN will use cdn.{rootDomain})
DOMAIN_NAME=postolio.example               # App domain (root will be extracted for CDN)
VITE_API_URL=https://postolio.example      # CORS origin for API

# Docker Image
IMAGE_TAG=api-dev-custom-tag
```

### Environment Variable Mapping

The script maps `.env` variables to CDK context parameters as follows:

| .env Variable            | CDK Context Parameter  | Used By   |
| ------------------------ | ---------------------- | --------- |
| `OPENAI_API_KEY`         | `openaiApiKey`         | API       |
| `GOOGLE_CLIENT_ID`       | `googleClientId`       | API       |
| `GOOGLE_CLIENT_SECRET`   | `googleClientSecret`   | API       |
| `FACEBOOK_APP_ID`        | `facebookAppId`        | API, Auth |
| `FACEBOOK_APP_SECRET`    | `facebookAppSecret`    | API, Auth |
| `INSTAGRAM_APP_ID`       | `instagramAppId`       | API, Auth |
| `INSTAGRAM_APP_SECRET`   | `instagramAppSecret`   | API, Auth |
| `INSTAGRAM_REDIRECT_URI` | `instagramRedirectUri` | API, Auth |
| `LINKEDIN_CLIENT_ID`     | `linkedinClientId`     | API, Auth |
| `LINKEDIN_CLIENT_SECRET` | `linkedinClientSecret` | API, Auth |
| `TIKTOK_CLIENT_KEY`      | `tiktokClientKey`      | API, Auth |
| `TIKTOK_CLIENT_SECRET`   | `tiktokClientSecret`   | API, Auth |
| `NODE_ENV`               | `nodeEnv`              | All       |
| `LOG_LEVEL`              | `logLevel`             | All       |
| `ENABLE_MONITORING`      | `enableMonitoring`     | All       |
| `DOMAIN_NAME`            | `domainName`           | API, Web  |
| `VITE_API_URL`           | `corsOrigin`           | API       |

#### Optional Brand Analysis Wiring

If you want the API stack to deploy without depending on the Brand Analysis stack, you can explicitly provide table names or SSM parameter paths. If neither is provided, the API uses deterministic names: `postolio-<env>-brand-analysis-profiles` and `postolio-<env>-brand-analysis-jobs`.

| .env Variable                     | CDK Context Parameter         | Used By |
| --------------------------------- | ----------------------------- | ------- |
| `BRAND_PROFILES_TABLE_NAME`       | `brandProfilesTableName`      | API     |
| `BRAND_JOBS_TABLE_NAME`           | `brandJobsTableName`          | API     |
| `BRAND_PROFILES_TABLE_PARAM_PATH` | `brandProfilesTableParamPath` | API     |
| `BRAND_JOBS_TABLE_PARAM_PATH`     | `brandJobsTableParamPath`     | API     |

### Troubleshooting

#### Stack in ROLLBACK_COMPLETE state

If a stack is in `ROLLBACK_COMPLETE` state, the script will prompt you to delete it:

```bash
⚠️  Stack is in ROLLBACK_COMPLETE state
To fix this, delete the stack first:
  aws cloudformation delete-stack --stack-name Postolio-API-dev
Delete stack and continue? (y/N):
```

#### Missing environment variables

If required environment variables are missing, the deployment may fail. Check the CDK output for specific errors about missing context values.

#### AWS credentials not configured

```bash
Error: AWS CLI is not configured
Run: aws configure
```

Run `aws configure` and enter your AWS access key ID, secret access key, and default region.

### Deployment Flow

The script performs the following steps:

1. **Load Environment**: Reads `.env` file and exports variables
2. **Validate**: Checks AWS credentials and required tools
3. **Build Dependencies**: Builds shared libraries based on the stack
4. **Prepare Context**: Maps environment variables to CDK context parameters
5. **Check Stack Status**: Detects if stack is in error state
6. **Deploy**: Runs CDK deploy with all context parameters
7. **Verify**: Confirms successful deployment

### Stack Dependencies

Stacks must be deployed in dependency order:

```
Foundation
    ↓
  Auth
    ↓
Scheduling
    ↓
Publishing
    ↓
   API
    ↓
   Web
```

When deploying with `all`, the script automatically handles this order.

## Comparing with CI/CD

This script mirrors the GitHub Actions workflow in `.github/workflows/deploy.yml`:

| Feature               | Local Script      | GitHub Actions           |
| --------------------- | ----------------- | ------------------------ |
| Environment Variables | `.env` file       | GitHub Secrets/Variables |
| AWS Credentials       | `aws configure`   | AWS OIDC/Actions         |
| Dependency Building   | Automatic         | Automatic                |
| Stack Dependencies    | Manual/Sequential | Automatic waiting        |
| Retry Logic           | Manual            | 3 retries with backoff   |
| Change Detection      | Manual            | Automatic (paths-filter) |

### Key Differences

1. **Change Detection**: CI/CD automatically detects which stacks to deploy based on file changes
2. **Parallel Deployment**: CI/CD can deploy independent stacks in parallel (max-parallel: 1 currently)
3. **Retry Logic**: CI/CD has built-in retry with exponential backoff
4. **Docker Images**: CI/CD builds and pushes Docker images automatically
5. **Notifications**: CI/CD sends deployment notifications and creates GitHub comments

## Security Best Practices

1. **Never commit `.env` file**: Add to `.gitignore`
2. **Use different secrets per environment**: Separate `.env.dev`, `.env.staging`, `.env.prod`
3. **Rotate secrets regularly**: Update GitHub Secrets and local `.env` files
4. **Use IAM roles in AWS**: Don't hardcode credentials
5. **Limit permissions**: Use least-privilege IAM policies

## See Also

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Stack-Based Architecture Guide](../docs/STACK-OPTIMIZATION.md)
- [Environment Variables Guide](../.env.example)
