-- AlterEnum
-- This migration simplifies ContentStatus from 7 values to 5 values

-- Create new enum type
CREATE TYPE "ContentStatus_new" AS ENUM ('draft', 'scheduled', 'published', 'failed', 'skipped');

-- Change column to use new enum (no data to migrate in alpha)
ALTER TABLE "content" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "content" ALTER COLUMN "status" TYPE "ContentStatus_new" USING 'draft'::"ContentStatus_new";
ALTER TABLE "content" ALTER COLUMN "status" SET DEFAULT 'draft';

-- Drop old enum type and rename new one
DROP TYPE "ContentStatus";
ALTER TYPE "ContentStatus_new" RENAME TO "ContentStatus";