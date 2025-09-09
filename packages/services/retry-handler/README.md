# Service: @postolio/retry-handler

This service implements a generic retry mechanism for failed operations. It can be invoked by other services to handle transient errors, applying strategies like exponential backoff to ensure eventual consistency.

## Development

### Scripts

- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/retry-handler <script_name>
```
