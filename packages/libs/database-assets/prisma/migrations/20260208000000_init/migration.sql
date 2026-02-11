-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('pending', 'processing', 'thumbnails_complete', 'ai_analyzed', 'completed', 'thumbnail_failed', 'ai_analysis_failed', 'failed');

-- CreateEnum
CREATE TYPE "FolderType" AS ENUM ('general', 'brand_assets');

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "folderId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileType" "AssetType" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "aspectRatio" TEXT,
    "aspectRatioDecimal" DOUBLE PRECISION,
    "orientationType" TEXT,
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
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_folders" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "color" TEXT,
    "folderType" "FolderType" NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_s3Key_key" ON "assets"("s3Key");

-- CreateIndex
CREATE INDEX "assets_brandId_processingStatus_idx" ON "assets"("brandId", "processingStatus");

-- CreateIndex
CREATE INDEX "assets_brandId_fileType_idx" ON "assets"("brandId", "fileType");

-- CreateIndex
CREATE INDEX "assets_brandId_createdAt_idx" ON "assets"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "assets_tags_idx" ON "assets"("tags");

-- CreateIndex
CREATE INDEX "assets_aspectRatio_idx" ON "assets"("aspectRatio");

-- CreateIndex
CREATE INDEX "assets_orientationType_idx" ON "assets"("orientationType");

-- CreateIndex
CREATE INDEX "assets_brandId_aspectRatio_idx" ON "assets"("brandId", "aspectRatio");

-- CreateIndex
CREATE INDEX "assets_brandId_fileType_aspectRatio_idx" ON "assets"("brandId", "fileType", "aspectRatio");

-- CreateIndex
CREATE INDEX "asset_folders_brandId_idx" ON "asset_folders"("brandId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_folders" ADD CONSTRAINT "asset_folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "asset_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

