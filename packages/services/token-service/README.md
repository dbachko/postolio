# Service: @postolio/token-service

This service handles all aspects of authentication and authorization. It is responsible for issuing, validating, and refreshing JWTs and other API tokens used throughout the platform.

## Development

### Scripts

-   **Build:** `pnpm build`
-   **Lint:** `pnpm lint`
-   **Test:** `pnpm test`

To run any script for only this service from the monorepo root, use the `--filter` flag:

```bash
pnpm --filter=@postolio/token-service <script_name>
```
