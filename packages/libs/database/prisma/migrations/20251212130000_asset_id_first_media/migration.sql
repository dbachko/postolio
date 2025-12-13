-- Asset-id-first media model:
-- - Remove cached media URL/type fields from `content`
-- - Replace `post_media_assets` with `content_media_assets` that stores only asset references + ordering

ALTER TABLE "content"
  DROP COLUMN IF EXISTS "primaryAssetId",
  DROP COLUMN IF EXISTS "primaryAssetCdnUrl",
  DROP COLUMN IF EXISTS "primaryAssetWidth",
  DROP COLUMN IF EXISTS "primaryAssetHeight",
  DROP COLUMN IF EXISTS "mediaType",
  DROP COLUMN IF EXISTS "videoUrl",
  DROP COLUMN IF EXISTS "videoDuration",
  DROP COLUMN IF EXISTS "videoThumbnail",
  DROP COLUMN IF EXISTS "aspectRatio";

DROP TABLE IF EXISTS "post_media_assets";

CREATE TABLE "content_media_assets" (
  "contentId" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "assetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_media_assets_pkey" PRIMARY KEY ("contentId","displayOrder"),
  CONSTRAINT "content_media_assets_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "content_media_assets_contentId_idx" ON "content_media_assets"("contentId");

