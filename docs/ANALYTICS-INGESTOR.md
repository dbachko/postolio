# Analytics ingestor

The ECS worker fetches Instagram account and publication metrics through the connectors library. It stores samples and latest aggregates in PostgreSQL, uses Redis for rate limiting, and signs Token Service requests with AWS SigV4.

## Configuration

| Variable                                                      | Purpose                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                                                | PostgreSQL connection string                                          |
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Used to construct the connection string when `DATABASE_URL` is absent |
| `REDIS_URL` or `REDIS_URI`                                    | Redis connection; defaults to `redis://localhost:6379`                |
| `TOKEN_SERVICE_URL` or `TOKEN_SERVICE_FUNCTION_URL`           | IAM-authenticated Token Service URL                                   |
| `DUMMY_ACCESS_TOKEN`                                          | Local credential fallback when Token Service is not configured        |
| `FB_GRAPH_API_VERSION`                                        | Graph API version used by connectors                                  |
| `RATE_LIMIT_PER_HOUR`                                         | Per-account request limit                                             |
| `INGESTOR_LOOP_MS`                                            | Sleep after a pass that did work. `0` runs once. ECS sets `60000`.   |
| `LOG_LEVEL`                                                   | Log verbosity                                                         |

The analytics stack injects database, Redis, and Token Service settings. Its `imageTag`, `rateLimitPerHour`, and `fbGraphApiVersion` context values select the image and runtime configuration.

A positive `INGESTOR_LOOP_MS` is clamped to at least `INGESTOR_LOOP_MIN_MS` (default 60 seconds). A pass with no work sleeps `IDLE_BACKOFF_MS` (default 5 minutes) instead. See `packages/services/analytics-ingestor/src/index.ts` for the other backoff settings.

## Run and deploy

From the repository root:

```bash
pnpm --filter @postolio/analytics-ingestor build
pnpm --filter @postolio/analytics-ingestor start
```

Build the analytics image from `packages/services/analytics-ingestor/Dockerfile`, push it to the configured registry, and deploy the `analytics` stack with that image tag. The image platform must match the ECS task. See [deployment scripts](../scripts/README.md).

## Troubleshooting

- Image pull failure: check the image tag, platform, registry permissions, and network access.
- Token Service 403: check the configured URL, request signing, and the task role's function URL permissions.
- Platform 400: inspect connector errors and account permissions.
- Missing metrics: inspect worker logs, account selection, and stored samples. Rate limits and backoff may defer ingestion.

Verify results through the analytics API and the `PublicationMetricsLatest` and account metric records.
