-- CreateEnum
CREATE TYPE "DMTriggerType" AS ENUM ('comment_keyword', 'dm_keyword', 'comment_any', 'dm_any');

-- CreateEnum
CREATE TYPE "DMActionType" AS ENUM ('send_dm', 'reply_comment', 'send_dm_and_reply');

-- CreateEnum
CREATE TYPE "DMRuleStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "CommentWorkflowStatus" AS ENUM ('open', 'resolved', 'archived');

-- AlterTable
ALTER TABLE "content" ALTER COLUMN "hashtags" DROP DEFAULT;

-- AlterTable
ALTER TABLE "publication_comments" ADD COLUMN     "status" "CommentWorkflowStatus" NOT NULL DEFAULT 'open';

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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "saved_replies_brandId_idx" ON "saved_replies"("brandId");

-- CreateIndex
CREATE INDEX "saved_replies_userId_idx" ON "saved_replies"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_replies_brandId_title_key" ON "saved_replies"("brandId", "title");

-- CreateIndex
CREATE INDEX "dm_automation_rules_brandId_status_idx" ON "dm_automation_rules"("brandId", "status");

-- CreateIndex
CREATE INDEX "dm_automation_rules_triggerType_idx" ON "dm_automation_rules"("triggerType");

-- CreateIndex
CREATE INDEX "dm_conversations_brandId_state_idx" ON "dm_conversations"("brandId", "state");

-- CreateIndex
CREATE INDEX "dm_conversations_lastMessageAt_idx" ON "dm_conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "dm_conversations_brandId_instagramUserId_key" ON "dm_conversations"("brandId", "instagramUserId");

-- CreateIndex
CREATE INDEX "dm_messages_conversationId_createdAt_idx" ON "dm_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "dm_messages_status_idx" ON "dm_messages"("status");

-- CreateIndex
CREATE INDEX "dm_automation_events_brandId_timestamp_idx" ON "dm_automation_events"("brandId", "timestamp");

-- CreateIndex
CREATE INDEX "dm_automation_events_ruleId_idx" ON "dm_automation_events"("ruleId");

-- CreateIndex
CREATE INDEX "dm_automation_events_rateLimited_idx" ON "dm_automation_events"("rateLimited");

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_rules" ADD CONSTRAINT "dm_automation_rules_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "dm_automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "dm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_events" ADD CONSTRAINT "dm_automation_events_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dm_automation_events" ADD CONSTRAINT "dm_automation_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "dm_automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
