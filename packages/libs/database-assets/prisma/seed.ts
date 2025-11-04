import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient as AssetsPrismaClient } from '../assets-client/index.js';

type Args = {
  brandId: string;
  count: number;
  uploadedBy: string;
  cdnBase?: string;
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
  const uploadedBy = args.uploadedBy || 'seed-user';
  const cdnBase = args.cdnBase;

  console.log(`==> Seeding ${count} assets for brand ${brandId}`);

  const prisma = new AssetsPrismaClient({
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

  const assets = Array.from({ length: count }).map((_, i) => {
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

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
