-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AssetType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "public"."ProcessingStatus" AS ENUM ('pending', 'processing', 'thumbnails_complete', 'ai_analyzed', 'completed', 'thumbnail_failed', 'ai_analysis_failed', 'failed');

-- CreateEnum
CREATE TYPE "public"."FolderType" AS ENUM ('general', 'campaign_pool', 'brand_assets');

-- CreateTable
CREATE TABLE "public"."assets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" "public"."AssetType" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "s3Key" TEXT NOT NULL,
    "s3Bucket" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "thumbnailSmallKey" TEXT,
    "thumbnailLargeKey" TEXT,
    "title" TEXT,
    "altText" TEXT,
    "description" TEXT,
    "tags" TEXT[],
    "aiDescription" TEXT,
    "aiTags" TEXT[],
    "aiPrimaryColors" TEXT[],
    "aiMood" TEXT,
    "aiSubjects" TEXT[],
    "aiDescriptionEmbedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "analyzedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "processingStatus" "public"."ProcessingStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asset_folders" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "color" TEXT,
    "folderType" "public"."FolderType" NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_assets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "selectionScore" DOUBLE PRECISION,
    "manuallySelected" BOOLEAN NOT NULL DEFAULT false,
    "aiDescription" TEXT,
    "aiTags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_s3Key_key" ON "public"."assets"("s3Key");

-- CreateIndex
CREATE INDEX "assets_brandId_processingStatus_idx" ON "public"."assets"("brandId", "processingStatus");

-- CreateIndex
CREATE INDEX "assets_brandId_fileType_idx" ON "public"."assets"("brandId", "fileType");

-- CreateIndex
CREATE INDEX "assets_brandId_createdAt_idx" ON "public"."assets"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "assets_tags_idx" ON "public"."assets"("tags");

-- CreateIndex
CREATE INDEX "asset_folders_brandId_idx" ON "public"."asset_folders"("brandId");

-- CreateIndex
CREATE INDEX "campaign_assets_campaignId_idx" ON "public"."campaign_assets"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_assets_campaignId_assetId_key" ON "public"."campaign_assets"("campaignId", "assetId");

-- AddForeignKey
ALTER TABLE "public"."assets" ADD CONSTRAINT "assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "public"."asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."asset_folders" ADD CONSTRAINT "asset_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_assets" ADD CONSTRAINT "campaign_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

