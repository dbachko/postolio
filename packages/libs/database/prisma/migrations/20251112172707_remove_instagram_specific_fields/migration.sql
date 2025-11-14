-- AlterTable: Remove Instagram-specific fields from users table
-- These fields are deprecated in favor of SocialAccount model
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramUsername";
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramToken";

-- AlterTable: Remove Instagram-specific fields from brands table
-- These fields have been migrated to SocialAccount model
ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramPageId";
ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramAccountId";
ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramProfileData";

-- Note: This migration should be run AFTER migrating existing Instagram data
-- to the SocialAccount model using the migration script:
-- packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts
