# Service: @postolio/dlq-processor

This service is responsible for processing messages that have failed delivery and ended up in a Dead-Letter Queue (DLQ). It provides a mechanism to inspect, retry, or discard failed messages, ensuring system resilience.

## Development

### Scripts

-   **Build:** `pnpm build`
-   **Lint:** `pnpm lint`
-   **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/dlq-processor <script_name>
```
