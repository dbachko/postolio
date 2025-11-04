import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

type Args = {
  brandId: string;
  count: number;
  uploadedBy: string;
  cdnBase?: string; // e.g., https://picsum.photos for dev thumbnails
};

function parseArgs(): Partial<Args> {
  const out: Partial<Args> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token === '--') continue; // skip arg delimiter
    const [k, vRaw] = token.includes('=') ? token.split('=') : [token, process.argv[i + 1]];
    const v = vRaw as string | undefined;
    switch (k) {
      case '--brandId':
        if (v) out.brandId = v;
        break;
      case '--count':
        if (v) out.count = Number(v);
        break;
      case '--uploadedBy':
        if (v) out.uploadedBy = v;
        break;
      case '--cdnBase':
        if (v) out.cdnBase = v;
        break;
      default:
        break;
    }
    if (!token.includes('=')) i++;
  }
  return out;
}

function seedKeyForImage(width: number, height: number, i: number) {
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
  const uploadedBy = args.uploadedBy || 'seed-user';
  const cdnBase = args.cdnBase; // Optional; when provided, set keys to picsum-compatible paths

  console.log(`==> Seeding ${count} assets for brand ${brandId}`);

  // Ensure a couple of folders exist
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.ASSETS_DATABASE_URL } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  async function getOrCreateFolder(
    name: string,
    folderType: 'general' | 'campaign_pool' | 'brand_assets',
    color?: string
  ) {
    const existing = await prisma.assetFolder.findFirst({ where: { brandId, name } });
    if (existing) return existing;
    return prisma.assetFolder.create({
      data: { brandId, name, folderType, color },
    });
  }

  const [general, brandFolder] = await Promise.all([
    getOrCreateFolder('General', 'general', '#64748b'),
    getOrCreateFolder('Brand Assets', 'brand_assets', '#3b82f6'),
  ]);

  // Prepare assets
  const assets = Array.from({ length: count }).map((_, i) => {
    const imgW = 1200;
    const imgH = 800;
    const thumbW = 300;
    const thumbH = 200;
    const baseName = `seed-image-${String(i + 1).padStart(3, '0')}.jpg`;
    const s3Key = cdnBase
      ? seedKeyForImage(imgW, imgH, i + 1)
      : `brands/${brandId}/uploads/images/${Date.now()}_${i + 1}_${baseName}`;
    const thumbnailKey = cdnBase ? seedKeyForImage(thumbW, thumbH, i + 1) : undefined;
    return {
      brandId,
      uploadedBy,
      fileName: baseName,
      s3Key,
      s3Bucket: process.env.ASSETS_S3_BUCKET || 'postolio-assets-dev-storage',
      fileSize: Math.floor(400_000 + Math.random() * 1_200_000),
      mimeType: 'image/jpeg',
      fileType: 'image' as const,
      width: imgW,
      height: imgH,
      duration: null,
      title: `Seed Image ${i + 1}`,
      altText: `Seed image ${i + 1}`,
      description: 'Seeded asset for local development',
      tags: ['seed', 'demo'],
      folderId: i % 2 === 0 ? brandFolder.id : general.id,
      processingStatus: 'completed' as const,
      thumbnailKey,
      thumbnailSmallKey: undefined,
      thumbnailLargeKey: undefined,
    };
  });

  const created = await prisma.asset.createMany({ data: assets });
  console.log(`✅ Seeded ${created.count} assets`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const prisma = new PrismaClient({
        datasources: { db: { url: process.env.ASSETS_DATABASE_URL } },
      });
      await prisma.$disconnect();
    } catch {}
  });
