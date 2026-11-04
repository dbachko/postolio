# Media assets

The assets service owns media metadata. Callers use `Asset.fileType` (`image` or `video`), MIME type, dimensions, duration, and thumbnails to preview and publish media.

## Storage

- Assets schema: `packages/libs/database-assets/prisma/schema.prisma`
- Main schema: `packages/libs/database/prisma/schema.prisma`
- `Content.primaryAssetId` and `PostMediaAsset.assetId` reference assets.
- Main database records cache CDN URLs and ordering; they do not replace asset metadata.

## Upload and attach

1. The web app requests upload URLs through `/api/assets/upload-url`.
2. The browser uploads bytes to S3 using presigned URLs.
3. The API creates asset metadata through the assets service.
4. Attaching an asset updates the content's primary asset reference and media rows. Replacing a carousel recreates media rows in display order.

API proxy: `packages/apps/api/src/routes/assets-proxy.ts`.
Content media routes: `packages/apps/api/src/routes/content/media.ts`.
Attachment service: `packages/apps/api/src/services/assets-media.ts`.

## Read and publish

Post detail and scheduling code load asset metadata for the referenced IDs. The UI uses the returned media type for previews. The scheduler constructs typed `mediaAssets` and validates the publishing payload through `@postolio/content-validation`.

Use explicit asset metadata for type decisions. A CDN URL's extension may be missing or misleading.

See [assets API setup](../packages/apps/assets-api/README.md) and [content scheduler](README-SCHEDULER.md).
