-- AlterTable
ALTER TABLE "public"."content" ADD COLUMN     "cdnImageUrl" TEXT,
ADD COLUMN     "imageRegion" TEXT,
ADD COLUMN     "retentionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "s3ImageKey" TEXT;
