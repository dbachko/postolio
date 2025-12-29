-- Inbox v2: DB-enforced idempotency for inbound DM messages

-- Prevent duplicate message inserts per conversation when webhooks are retried.
-- Note: Postgres UNIQUE indexes allow multiple NULL values, so this still permits
-- outbound/pending rows without externalMessageId.
CREATE UNIQUE INDEX "dm_messages_conversationId_externalMessageId_key"
ON "dm_messages"("conversationId", "externalMessageId");
