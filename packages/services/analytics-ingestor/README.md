Analytics Ingestor (Scaffold)

Purpose

- Background worker to fetch platform analytics via connectors and persist into MetricSample and PublicationMetricsLatest.

Local Dev Notes

- Requires a Postgres database with the Analytics v2 schema applied.
- Requires Redis for token bucket rate limiting (coming next iteration).
- Credentials: temporarily reads `DUMMY_ACCESS_TOKEN` from env. This will be replaced with Token Service integration.

Commands

- Build: pnpm --filter @postolio/analytics-ingestor build
- Run once: node dist/index.js
