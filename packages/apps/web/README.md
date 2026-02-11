# Application: @postolio/web

This is the frontend web application for Postolio. It is a single-page application built with React and Vite, providing the user interface for managing brands, content, and analytics.

## Rules

- Repo-wide rules: `AGENTS.md` (at the monorepo root)
- Web-specific rules: `AGENTS.md` (this directory)

## Development

### Scripts

- **Dev:** `pnpm dev` (Starts the Vite development server)
- **Build:** `pnpm build`
- **Lint:** `pnpm lint`
- **Test:** `pnpm test`
- **Preview:** `pnpm preview` (Serves the production build locally)

To run any script for only this application from the monorepo root, use the `--filter` flag:

```bash
# Example: Start the web app in development mode
pnpm --filter=@postolio/web dev
```

### First run after a clean checkout (build deps)

This app depends on workspace libraries (e.g., `@postolio/csrf-client`) that publish built files in their `dist/` directories. After cleaning caches or on a fresh clone, build those dependencies once, then start Vite:

```bash
# Build only web’s dependencies (not the web bundle)
pnpm --filter @postolio/web^... run build

# Start the Vite dev server
pnpm --filter @postolio/web dev
```

If Vite shows an error about a missing `@postolio/*/dist/*` file, it means that library hasn’t been built yet—run the dependency build step above and retry.

## UI Components (shadcn/ui)

- We standardize on shadcn/ui primitives installed locally under `src/components/ui`.
- Usage guide: see `../../docs/SHADCN-UI-USAGE.md` for install commands, import rules, tokens/colors, and composition patterns.
- Always import from `@/components/ui/<component>` and prefer design tokens like `text-foreground`, `bg-background`, `border` over palette utilities.
- Lint guard: ESLint blocks non-alias imports of UI primitives (see `eslint.config.js`).

### Local HTTPS on ai.localhost

- Run `scripts/setup-ai-localhost.sh` once to generate and trust local dev certs (mkcert required).
- Web dev server will be available at `https://ai.localhost:5173`.
- API dev server proxies via HTTPS to `https://ai.localhost:3000`.

## REST Structure and API Clients

The web app consumes a RESTful API via domain-scoped clients backed by a shared HTTP adapter.

- HTTP adapter: `src/lib/http/http.ts`
  - Adds `X-Timezone`, handles CSRF (`/api/csrf-token`), includes credentials, and retries on 401 via the AuthInterceptor.
- Domain clients: `src/lib/api/{auth-client,brand-client,content-client}.ts`
  - Import via `import { auth, brand, content } from '@/lib/api'`.
  - For simple one-offs, use `httpGet/httpPost/httpPut/httpDelete` from the same barrel.

### Key REST Endpoints (selected)

- Brands
  - `GET /api/brands` — list brands
  - `POST /api/brands` — create brand
  - `GET|PUT|DELETE /api/brands/:brandId` — brand detail/update/delete
  - `GET|PATCH /api/brands/:brandId/timezone` — brand timezone
  - Instagram (nested):
    - `GET /api/brands/:brandId/instagram/authorize` — returns OAuth URL
    - `GET /api/brands/:brandId/instagram/status` — connection status
    - `POST /api/brands/:brandId/instagram/refresh-token` — no-op (handled automatically)
    - `POST /api/brands/:brandId/instagram/disconnect` — unlink IG
    - `POST /api/brands/:brandId/instagram/sync` — sync published posts
  - Analysis:
    - `POST /api/brands/:brandId/analysis` — start brand analysis
    - `GET /api/brands/:brandId/analysis/status` — job status
    - `GET /api/brands/:brandId/analysis/profile` — latest profile
    - `GET /api/brands/:brandId/analysis/profiles` — list profiles
    - `GET /api/brands/:brandId/analysis/diff/:a/:b` — diff two profiles
  - Calendar: `GET /api/brands/:brandId/calendar/:yyyymm`

- Content
  - `POST /api/content` — create manual content
  - `PUT /api/content/:id` — update (caption/hashtags/schedule)
  - `DELETE /api/content/:id` — delete (non-published)
  - `POST /api/content/:id/{schedule,publish}` — schedule/publish
  - `POST /api/content/upload-image` — upload image
  - `GET /api/posts/:id{,/insights,/comments}` — post detail and insights

- Analytics (helpers)
  - Analytics: `/api/analytics/{stats/:brandId,scheduled/:brandId,reschedule,bulk-schedule,schedule}`

The monolithic `api.ts` has been decomposed. Prefer importing domain clients from `src/lib/api/index.ts` and keep view components thin by using container hooks for data/mutations.
