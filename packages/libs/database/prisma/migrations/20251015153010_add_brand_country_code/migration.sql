-- Add optional ISO 3166-1 alpha-2 country code to brands
-- This aligns the database with schema.prisma (Brand.countryCode String?)

ALTER TABLE "public"."brands"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

