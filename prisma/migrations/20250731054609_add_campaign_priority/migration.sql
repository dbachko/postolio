-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX "campaigns_priority_idx" ON "campaigns"("priority");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_brandId_status_idx" ON "campaigns"("brandId", "status");
