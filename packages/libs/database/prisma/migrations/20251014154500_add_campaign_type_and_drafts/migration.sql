-- Add CampaignTypeEnum and campaignType column; create campaign_drafts table

-- CreateEnum for campaign types
CREATE TYPE "public"."CampaignTypeEnum" AS ENUM (
  'promotional',
  'educational',
  'seasonal',
  'thought_leadership',
  'custom'
);

-- AlterTable: add campaignType with default 'custom'
ALTER TABLE "public"."campaigns"
  ADD COLUMN "campaignType" "public"."CampaignTypeEnum" NOT NULL DEFAULT 'custom';

-- CreateIndex on campaignType
CREATE INDEX "campaigns_campaignType_idx" ON "public"."campaigns"("campaignType");

-- CreateTable: campaign_drafts
CREATE TABLE "public"."campaign_drafts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "wizardState" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "campaign_drafts_pkey" PRIMARY KEY ("id")
);

-- Indexes for campaign_drafts
CREATE UNIQUE INDEX "campaign_drafts_userId_brandId_key" ON "public"."campaign_drafts"("userId", "brandId");
CREATE INDEX "campaign_drafts_userId_idx" ON "public"."campaign_drafts"("userId");
CREATE INDEX "campaign_drafts_brandId_idx" ON "public"."campaign_drafts"("brandId");

-- Foreign keys for campaign_drafts
ALTER TABLE "public"."campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."campaign_drafts"
  ADD CONSTRAINT "campaign_drafts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

