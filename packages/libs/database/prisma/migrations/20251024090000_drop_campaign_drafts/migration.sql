-- Drop campaign drafts table and related unique constraint if exists
-- This migration removes the deprecated campaign_drafts feature

-- In case it exists (safe on re-run environments)
DROP TABLE IF EXISTS "campaign_drafts";

