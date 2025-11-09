/*
  Warnings:

  - You are about to drop the column `recommendedGoals` on the `brands` table. All the data in the column will be lost.
  - You are about to drop the column `recommendedGoalsGeneratedAt` on the `brands` table. All the data in the column will be lost.
  - You are about to drop the column `analytics` on the `content` table. All the data in the column will be lost.
  - You are about to drop the column `instagramPermalink` on the `content` table. All the data in the column will be lost.
  - You are about to drop the column `instagramPostId` on the `content` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."Platform" AS ENUM ('instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok');

-- CreateEnum
CREATE TYPE "public"."MetricName" AS ENUM ('impressions', 'reach', 'likes', 'comments', 'saves', 'shares', 'video_views', 'engagement', 'profile_views', 'followers', 'link_clicks', 'website_clicks');

-- CreateEnum
CREATE TYPE "public"."MetricPeriod" AS ENUM ('lifetime', 'day', 'hour');

-- DropIndex
DROP INDEX "public"."content_brandId_instagramPostId_key";

-- AlterTable
ALTER TABLE "public"."brands" DROP COLUMN "recommendedGoals",
DROP COLUMN "recommendedGoalsGeneratedAt";

-- AlterTable
ALTER TABLE "public"."content" DROP COLUMN "analytics",
DROP COLUMN "instagramPermalink",
DROP COLUMN "instagramPostId";

-- AlterTable
ALTER TABLE "public"."post_media_assets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."social_accounts" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalPageId" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content_publications" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "externalPostId" TEXT NOT NULL,
    "externalThreadRootId" TEXT,
    "externalAccountId" TEXT,
    "externalPageId" TEXT,
    "permalink" TEXT,
    "publishedAt" TIMESTAMP(3),
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."metric_samples" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "metric_name" "public"."MetricName" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "period" "public"."MetricPeriod" NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "as_of" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."publication_metrics_latest" (
    "publication_id" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "video_views" INTEGER NOT NULL DEFAULT 0,
    "engagement" INTEGER NOT NULL DEFAULT 0,
    "engagementRate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_metrics_latest_pkey" PRIMARY KEY ("publication_id")
);

-- CreateTable
CREATE TABLE "public"."publication_comments" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "parent_external_comment_id" TEXT,
    "authorUsername" TEXT,
    "authorExternalUserId" TEXT,
    "text" TEXT,
    "like_count" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "publication_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account_metric_samples" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "metric_name" "public"."MetricName" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "period" "public"."MetricPeriod" NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "as_of" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "account_metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account_metrics_latest" (
    "social_account_id" TEXT NOT NULL,
    "platform" "public"."Platform" NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "profile_views" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_metrics_latest_pkey" PRIMARY KEY ("social_account_id")
);

-- CreateIndex
CREATE INDEX "social_accounts_brandId_platform_idx" ON "public"."social_accounts"("brandId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_platform_externalAccountId_key" ON "public"."social_accounts"("platform", "externalAccountId");

-- CreateIndex
CREATE INDEX "content_publications_contentId_platform_idx" ON "public"."content_publications"("contentId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "content_publications_socialAccountId_externalPostId_key" ON "public"."content_publications"("socialAccountId", "externalPostId");

-- CreateIndex
CREATE INDEX "metric_samples_publicationId_metric_name_as_of_idx" ON "public"."metric_samples"("publicationId", "metric_name", "as_of");

-- CreateIndex
CREATE INDEX "publication_comments_publicationId_idx" ON "public"."publication_comments"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "publication_comments_publicationId_external_comment_id_key" ON "public"."publication_comments"("publicationId", "external_comment_id");

-- CreateIndex
CREATE INDEX "account_metric_samples_social_account_id_metric_name_as_of_idx" ON "public"."account_metric_samples"("social_account_id", "metric_name", "as_of");

-- AddForeignKey
ALTER TABLE "public"."social_accounts" ADD CONSTRAINT "social_accounts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_publications" ADD CONSTRAINT "content_publications_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content_publications" ADD CONSTRAINT "content_publications_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "public"."social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."metric_samples" ADD CONSTRAINT "metric_samples_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "public"."content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."publication_metrics_latest" ADD CONSTRAINT "publication_metrics_latest_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."publication_comments" ADD CONSTRAINT "publication_comments_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "public"."content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."account_metric_samples" ADD CONSTRAINT "account_metric_samples_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."account_metrics_latest" ADD CONSTRAINT "account_metrics_latest_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
