#!/usr/bin/env tsx
/**
 * Script to migrate existing external image URLs to S3
 * Usage: tsx scripts/migrate-images.ts [--dry-run] [--batch-size=10]
 */

import { PrismaClient } from '@prisma/client';
import { migrateImageToS3 } from '../src/services/s3-image.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

interface MigrationOptions {
  dryRun: boolean;
  batchSize: number;
  skipErrors: boolean;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function migrateImages(options: MigrationOptions) {
  console.log('🚀 Starting image migration to S3');
  console.log(`Options: ${JSON.stringify(options)}`);

  try {
    // Find all content with external image URLs but no S3 key
    const contentToMigrate = await prisma.content.findMany({
      where: {
        imageUrl: {
          not: null,
        },
        s3ImageKey: null,
      },
      include: {
        brand: {
          select: {
            id: true,
            name: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`Found ${contentToMigrate.length} images to migrate`);

    if (options.dryRun) {
      console.log('DRY RUN MODE - No changes will be made');
      console.log('\nSample of content to migrate:');
      contentToMigrate.slice(0, 5).forEach((content) => {
        console.log(`- Content ${content.id}: ${content.imageUrl?.substring(0, 50)}...`);
      });
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ contentId: string; error: string }> = [];

    // Process in batches
    for (let i = 0; i < contentToMigrate.length; i += options.batchSize) {
      const batch = contentToMigrate.slice(i, i + options.batchSize);
      console.log(
        `\nProcessing batch ${Math.floor(i / options.batchSize) + 1} of ${Math.ceil(contentToMigrate.length / options.batchSize)}`
      );

      const migrationPromises = batch.map(async (content) => {
        if (!content.imageUrl) return null;

        try {
          console.log(`  Migrating content ${content.id}...`);

          const result = await migrateImageToS3(
            content.imageUrl,
            content.id,
            content.brandId,
            content.campaignId || undefined
          );

          // Update database with S3 information
          await prisma.content.update({
            where: { id: content.id },
            data: {
              s3ImageKey: result.s3Key,
              cdnImageUrl: result.cdnUrl,
              imageRegion: result.region,
              retentionExpiresAt: result.retentionExpiresAt,
            },
          });

          console.log(`  ✅ Migrated content ${content.id} -> ${result.s3Key}`);
          successCount++;
          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`  ❌ Failed to migrate content ${content.id}: ${errorMessage}`);
          errorCount++;
          errors.push({ contentId: content.id, error: errorMessage });

          if (!options.skipErrors) {
            throw error;
          }
          return null;
        }
      });

      // Wait for batch to complete
      await Promise.all(migrationPromises);

      // Add delay between batches to avoid rate limiting
      if (i + options.batchSize < contentToMigrate.length) {
        console.log('  Waiting 2 seconds before next batch...');
        await sleep(2000);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('Migration Complete!');
    console.log(`✅ Successfully migrated: ${successCount} images`);
    console.log(`❌ Failed migrations: ${errorCount} images`);

    if (errors.length > 0) {
      console.log('\nFailed content IDs:');
      errors.forEach(({ contentId, error }) => {
        console.log(`  - ${contentId}: ${error}`);
      });
    }

    // Generate summary statistics
    const remainingExternal = await prisma.content.count({
      where: {
        imageUrl: {
          not: null,
        },
        s3ImageKey: null,
      },
    });

    const totalMigrated = await prisma.content.count({
      where: {
        s3ImageKey: {
          not: null,
        },
      },
    });

    console.log('\nFinal Statistics:');
    console.log(`  Total content with S3 images: ${totalMigrated}`);
    console.log(`  Remaining external images: ${remainingExternal}`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: MigrationOptions = {
    dryRun: false,
    batchSize: 10,
    skipErrors: false,
  };

  args.forEach((arg) => {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      const size = parseInt(arg.split('=')[1], 10);
      if (!isNaN(size) && size > 0) {
        options.batchSize = size;
      }
    } else if (arg === '--skip-errors') {
      options.skipErrors = true;
    } else if (arg === '--help') {
      console.log('Usage: tsx scripts/migrate-images.ts [options]');
      console.log('\nOptions:');
      console.log('  --dry-run         Show what would be migrated without making changes');
      console.log('  --batch-size=N    Process N images at a time (default: 10)');
      console.log('  --skip-errors     Continue migration even if some images fail');
      console.log('  --help           Show this help message');
      process.exit(0);
    }
  });

  return options;
}

// Main execution
const options = parseArgs();
migrateImages(options);
