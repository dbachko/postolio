-- DropIndex
DROP INDEX IF EXISTS "campaigns_priority_idx";

-- Clean up legacy config keys (priority lived both as a column and sometimes inside config JSON)
UPDATE "campaigns" SET "config" = "config" - 'priority' WHERE "config" ? 'priority';

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "priority";
