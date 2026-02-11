# CloudFront: SPA + API Routing (No HTML for API errors)

Goal: Ensure API routes (`/api/*`) hit the API origin and return JSON with correct status codes, while the SPA keeps deep-link routing via `index.html` — without a global 403→index.html rewrite.

CDK status: Automated

- The CDK Web stack (`packages/infra/cdk/lib/stacks/web-stack.ts`) now:
  - Adds a CloudFront Function (viewer-request) to rewrite non-file, non-`/api/*` paths to `/index.html`.
  - Configures an `/api/*` behavior pointing to the API origin with all methods, caching disabled, and ALL_VIEWER headers.
  - Removes the 403→`/index.html` error page mapping.
  - No manual CloudFront edits are required.

## Summary

- Add a behavior for `/api/*` that points to the API origin (ALB/NLB) with all methods, no caching, and full header/cookie/query forwarding.
- Remove the 403 custom error page mapping that rewrites to `/index.html`.
- Attach a CloudFront Function (Viewer Request) on the default (web) behavior to rewrite non-file, non-`/api/*` paths to `/index.html`.

This prevents “HTML instead of JSON” when the API returns 403/409/etc. (e.g., allowlist signup rejections).

## What CDK Deploys

- Default behavior: SPA static assets on S3.
- Viewer-request function on default behavior to rewrite non-file, non-`/api/*` paths to `/index.html`.
- Additional behaviors:
  - `/index.html` (no cache)
  - `/api/*` → API origin with ALL methods, CachingDisabled, OriginRequestPolicy.ALL_VIEWER
  - `/ws` → API origin for WebSockets
- Error pages: only `404 → /index.html (200)`. No 403 rewrite.

## Verify

- API health: `curl -i https://<domain>/api/health` → `200` with JSON.
- Blocked signup (allowlist off): POST `.../api/auth/register` → `403` JSON. Should NOT be HTML.
- SPA routes: navigate to deep links like `/login` or `/content/123` → should load `index.html` and render.
