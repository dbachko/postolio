/* Remove progress column from campaigns */
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "progress";
