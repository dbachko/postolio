-- Add performance indexes for frequently queried columns

-- Content table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_content_brand_status" 
ON "content"("brandId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_content_scheduled_at" 
ON "content"("scheduledAt") 
WHERE "scheduledAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_content_brand_status_scheduled" 
ON "content"("brandId", "status", "scheduledAt") 
WHERE "status" = 'scheduled' AND "scheduledAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_content_campaign" 
ON "content"("campaignId") 
WHERE "campaignId" IS NOT NULL;

-- Campaign table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaigns_brand_active" 
ON "campaigns"("brandId", "status") 
WHERE "status" = 'active';

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaigns_priority" 
ON "campaigns"("priority");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaigns_status" 
ON "campaigns"("status");

-- User table index for scheduled deletion
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_users_scheduled_deletion" 
ON "users"("deletedAt", "scheduledDeletion") 
WHERE "deletedAt" IS NOT NULL;

-- Brand table index for user lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_brands_user" 
ON "brands"("userId");

-- Campaign template indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaign_templates_created_by" 
ON "campaign_templates"("createdById");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaign_templates_brand" 
ON "campaign_templates"("brandId") 
WHERE "brandId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_campaign_templates_public" 
ON "campaign_templates"("isPublic") 
WHERE "isPublic" = true;