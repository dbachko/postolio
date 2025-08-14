-- Add timezone columns to users and brands
ALTER TABLE "public"."users" 
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "timezoneAutoDetected" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "public"."brands" 
  ADD COLUMN "postingTimezone" TEXT;

-- Convert timestamp columns to timestamptz for proper timezone handling
-- This is safe because PostgreSQL will preserve the existing time values
-- and treat them as being in the database's timezone (usually UTC)

-- Content table: Convert scheduling and posting timestamps
ALTER TABLE "public"."content" 
  ALTER COLUMN "scheduledAt" TYPE timestamptz,
  ALTER COLUMN "postedAt" TYPE timestamptz,
  ALTER COLUMN "createdAt" TYPE timestamptz,
  ALTER COLUMN "updatedAt" TYPE timestamptz,
  ALTER COLUMN "retentionExpiresAt" TYPE timestamptz;

-- Campaigns table: Convert all timestamps
ALTER TABLE "public"."campaigns"
  ALTER COLUMN "createdAt" TYPE timestamptz,
  ALTER COLUMN "updatedAt" TYPE timestamptz,
  ALTER COLUMN "startedAt" TYPE timestamptz,
  ALTER COLUMN "completedAt" TYPE timestamptz;

-- Brands table: Convert timestamps
ALTER TABLE "public"."brands"
  ALTER COLUMN "createdAt" TYPE timestamptz,
  ALTER COLUMN "updatedAt" TYPE timestamptz;

-- Users table: Convert timestamps
ALTER TABLE "public"."users"
  ALTER COLUMN "createdAt" TYPE timestamptz,
  ALTER COLUMN "updatedAt" TYPE timestamptz;

-- Campaign templates table: Convert timestamps
ALTER TABLE "public"."campaign_templates"
  ALTER COLUMN "createdAt" TYPE timestamptz,
  ALTER COLUMN "updatedAt" TYPE timestamptz;

-- Add comment to explain timezone handling strategy
COMMENT ON COLUMN "public"."users"."timezone" IS 'User preferred timezone for display (null = auto-detect from browser)';
COMMENT ON COLUMN "public"."users"."timezoneAutoDetected" IS 'Whether to use browser-detected timezone vs user preference';
COMMENT ON COLUMN "public"."brands"."postingTimezone" IS 'Brand-specific posting timezone (null = use user timezone)';
