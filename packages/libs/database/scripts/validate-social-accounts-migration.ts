/**
 * Validation Script: SocialAccount Migration Integrity
 *
 * This script validates that the migration from Instagram-specific fields
 * to SocialAccount model was successful and identifies any data integrity issues.
 *
 * Run with: pnpm tsx packages/libs/database/scripts/validate-social-accounts-migration.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

const pool = new Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined
);
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface ValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    details?: any;
  }>;
}

async function runValidation(): Promise<ValidationResult> {
  const result: ValidationResult = {
    passed: true,
    checks: [],
  };

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  SocialAccount Migration Validation                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log();

  // Check 1: All brands with Instagram data have SocialAccount
  console.log('🔍 Check 1: Brands with Instagram data have SocialAccount...');
  const brandsWithInstagram = await prisma.brand.findMany({
    where: { instagramAccountId: { not: null } },
    select: { id: true, name: true, instagramAccountId: true },
  });

  const missingAccounts: string[] = [];
  for (const brand of brandsWithInstagram) {
    const socialAccount = await prisma.socialAccount.findFirst({
      where: { brandId: brand.id, platform: 'instagram' },
    });

    if (!socialAccount) {
      missingAccounts.push(`${brand.name} (${brand.id})`);
    }
  }

  if (missingAccounts.length === 0) {
    console.log(`   ✅ All ${brandsWithInstagram.length} brands have SocialAccount\n`);
    result.checks.push({
      name: 'BrandsHaveSocialAccount',
      passed: true,
      message: `All ${brandsWithInstagram.length} brands with Instagram data have SocialAccount`,
    });
  } else {
    console.log(`   ❌ ${missingAccounts.length} brands missing SocialAccount:`);
    missingAccounts.forEach((name) => console.log(`      - ${name}`));
    console.log();
    result.passed = false;
    result.checks.push({
      name: 'BrandsHaveSocialAccount',
      passed: false,
      message: `${missingAccounts.length} brands missing SocialAccount`,
      details: missingAccounts,
    });
  }

  // Check 2: All published content has ContentPublication
  console.log('🔍 Check 2: Published content has ContentPublication...');
  const publishedContent = await prisma.content.findMany({
    where: {
      status: 'published',
      postedAt: { not: null },
    },
    include: {
      brand: true,
    },
  });

  const missingPublications: string[] = [];
  for (const content of publishedContent) {
    const socialAccount = await prisma.socialAccount.findFirst({
      where: { brandId: content.brandId, platform: 'instagram' },
    });

    if (!socialAccount) {
      missingPublications.push(`Content ${content.id} - Brand has no SocialAccount`);
      continue;
    }

    const publication = await prisma.contentPublication.findUnique({
      where: {
        contentId_socialAccountId: {
          contentId: content.id,
          socialAccountId: socialAccount.id,
        },
      },
    });

    if (!publication) {
      missingPublications.push(`Content ${content.id} (${content.brand.name})`);
    }
  }

  if (missingPublications.length === 0) {
    console.log(`   ✅ All ${publishedContent.length} published items have ContentPublication\n`);
    result.checks.push({
      name: 'ContentHasPublication',
      passed: true,
      message: `All ${publishedContent.length} published items have ContentPublication`,
    });
  } else {
    console.log(`   ❌ ${missingPublications.length} published items missing ContentPublication:`);
    missingPublications.slice(0, 10).forEach((name) => console.log(`      - ${name}`));
    if (missingPublications.length > 10) {
      console.log(`      ... and ${missingPublications.length - 10} more`);
    }
    console.log();
    result.passed = false;
    result.checks.push({
      name: 'ContentHasPublication',
      passed: false,
      message: `${missingPublications.length} published items missing ContentPublication`,
      details: missingPublications.slice(0, 20),
    });
  }

  // Check 3: No duplicate SocialAccounts
  console.log('🔍 Check 3: No duplicate SocialAccounts...');
  const duplicates = await prisma.$queryRaw<
    Array<{ brandId: string; platform: string; count: bigint }>
  >`
    SELECT "brandId", platform, COUNT(*) as count
    FROM social_accounts
    GROUP BY "brandId", platform
    HAVING COUNT(*) > 1
  `;

  if (duplicates.length === 0) {
    console.log('   ✅ No duplicate SocialAccounts found\n');
    result.checks.push({
      name: 'NoDuplicateAccounts',
      passed: true,
      message: 'No duplicate SocialAccounts found',
    });
  } else {
    console.log(`   ❌ Found ${duplicates.length} duplicate SocialAccounts:`);
    duplicates.forEach((dup) => {
      console.log(`      - Brand ${dup.brandId}, Platform ${dup.platform}: ${dup.count} accounts`);
    });
    console.log();
    result.passed = false;
    result.checks.push({
      name: 'NoDuplicateAccounts',
      passed: false,
      message: `Found ${duplicates.length} duplicate SocialAccounts`,
      details: duplicates,
    });
  }

  // Check 4: SocialAccount data integrity
  console.log('🔍 Check 4: SocialAccount data integrity...');
  const invalidAccounts: string[] = [];
  const allSocialAccounts = await prisma.socialAccount.findMany({
    where: { platform: 'instagram' },
    include: { brand: true },
  });

  for (const account of allSocialAccounts) {
    if (!account.externalAccountId) {
      invalidAccounts.push(`${account.brand.name} - missing externalAccountId`);
    }
    if (!account.username && !account.displayName) {
      invalidAccounts.push(`${account.brand.name} - missing username and displayName`);
    }
  }

  if (invalidAccounts.length === 0) {
    console.log(`   ✅ All ${allSocialAccounts.length} SocialAccounts have valid data\n`);
    result.checks.push({
      name: 'AccountDataIntegrity',
      passed: true,
      message: `All ${allSocialAccounts.length} SocialAccounts have valid data`,
    });
  } else {
    console.log(`   ❌ Found ${invalidAccounts.length} accounts with invalid data:`);
    invalidAccounts.forEach((issue) => console.log(`      - ${issue}`));
    console.log();
    result.passed = false;
    result.checks.push({
      name: 'AccountDataIntegrity',
      passed: false,
      message: `Found ${invalidAccounts.length} accounts with invalid data`,
      details: invalidAccounts,
    });
  }

  // Check 5: ContentPublication data integrity
  console.log('🔍 Check 5: ContentPublication data integrity...');
  const invalidPublications: string[] = [];
  const allPublications = await prisma.contentPublication.findMany({
    where: { platform: 'instagram' },
    include: { content: true },
  });

  for (const publication of allPublications) {
    if (!publication.externalPostId || publication.externalPostId === 'UNKNOWN') {
      // This is acceptable for migrated data
      continue;
    }
    if (!publication.publishedAt) {
      invalidPublications.push(`Content ${publication.contentId} - missing publishedAt`);
    }
  }

  if (invalidPublications.length === 0) {
    console.log(`   ✅ All ${allPublications.length} ContentPublications have valid data\n`);
    result.checks.push({
      name: 'PublicationDataIntegrity',
      passed: true,
      message: `All ${allPublications.length} ContentPublications have valid data`,
    });
  } else {
    console.log(`   ❌ Found ${invalidPublications.length} publications with invalid data:`);
    invalidPublications.forEach((issue) => console.log(`      - ${issue}`));
    console.log();
    result.passed = false;
    result.checks.push({
      name: 'PublicationDataIntegrity',
      passed: false,
      message: `Found ${invalidPublications.length} publications with invalid data`,
      details: invalidPublications,
    });
  }

  // Check 6: Orphaned ContentPublications
  console.log('🔍 Check 6: No orphaned ContentPublications...');
  const orphanedPublications = await prisma.contentPublication.findMany({
    where: {
      content: null,
    },
  });

  if (orphanedPublications.length === 0) {
    console.log('   ✅ No orphaned ContentPublications found\n');
    result.checks.push({
      name: 'NoOrphanedPublications',
      passed: true,
      message: 'No orphaned ContentPublications found',
    });
  } else {
    console.log(`   ❌ Found ${orphanedPublications.length} orphaned ContentPublications\n`);
    result.passed = false;
    result.checks.push({
      name: 'NoOrphanedPublications',
      passed: false,
      message: `Found ${orphanedPublications.length} orphaned ContentPublications`,
      details: orphanedPublications.map((p) => p.id),
    });
  }

  // Check 7: Statistics
  console.log('📊 Migration Statistics:');
  const stats = {
    totalBrands: await prisma.brand.count(),
    brandsWithInstagram: brandsWithInstagram.length,
    instagramSocialAccounts: await prisma.socialAccount.count({ where: { platform: 'instagram' } }),
    totalContent: await prisma.content.count(),
    publishedContent: publishedContent.length,
    contentPublications: await prisma.contentPublication.count({
      where: { platform: 'instagram' },
    }),
  };

  console.log(`   Total brands: ${stats.totalBrands}`);
  console.log(`   Brands with Instagram: ${stats.brandsWithInstagram}`);
  console.log(`   Instagram SocialAccounts: ${stats.instagramSocialAccounts}`);
  console.log(`   Total content: ${stats.totalContent}`);
  console.log(`   Published content: ${stats.publishedContent}`);
  console.log(`   ContentPublications: ${stats.contentPublications}`);
  console.log();

  return result;
}

async function main() {
  try {
    const result = await runValidation();

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  Validation Summary                                            ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log();

    const passedChecks = result.checks.filter((c) => c.passed).length;
    const totalChecks = result.checks.length;

    console.log(`  Checks passed: ${passedChecks}/${totalChecks}`);
    console.log();

    if (result.passed) {
      console.log('✅ All validation checks passed!');
      console.log();
      console.log('Your migration is complete and data integrity is verified.');
      console.log('You can now safely proceed with removing old Instagram fields.');
      console.log();
      process.exit(0);
    } else {
      console.log('❌ Some validation checks failed:');
      console.log();
      result.checks
        .filter((c) => !c.passed)
        .forEach((check) => {
          console.log(`  ❌ ${check.name}: ${check.message}`);
        });
      console.log();
      console.log('Please review the issues above and run the migration script again.');
      console.log();
      process.exit(1);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error during validation:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { runValidation, ValidationResult };
