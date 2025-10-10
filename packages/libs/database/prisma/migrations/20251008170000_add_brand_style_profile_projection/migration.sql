-- Create table for brand style profile projection
CREATE TABLE IF NOT EXISTS "brand_style_profile_projection" (
  "brand_id" TEXT PRIMARY KEY,
  "profile_version" INTEGER NOT NULL,
  "prompt_set_version" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "has_recent_drift" BOOLEAN NOT NULL DEFAULT FALSE,
  "last_drift_at" TIMESTAMPTZ,
  "archetype" TEXT,
  "primary_tones" TEXT[] NOT NULL DEFAULT '{}',
  "primary_palette" TEXT[] NOT NULL DEFAULT '{}',
  "topics_top" JSONB,
  "summary_projection" JSONB,
  "checksum" TEXT,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_brand_style_profile_projection_profile_version"
  ON "brand_style_profile_projection" ("profile_version");

CREATE INDEX IF NOT EXISTS "idx_brand_style_profile_projection_archetype"
  ON "brand_style_profile_projection" ("archetype");

