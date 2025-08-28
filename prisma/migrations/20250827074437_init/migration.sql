-- CreateEnum
CREATE TYPE "public"."ContentStatus" AS ENUM ('draft', 'scheduled', 'published', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('creating', 'preview', 'active', 'paused', 'completed', 'failed', 'processing');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "instagramId" TEXT,
    "instagramUsername" TEXT,
    "instagramToken" TEXT,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "scheduledDeletion" TIMESTAMP(3),
    "timezone" TEXT,
    "timezoneAutoDetected" BOOLEAN NOT NULL DEFAULT true,
    "googleid" TEXT,
    "facebookid" TEXT,
    "profilepicture" TEXT,
    "emailverified" BOOLEAN NOT NULL DEFAULT false,
    "twofactorenabled" BOOLEAN NOT NULL DEFAULT false,
    "twofactormethod" TEXT,
    "twofactorsecret" TEXT,
    "twofactorbackupcodes" JSONB,
    "twofactorphonenumber" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "styleProfile" JSONB,
    "preferences" JSONB,
    "userId" TEXT NOT NULL,
    "instagramAccessToken" TEXT,
    "instagramPageId" TEXT,
    "instagramAccountId" TEXT,
    "instagramProfileData" JSONB,
    "engagementActive" BOOLEAN NOT NULL DEFAULT false,
    "engagementRules" JSONB,
    "postingTimezone" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."content" (
    "id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[],
    "status" "public"."ContentStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "generationParams" JSONB,
    "brandId" TEXT NOT NULL,
    "campaignId" TEXT,
    "instagramPermalink" TEXT,
    "instagramPostId" TEXT,
    "analytics" JSONB,
    "schedulingError" TEXT,
    "imageUrl" TEXT,
    "cdnImageUrl" TEXT,
    "imageRegion" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),
    "s3ImageKey" TEXT,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'creating',
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "previewGenerated" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastModifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModifiedById" TEXT,
    "modificationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."campaign_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "templateConfig" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "brandId" TEXT,

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "userid" TEXT,
    "email" TEXT,
    "eventtype" TEXT NOT NULL,
    "ipaddress" TEXT,
    "useragent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errormessage" TEXT,
    "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleid_key" ON "public"."users"("googleid");

-- CreateIndex
CREATE UNIQUE INDEX "users_facebookid_key" ON "public"."users"("facebookid");

-- CreateIndex
CREATE INDEX "content_brandId_status_idx" ON "public"."content"("brandId", "status");

-- CreateIndex
CREATE INDEX "content_scheduledAt_idx" ON "public"."content"("scheduledAt");

-- CreateIndex
CREATE INDEX "content_brandId_status_scheduledAt_idx" ON "public"."content"("brandId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "content_campaignId_idx" ON "public"."content"("campaignId");

-- CreateIndex
CREATE INDEX "campaigns_priority_idx" ON "public"."campaigns"("priority");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "public"."campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_brandId_status_idx" ON "public"."campaigns"("brandId", "status");

-- CreateIndex
CREATE INDEX "campaign_templates_createdById_idx" ON "public"."campaign_templates"("createdById");

-- CreateIndex
CREATE INDEX "campaign_templates_brandId_idx" ON "public"."campaign_templates"("brandId");

-- CreateIndex
CREATE INDEX "campaign_templates_isPublic_idx" ON "public"."campaign_templates"("isPublic");

-- CreateIndex
CREATE INDEX "campaign_templates_createdAt_idx" ON "public"."campaign_templates"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userid_idx" ON "public"."audit_logs"("userid");

-- CreateIndex
CREATE INDEX "audit_logs_email_idx" ON "public"."audit_logs"("email");

-- CreateIndex
CREATE INDEX "audit_logs_eventtype_idx" ON "public"."audit_logs"("eventtype");

-- CreateIndex
CREATE INDEX "audit_logs_createdat_idx" ON "public"."audit_logs"("createdat");

-- AddForeignKey
ALTER TABLE "public"."brands" ADD CONSTRAINT "brands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content" ADD CONSTRAINT "content_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."content" ADD CONSTRAINT "content_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaigns" ADD CONSTRAINT "campaigns_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaigns" ADD CONSTRAINT "campaigns_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_templates" ADD CONSTRAINT "campaign_templates_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "public"."brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."campaign_templates" ADD CONSTRAINT "campaign_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
