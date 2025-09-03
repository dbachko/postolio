# Status Sync Lambda

Consumes EventBridge events and updates PostgreSQL `Content` status.

## Events
- `post.published`: sets `status=published`, `postedAt`, `instagramPostId`, `instagramPermalink`.
- `post.failed`: sets `status=failed`, `schedulingError`.
- `schedule.created`: sets `status=scheduled`, `scheduledAt`.
- `schedule.updated`: updates `scheduledAt` (if provided).
- `schedule.canceled`: clears `scheduledAt`, sets `status=draft`.

## Configuration
Provide one of the following:
- `DATABASE_URL` (full Postgres URL), or
- `DB_HOST`, `DB_PORT`, `DB_NAME`, and either:
  - `DB_USERNAME`/`DB_PASSWORD`, or
  - `DB_SECRET_ARN` (or `DB_SECRET_NAME`) pointing to a Secrets Manager secret with `{ username, password }`.

Grant `secretsmanager:GetSecretValue` if using a secret.

## Deployment
The `ContentSchedulerStack` creates `StatusSyncLambda` and an EventBridge rule targeting it. Ensure DB env vars are set via stack configuration or runtime environment.
