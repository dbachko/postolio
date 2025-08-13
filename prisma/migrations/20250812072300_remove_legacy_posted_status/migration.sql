-- Convert any existing "posted" records to "published"
UPDATE "content" SET "status" = 'published' WHERE "status" = 'posted';

-- Remove the legacy "posted" enum value
-- Note: PostgreSQL doesn't support removing enum values directly, so we need to recreate the enum

-- Create new enum without 'posted'
CREATE TYPE "ContentStatus_new" AS ENUM ('pending', 'approved', 'rejected', 'scheduled', 'published', 'skipped', 'failed');

-- Remove the default temporarily
ALTER TABLE "content" ALTER COLUMN "status" DROP DEFAULT;

-- Update the column to use the new enum
ALTER TABLE "content" ALTER COLUMN "status" TYPE "ContentStatus_new" USING "status"::text::"ContentStatus_new";

-- Drop the old enum and rename the new one
DROP TYPE "ContentStatus";
ALTER TYPE "ContentStatus_new" RENAME TO "ContentStatus";

-- Restore the default value
ALTER TABLE "content" ALTER COLUMN "status" SET DEFAULT 'pending';