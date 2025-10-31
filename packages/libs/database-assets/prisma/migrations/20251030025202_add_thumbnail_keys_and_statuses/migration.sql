-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ProcessingStatus" ADD VALUE 'thumbnails_complete';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE 'ai_analyzed';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE 'thumbnail_failed';
ALTER TYPE "public"."ProcessingStatus" ADD VALUE 'ai_analysis_failed';

-- AlterTable
ALTER TABLE "public"."assets" ADD COLUMN     "thumbnailLargeKey" TEXT,
ADD COLUMN     "thumbnailSmallKey" TEXT;
