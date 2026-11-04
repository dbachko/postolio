# Analytics ingestor

Fetches Instagram account and publication metrics through the connectors library and stores them in PostgreSQL.

Requires PostgreSQL and Redis. Credentials come from `TOKEN_SERVICE_URL` or `TOKEN_SERVICE_FUNCTION_URL`; for local development without Token Service, set `DUMMY_ACCESS_TOKEN`.

From the repository root:

```bash
pnpm --filter @postolio/analytics-ingestor build
pnpm --filter @postolio/analytics-ingestor start
```

Set `INGESTOR_LOOP_MS` to run repeatedly. See [configuration and troubleshooting](../../../docs/ANALYTICS-INGESTOR.md).
