-- Fix: rename truncated index to explicit short name (79 chars was silently truncated to 63 by PostgreSQL)
ALTER INDEX "dm_conversations_brandId_socialAccountId_platform_participantEx"
RENAME TO "dm_conv_brand_account_platform_participant_key";
