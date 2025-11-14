# Phase 1: Database Refactoring - COMPLETE ✅

**Date Completed**: January 12, 2025
**Duration**: ~2 hours
**Status**: ✅ Ready for Phase 2

## Summary

Phase 1 of the extensibility refactoring is complete. The database schema is now platform-agnostic and ready for multi-platform support.

---

## What Was Accomplished

### 1. Removed Instagram-Specific Fields

**From User model**:

- ❌ `instagramId` (String?)
- ❌ `instagramUsername` (String?)
- ❌ `instagramToken` (String?)

**From Brand model**:

- ❌ `instagramPageId` (String?)
- ❌ `instagramAccountId` (String?)
- ❌ `instagramProfileData` (Json?)

**Updated Comments**:

- ContentStatus.published: "Successfully posted to Instagram" → "Successfully posted to social platform(s)"

### 2. Created Prisma Migration

**File**: `migrations/20251112172707_remove_instagram_specific_fields/migration.sql`

SQL commands to safely drop Instagram-specific columns:

```sql
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramId";
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramUsername";
ALTER TABLE "users" DROP COLUMN IF EXISTS "instagramToken";

ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramPageId";
ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramAccountId";
ALTER TABLE "brands" DROP COLUMN IF EXISTS "instagramProfileData";
```

⚠️ **Important**: Migration should be run AFTER data migration script.

### 3. Verified Platform-Agnostic Models

Already in place (no changes needed):

✅ **SocialAccount Model**:

```prisma
model SocialAccount {
  id                String   @id @default(cuid())
  brandId           String
  platform          Platform  // instagram | facebook | linkedin | x | youtube | tiktok
  externalAccountId String
  externalPageId    String?
  username          String?
  displayName       String?
  metadata          Json?

  publications      ContentPublication[]
}
```

✅ **ContentPublication Model**:

```prisma
model ContentPublication {
  id                 String    @id @default(cuid())
  contentId          String
  socialAccountId    String
  platform           Platform  // Multi-platform support
  externalPostId     String
  permalink          String?
  publishedAt        DateTime?

  metrics            MetricsSample[]
}
```

✅ **Platform Enum**:

```prisma
enum Platform {
  instagram
  facebook
  linkedin
  x
  youtube
  tiktok
}
```

---

## Files That Need Refactoring (Phase 2)

Found **20 files** (excluding migrations) that reference Instagram-specific fields:

### API Routes (8 files)

1. `packages/apps/api/src/routes/brand-analysis-nested.ts`
2. `packages/apps/api/src/routes/brand-analysis.ts`
3. `packages/apps/api/src/routes/brands-instagram.ts` ⚠️ Entire file Instagram-specific
4. `packages/apps/api/src/routes/brands.ts`
5. `packages/apps/api/src/routes/campaign.ts`
6. `packages/apps/api/src/routes/instagram-oauth.ts` ⚠️ Keep but deprecate
7. `packages/apps/api/src/routes/instagram.ts` ⚠️ Entire file Instagram-specific
8. `packages/apps/api/src/routes/rolling-content.ts`

### Services (6 files)

9. `packages/apps/api/src/services/autopilot.ts`
10. `packages/apps/api/src/services/content-operations/publishing.ts` ⚠️ Critical
11. `packages/apps/api/src/services/instagram-best-time.ts` ⚠️ Platform-specific
12. `packages/apps/api/src/services/instagram.ts` ⚠️ 1706 lines monolith
13. `packages/apps/api/src/services/publisher-credentials.ts`
14. `packages/apps/api/src/routes/internal-tokens.ts`

### Lambda Functions (4 files)

15. `packages/infra/cdk/lib/lambdas/publishers/instagram/index.ts` ✅ OK, platform-specific
16. `packages/services/brand-analysis-scheduler/src/index.ts`
17. `packages/services/comments-ingestor/src/index.ts`
18. `packages/services/status-sync/src/index.ts`

### Scripts (2 files)

19. `packages/apps/api/scripts/seed-dev.ts` ✅ OK, test data
20. `packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts` ✅ OK, migration

---

## Database Migration Strategy

### Before Running Migration

**Step 1**: Run data migration script (already created):

```bash
pnpm tsx packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts
```

**Step 2**: Validate migration:

```bash
pnpm tsx packages/libs/database/scripts/validate-social-accounts-migration.ts
```

**Step 3**: Review validation results - ensure:

- ✅ All brands with Instagram data have SocialAccount records
- ✅ All published content has ContentPublication records
- ✅ No duplicate SocialAccounts
- ✅ Data integrity checks pass

### Running the Migration

**Development**:

```bash
cd packages/libs/database
pnpm prisma migrate dev
```

**Production**:

```bash
cd packages/libs/database
pnpm prisma migrate deploy
```

### Rollback Plan

If issues occur:

1. Revert schema.prisma to previous commit:

   ```bash
   git checkout HEAD~1 packages/libs/database/prisma/schema.prisma
   ```

2. Delete migration folder:

   ```bash
   rm -rf packages/libs/database/prisma/migrations/20251112172707_remove_instagram_specific_fields
   ```

3. Regenerate Prisma client:
   ```bash
   pnpm --filter=@postolio/database build
   ```

**Data is safe**: SocialAccount data persists even if migration is rolled back.

---

## Phase 2 Preview: API Refactoring

### Phase 2.1: Create Generic Routes (Week 1-2)

**New Routes** (replace Instagram-specific):

```typescript
// Generic social platform routes
GET  /api/social/:platform/status/:brandId
POST /api/social/:platform/publish/:contentId
POST /api/social/:platform/sync/:brandId
POST /api/social/:platform/disconnect/:brandId
GET  /api/social/:platform/insights/:contentId
```

**Deprecate** (keep for backward compatibility):

```typescript
// Old Instagram-only routes (deprecated)
GET  /api/instagram/status/:brandId → Redirect to /api/social/instagram/...
POST /api/instagram/publish/:contentId → Redirect to /api/social/instagram/...
```

### Phase 2.2: Refactor Instagram Service (Week 2-3)

**Current**: `services/instagram.ts` (1706 lines monolith)

**Target**: Break into modular connector

```
services/connectors/
├── instagram-connector.ts    (implements Connector interface)
├── connector-factory.ts      (routes to correct connector)
└── types.ts                  (shared interfaces)
```

### Phase 2.3: Update Publishing Logic (Week 3)

**Before** (hardcoded):

```typescript
const result = await publishContentToInstagram(content, brand);
```

**After** (generic):

```typescript
const socialAccount = await prisma.socialAccount.findUnique({
  where: { brandId_platform: { brandId, platform: 'instagram' } },
});

const connector = ConnectorFactory.get(socialAccount.platform);
const result = await connector.publish(content, credentials);
```

### Phase 2.4: Update All Queries (Week 3-4)

**Pattern to replace** (20 files):

```typescript
// OLD
const brand = await prisma.brand.findUnique({
  where: { id: brandId },
  select: { instagramAccountId: true },
});

// NEW
const socialAccount = await prisma.socialAccount.findUnique({
  where: { brandId_platform: { brandId, platform: 'instagram' } },
});
```

---

## Success Metrics

### Completed ✅

- [x] Instagram-specific fields removed from schema
- [x] Prisma migration created
- [x] Platform-agnostic models verified
- [x] Data migration scripts created and tested
- [x] 20 files identified for refactoring

### Phase 2 Goals

- [ ] Generic routes created
- [ ] InstagramConnector implements Connector interface
- [ ] All 20 files refactored to use SocialAccount
- [ ] Old Instagram routes deprecated
- [ ] Tests passing

---

## Timeline

- **Phase 1**: ✅ Complete (2 hours)
- **Phase 2**: 🔄 In Progress (estimated 2-3 weeks)
  - Week 1-2: Create generic routes + ConnectorFactory
  - Week 2-3: Refactor Instagram service to connector
  - Week 3-4: Update all queries to use SocialAccount
- **Phase 3**: Frontend refactoring (2-3 weeks)
- **Phase 4**: Infrastructure & validation (1 week)

**Total**: 6-8 weeks for complete extensibility refactoring

---

## Commands Reference

### Run Data Migration

```bash
pnpm tsx packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts
```

### Validate Migration

```bash
pnpm tsx packages/libs/database/scripts/validate-social-accounts-migration.ts
```

### Apply Schema Migration (Dev)

```bash
cd packages/libs/database
pnpm prisma migrate dev
```

### Apply Schema Migration (Production)

```bash
cd packages/libs/database
pnpm prisma migrate deploy
```

### Regenerate Prisma Client

```bash
pnpm --filter=@postolio/database build
```

### Find Instagram References

```bash
rg "instagramAccountId|instagramPageId|instagramProfileData" packages/
```

---

## Related Documents

- **Overall Plan**: `docs/REFACTORING-PLAN.md`
- **Adding Platforms**: `docs/ADDING-NEW-PLATFORM.md`
- **Data Migration**: `packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts`
- **Validation**: `packages/libs/database/scripts/validate-social-accounts-migration.ts`
- **Error Handling**: `packages/libs/errors/src/platform-errors.ts`

---

## Questions?

For questions about Phase 1 or next steps:

- Review `REFACTORING-PLAN.md` for complete roadmap
- Check `ADDING-NEW-PLATFORM.md` for post-refactoring workflow
- See commit history for implementation details

**Next Step**: Begin Phase 2 - API Layer Refactoring
