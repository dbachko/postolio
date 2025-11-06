-- Remove legacy S3 columns from content
ALTER TABLE "content"
  DROP COLUMN IF EXISTS "s3ImageKey",
  DROP COLUMN IF EXISTS "imageRegion",
  DROP COLUMN IF EXISTS "retentionExpiresAt";

ALTER TABLE "content"
  ADD COLUMN "primaryAssetId" TEXT,
  ADD COLUMN "primaryAssetCdnUrl" TEXT,
  ADD COLUMN "primaryAssetWidth" INTEGER,
  ADD COLUMN "primaryAssetHeight" INTEGER;

-- Media asset references per post
CREATE TABLE "post_media_assets" (
  "id" TEXT NOT NULL,
  "contentId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "cdnUrl" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "usageContext" TEXT NOT NULL DEFAULT 'primary',
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_media_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "post_media_assets_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "post_media_assets_contentId_idx" ON "post_media_assets"("contentId");
CREATE UNIQUE INDEX "post_media_assets_contentId_usageContext_key" ON "post_media_assets"("contentId", "usageContext");
