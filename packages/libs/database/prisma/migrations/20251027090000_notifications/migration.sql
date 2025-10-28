-- Notifications feature migration

-- Create notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT PRIMARY KEY,
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
  "dedupeKey" TEXT UNIQUE,
  "groupKey" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "seenAt" TIMESTAMPTZ,
  "readAt" TIMESTAMPTZ,
  "archivedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ
);

-- Foreign keys
ALTER TABLE "notifications"
  ADD CONSTRAINT IF NOT EXISTS "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT IF NOT EXISTS "notifications_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_userId_readAt_idx" ON "notifications" ("userId", "readAt");
CREATE INDEX IF NOT EXISTS "notifications_brandId_idx" ON "notifications" ("brandId");

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "brandId" TEXT,
  "category" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "frequency" TEXT,
  "digestTime" TEXT,
  "dndStart" TEXT,
  "dndEnd" TEXT,
  "timezone" TEXT,
  "allowMentionOverride" BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT IF NOT EXISTS "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT IF NOT EXISTS "notification_preferences_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unique composite index (note: brandId may be NULL; Postgres treats NULLs as distinct)
CREATE UNIQUE INDEX IF NOT EXISTS "notification_prefs_user_brand_category_type_channel_idx"
ON "notification_preferences" ("userId", "brandId", "category", "type", "channel");

-- Create notification_deliveries table
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" TEXT PRIMARY KEY,
  "notificationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "sentAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT IF NOT EXISTS "notification_deliveries_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "notification_deliveries_notificationId_idx" ON "notification_deliveries" ("notificationId");
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_status_idx" ON "notification_deliveries" ("channel", "status");

-- Create user_notification_state table
CREATE TABLE IF NOT EXISTS "user_notification_state" (
  "userId" TEXT PRIMARY KEY,
  "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "user_notification_state"
  ADD CONSTRAINT IF NOT EXISTS "user_notification_state_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

