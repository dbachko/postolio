# Service: @postolio/schedule-cleanup

This service is a maintenance task responsible for cleaning up old or completed schedules from the database. It runs periodically to ensure the scheduling system remains performant.

## Development

### Scripts

-   **Build:** `pnpm build`
-   **Lint:** `pnpm lint`
-   **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/schedule-cleanup <script_name>
```
