# Media Assets: End-to-End Flow (Web → API → Assets Service)

This document describes where media type lives today (`image` vs `video`), how assets flow through the system, and where we should derive media type (hint: from the assets service, not URL heuristics).

## Data Stores

### Assets DB (source of truth)

- Schema: `packages/libs/database-assets/prisma/schema.prisma`
- Model: `Asset`
  - Canonical type: `Asset.fileType` (`image | video`)
  - Additional metadata: `mimeType`, `width/height`, `duration` (videos), thumbnails, etc.

### Main DB (post/content references + caches)

- Schema: `packages/libs/database/prisma/schema.prisma`
- Models:
  - `Content`
    - `primaryAssetId` (assets service id, canonical reference)
    - `primaryAssetCdnUrl` (cached URL for faster reads)
    - `mediaType` / `contentType` / `videoUrl` (content-level metadata)
  - `PostMediaAsset`
    - `assetId` (assets service id)
    - `cdnUrl` (cached URL)
    - `displayOrder`, `usageContext`, dimensions
    - Note: does **not** persist `fileType` today.

## Upload → Asset Creation

### Web: Assets Library / Right Sidebar uploads

- Client: `packages/apps/web/src/features/assets/api/client.ts`
- UI: `packages/apps/web/src/right-sidebar/AssetUploadSidebar.tsx`

Flow:

1. Request upload URLs (proxy)
   - Web → `POST /api/assets/upload-url`
   - API: `packages/apps/api/src/routes/assets-proxy.ts`
   - Assets service: `AssetsServiceClient.getUploadUrl(...)`
2. Browser uploads bytes to S3 using presigned URL(s)
3. Create asset metadata (proxy)
   - Web → `POST /api/assets`
   - API: `packages/apps/api/src/routes/assets-proxy.ts`
   - Assets service: `AssetsServiceClient.createAsset(...)`
   - `Asset.fileType` is persisted here.

### API: Video helper endpoints (compat)

- API: `packages/apps/api/src/routes/video.ts`
- Still ends by creating an asset record with `fileType: 'video'`.

## Attach Asset(s) To a Post

### Replace primary asset

- API route: `POST /api/content/:contentId/asset`
- Handler: `packages/apps/api/src/routes/content/media.ts`
- Writer: `packages/apps/api/src/services/assets-media.ts` (`attachAssetToContent`)

Writes:

- `Content.primaryAssetId` / `Content.primaryAssetCdnUrl` (cache)
- Upserts a `PostMediaAsset` row (`assetId`, `cdnUrl`, ordering, dimensions)

### Replace full media set (carousel)

- API route: `PUT /api/content/:contentId/media`
- Handler: `packages/apps/api/src/routes/content/media.ts`

Writes:

- Clears existing `PostMediaAsset` rows, then recreates them in display order.
- Does **not** store file type in main DB (only `assetId` references).

## Fetch / Transform For UI

### Asset library browsing

- Web lists assets via API proxy:
  - `GET /api/assets?...` → `packages/apps/api/src/routes/assets-proxy.ts`
  - Response comes from assets service and includes `fileType`.

### Post detail page

- API: `packages/apps/api/src/routes/post-detail.ts`
  - Reads `Content` + `PostMediaAsset[]`
  - Enriches `mediaAssets[]` with `fileType` using `AssetsServiceClient.getBatchAssets(assetIds)`
  - Provides a `videoUrl` fallback derived from a video media asset when needed
- Web: `packages/apps/web/src/pages/PostDetail.tsx`
  - Renders `<video>` vs `<img>` based on `contentType`, `mediaType`, `videoUrl`, and `mediaAssets[].fileType`

### Post editor (right sidebar)

- Web: `packages/apps/web/src/right-sidebar/PostSidebar.tsx`
- Relies on `mediaAssets[].fileType` (from post detail API) for correct previews and editing state.

### Calendar / postcards

- API: `packages/apps/api/src/routes/brands.ts` (calendar endpoint)
  - Uses `Content.primaryAssetId` to batch load asset previews (`fileType`, thumbnails) from the assets service
- Web: cards display a media-type badge (`MediaTypeBadge`) based on explicit content fields and `mediaAssets` metadata when available.

## Scheduling / Publishing

- API: `packages/apps/api/src/services/scheduler-adapter.ts`
  - Reads `Content` + `PostMediaAsset[]`
  - Batch loads asset metadata (`fileType`, `duration`) from the assets service (with a small in-memory TTL cache)
  - Constructs structured `mediaAssets[]` with explicit per-asset `type` (image/video)
  - Validates payload using `@postolio/content-validation`

## Why URL Guessing Existed (and what to avoid)

- Main DB `PostMediaAsset` stores `assetId` and `cdnUrl`, but not `fileType`.
- Without enriching from the assets service, callers only had URLs and were forced into brittle heuristics (e.g., “does it end in `.mp4`?”).

## Improvement Options

1. **Enrich from assets service on read/schedule (current direction)**
   - Pros: no DB migration; uses canonical metadata.
   - Cons: adds a cross-service dependency; should use caching + graceful fallbacks.

2. **Denormalize `fileType` onto `PostMediaAsset`**
   - Update writers (`attachAssetToContent`, carousel write paths) to persist fileType.
   - Backfill existing rows once using `assetId → Asset.fileType`.
   - Pros: fast reads; scheduler/publisher resilient to assets-service outages.
   - Cons: migration/backfill work; requires keeping denormalized value in sync.

3. **Hybrid cache (Redis/table) for `assetId → fileType/duration`**
   - Pros: reduces network calls without schema changes.
   - Cons: cache invalidation/consistency complexity.

## Recommendation

- Short term: keep deriving types from `Asset.fileType` (not URLs) and ensure the UI surfaces that need per-asset type receive `mediaAssets[].fileType`.
- Medium term: consider denormalizing `fileType` onto `PostMediaAsset` to eliminate cross-service reads in scheduler/publisher and remove all remaining ambiguity.
