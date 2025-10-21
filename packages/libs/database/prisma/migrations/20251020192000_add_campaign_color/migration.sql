-- Add optional color column to campaigns for calendar visualization
-- Column type: TEXT (hex color code like #FF5733)

ALTER TABLE "public"."campaigns"
  ADD COLUMN IF NOT EXISTS "color" TEXT;

