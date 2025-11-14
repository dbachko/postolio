Instagram Data Model Migration (Legacy → SocialAccount)

Overview

- This migration removes Instagram-specific fields from core tables and replaces them with a generic, multi-platform model based on SocialAccount, ContentPublication and metric tables. Credentials are stored in the Token Service.

One-time Migration Order

1. Migrate legacy data to SocialAccount
   - Script: packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts
   - Purpose: Reads Brand.instagramAccountId/instagramPageId/instagramProfileData and creates a SocialAccount row (platform='instagram') with metadata. This must run BEFORE the removal migration.

2. Drop legacy columns from users/brands
   - Migration: packages/libs/database/prisma/migrations/20251112172707_remove_instagram_specific_fields/
   - Drops: users.instagramId, users.instagramUsername, brands.instagramPageId, brands.instagramAccountId, brands.instagramProfileData

3. Validate
   - Script: packages/libs/database/scripts/validate-social-accounts-migration.ts
   - Checks that every brand with legacy instagramAccountId has a corresponding SocialAccount row and basic referential integrity holds.

Post-migration Code Guidelines

- Do NOT access Brand.instagram* or User.instagram* anywhere. Use SocialAccount for account identity and Token Service for credentials.
- Publishing/Sync/DMs must derive accountId/pageId exclusively from Token Service or SocialAccount, never from Brand.
- Publications/metrics must join via SocialAccount and ContentPublication.
- Generic social operations (status, publish, sync, disconnect, insights) must go through:
  - `packages/apps/api/src/routes/social-platform.ts` + `ConnectorFactory` (`@postolio/connectors`).
  - Instagram-specific behavior (best time, DMs, analysis sampling) stays in `services/instagram.ts` and `routes/brands-instagram.ts`, still backed by SocialAccount + Token Service.

Notes

- If you need to seed/dev-test: create SocialAccount rows for platforms you want to simulate. The seed script already uses SocialAccount and avoids legacy columns.
