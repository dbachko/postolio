-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "aspectRatioDecimal" DOUBLE PRECISION,
ADD COLUMN     "orientationType" TEXT;

-- CreateIndex
CREATE INDEX "assets_aspectRatio_idx" ON "assets"("aspectRatio");

-- CreateIndex
CREATE INDEX "assets_orientationType_idx" ON "assets"("orientationType");

-- CreateIndex
CREATE INDEX "assets_brandId_aspectRatio_idx" ON "assets"("brandId", "aspectRatio");

-- CreateIndex
CREATE INDEX "assets_brandId_fileType_aspectRatio_idx" ON "assets"("brandId", "fileType", "aspectRatio");
