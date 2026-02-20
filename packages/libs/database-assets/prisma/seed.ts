import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createAssetsPrismaClient, normalizeAssetLabelName } from '../index.js';

type Args = {
  brandId: string;
  count: number;
  uploadedBy: string;
  cdnBase?: string;
  videoCount?: number;
};

function parseArgs(): Partial<Args> {
  const out: Partial<Args> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token === '--') continue;

    let key = token;
    let value: string | undefined;
    const eqIndex = token.indexOf('=');
    if (eqIndex >= 0) {
      key = token.slice(0, eqIndex);
      value = token.slice(eqIndex + 1);
    } else {
      value = process.argv[i + 1];
      i++;
    }

    if (!value) continue;

    switch (key) {
      case '--brandId':
        out.brandId = value;
        break;
      case '--count':
        out.count = Number(value);
        break;
      case '--uploadedBy':
        out.uploadedBy = value;
        break;
      case '--cdnBase':
        out.cdnBase = value;
        break;
      case '--videoCount':
        out.videoCount = Number(value);
        break;
      default:
        break;
    }
  }
  return out;
}

function seedPath(width: number, height: number, i: number) {
  return `${width}/${height}?random=${i}-${randomUUID().slice(0, 8)}`;
}

async function main() {
  const args = parseArgs();

  const brandId = args.brandId || process.env.SEED_BRAND_ID;
  if (!brandId) {
    console.error(
      'Missing --brandId. Usage: pnpm --filter @postolio/database-assets db:seed -- --brandId <id> [--count 12] [--cdnBase https://picsum.photos]'
    );
    process.exit(1);
  }

  const count =
    Number.isFinite(args.count) && (args.count as number) > 0 ? (args.count as number) : 12;
  const videoCount =
    Number.isFinite(args.videoCount) && (args.videoCount as number) >= 0
      ? (args.videoCount as number)
      : 3;
  const uploadedBy = args.uploadedBy || 'seed-user';
  const cdnBase = args.cdnBase;

  console.log(`==> Seeding ${count} images and ${videoCount} videos for brand ${brandId}`);

  const assetsDatabaseUrl = process.env.ASSETS_DATABASE_URL;
  if (!assetsDatabaseUrl) {
    throw new Error('ASSETS_DATABASE_URL must be set to seed the assets database');
  }
  const { client: prisma, pool } = createAssetsPrismaClient({
    connectionString: assetsDatabaseUrl,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  try {
    async function getOrCreateCollection(name: string, color?: string) {
      const existing = await prisma.assetTaxonomyItem.findFirst({
        where: { brandId, type: 'COLLECTION', name, deletedAt: null },
      });
      if (existing) return existing;
      return prisma.assetTaxonomyItem.create({
        data: { brandId, type: 'COLLECTION', name, color },
      });
    }

    async function getOrCreateLabel(name: string) {
      const nameNorm = normalizeAssetLabelName(name);
      const existing = await prisma.assetTaxonomyItem.findFirst({
        where: { brandId, type: 'LABEL', nameNorm, deletedAt: null },
      });
      if (existing) return existing;
      return prisma.assetTaxonomyItem.create({
        data: { brandId, type: 'LABEL', name, nameNorm },
      });
    }

    const [general, brandCollection, seedLabel, demoLabel, videoLabel] = await Promise.all([
      getOrCreateCollection('General', '#64748b'),
      getOrCreateCollection('Brand Assets', '#3b82f6'),
      getOrCreateLabel('seed'),
      getOrCreateLabel('demo'),
      getOrCreateLabel('video'),
    ]);

    const imageAssets = Array.from({ length: count }).map((_, i) => {
      const imgW = 1200;
      const imgH = 800;
      const thumbW = 300;
      const thumbH = 200;
      const baseName = `seed-image-${String(i + 1).padStart(3, '0')}.jpg`;
      const imagePath = seedPath(imgW, imgH, i + 1);
      const thumbPath = seedPath(thumbW, thumbH, i + 1);
      const normalizedCdn = cdnBase ? cdnBase.replace(/\/$/, '') : undefined;
      const s3Key = normalizedCdn
        ? `${normalizedCdn}/${imagePath}`
        : `brands/${brandId}/uploads/images/${Date.now()}_${i + 1}_${baseName}`;
      const thumbnailKey = normalizedCdn ? `${normalizedCdn}/${thumbPath}` : undefined;
      return {
        brandId,
        uploadedBy,
        fileName: baseName,
        s3Key,
        s3Bucket:
          process.env.ASSETS_S3_BUCKET || process.env.S3_BUCKET || 'postolio-dev-assets-storage',
        fileSize: Math.floor(400_000 + Math.random() * 1_200_000),
        mimeType: 'image/jpeg',
        fileType: 'image' as const,
        width: imgW,
        height: imgH,
        duration: null,
        title: `Seed Image ${i + 1}`,
        altText: `Seed image ${i + 1}`,
        description: 'Seeded asset for local development',
        collectionId: i % 2 === 0 ? brandCollection.id : general.id,
        labelIds: [seedLabel.id, demoLabel.id],
        processingStatus: 'completed' as const,
        thumbnailKey,
        thumbnailSmallKey: undefined,
        thumbnailLargeKey: undefined,
      };
    });

    const videoAssets = Array.from({ length: videoCount }).map((_, i) => {
      const width = 1080;
      const height = 1920;
      const baseName = `seed-video-${String(i + 1).padStart(3, '0')}.mp4`;
      const normalizedCdn = cdnBase ? cdnBase.replace(/\/$/, '') : undefined;
      const s3Key = normalizedCdn
        ? `${normalizedCdn}/videos/${baseName}`
        : `brands/${brandId}/uploads/videos/${Date.now()}_${i + 1}_${baseName}`;

      return {
        brandId,
        uploadedBy,
        fileName: baseName,
        s3Key,
        s3Bucket:
          process.env.ASSETS_S3_BUCKET || process.env.S3_BUCKET || 'postolio-dev-assets-storage',
        fileSize: Math.floor(2_000_000 + Math.random() * 6_000_000),
        mimeType: 'video/mp4',
        fileType: 'video' as const,
        width,
        height,
        duration: 12 + i * 5,
        title: `Seed Video ${i + 1}`,
        altText: `Seed video ${i + 1}`,
        description: 'Seeded video asset for local development',
        collectionId: i % 2 === 0 ? brandCollection.id : general.id,
        labelIds: [seedLabel.id, demoLabel.id, videoLabel.id],
        processingStatus: 'completed' as const,
        thumbnailKey: undefined,
        thumbnailSmallKey: undefined,
        thumbnailLargeKey: undefined,
      };
    });

    const assets = [...imageAssets, ...videoAssets];
    let createdCount = 0;
    for (const asset of assets) {
      const { labelIds, ...data } = asset;
      await prisma.asset.create({
        data: {
          ...data,
          labelAssignments: labelIds.length
            ? {
                createMany: {
                  data: labelIds.map((taxonomyItemId) => ({
                    taxonomyItemId,
                    createdBy: uploadedBy,
                  })),
                },
              }
            : undefined,
        },
      });
      createdCount += 1;
    }
    console.log(`✅ Seeded ${createdCount} assets`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
