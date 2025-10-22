-- Drop partial unique index for default campaign if exists
DO 4630
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'campaigns_brand_default_unique'
  ) THEN
    EXECUTE 'DROP INDEX "public"."campaigns_brand_default_unique"';
  END IF;
END 4630;

-- Drop isDefault column if exists
ALTER TABLE "campaigns"
  DROP COLUMN IF EXISTS "isDefault";
