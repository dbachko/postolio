# Service: @postolio/status-sync

This service is responsible for synchronizing the status of published content. It periodically checks the social media platforms for engagement and updates the local database with the latest information.

## Development

### Scripts

- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/status-sync <script_name>
```
