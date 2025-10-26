-- Consolidate theme fields to a single enum column `themePreference`

-- Create new enum for consolidated theme preference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'ThemePreference'
  ) THEN
    CREATE TYPE "public"."ThemePreference" AS ENUM ('system', 'light', 'dark');
  END IF;
END $$;

-- Add new column with default 'system'
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "themePreference" "public"."ThemePreference" NOT NULL DEFAULT 'system';

-- Backfill from previous columns if they existed
DO $$
BEGIN
  -- If old columns exist, map them to the new preference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'themeAutoDetected'
  ) THEN
    -- Set system when auto-detected is true
    EXECUTE 'UPDATE "public"."users" SET "themePreference" = ''system'' WHERE "themeAutoDetected" = TRUE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'theme'
  ) THEN
    -- If not auto, copy explicit theme values
    EXECUTE 'UPDATE "public"."users" SET "themePreference" = CAST("theme" AS TEXT)::"public"."ThemePreference" WHERE COALESCE("themeAutoDetected", FALSE) = FALSE AND "theme" IS NOT NULL';
  END IF;
END $$;

-- Drop old columns if they exist
ALTER TABLE "public"."users"
  DROP COLUMN IF EXISTS "theme",
  DROP COLUMN IF EXISTS "themeAutoDetected";

-- Drop old enum type if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ThemeMode') THEN
    DROP TYPE "public"."ThemeMode";
  END IF;
END $$;

