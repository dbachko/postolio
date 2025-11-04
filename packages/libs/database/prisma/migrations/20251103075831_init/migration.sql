-- CreateEnum
CREATE TYPE "CampaignTypeEnum" AS ENUM ('promotional', 'educational', 'seasonal', 'thought_leadership', 'custom');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'scheduled', 'published', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('creating', 'preview', 'active', 'paused', 'completed', 'failed', 'processing');

-- CreateEnum
CREATE TYPE "WeekStartPreference" AS ENUM ('monday', 'sunday');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('system', 'light', 'dark');

-- CreateTable
CREATE TABLE "users" (
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
    "themePreference" "ThemePreference" NOT NULL DEFAULT 'system',
    "weekStartPreference" "WeekStartPreference" NOT NULL DEFAULT 'monday',
    "uiPreferences" JSONB,
    "googleid" TEXT,
    "facebookid" TEXT,
    "profilepicture" TEXT,
    "emailverified" BOOLEAN NOT NULL DEFAULT false,
    "twofactorenabled" BOOLEAN NOT NULL DEFAULT false,
    "twofactormethod" TEXT,
    "twofactorsecret" TEXT,
    "twofactorbackupcodes" JSONB,
    "twofactorphonenumber" TEXT,
    "failedloginattempts" INTEGER NOT NULL DEFAULT 0,
    "accountlockeduntil" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "styleProfile" JSONB,
    "preferences" JSONB,
    "userId" TEXT NOT NULL,
    "instagramPageId" TEXT,
    "instagramAccountId" TEXT,
    "instagramProfileData" JSONB,
    "postingTimezone" TEXT,
    "countryCode" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content" (
    "id" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "hashtags" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
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
    "s3ImageKey" TEXT,
    "imageRegion" TEXT,
    "retentionExpiresAt" TIMESTAMP(3),

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'creating',
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "previewGenerated" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastModifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastModifiedById" TEXT,
    "modificationCount" INTEGER NOT NULL DEFAULT 0,
    "campaignType" "CampaignTypeEnum" NOT NULL DEFAULT 'custom',
    "contentPillars" JSONB,
    "urgencyTactics" JSONB,
    "seasonalContext" JSONB,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_fingerprint" TEXT,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "location" JSONB,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "trusted_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
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

-- CreateTable
CREATE TABLE "brand_style_profile_projection" (
    "brand_id" TEXT NOT NULL,
    "profile_version" INTEGER NOT NULL,
    "prompt_set_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "has_recent_drift" BOOLEAN NOT NULL DEFAULT false,
    "last_drift_at" TIMESTAMP(3),
    "archetype" TEXT,
    "primaryTones" TEXT[],
    "primaryPalette" TEXT[],
    "topics_top" JSONB,
    "summary_projection" JSONB,
    "checksum" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_style_profile_projection_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkUrl" TEXT,
    "actorId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "metadata" JSONB,
    "dedupeKey" TEXT,
    "groupKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brandId" TEXT,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT,
    "digestTime" TEXT,
    "dndStart" TEXT,
    "dndEnd" TEXT,
    "timezone" TEXT,
    "allowMentionOverride" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_state" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notification_state_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleid_key" ON "users"("googleid");

-- CreateIndex
CREATE UNIQUE INDEX "users_facebookid_key" ON "users"("facebookid");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_accountlockeduntil_idx" ON "users"("accountlockeduntil");

-- CreateIndex
CREATE INDEX "users_failedloginattempts_idx" ON "users"("failedloginattempts");

-- CreateIndex
CREATE INDEX "users_emailverified_idx" ON "users"("emailverified");

-- CreateIndex
CREATE INDEX "brands_userId_idx" ON "brands"("userId");

-- CreateIndex
CREATE INDEX "brands_createdAt_idx" ON "brands"("createdAt");

-- CreateIndex
CREATE INDEX "content_brandId_status_idx" ON "content"("brandId", "status");

-- CreateIndex
CREATE INDEX "content_scheduledAt_idx" ON "content"("scheduledAt");

-- CreateIndex
CREATE INDEX "content_brandId_status_scheduledAt_idx" ON "content"("brandId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "content_campaignId_idx" ON "content"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "content_brandId_instagramPostId_key" ON "content"("brandId", "instagramPostId");

-- CreateIndex
CREATE INDEX "campaigns_priority_idx" ON "campaigns"("priority");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_campaignType_idx" ON "campaigns"("campaignType");

-- CreateIndex
CREATE INDEX "campaigns_brandId_status_idx" ON "campaigns"("brandId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_last_activity_at_idx" ON "sessions"("last_activity_at");

-- CreateIndex
CREATE INDEX "sessions_device_fingerprint_idx" ON "sessions"("device_fingerprint");

-- CreateIndex
CREATE INDEX "audit_logs_userid_idx" ON "audit_logs"("userid");

-- CreateIndex
CREATE INDEX "audit_logs_email_idx" ON "audit_logs"("email");

-- CreateIndex
CREATE INDEX "audit_logs_eventtype_idx" ON "audit_logs"("eventtype");

-- CreateIndex
CREATE INDEX "audit_logs_createdat_idx" ON "audit_logs"("createdat");

-- CreateIndex
CREATE INDEX "brand_style_profile_projection_profile_version_idx" ON "brand_style_profile_projection"("profile_version");

-- CreateIndex
CREATE INDEX "brand_style_profile_projection_archetype_idx" ON "brand_style_profile_projection"("archetype");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_brandId_idx" ON "notifications"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_brandId_category_type_chann_key" ON "notification_preferences"("userId", "brandId", "category", "type", "channel");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE INDEX "notification_deliveries_channel_status_idx" ON "notification_deliveries"("channel", "status");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_lastModifiedById_fkey" FOREIGN KEY ("lastModifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_state" ADD CONSTRAINT "user_notification_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
