# Scripts

Helpers for local development, deployment, and billing setup.

## Local HTTPS: ai.localhost (macOS)

Install mkcert (`brew install mkcert`; also `brew install nss` for Firefox), then run:

```bash
pnpm setup:ai-localhost
```

The helper trusts the local CA, generates certificates under `certs/`, and writes SSL paths to the API and web `.env` files. The API runs at `https://ai.localhost:3000` and web at `https://ai.localhost:5173`. The `.localhost` domain resolves to loopback without editing `/etc/hosts`.

If the browser rejects the certificate, run `mkcert -install` and restart it. To regenerate certificates, delete the generated files under `certs/` and rerun the helper.

See the [root README](../README.md) for starting the development stack and resetting local data.

## Application URLs

`get-app-urls.sh` reads deployed stack outputs for application URLs, API endpoints, resource IDs, and stack status:

```bash
./scripts/get-app-urls.sh dev
./scripts/get-app-urls.sh staging
./scripts/get-app-urls.sh prod
```

## Local AWS deployment

`deploy-stack.sh` loads the root `.env`, maps its values to CDK context, builds dependencies, and deploys the selected stack. Configure AWS CLI credentials and application settings first; see [`.env.example`](../.env.example).

```bash
./scripts/deploy-stack.sh -e dev all
./scripts/deploy-stack.sh -e staging api
./scripts/deploy-stack.sh -f .env.production -e prod api
```

| Option            | Purpose                                 |
| ----------------- | --------------------------------------- |
| `-e, --env`       | `dev` (default), `staging`, or `prod`   |
| `-f, --env-file`  | Environment file (default: root `.env`) |
| `-t, --image-tag` | Docker image tag                        |
| `-h, --help`      | Usage and environment variables         |

### Stacks

| Stack            | Resources                                     |
| ---------------- | --------------------------------------------- |
| `foundation`     | Shared network, database, Redis, and ECR      |
| `auth`           | Token Service                                 |
| `scheduling`     | Schedule management, cleanup, and status sync |
| `brand-analysis` | Profiles, jobs, analysis, and projection      |
| `asset-library`  | Assets API, storage, CDN, and processing      |
| `publishing`     | Publisher, retries, and dead-letter queues    |
| `analytics`      | Analytics ingestor                            |
| `api`            | Fastify API on ECS                            |
| `web`            | Frontend on S3 and CloudFront                 |
| `all`            | All stacks in dependency order                |

The local script deploys infrastructure using the selected image tag. The [GitHub deployment workflow](../.github/workflows/README.md) also builds and pushes images.

### Configuration

The script maps application environment variables to CDK context:

| Environment variable     | CDK context            |
| ------------------------ | ---------------------- |
| `OPENAI_API_KEY`         | `openaiApiKey`         |
| `GOOGLE_CLIENT_ID`       | `googleClientId`       |
| `GOOGLE_CLIENT_SECRET`   | `googleClientSecret`   |
| `FACEBOOK_APP_ID`        | `facebookAppId`        |
| `FACEBOOK_APP_SECRET`    | `facebookAppSecret`    |
| `INSTAGRAM_APP_ID`       | `instagramAppId`       |
| `INSTAGRAM_APP_SECRET`   | `instagramAppSecret`   |
| `INSTAGRAM_REDIRECT_URI` | `instagramRedirectUri` |
| `LINKEDIN_CLIENT_ID`     | `linkedinClientId`     |
| `LINKEDIN_CLIENT_SECRET` | `linkedinClientSecret` |
| `TIKTOK_CLIENT_KEY`      | `tiktokClientKey`      |
| `TIKTOK_CLIENT_SECRET`   | `tiktokClientSecret`   |
| `NODE_ENV`               | `nodeEnv`              |
| `LOG_LEVEL`              | `logLevel`             |
| `ENABLE_MONITORING`      | `enableMonitoring`     |
| `DOMAIN_NAME`            | `domainName`           |
| `VITE_API_URL`           | `corsOrigin`           |

Brand analysis table overrides: `BRAND_PROFILES_TABLE_NAME`, `BRAND_JOBS_TABLE_NAME`, `BRAND_PROFILES_TABLE_PARAM_PATH`, and `BRAND_JOBS_TABLE_PARAM_PATH`. Without overrides, the API uses `postolio-<env>-brand-analysis-profiles` and `postolio-<env>-brand-analysis-jobs`.

### Troubleshooting

- Missing credentials: configure AWS CLI credentials for the target account and region.
- Missing settings: inspect CDK's reported context errors and the selected environment file.
- `ROLLBACK_COMPLETE`: inspect CloudFormation events before accepting the script's prompt to delete the failed stack.
- Image pull failure: check that the selected tag exists and its platform matches the ECS task. See [API image deployment](../docs/api-docker-deployment-guide.md) and [analytics configuration](../docs/ANALYTICS-INGESTOR.md).

## Stripe setup

`setup-stripe-billing.sh` creates or reuses products, prices, portal configuration, and webhook resources. See [Stripe billing setup](../docs/STRIPE-BILLING-SETUP.md) for arguments and environment variables.
