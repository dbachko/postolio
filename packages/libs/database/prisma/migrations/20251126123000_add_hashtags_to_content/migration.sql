-- Reintroduce hashtags column on content as a derived field
ALTER TABLE "content" ADD COLUMN IF NOT EXISTS "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];

