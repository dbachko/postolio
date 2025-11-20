-- Add media metadata columns expected by the Prisma schema
ALTER TABLE "content"
  ADD COLUMN IF NOT EXISTS "mediaType" TEXT NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS "contentType" TEXT NOT NULL DEFAULT 'post',
  ADD COLUMN IF NOT EXISTS "videoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "videoDuration" INTEGER,
  ADD COLUMN IF NOT EXISTS "videoThumbnail" TEXT,
  ADD COLUMN IF NOT EXISTS "aspectRatio" TEXT;
