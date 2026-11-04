# CloudFront routing

The web stack routes API and WebSocket traffic to the API origin and serves the SPA from S3. Its viewer-request function rewrites non-file SPA paths to `/index.html`.

Defined in `packages/infra/cdk/lib/stacks/web-stack.ts`:

- `/api/*`: API origin, all methods, caching disabled, viewer headers forwarded
- `/ws`: API origin for WebSockets
- `/index.html`: caching disabled
- Default behavior: static web assets with SPA path rewriting

API errors should retain their status and JSON body. Do not add a global 403-to-`index.html` rewrite.

## Verify

- `GET /api/health` returns JSON.
- A rejected API request returns its error status and JSON body.
- Opening a SPA deep link loads the matching page.
