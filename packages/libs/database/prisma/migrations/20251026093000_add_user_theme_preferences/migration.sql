-- Add theme preference enum and columns to users

-- CreateEnum for theme
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'ThemeMode'
  ) THEN
    CREATE TYPE "public"."ThemeMode" AS ENUM ('light', 'dark');
  END IF;
END $$;

-- Add columns to users table (idempotent guards where possible)
ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "theme" "public"."ThemeMode",
  ADD COLUMN IF NOT EXISTS "themeAutoDetected" BOOLEAN NOT NULL DEFAULT TRUE;

