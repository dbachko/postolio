# Application: @postolio/web

This is the frontend web application for Postolio. It is a single-page application built with React and Vite, providing the user interface for managing brands, content, and analytics.

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

## REST Structure and API Clients

The web app consumes a RESTful API via domain-scoped clients backed by a shared HTTP adapter.

- HTTP adapter: `src/lib/http/http.ts`
  - Adds `X-Timezone`, handles CSRF (`/api/csrf-token`), includes credentials, and retries on 401 via the AuthInterceptor.
- Domain clients: `src/lib/api/{auth-client,brand-client,campaign-client,content-client}.ts`
  - Import via `import { auth, brand, campaign, content } from '@/lib/api'`.
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

- Campaigns
  - `GET /api/campaigns?brandId=` — list campaigns
  - `POST /api/campaigns` — create
  - `GET|PUT|DELETE /api/campaigns/:id` — detail/update/delete
  - `POST /api/campaigns/:id/start` — start
  - `POST /api/campaigns/:id/fill-window` — generate window
  - Drafts: `GET|POST /api/campaigns/drafts`
  - Strategy & goal: `POST /api/campaigns/{strategy,analyze-goal}`
  - Analytics: `/api/campaigns/:id/analytics{,/recommendations,/roi}`
  - Brand analytics summary: `/api/brands/:brandId/analytics/summary`

- Content
  - `POST /api/content` — create manual content
  - `PUT /api/content/:id` — update (caption/hashtags/schedule)
  - `DELETE /api/content/:id` — delete (non-published)
  - `POST /api/content/:id/{schedule,publish}` — schedule/publish
  - `POST /api/content/upload-image` — upload image
  - `GET /api/posts/:id{,/insights,/comments}` — post detail and insights

- Analytics/Engagement/Growth (helpers)
  - Analytics: `/api/analytics/{report/:brandId,stats/:brandId,scheduled/:brandId,reschedule}`
  - Engagement: `/api/engagement/{status/:brandId,stats/:brandId,start/:brandId,stop/:brandId}`
  - Growth: `/api/growth/{analyze,strategies,metrics/:brandId}`

The monolithic `api.ts` has been decomposed. Prefer importing domain clients from `src/lib/api/index.ts` and keep view components thin by using container hooks for data/mutations.
