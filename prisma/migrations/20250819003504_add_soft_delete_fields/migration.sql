-- AlterTable
ALTER TABLE "public"."campaigns" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "deletionReason" TEXT;

-- AlterTable
ALTER TABLE "public"."content" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT,
ADD COLUMN     "deletionReason" TEXT;

-- CreateIndex
CREATE INDEX "campaigns_brandId_deletedAt_idx" ON "public"."campaigns"("brandId", "deletedAt");

-- CreateIndex
CREATE INDEX "campaigns_deletedAt_idx" ON "public"."campaigns"("deletedAt");

-- CreateIndex
CREATE INDEX "content_brandId_deletedAt_idx" ON "public"."content"("brandId", "deletedAt");

-- CreateIndex
CREATE INDEX "content_campaignId_deletedAt_idx" ON "public"."content"("campaignId", "deletedAt");

-- CreateIndex
CREATE INDEX "content_deletedAt_idx" ON "public"."content"("deletedAt");
