-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "instagramPageId" TEXT,
ADD COLUMN     "instagramProfileData" JSONB;

-- AlterTable
ALTER TABLE "content" ADD COLUMN     "instagramPermalink" TEXT,
ADD COLUMN     "instagramPostId" TEXT;
