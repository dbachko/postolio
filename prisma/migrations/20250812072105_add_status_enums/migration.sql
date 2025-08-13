-- Create enum types
CREATE TYPE "ContentStatus" AS ENUM ('pending', 'approved', 'rejected', 'scheduled', 'published', 'posted', 'skipped', 'failed');
CREATE TYPE "CampaignStatus" AS ENUM ('creating', 'preview', 'active', 'paused', 'completed', 'failed', 'processing');

-- Add new columns with enum types
ALTER TABLE "content" ADD COLUMN "status_new" "ContentStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "campaigns" ADD COLUMN "status_new" "CampaignStatus" NOT NULL DEFAULT 'creating';

-- Migrate existing data, handling any invalid values gracefully
UPDATE "content" SET "status_new" = 
  CASE 
    WHEN "status" = 'pending' THEN 'pending'::"ContentStatus"
    WHEN "status" = 'approved' THEN 'approved'::"ContentStatus"
    WHEN "status" = 'rejected' THEN 'rejected'::"ContentStatus" 
    WHEN "status" = 'scheduled' THEN 'scheduled'::"ContentStatus"
    WHEN "status" = 'published' THEN 'published'::"ContentStatus"
    WHEN "status" = 'posted' THEN 'posted'::"ContentStatus"
    WHEN "status" = 'skipped' THEN 'skipped'::"ContentStatus"
    WHEN "status" = 'failed' THEN 'failed'::"ContentStatus"
    ELSE 'pending'::"ContentStatus"  -- Default for any unexpected values
  END;

UPDATE "campaigns" SET "status_new" = 
  CASE 
    WHEN "status" = 'creating' THEN 'creating'::"CampaignStatus"
    WHEN "status" = 'preview' THEN 'preview'::"CampaignStatus"
    WHEN "status" = 'active' THEN 'active'::"CampaignStatus"
    WHEN "status" = 'paused' THEN 'paused'::"CampaignStatus"
    WHEN "status" = 'completed' THEN 'completed'::"CampaignStatus"
    WHEN "status" = 'failed' THEN 'failed'::"CampaignStatus"
    WHEN "status" = 'processing' THEN 'processing'::"CampaignStatus"
    ELSE 'creating'::"CampaignStatus"  -- Default for any unexpected values
  END;

-- Drop existing indexes that depend on the old status columns
DROP INDEX IF EXISTS "campaigns_status_idx";
DROP INDEX IF EXISTS "campaigns_brandId_status_idx";

-- Drop the old string columns
ALTER TABLE "content" DROP COLUMN "status";
ALTER TABLE "campaigns" DROP COLUMN "status";

-- Rename new columns to original names
ALTER TABLE "content" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "campaigns" RENAME COLUMN "status_new" TO "status";

-- Recreate indexes on the new enum columns
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX "campaigns_brandId_status_idx" ON "campaigns"("brandId", "status");