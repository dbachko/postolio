-- Add first comment metadata columns expected by the Prisma schema
ALTER TABLE "content"
  ADD COLUMN IF NOT EXISTS "firstComment" TEXT,
  ADD COLUMN IF NOT EXISTS "firstCommentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "firstCommentPostedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstCommentError" TEXT;

