-- Add uiPreferences JSONB column to users table for storing UI prefs
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "uiPreferences" JSONB;

