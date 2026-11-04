# Media assets

The assets service owns media metadata. Callers use `Asset.fileType` (`image` or `video`), MIME type, dimensions, duration, and thumbnails to preview and publish media.

## Storage

- Assets schema: `packages/libs/database-assets/prisma/schema.prisma`
- Main schema: `packages/libs/database/prisma/schema.prisma`
- `ContentMediaAsset` stores `assetId` and `displayOrder`. There is no `Content.primaryAssetId` column. API responses set `primaryAssetId` from the first media row, ordered by `displayOrder`.
- Assets store S3 keys (`s3Key` and thumbnail keys). The main database does not cache CDN URLs.

## Upload and attach

1. The web app requests upload URLs through `/api/assets/upload-url`.
2. The browser uploads bytes to S3 using presigned URLs.
3. The API creates asset metadata through the assets service.
4. Attaching an asset upserts a `ContentMediaAsset` row (`assetId`, `displayOrder`). Replacing a carousel deletes the content's media rows and recreates them in display order.

API proxy: `packages/apps/api/src/routes/assets-proxy.ts`.
Content media routes: `packages/apps/api/src/routes/content/media.ts`.
Attachment service: `packages/apps/api/src/services/assets-media.ts`.

## Read and publish

Post detail and scheduling code load asset metadata for the referenced IDs. The UI uses the returned media type for previews. The scheduler constructs typed `mediaAssets` and validates the publishing payload through `@postolio/content-validation`.

Use explicit asset metadata for type decisions. A CDN URL's extension may be missing or misleading.

See [assets API setup](../packages/apps/assets-api/README.md) and [content scheduler](README-SCHEDULER.md).
