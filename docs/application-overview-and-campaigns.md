# Postolio — Application Overview, Architecture, and Campaign Creation

This document orients a new agent to Postolio: what the application does, why it exists, how it is architected, and how the end‑to‑end campaign creation experience works in detail. All sections include concrete file references so you can dive directly into the implementation.

---

## 1) Product Goal and Core Capabilities

Postolio helps brands plan, generate, schedule, and publish social content with consistent brand voice and measurable outcomes.

- Goal: Reduce campaign creation from hours to minutes, with consistent brand voice and automated scheduling.
- Users: Solo creators to small teams managing one or more brands.
- Outcomes:
  - Consistent tone via a brand style profile projection.
  - Faster planning via a multi‑step campaign wizard.
  - Reliable posting via AWS‑backed scheduling + publishing pipeline.
  - Feedback loop via analytics and regeneration.

Primary workflows supported:

- Brand analysis and profile projection to capture voice, tone, palette, and topics.
- Campaign creation wizard (multi‑step flow, draft auto‑save, timezone‑aware dates).
- Content preview, launch, scheduling, pause/resume, and regeneration.
- Instagram publishing with status sync and UI live updates.

---

## 2) High‑Level Architecture

Monorepo: `pnpm` workspaces + Turborepo. Major packages:

- API (Fastify) — `packages/apps/api` (routes, services, Prisma integration)
- Web (React + Vite) — `packages/apps/web`
- Shared libraries — `packages/libs/*` (`@postolio/database`, `@postolio/logger`, etc.)
- Services (serverless/microservices) — `packages/services/*` (Publisher, Schedule Management, Status Sync, Brand Analysis, etc.)

Data and infra components:

- PostgreSQL (Prisma) for core entities (User, Brand, Campaign, Content, Drafts, Projection tables).
- Redis for WebSocket event streams and recent event history.
- S3 + CloudFront for image storage and CDN delivery.
- AWS EventBridge Scheduler + Lambdas for scheduling and publishing.
- DynamoDB for brand analysis learning signals; Postgres projection for fast reads.

Key docs and diagrams already in the repo:

- Monorepo overview: `README.md`
- System diagram (Mermaid): `docs/architecture-diagram.mermaid`
- Brand analysis overview: `README.md` (Brand Analysis Overview section)

---

## 3) Domain Model (Prisma)

Important models (see `packages/libs/database/prisma/schema.prisma`):

- `User`, `Brand` — ownership and OAuth integration fields.
- `Campaign` — configuration JSON plus typed fields and lifecycle status; includes:
  - `campaignType` (`CampaignTypeEnum`), `contentPillars` (Json?), `urgencyTactics` (Json?), `seasonalContext` (Json?)
  - `status` (`creating` → `preview` → `active`/`paused` → `completed` | `failed` | `processing`)
- `Content` — generated/scheduled/published content with `ContentStatus` (`draft`, `scheduled`, `published`, `failed`, `skipped`).
- `CampaignDraft` — server‑side persistent wizard state for cross‑device continuity.
- `BrandStyleProfileProjection` — projection of the latest brand profile for fast reads.

File reference: `packages/libs/database/prisma/schema.prisma:96` (CampaignTypeEnum), `packages/libs/database/prisma/schema.prisma:120` (Campaign), `packages/libs/database/prisma/schema.prisma:164` (CampaignDraft), `packages/libs/database/prisma/schema.prisma:187` (ContentStatus), `packages/libs/database/prisma/schema.prisma:195` (CampaignStatus).

---

## 4) Campaign Lifecycle and State Machine

Status transitions are enforced centrally (see `packages/apps/api/src/services/campaign.ts:1229`).

- Valid transitions:
  - `creating` → `preview` | `failed`
  - `preview` → `active` | `failed`
  - `active` → `paused` | `completed` | `failed`
  - `paused` → `active` | `completed` | `failed`
  - `failed` → `preview` (retry)
  - `completed` → ∅ (terminal)

Operational semantics:

- Pausing an `active` campaign marks all future `scheduled` posts as `skipped` but preserves `scheduledAt` to support resume (see `pauseCampaign` in `packages/apps/api/src/services/campaign.ts:944`).
- Resuming a `paused` campaign restores future `skipped` posts back to `scheduled`; past `skipped` remain flagged as permanently missed (see `resumeCampaign` in `packages/apps/api/src/services/campaign.ts:1089`).

---

## 5) End‑to‑End Campaign Creation (Detailed)

The campaign creation experience is a multi‑step wizard in the Web app with server‑side draft persistence and an API‑driven preview/launch pipeline.

### 5.1 Wizard UX (Web)

Primary container:

- `packages/apps/web/src/components/campaign-wizard/CampaignWizard.tsx`

State management and auto‑save:

- Zustand store with `persist` middleware: `packages/apps/web/src/hooks/useCampaignWizard.ts`
  - `saveDraft()` POSTs to `/api/campaigns/draft` every 3s of inactivity.
  - Hydrates from latest server draft on load to support cross‑device continuity.
- Types: `packages/apps/web/src/types/campaign-wizard.ts` (wizard‑specific types; see store usage)

Wizard steps (components under `packages/apps/web/src/components/campaign-wizard/`):

- `Step1TypeSelection.tsx` — Choose `campaignType` and auto‑load defaults (frequency, duration, themes).
- `Step2CampaignBrief.tsx` — Goals, timeline, themes, timezone‑aware date validation and constraints.
- `Step3StrategyReview.tsx` — Placeholder for AI strategy with a manual entry fallback in Phase 1.
- `Step4Timeline.tsx` — Timeline/calendar preview; adjusts post times; mobile list view.
- `Step5Review.tsx` — Review + launch options (all now, batches, day‑by‑day).
- Progress and scaffolding: `WizardProgress.tsx`, shared UI elements under `shared/`.

Important UI behaviors:

- Auto‑save indicator (`saveStatus`) and draft hydration on load.
- Date handling shows duration, enforces `startDate <= endDate`, and respects brand timezone.
- Conditional fields for promotional details when `campaignType === 'promotional'`.

### 5.2 Draft Persistence API

Routes (see `packages/apps/api/src/routes/campaign.ts`):

- `POST /api/campaigns/draft` — Save wizard state for `(userId, brandId)` pair; payload limited to ~250KB.
- `GET /api/campaigns/draft?brandId=...` — Return most recent draft for the authenticated user/brand.

Server storage: `CampaignDraft` (unique `(userId, brandId)`), `packages/libs/database/prisma/schema.prisma:164`.

### 5.3 Configure → Preview Flow

API route: `POST /api/campaigns/configure` (`packages/apps/api/src/routes/campaign.ts:28`).

Request body (selected fields):

- `name`, `brandId`, `duration { start, end }`, `frequency`, `themes`, `style`, `postingTime`
- Wizard fields: `campaignType?`, `promotionDetails?` (maps to `urgencyTactics`), `contentPillars?`

Key behaviors:

- Brand timezone detection and persistence on first configure (brand or user fallback): `TimezoneService` usage at `packages/apps/api/src/routes/campaign.ts:60`.
- Validation via `campaignService.validateCampaignConfig()` (returns 400 on validation errors).
- Persists `campaignType`, `contentPillars`, `urgencyTactics` to typed/JSON fields on `Campaign`.
- Creates `Campaign` with status `creating`, computes `estimatedPosts` and conflict summary.
- Starts background preview generation job (`campaignJobService`):
  - See `packages/apps/api/src/services/campaign.ts:184` and `packages/apps/api/src/services/campaign-jobs.ts`.

Background job (preview):

- Generates 3 example posts from configured themes.
- Saves them as `Content` with status `draft` and `generationParams.isPreview = true`.
- Updates campaign status `creating` → `preview` and broadcasts over WebSocket.

UI reaction:

- WebSocket subscription updates the dashboard and shows toasts on `preview` ready (`packages/apps/web/src/pages/Campaigns.tsx:170`).

### 5.4 Launch (Start) Flow

API route: `POST /api/campaigns/start` (`packages/apps/api/src/routes/campaign.ts:365`).

Behavior:

- Validates the campaign is owned by the user and in `preview`.
- Builds a timezone‑aware posting schedule from `duration`, `frequency`, `postingTime` using brand timezone.
  - `generatePostingSchedule()` — `packages/apps/api/src/services/campaign.ts:1338`.
- Uses existing preview `Content` to create scheduled posts; no fresh generation occurs on start.
- Schedules via Scheduler adapter (see next section) and flips status to `active`.

Pause/Resume:

- `PUT /api/campaigns/:id` with `{ status: 'paused' }` or `{ status: 'active' }`.
- Implements `skip` semantics for future posts, auto‑complete if end date passed on resume.

Regeneration:

- `POST /api/campaigns/:id/regenerate-content` with optional `themes`/`style` or `contentIds`.
- Starts a regeneration job and exposes job progress via `/api/campaigns/regeneration-jobs/:jobId`.

Deletion:

- `DELETE /api/campaigns/:id` allowed only for unlaunched campaigns (`draft`, `preview`, `creating`, `failed`).

---

## 6) Scheduling and Publishing Pipeline (AWS)

The platform separates scheduling from publishing via dedicated services and AWS infrastructure for durability and observability.

### 6.1 Scheduler Adapter (API → Scheduler Service)

- Facade: `packages/apps/api/src/services/scheduler.ts` and `packages/apps/api/src/services/scheduler-adapter.ts`
- Discovers/targets the external Content Scheduler service; falls back or degrades gracefully when `SCHEDULER_API_URL` is a placeholder.
- Enforces invariants:
  - Content must belong to a campaign.
  - Only `active` campaigns may schedule posts, except auto‑recovery for orphan `draft` posts.
  - Minimum post interval and bulk scheduling support.

### 6.2 Scheduler & Publisher Services (Lambdas)

- Schedule Management: `packages/services/schedule-management/*` — HTTP handler + EventBridge handlers for campaign schedule orchestration.
- Publisher: `packages/services/publisher/*` — Validates campaign state, publishes to Instagram via platform adapter, emits events.
- Status Sync: `packages/services/status-sync/*` — Consumes EventBridge events to update Postgres `Content` statuses.
- DLQ Processing & Cleanup: `packages/services/*-dlq-processor`, `packages/services/schedule-cleanup` — SQS DLQ reconciliation and EventBridge rule cleanup.

### 6.3 Instagram Platform Adapter

- API service posting flow (Graph API): `packages/apps/api/src/services/platform-adapter.ts`
  - Create media, publish media, fetch permalink, persist a `ContentPublication` with `platform`, `external_post_id`, and `permalink`.
  - Uses short‑lived credentials obtained securely (see `packages/apps/api/src/services/publisher-credentials.ts`).

### 6.4 Live Updates to UI (WebSockets)

- Broadcaster: `packages/apps/api/src/services/status-broadcaster.ts` persists events in Redis Streams and emits to room `brand:${brandId}`.
- Web client: `packages/apps/web/src/hooks/useSchedulingWebSocket.ts` and handlers in `packages/apps/web/src/pages/Campaigns.tsx`.
- UI displays per‑content status chips (draft/scheduled/published/failed/skipped) and campaign status changes (creating/preview/active/paused/completed/failed).

---

## 7) Images, Storage, and CDN

- All uploads now flow through the Assets service client at `packages/apps/api/src/services/assets-media.ts`, which proxies to `packages/apps/assets-api`.
- Environment variables used:
  - `ASSETS_API_BASE_URL`, `ASSETS_API_SERVICE_TOKEN`, `ASSETS_CDN_DOMAIN`, `AWS_REGION`.
- Assets are optimized by the assets pipeline, stored in the dedicated assets bucket, and served via the assets CloudFront distribution (exported through `/postolio/<env>/assets/cdn-domain`).

---

## 8) Security, Validation, and Rate Limiting

- Authentication middleware for API routes: `fastify.authenticate`.
- Ownership checks: every campaign/brand read/update validates `userId` ownership via Prisma queries.
- Request validation: `zod` schemas + custom validators (e.g., `validateCampaignUpdateRequest` in `packages/apps/api/src/utils/campaign-validation.js`).
- Rate limiting for draft saves and campaign operations: `packages/apps/api/src/services/rate-limiter.ts` used via `createRateLimitMiddleware` in `campaign.ts`.
- Instagram credentials are fetched just‑in‑time for the publisher Lambda: `packages/apps/api/src/services/publisher-credentials.ts`.

---

## 9) Edge Cases and Operational Notes

- Timezones: All user dates are normalized using brand timezone; `configure` may auto‑detect and persist timezone for the brand/user. See `TimezoneService` and usage in `campaign.ts`.
- Past times: Scheduler skips posting times in the past (with a small buffer) to prevent immediate failures.
- Draft payload size: `wizardState` payload capped at ~250KB (string length check) to avoid oversized drafts.
- Conflicts: `campaignCoordinationService` detects conflicts but allows creation; details are stored under `campaign.config.conflicts` for UI display.
- Pause/Resume semantics: Future scheduled posts are reversible; past scheduled times become permanently skipped during a pause window.

---

## 10) Local Development and Useful Commands

Prereqs: Node 22+, pnpm 9+ (`nvm use`), Docker for local Postgres/Redis.

- Install deps: `pnpm install`
- Start dev DBs: `pnpm run dev:db`
- API (Fastify): `pnpm --filter api dev`
- Web (Vite): `pnpm --filter @postolio/web dev`
- Start all: `pnpm run start:all`
- Lint/typecheck/tests: `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Prisma migrations: ensure `DATABASE_URL` is set; then `pnpm run migrate:deploy`

Smoke testing campaign flow locally:

1. Create a brand, ensure it’s selected in the UI.
2. Go to `/campaigns/create` and complete Steps 1–5.
3. The UI auto‑saves drafts and calls `POST /api/campaigns/configure`.
4. Wait for preview (status `creating` → `preview` via WebSocket).
5. Start campaign; verify content shows as `scheduled` and transitions to `published` in time.

---

## 11) How to Extend or Debug Campaign Creation

Common extension points:

- Add a new `campaignType`: extend enum in schema (`CampaignTypeEnum`), update type cards, and default config.
- Add fields to wizard: wire through Zustand store, draft payload, and `ConfigureSchema`/`CampaignConfig` mapping.
- Adjust scheduling policies: update `generatePostingSchedule()` and scheduler adapter invariants.
- Tune image generation/storage: adjust `content-generator` and `s3-image.ts`.

Debug pointers:

- API route flow: `packages/apps/api/src/routes/campaign.ts`
- Core logic and status transitions: `packages/apps/api/src/services/campaign.ts`
- Preview background job: `packages/apps/api/src/services/campaign-jobs.ts`
- Scheduler bridge: `packages/apps/api/src/services/scheduler-adapter.ts`
- WebSocket events: `packages/apps/api/src/services/status-broadcaster.ts`
- Web wizard state: `packages/apps/web/src/hooks/useCampaignWizard.ts`

---

## 12) Roadmap Fit (Phases)

This repo includes deep research and an implementation plan for campaigns:

- Research: `docs/campaign-creation-research.md` (UI/UX, AI strategy, competitive analysis)
- Implementation Plan: `docs/campaign-creation-implementation-plan.md` (tasks, files, acceptance)

Phases referenced in code and docs:

- Phase 1 — UX and structured fields (current): Wizard, drafts, timezone handling, preview/launch, pause/resume, regeneration.
- Phase 2 — AI Strategy Generation: `/api/campaigns/analyze-goal`, `/api/campaigns/generate-strategy` endpoints scaffolded; UI placeholders in Step 3.
- Phase 3 — Continuous Learning and Adaptive Generation: feedback loops and performance‑driven optimization.

---

## 13) Glossary and Invariants

- Campaign: A named collection of content configured with timeline, frequency, themes, style, and posting time.
- Preview: The interim state with example posts created but not scheduled; user reviews before launch.
- Launch: Transition to `active`, schedule posts with AWS Content Scheduler.
- Skipped: Posts not published due to pause; can be restored if still in the future on resume.
- Ownership: All read/write operations are scoped to the authenticated user’s brands.

Invariant checks to remember:

- Only campaigns in `preview` can be started.
- Only `active` or `paused` campaigns can be toggled; edits are blocked for `active` until paused.
- Content must belong to a campaign to be scheduled; otherwise the scheduler rejects it.

---

If you need deeper context, start with the file references above, then read the research and implementation plan docs to understand strategic decisions and future phases.
