-- Add shareToFeed and thumbOffset columns expected by the Prisma schema
ALTER TABLE "content"
  ADD COLUMN IF NOT EXISTS "shareToFeed" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "thumbOffset" INTEGER;

