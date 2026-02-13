-- CreateEnum
CREATE TYPE "ContentSeriesKind" AS ENUM ('batch', 'rolling');

-- CreateEnum
CREATE TYPE "ContentSeriesStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'scheduled', 'published', 'failed', 'skipped', 'unavailable');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok');

-- CreateEnum
CREATE TYPE "MetricName" AS ENUM ('impressions', 'reach', 'likes', 'comments', 'saves', 'shares', 'video_views', 'engagement', 'profile_views', 'followers', 'link_clicks', 'website_clicks');

-- CreateEnum
CREATE TYPE "MetricPeriod" AS ENUM ('lifetime', 'day', 'hour');

-- CreateEnum
CREATE TYPE "DMTriggerType" AS ENUM ('comment_keyword', 'dm_keyword', 'comment_any', 'dm_any');

-- CreateEnum
CREATE TYPE "DMActionType" AS ENUM ('send_dm', 'reply_comment', 'send_dm_and_reply');

-- CreateEnum
CREATE TYPE "DMRuleStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "CommentWorkflowStatus" AS ENUM ('open', 'resolved', 'archived');

-- CreateEnum
CREATE TYPE "WeekStartPreference" AS ENUM ('monday', 'sunday');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('system', 'light', 'dark');

-- CreateEnum
CREATE TYPE "RecipeCategory" AS ENUM ('get_started', 'content', 'growth', 'social', 'other');

-- CreateEnum
CREATE TYPE "RecipeTemplateStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "SkillModeSupport" AS ENUM ('managed', 'byok', 'both');

-- CreateEnum
CREATE TYPE "SkillMode" AS ENUM ('managed', 'byok');

-- CreateEnum
CREATE TYPE "RecipeRunTrigger" AS ENUM ('manual', 'schedule', 'api', 'chat');

-- CreateEnum
CREATE TYPE "RecipeRunStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "RecipeRunStepType" AS ENUM ('llm', 'skill_call', 'transform', 'content_create', 'export');

-- CreateEnum
CREATE TYPE "RecipeRunStepStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "RecipeRunArtifactKind" AS ENUM ('markdown', 'text', 'json', 'asset');

-- CreateEnum
CREATE TYPE "RecipeCostProvider" AS ENUM ('openai', 'anthropic', 'replicate', 'internal', 'unknown');

-- CreateEnum
CREATE TYPE "AICreditLedgerEntryType" AS ENUM ('grant', 'debit', 'refund', 'adjustment');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "postingTimezone" TEXT,
    "countryCode" TEXT,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_groups" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "templateInitialized" BOOLEAN NOT NULL DEFAULT false,
    "templateCaption" TEXT,
    "templateContentType" TEXT,
    "templateShareToFeed" BOOLEAN,
    "templateThumbOffset" INTEGER,
    "templateFirstComment" TEXT,
    "templateAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_series" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "kind" "ContentSeriesKind" NOT NULL DEFAULT 'batch',
    "status" "ContentSeriesStatus" NOT NULL DEFAULT 'active',
    "generatorJson" JSONB,
    "rollingConfigJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_series_pkey" PRIMARY KEY ("id")
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
    "contentGroupId" TEXT,
    "contentSeriesId" TEXT,
    "recipeRunId" TEXT,
    "targetSocialAccountId" TEXT,
    "schedulingError" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'post',
    "shareToFeed" BOOLEAN,
    "thumbOffset" INTEGER,
    "firstComment" TEXT,
    "firstCommentStatus" TEXT,
    "firstCommentPostedAt" TIMESTAMP(3),
    "firstCommentError" TEXT,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media_assets" (
    "contentId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_media_assets_pkey" PRIMARY KEY ("contentId","displayOrder")
);

-- CreateTable
CREATE TABLE "image_generation_logs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "contentId" TEXT,
    "provider" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "cost" DECIMAL(10,4) NOT NULL,
    "generationTime" INTEGER NOT NULL,
    "size" TEXT NOT NULL,
    "quality" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "failedProvider" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalPageId" TEXT,
    "username" TEXT,
    "displayName" TEXT,
    "metadata" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_queues" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_queue_slots" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "localTime" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "laneKey" TEXT NOT NULL DEFAULT 'post',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_queue_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_queue_items" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "laneKey" TEXT NOT NULL DEFAULT 'post',
    "position" INTEGER NOT NULL,
    "notBefore" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_publications" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
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
CREATE TABLE "metric_samples" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "metric_name" "MetricName" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "period" "MetricPeriod" NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "as_of" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_metrics_latest" (
    "publication_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
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
CREATE TABLE "publication_comments" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "parent_external_comment_id" TEXT,
    "authorUsername" TEXT,
    "authorExternalUserId" TEXT,
    "text" TEXT,
    "like_count" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "status" "CommentWorkflowStatus" NOT NULL DEFAULT 'open',

    CONSTRAINT "publication_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_replies" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snippets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snippets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_metric_samples" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "metric_name" "MetricName" NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "period" "MetricPeriod" NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "as_of" TIMESTAMP(3) NOT NULL,
    "raw" JSONB,

    CONSTRAINT "account_metric_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_metrics_latest" (
    "social_account_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "profile_views" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_metrics_latest_pkey" PRIMARY KEY ("social_account_id")
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

-- CreateTable
CREATE TABLE "dm_automation_rules" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "DMTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "actionType" "DMActionType" NOT NULL,
    "messageTemplate" TEXT,
    "commentReplyTemplate" TEXT,
    "status" "DMRuleStatus" NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerUser" INTEGER,
    "cooldownMinutes" INTEGER,
    "activeHours" JSONB,
    "activeDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "dm_automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_conversations" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "ruleId" TEXT,
    "platform" "Platform" NOT NULL,
    "participantExternalUserId" TEXT NOT NULL,
    "participantUsername" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "contextData" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "dm_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "direction" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "externalCommentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dm_automation_events" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "conversationId" TEXT,
    "triggerType" "DMTriggerType" NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "triggerText" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "actionType" "DMActionType" NOT NULL,
    "messageSent" BOOLEAN NOT NULL DEFAULT false,
    "commentReplySent" BOOLEAN NOT NULL DEFAULT false,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "dm_automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_templates" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "RecipeCategory" NOT NULL DEFAULT 'other',
    "isCurated" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecipeTemplateStatus" NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_template_versions" (
    "id" TEXT NOT NULL,
    "recipeTemplateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configJson" JSONB NOT NULL,
    "changelog" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "modeSupported" "SkillModeSupport" NOT NULL DEFAULT 'managed',
    "scopesJson" JSONB NOT NULL DEFAULT '{}',
    "configSchemaJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_installations" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "skillDefinitionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "mode" "SkillMode" NOT NULL DEFAULT 'managed',
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "secretId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encrypted_secrets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "encrypted_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_runs" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "recipeTemplateId" TEXT NOT NULL,
    "recipeTemplateVersionId" TEXT NOT NULL,
    "contentSeriesId" TEXT,
    "trigger" "RecipeRunTrigger" NOT NULL,
    "status" "RecipeRunStatus" NOT NULL DEFAULT 'queued',
    "inputJson" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "internalError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_run_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "RecipeRunStepType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecipeRunStepStatus" NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "inputJsonRedacted" JSONB,
    "outputJsonRedacted" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_run_artifacts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "RecipeRunArtifactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "contentText" TEXT,
    "assetId" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_run_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_run_costs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" "RecipeCostProvider" NOT NULL,
    "mode" "SkillMode" NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_run_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_ai_credit_wallets" (
    "brandId" TEXT NOT NULL,
    "balanceCredits" INTEGER NOT NULL DEFAULT 0,
    "totalGrantedCredits" INTEGER NOT NULL DEFAULT 0,
    "totalDebitedCredits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_ai_credit_wallets_pkey" PRIMARY KEY ("brandId")
);

-- CreateTable
CREATE TABLE "ai_credit_ledger_entries" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "runId" TEXT,
    "type" "AICreditLedgerEntryType" NOT NULL,
    "deltaCredits" INTEGER NOT NULL,
    "amountUsd" DECIMAL(10,4),
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "provider" "RecipeCostProvider" NOT NULL DEFAULT 'unknown',
    "mode" "SkillMode" NOT NULL DEFAULT 'managed',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_ledger_entries_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "content_groups_brandId_idx" ON "content_groups"("brandId");

-- CreateIndex
CREATE INDEX "content_series_brandId_status_idx" ON "content_series"("brandId", "status");

-- CreateIndex
CREATE INDEX "content_series_brandId_kind_idx" ON "content_series"("brandId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "content_series_brandId_key_key" ON "content_series"("brandId", "key");

-- CreateIndex
CREATE INDEX "content_brandId_status_idx" ON "content"("brandId", "status");

-- CreateIndex
CREATE INDEX "content_scheduledAt_idx" ON "content"("scheduledAt");

-- CreateIndex
CREATE INDEX "content_brandId_status_scheduledAt_idx" ON "content"("brandId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "content_contentGroupId_idx" ON "content"("contentGroupId");

-- CreateIndex
CREATE INDEX "content_contentSeriesId_idx" ON "content"("contentSeriesId");

-- CreateIndex
CREATE INDEX "content_recipeRunId_idx" ON "content"("recipeRunId");

-- CreateIndex
CREATE INDEX "content_media_assets_contentId_idx" ON "content_media_assets"("contentId");

-- CreateIndex
CREATE INDEX "image_generation_logs_brandId_createdAt_idx" ON "image_generation_logs"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "image_generation_logs_provider_createdAt_idx" ON "image_generation_logs"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "social_accounts_platform_externalPageId_idx" ON "social_accounts"("platform", "externalPageId");

-- CreateIndex
CREATE INDEX "social_accounts_brandId_platform_idx" ON "social_accounts"("brandId", "platform");

-- CreateIndex
CREATE INDEX "social_accounts_brandId_sortOrder_idx" ON "social_accounts"("brandId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_platform_externalAccountId_key" ON "social_accounts"("platform", "externalAccountId");

-- CreateIndex
CREATE INDEX "publishing_queues_socialAccountId_idx" ON "publishing_queues"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_queues_socialAccountId_name_key" ON "publishing_queues"("socialAccountId", "name");

-- CreateIndex
CREATE INDEX "publishing_queue_slots_queueId_idx" ON "publishing_queue_slots"("queueId");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_queue_slots_socialAccountId_dayOfWeek_localTime_key" ON "publishing_queue_slots"("socialAccountId", "dayOfWeek", "localTime");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_queue_items_contentId_key" ON "publishing_queue_items"("contentId");

-- CreateIndex
CREATE INDEX "publishing_queue_items_queueId_idx" ON "publishing_queue_items"("queueId");

-- CreateIndex
CREATE INDEX "publishing_queue_items_queueId_laneKey_position_idx" ON "publishing_queue_items"("queueId", "laneKey", "position");

-- CreateIndex
CREATE INDEX "content_publications_platform_externalPostId_idx" ON "content_publications"("platform", "externalPostId");

-- CreateIndex
CREATE INDEX "content_publications_contentId_platform_idx" ON "content_publications"("contentId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "content_publications_socialAccountId_externalPostId_key" ON "content_publications"("socialAccountId", "externalPostId");

-- CreateIndex
CREATE INDEX "metric_samples_publicationId_metric_name_as_of_idx" ON "metric_samples"("publicationId", "metric_name", "as_of");

-- CreateIndex
CREATE INDEX "publication_comments_publicationId_idx" ON "publication_comments"("publicationId");

-- CreateIndex
CREATE INDEX "publication_comments_publicationId_status_idx" ON "publication_comments"("publicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "publication_comments_publicationId_external_comment_id_key" ON "publication_comments"("publicationId", "external_comment_id");

-- CreateIndex
CREATE INDEX "saved_replies_brandId_idx" ON "saved_replies"("brandId");

-- CreateIndex
CREATE INDEX "saved_replies_userId_idx" ON "saved_replies"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_replies_brandId_title_key" ON "saved_replies"("brandId", "title");

-- CreateIndex
CREATE INDEX "snippets_brandId_isArchived_idx" ON "snippets"("brandId", "isArchived");

-- CreateIndex
CREATE INDEX "snippets_brandId_tags_idx" ON "snippets"("brandId", "tags");

-- CreateIndex
CREATE INDEX "snippets_brandId_category_idx" ON "snippets"("brandId", "category");

-- CreateIndex
CREATE INDEX "snippets_userId_idx" ON "snippets"("userId");

-- CreateIndex
CREATE INDEX "account_metric_samples_social_account_id_metric_name_as_of_idx" ON "account_metric_samples"("social_account_id", "metric_name", "as_of");

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

-- CreateIndex
CREATE INDEX "dm_automation_rules_brandId_status_idx" ON "dm_automation_rules"("brandId", "status");

-- CreateIndex
CREATE INDEX "dm_automation_rules_triggerType_idx" ON "dm_automation_rules"("triggerType");

-- CreateIndex
CREATE INDEX "dm_conversations_brandId_state_idx" ON "dm_conversations"("brandId", "state");

-- CreateIndex
CREATE INDEX "dm_conversations_socialAccountId_state_idx" ON "dm_conversations"("socialAccountId", "state");

-- CreateIndex
CREATE INDEX "dm_conversations_lastMessageAt_idx" ON "dm_conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conv_brand_account_platform_participant_key" ON "dm_conversations"("brandId", "socialAccountId", "platform", "participantExternalUserId");

-- CreateIndex
CREATE INDEX "dm_messages_conversationId_createdAt_idx" ON "dm_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "dm_messages_status_idx" ON "dm_messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dm_messages_conversationId_externalMessageId_key" ON "dm_messages"("conversationId", "externalMessageId");

-- CreateIndex
CREATE INDEX "dm_automation_events_brandId_timestamp_idx" ON "dm_automation_events"("brandId", "timestamp");

-- CreateIndex
CREATE INDEX "dm_automation_events_ruleId_idx" ON "dm_automation_events"("ruleId");

-- CreateIndex
CREATE INDEX "dm_automation_events_rateLimited_idx" ON "dm_automation_events"("rateLimited");

-- CreateIndex
CREATE INDEX "recipe_templates_brandId_status_category_idx" ON "recipe_templates"("brandId", "status", "category");

-- CreateIndex
CREATE INDEX "recipe_templates_brandId_createdAt_idx" ON "recipe_templates"("brandId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_templates_brandId_slug_key" ON "recipe_templates"("brandId", "slug");

-- CreateIndex
CREATE INDEX "recipe_template_versions_recipeTemplateId_createdAt_idx" ON "recipe_template_versions"("recipeTemplateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_template_versions_recipeTemplateId_version_key" ON "recipe_template_versions"("recipeTemplateId", "version");

-- CreateIndex
CREATE INDEX "skill_installations_brandId_enabled_idx" ON "skill_installations"("brandId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "skill_installations_brandId_skillDefinitionId_key" ON "skill_installations"("brandId", "skillDefinitionId");

-- CreateIndex
CREATE INDEX "encrypted_secrets_brandId_kind_idx" ON "encrypted_secrets"("brandId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "encrypted_secrets_brandId_kind_name_key" ON "encrypted_secrets"("brandId", "kind", "name");

-- CreateIndex
CREATE INDEX "recipe_runs_brandId_createdAt_idx" ON "recipe_runs"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "recipe_runs_brandId_status_idx" ON "recipe_runs"("brandId", "status");

-- CreateIndex
CREATE INDEX "recipe_runs_contentSeriesId_idx" ON "recipe_runs"("contentSeriesId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_run_steps_runId_index_key" ON "recipe_run_steps"("runId", "index");

-- CreateIndex
CREATE INDEX "recipe_run_artifacts_runId_createdAt_idx" ON "recipe_run_artifacts"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "recipe_run_costs_runId_idx" ON "recipe_run_costs"("runId");

-- CreateIndex
CREATE INDEX "ai_credit_ledger_entries_brandId_createdAt_idx" ON "ai_credit_ledger_entries"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_credit_ledger_entries_runId_idx" ON "ai_credit_ledger_entries"("runId");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_groups" ADD CONSTRAINT "content_groups_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_series" ADD CONSTRAINT "content_series_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_contentGroupId_fkey" FOREIGN KEY ("contentGroupId") REFERENCES "content_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_contentSeriesId_fkey" FOREIGN KEY ("contentSeriesId") REFERENCES "content_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_recipeRunId_fkey" FOREIGN KEY ("recipeRunId") REFERENCES "recipe_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_targetSocialAccountId_fkey" FOREIGN KEY ("targetSocialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_assets" ADD CONSTRAINT "content_media_assets_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queues" ADD CONSTRAINT "publishing_queues_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue_slots" ADD CONSTRAINT "publishing_queue_slots_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "publishing_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue_items" ADD CONSTRAINT "publishing_queue_items_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "publishing_queues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_queue_items" ADD CONSTRAINT "publishing_queue_items_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_samples" ADD CONSTRAINT "metric_samples_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_metrics_latest" ADD CONSTRAINT "publication_metrics_latest_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_comments" ADD CONSTRAINT "publication_comments_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "content_publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metric_samples" ADD CONSTRAINT "account_metric_samples_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_metrics_latest" ADD CONSTRAINT "account_metrics_latest_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "dm_automation_rules" ADD CONSTRAINT "dm_automation_rules_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "dm_automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_events" ADD CONSTRAINT "dm_automation_events_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_events" ADD CONSTRAINT "dm_automation_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "dm_automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_templates" ADD CONSTRAINT "recipe_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_template_versions" ADD CONSTRAINT "recipe_template_versions_recipeTemplateId_fkey" FOREIGN KEY ("recipeTemplateId") REFERENCES "recipe_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_template_versions" ADD CONSTRAINT "recipe_template_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installations" ADD CONSTRAINT "skill_installations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installations" ADD CONSTRAINT "skill_installations_skillDefinitionId_fkey" FOREIGN KEY ("skillDefinitionId") REFERENCES "skill_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installations" ADD CONSTRAINT "skill_installations_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "encrypted_secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_installations" ADD CONSTRAINT "skill_installations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_secrets" ADD CONSTRAINT "encrypted_secrets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_secrets" ADD CONSTRAINT "encrypted_secrets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_recipeTemplateId_fkey" FOREIGN KEY ("recipeTemplateId") REFERENCES "recipe_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_recipeTemplateVersionId_fkey" FOREIGN KEY ("recipeTemplateVersionId") REFERENCES "recipe_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_contentSeriesId_fkey" FOREIGN KEY ("contentSeriesId") REFERENCES "content_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_run_steps" ADD CONSTRAINT "recipe_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "recipe_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_run_artifacts" ADD CONSTRAINT "recipe_run_artifacts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "recipe_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_run_costs" ADD CONSTRAINT "recipe_run_costs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "recipe_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_ai_credit_wallets" ADD CONSTRAINT "brand_ai_credit_wallets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_ledger_entries" ADD CONSTRAINT "ai_credit_ledger_entries_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_ledger_entries" ADD CONSTRAINT "ai_credit_ledger_entries_runId_fkey" FOREIGN KEY ("runId") REFERENCES "recipe_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
