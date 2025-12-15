-- AlterTable
ALTER TABLE "content_media_assets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "image_generation_logs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT,
    "contentId" TEXT,
    "provider" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "generationTime" INTEGER NOT NULL,
    "size" TEXT NOT NULL,
    "quality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "failedProvider" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "image_generation_logs_brandId_createdAt_idx" ON "image_generation_logs"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "image_generation_logs_campaignId_idx" ON "image_generation_logs"("campaignId");

-- CreateIndex
CREATE INDEX "image_generation_logs_provider_createdAt_idx" ON "image_generation_logs"("provider", "createdAt");
