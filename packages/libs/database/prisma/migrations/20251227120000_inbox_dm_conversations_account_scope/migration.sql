-- Inbox v2 foundations: account-scoped DM conversations + faster comment status queries

-- DropTable (safe: no customers, destructive migration acceptable)
DROP TABLE "dm_messages";
DROP TABLE "dm_conversations";

-- RecreateTable: dm_conversations (now scoped to socialAccountId)
CREATE TABLE "dm_conversations" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "ruleId" TEXT,
    "instagramUserId" TEXT NOT NULL,
    "instagramUsername" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "contextData" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "dm_conversations_pkey" PRIMARY KEY ("id")
);

-- RecreateTable: dm_messages (unchanged columns)
CREATE TABLE "dm_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
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

-- Indexes: dm_conversations
CREATE INDEX "dm_conversations_brandId_state_idx" ON "dm_conversations"("brandId", "state");
CREATE INDEX "dm_conversations_socialAccountId_state_idx" ON "dm_conversations"("socialAccountId", "state");
CREATE INDEX "dm_conversations_lastMessageAt_idx" ON "dm_conversations"("lastMessageAt");
CREATE UNIQUE INDEX "dm_conversations_brandId_socialAccountId_instagramUserId_key" ON "dm_conversations"("brandId", "socialAccountId", "instagramUserId");

-- Indexes: dm_messages
CREATE INDEX "dm_messages_conversationId_createdAt_idx" ON "dm_messages"("conversationId", "createdAt");
CREATE INDEX "dm_messages_status_idx" ON "dm_messages"("status");

-- Indexes: publication_comments
CREATE INDEX "publication_comments_publicationId_status_idx" ON "publication_comments"("publicationId", "status");

-- Foreign keys
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "dm_automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

