/**
 * Backfill aspect ratios for existing assets
 * This script calculates aspect ratio, aspect ratio decimal, and orientation type
 * for all assets that have width and height but are missing these fields.
 */

import { prismaAssets } from '../index.js';

/**
 * Standard aspect ratios with tolerance matching
 * Must match the definitions in aspect-ratio.ts utility
 */
const STANDARD_RATIOS = [
  { label: '1:1', decimal: 1.0, description: 'Square' },
  { label: '4:5', decimal: 0.8, description: 'Portrait' },
  { label: '9:16', decimal: 0.5625, description: 'Full vertical' },
  { label: '3:4', decimal: 0.75, description: 'Tall classic' },
  { label: '4:3', decimal: 1.3333, description: 'Photo classic' },
  { label: '16:9', decimal: 1.7778, description: 'Standard landscape' },
  { label: '1.91:1', decimal: 1.91, description: 'Social ads landscape' },
  { label: '2:1', decimal: 2.0, description: 'Ultra-wide' },
  { label: '2.39:1', decimal: 2.39, description: 'Cinematic wide' },
];

function calculateAspectRatio(width: number, height: number) {
  const aspectRatioDecimal = width / height;
  const tolerance = 0.03; // 3% tolerance for matching to standard ratios

  // Try to match to a standard ratio
  let aspectRatio = 'CUSTOM';
  for (const standard of STANDARD_RATIOS) {
    if (Math.abs(aspectRatioDecimal - standard.decimal) <= tolerance) {
      aspectRatio = standard.label;
      break;
    }
  }

  // Determine orientation
  let orientationType: 'portrait' | 'landscape' | 'square';
  if (Math.abs(aspectRatioDecimal - 1.0) < 0.01) {
    orientationType = 'square';
  } else {
    orientationType = aspectRatioDecimal < 1 ? 'portrait' : 'landscape';
  }

  return {
    aspectRatio,
    aspectRatioDecimal,
    orientationType,
  };
}

async function backfillAspectRatios() {
  console.log('🚀 Starting aspect ratio backfill...');

  try {
    // Find assets without aspect ratio that have dimensions
    const assets = await prismaAssets.asset.findMany({
      where: {
        aspectRatio: null,
        width: { not: null },
        height: { not: null },
      },
      select: {
        id: true,
        width: true,
        height: true,
      },
    });

    console.log(`📊 Found ${assets.length} assets to update`);

    if (assets.length === 0) {
      console.log('✅ No assets need updating');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const asset of assets) {
      try {
        if (!asset.width || !asset.height) {
          console.warn(`⚠️  Asset ${asset.id} has null dimensions, skipping`);
          continue;
        }

        const { aspectRatio, aspectRatioDecimal, orientationType } = calculateAspectRatio(
          asset.width,
          asset.height
        );

        await prismaAssets.asset.update({
          where: { id: asset.id },
          data: {
            aspectRatio,
            aspectRatioDecimal,
            orientationType,
          },
        });

        updated++;

        // Log progress every 100 assets
        if (updated % 100 === 0) {
          console.log(`📈 Progress: ${updated}/${assets.length} assets updated`);
        }
      } catch (error) {
        failed++;
        console.error(`❌ Failed to update asset ${asset.id}:`, error);
      }
    }

    console.log('\n✅ Backfill complete!');
    console.log(`   Updated: ${updated}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total: ${assets.length}`);
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    await prismaAssets.$disconnect();
  }
}

// Run the backfill
backfillAspectRatios()
  .then(() => {
    console.log('👋 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
