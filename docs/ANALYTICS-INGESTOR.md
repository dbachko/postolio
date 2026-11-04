Analytics Ingestor: Env Vars, Deploy, and Troubleshooting

Overview

- The Analytics Ingestor runs as an ECS Fargate service and periodically fetches Instagram metrics via the connectors library and persists them to `MetricSample`, `PublicationMetricsLatest`, and `AccountMetricsLatest`.
- It uses Redis for per-account rate limiting and reads DB/Redis/Token Service endpoints from SSM/Secrets injected by the CDK stack.

Key Environment Variables

- FB_GRAPH_API_VERSION
  - Purpose: Controls the Facebook/Instagram Graph API version used by connectors, API service calls, and OAuth flows.
  - Default: `v24.0`
  - How to set: Runtime env var, or via Analytics stack context `--context fbGraphApiVersion=v24.0`.

- RATE_LIMIT_PER_HOUR
  - Purpose: Per-account rate limit enforced by the ingestor (token-bucket on Redis). When the limit is exceeded, items are skipped with a log message.
  - Default: `200`
  - How to set: Runtime env var, or via Analytics stack context `--context rateLimitPerHour=1000` (useful for dev/tests).

- TOKEN_SERVICE_URL (or TOKEN_SERVICE_FUNCTION_URL)
  - Purpose: Base URL for the Token Service Lambda Function URL (IAM-authenticated). The ingestor signs requests using AWS SigV4.
  - Injected by: Analytics stack from SSM (`/postolio/{env}/auth/token-service-url`).

- DATABASE*URL (or DB*\* variables)
  - Purpose: Prisma connection string. If `DATABASE_URL` is not provided, the ingestor constructs it from `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` (all injected by the stack).

- REDIS_URL
  - Purpose: Redis connection for rate limiting. Injected from SSM via the stack using endpoint + port.
  - Example: `redis://cache-endpoint:6379`.

- INGESTOR_LOOP_MS
  - Purpose: Interval between ingestor passes (ms). Default `60000` in ECS. For one-shot runs set to `0`.

- LOG_LEVEL
  - Purpose: `info`/`debug`/`trace` verbosity. Default `debug` in dev.

CDK Context (Analytics Stack)

- `imageTag` – ECR image tag to deploy (e.g., `analytics-dev-latest`).
- `rateLimitPerHour` – Sets `RATE_LIMIT_PER_HOUR` env on the task.
- `fbGraphApiVersion` – Sets `FB_GRAPH_API_VERSION` env on the task.

Deploy Script Usage

- Build/push the image to ECR and deploy the stack:
  - Build multi-arch (amd64) image and push:
    - docker buildx build --platform linux/amd64 \
      -f packages/services/analytics-ingestor/Dockerfile \
      -t 000000000000.dkr.ecr.us-east-1.amazonaws.com/postolio:analytics-dev-latest \
      . --push
  - Deploy with higher rate limit for dev:
    - RATE_LIMIT_PER_HOUR=1000 scripts/deploy-stack.sh -e dev analytics

Troubleshooting

- CannotPullContainerError: "image Manifest does not contain descriptor matching platform 'linux/amd64'"
  - Cause: Image was built as `linux/arm64` (common on Apple Silicon), but ECS in dev uses `linux/amd64`.
  - Fix (rebuild + push for amd64):
    - docker buildx create --use --name postolio-builder || true
    - docker buildx build --platform linux/amd64 \
      -f packages/services/analytics-ingestor/Dockerfile \
      -t 000000000000.dkr.ecr.us-east-1.amazonaws.com/postolio:analytics-dev-latest \
      . --push
  - Re-deploy the Analytics stack so the task pulls the matching image.

- Token Service 403
  - Ensure `TOKEN_SERVICE_URL` is set from SSM and the task role includes `lambda:InvokeFunctionUrl` on the Token Service function ARN.

- Account insights 400
  - Connector now retries without `profile_views` and logs Graph API error context; verify `instagram_manage_insights` permission if failures persist.

Verifying Ingestion

- Tail logs: `aws logs tail <analytics-log-group> --since 15m --follow`
- Look for: "[Ingestor] Resolved external media to publication", "Fetching media insights", "Upserted metrics".
- API check: `GET /api/analytics/publications/:id` should return `PublicationMetricsLatest`.
