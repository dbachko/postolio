-- Add optional targetSocialAccountId on content for account-scoped publish/scheduling
ALTER TABLE "content"
  ADD COLUMN IF NOT EXISTS "targetSocialAccountId" TEXT;

-- Add foreign key constraint (keep content if account removed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_targetSocialAccountId_fkey'
  ) THEN
    ALTER TABLE "content"
      ADD CONSTRAINT "content_targetSocialAccountId_fkey"
      FOREIGN KEY ("targetSocialAccountId") REFERENCES "social_accounts"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

