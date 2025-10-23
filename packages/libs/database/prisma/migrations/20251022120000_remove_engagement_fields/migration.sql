-- Remove engagement-related fields from brands
-- Safe to run multiple times due to IF EXISTS guards

-- Drop index on engagementActive if it exists
DROP INDEX IF EXISTS "brands_engagementActive_idx";
DROP INDEX IF EXISTS "Brand_engagementActive_idx";

-- Drop columns on brands table
ALTER TABLE "public"."brands"
  DROP COLUMN IF EXISTS "engagementActive",
  DROP COLUMN IF EXISTS "engagementRules";

