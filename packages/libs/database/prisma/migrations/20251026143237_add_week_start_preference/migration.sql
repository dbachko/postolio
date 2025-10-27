-- Add week start preference enum and column to users

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t WHERE t.typname = 'WeekStartPreference'
  ) THEN
    CREATE TYPE "public"."WeekStartPreference" AS ENUM ('monday', 'sunday');
  END IF;
END $$;

ALTER TABLE "public"."users"
  ADD COLUMN IF NOT EXISTS "weekStartPreference" "public"."WeekStartPreference" NOT NULL DEFAULT 'monday';
