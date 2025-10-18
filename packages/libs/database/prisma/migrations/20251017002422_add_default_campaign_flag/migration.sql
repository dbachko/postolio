-- Add isDefault flag to campaigns
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure at most one default campaign per brand (partial unique index)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'campaigns_brand_default_unique'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX campaigns_brand_default_unique ON "public"."campaigns" ("brandId") WHERE ("isDefault" = TRUE)';
  END IF;
END $$;
