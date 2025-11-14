/**
 * Migration Script: Instagram Data to SocialAccount Model
 *
 * This script migrates existing Instagram-specific data from Brand and User models
 * to the new platform-agnostic SocialAccount and ContentPublication models.
 *
 * Run with: pnpm tsx packages/libs/database/scripts/migrate-instagram-to-social-accounts.ts
 */

import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';

const prisma = new PrismaClient();

interface MigrationStats {
  brandsProcessed: number;
  socialAccountsCreated: number;
  socialAccountsSkipped: number;
  contentPublicationsCreated: number;
  contentPublicationsSkipped: number;
  errors: Array<{ step: string; error: string; details?: any }>;
}

async function generateId(): Promise<string> {
  return nanoid();
}

/**
 * Step 1: Migrate Brand Instagram data to SocialAccount
 */
async function migrateBrandInstagramData(stats: MigrationStats): Promise<void> {
  console.log('\n📋 Step 1: Migrating Brand Instagram data to SocialAccount...\n');

  const brandsWithInstagram = await prisma.brand.findMany({
    where: {
      instagramAccountId: { not: null },
    },
    include: {
      user: true,
    },
  });

  console.log(`Found ${brandsWithInstagram.length} brands with Instagram data\n`);

  for (const brand of brandsWithInstagram) {
    stats.brandsProcessed++;

    try {
      // Check if SocialAccount already exists
      const existing = await prisma.socialAccount.findUnique({
        where: {
          brandId_platform: {
            brandId: brand.id,
            platform: 'instagram',
          },
        },
      });

      if (existing) {
        console.log(`  ⏭️  Brand "${brand.name}" already has Instagram SocialAccount - skipping`);
        stats.socialAccountsSkipped++;
        continue;
      }

      // Extract Instagram profile data
      const instagramProfileData = brand.instagramProfileData as any;
      const username = instagramProfileData?.username || instagramProfileData?.ig_username;
      const displayName =
        instagramProfileData?.name || instagramProfileData?.full_name || brand.name;

      // Create SocialAccount
      await prisma.socialAccount.create({
        data: {
          id: await generateId(),
          brandId: brand.id,
          platform: 'instagram',
          externalAccountId: brand.instagramAccountId!,
          externalPageId: brand.instagramPageId || undefined,
          username,
          displayName,
          metadata: instagramProfileData || {},
          createdAt: brand.createdAt,
          updatedAt: new Date(),
        },
      });

      console.log(
        `  ✅ Created Instagram SocialAccount for brand "${brand.name}" (@${username || 'unknown'})`
      );
      stats.socialAccountsCreated++;
    } catch (error: any) {
      console.error(`  ❌ Error migrating brand "${brand.name}": ${error.message}`);
      stats.errors.push({
        step: 'migrateBrandInstagramData',
        error: error.message,
        details: { brandId: brand.id, brandName: brand.name },
      });
    }
  }

  console.log(`\n✨ Step 1 Complete: ${stats.socialAccountsCreated} SocialAccounts created\n`);
}

/**
 * Step 2: Migrate published Content to ContentPublication
 */
async function migratePublishedContent(stats: MigrationStats): Promise<void> {
  console.log('\n📋 Step 2: Migrating published Content to ContentPublication...\n');

  // Find all content that has been published to Instagram
  const publishedContent = await prisma.content.findMany({
    where: {
      status: 'published',
      postedAt: { not: null },
    },
    include: {
      brand: true,
    },
  });

  console.log(`Found ${publishedContent.length} published content items\n`);

  for (const content of publishedContent) {
    try {
      // Find the corresponding SocialAccount
      const socialAccount = await prisma.socialAccount.findFirst({
        where: { brandId: content.brandId, platform: 'instagram' },
      });

      if (!socialAccount) {
        console.log(
          `  ⚠️  No Instagram SocialAccount for content "${content.id}" (brand: ${content.brand.name}) - skipping`
        );
        continue;
      }

      // Check if ContentPublication already exists
      const existing = await prisma.contentPublication.findUnique({
        where: {
          contentId_socialAccountId: {
            contentId: content.id,
            socialAccountId: socialAccount.id,
          },
        },
      });

      if (existing) {
        console.log(`  ⏭️  Content "${content.id}" already has ContentPublication - skipping`);
        stats.contentPublicationsSkipped++;
        continue;
      }

      // Create ContentPublication
      await prisma.contentPublication.create({
        data: {
          id: await generateId(),
          contentId: content.id,
          socialAccountId: socialAccount.id,
          platform: 'instagram',
          externalPostId: content.externalPostId || 'MIGRATED_UNKNOWN',
          permalink: content.permalink || undefined,
          publishedAt: content.postedAt,
          metadata: {
            migratedFrom: 'instagram_legacy',
            migratedAt: new Date().toISOString(),
          },
          createdAt: content.postedAt || content.updatedAt,
          updatedAt: new Date(),
        },
      });

      console.log(
        `  ✅ Created ContentPublication for content "${content.id}" (brand: ${content.brand.name})`
      );
      stats.contentPublicationsCreated++;
    } catch (error: any) {
      console.error(`  ❌ Error migrating content "${content.id}": ${error.message}`);
      stats.errors.push({
        step: 'migratePublishedContent',
        error: error.message,
        details: { contentId: content.id },
      });
    }
  }

  console.log(
    `\n✨ Step 2 Complete: ${stats.contentPublicationsCreated} ContentPublications created\n`
  );
}

/**
 * Step 3: Validate migration integrity
 */
async function validateMigration(stats: MigrationStats): Promise<void> {
  console.log('\n📋 Step 3: Validating migration integrity...\n');

  // Check 1: All brands with Instagram data have SocialAccount
  const brandsWithInstagram = await prisma.brand.count({
    where: { instagramAccountId: { not: null } },
  });

  const socialAccounts = await prisma.socialAccount.count({
    where: { platform: 'instagram' },
  });

  console.log(`  Brands with Instagram data: ${brandsWithInstagram}`);
  console.log(`  Instagram SocialAccounts: ${socialAccounts}`);

  if (brandsWithInstagram > socialAccounts) {
    console.log(
      `  ⚠️  Warning: ${brandsWithInstagram - socialAccounts} brands missing SocialAccount`
    );
  } else {
    console.log(`  ✅ All brands have SocialAccount`);
  }

  // Check 2: All published content has ContentPublication
  const publishedContentCount = await prisma.content.count({
    where: {
      status: 'published',
      postedAt: { not: null },
    },
  });

  const contentPublications = await prisma.contentPublication.count({
    where: { platform: 'instagram' },
  });

  console.log(`\n  Published content items: ${publishedContentCount}`);
  console.log(`  ContentPublications: ${contentPublications}`);

  if (publishedContentCount > contentPublications) {
    console.log(
      `  ⚠️  Warning: ${publishedContentCount - contentPublications} content items missing ContentPublication`
    );
  } else {
    console.log(`  ✅ All published content has ContentPublication`);
  }

  // Check 3: No duplicate SocialAccounts
  const duplicates = await prisma.$queryRaw<
    Array<{ brandId: string; platform: string; count: bigint }>
  >`
    SELECT "brandId", platform, COUNT(*) as count
    FROM social_accounts
    GROUP BY "brandId", platform
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length > 0) {
    console.log(`\n  ❌ Found ${duplicates.length} duplicate SocialAccounts:`);
    duplicates.forEach((dup) => {
      console.log(`     Brand ${dup.brandId}, Platform ${dup.platform}: ${dup.count} accounts`);
      stats.errors.push({
        step: 'validateMigration',
        error: 'Duplicate SocialAccount found',
        details: dup,
      });
    });
  } else {
    console.log(`\n  ✅ No duplicate SocialAccounts found`);
  }

  console.log('\n✨ Step 3 Complete: Validation finished\n');
}

/**
 * Main migration function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Instagram to SocialAccount Migration                         ║');
  console.log('║  WARNING: This will modify your database                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  const stats: MigrationStats = {
    brandsProcessed: 0,
    socialAccountsCreated: 0,
    socialAccountsSkipped: 0,
    contentPublicationsCreated: 0,
    contentPublicationsSkipped: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    // Step 1: Migrate Brand Instagram data
    await migrateBrandInstagramData(stats);

    // Step 2: Migrate published content
    await migratePublishedContent(stats);

    // Step 3: Validate migration
    await validateMigration(stats);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Migration Summary                                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log();
    console.log(`  ⏱️  Duration: ${duration}s`);
    console.log(`  📊 Brands processed: ${stats.brandsProcessed}`);
    console.log(`  ✅ SocialAccounts created: ${stats.socialAccountsCreated}`);
    console.log(`  ⏭️  SocialAccounts skipped: ${stats.socialAccountsSkipped}`);
    console.log(`  ✅ ContentPublications created: ${stats.contentPublicationsCreated}`);
    console.log(`  ⏭️  ContentPublications skipped: ${stats.contentPublicationsSkipped}`);
    console.log(`  ❌ Errors: ${stats.errors.length}`);
    console.log();

    if (stats.errors.length > 0) {
      console.log('❌ Errors encountered during migration:');
      stats.errors.forEach((err, idx) => {
        console.log(`\n  ${idx + 1}. ${err.step}: ${err.error}`);
        if (err.details) {
          console.log(`     Details: ${JSON.stringify(err.details, null, 2)}`);
        }
      });
      console.log();
      process.exit(1);
    } else {
      console.log('✅ Migration completed successfully!');
      console.log();
      console.log('Next steps:');
      console.log('  1. Review the SocialAccounts in your database');
      console.log('  2. Run the validation script to verify integrity');
      console.log('  3. Consider removing old Instagram fields from Brand model');
      console.log();
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error during migration:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { main, MigrationStats };
