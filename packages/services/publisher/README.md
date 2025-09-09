# Service: @postolio/publisher

This service is responsible for publishing content to various social media platforms. It takes scheduled content, formats it for the target platform, and handles the final posting via the appropriate API.

## Development

### Scripts

- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/publisher <script_name>
```
