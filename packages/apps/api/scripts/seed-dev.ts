import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { ensureDatabaseSchema } from '../src/config/database-setup.js';
import { getDatabaseClient } from '../src/config/database.js';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  // When running from packages/apps/api
  path.resolve(process.cwd(), '../../../.env'),
  // When running from deeper paths
  path.resolve(process.cwd(), '../../../../.env'),
];

for (const candidate of envCandidates) {
  if (!fs.existsSync(candidate)) continue;
  dotenv.config({ path: candidate, override: false });
}

type Args = {
  email: string;
  password: string;
  name: string;
  brand: string;
  posts: number;
};

function parseArgs(): Partial<Args> {
  const out: Partial<Args> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (token === '--' || !token.startsWith('--')) continue;

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
      case '--email':
        out.email = value;
        break;
      case '--password':
        out.password = value;
        break;
      case '--name':
        out.name = value;
        break;
      case '--brand':
        out.brand = value;
        break;
      case '--posts':
        out.posts = Number(value);
        break;
      default:
        break;
    }
  }
  return out;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function main() {
  const args = parseArgs();
  const email = args.email || `demo+${randomSuffix()}@example.com`;
  const password = args.password || 'Test123!@#';
  const name = args.name || 'Demo User';
  const brandName = args.brand || 'Demo Brand';
  const posts =
    Number.isFinite(args.posts) && (args.posts as number) > 0 ? (args.posts as number) : 10;

  await ensureDatabaseSchema();

  const prisma = getDatabaseClient();

  // Idempotent seed: delete the existing user (and cascading data) if present.
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await prisma.user.delete({ where: { email } });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      subscriptionTier: 'premium',
    },
  });

  const brand = await prisma.brand.create({
    data: {
      name: brandName,
      description: 'Seeded development brand',
      userId: user.id,
      postingTimezone: 'UTC',
      preferences: {
        themes: ['lifestyle', 'product'],
        postingTimes: ['09:00', '18:00'],
        hashtagStrategy: 'moderate',
      },
    },
  });

  const instagramAccount = await prisma.socialAccount.create({
    data: {
      brandId: brand.id,
      platform: 'instagram',
      externalAccountId: `IG_${Math.random().toString(36).slice(2, 14)}`,
      username:
        brandName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '')
          .slice(0, 24) || 'demo',
      displayName: brandName,
      metadata: {
        account_type: 'BUSINESS',
        followers_count: 5000,
        following_count: 200,
      },
      sortOrder: 0,
    },
  });

  const queue = await prisma.publishingQueue.create({
    data: {
      socialAccountId: instagramAccount.id,
      name: 'Default',
      isDefault: true,
      paused: false,
    },
  });

  // Default schedule slots: Mon/Wed/Fri at 09:00 local time.
  await prisma.publishingQueueSlot.createMany({
    data: [
      {
        queueId: queue.id,
        socialAccountId: instagramAccount.id,
        dayOfWeek: 1,
        localTime: '09:00',
        laneKey: 'post',
      },
      {
        queueId: queue.id,
        socialAccountId: instagramAccount.id,
        dayOfWeek: 3,
        localTime: '09:00',
        laneKey: 'post',
      },
      {
        queueId: queue.id,
        socialAccountId: instagramAccount.id,
        dayOfWeek: 5,
        localTime: '09:00',
        laneKey: 'post',
      },
    ],
    skipDuplicates: true,
  });

  const now = Date.now();
  const publishedCount = Math.min(3, posts);
  const scheduledCount = Math.min(3, Math.max(0, posts - publishedCount));
  const draftCount = Math.max(0, posts - publishedCount - scheduledCount);

  const contents: Array<{ id: string; status: string }> = [];

  for (let i = 0; i < publishedCount; i++) {
    const scheduledAt = new Date(now - (i + 2) * 24 * 60 * 60 * 1000);
    const postedAt = new Date(scheduledAt.getTime() + 60 * 60 * 1000);
    const content = await prisma.content.create({
      data: {
        brandId: brand.id,
        caption: `Seeded published post ${i + 1}`,
        hashtags: ['#postolio', '#demo'],
        status: 'published',
        scheduledAt,
        postedAt,
        contentType: 'post',
      },
    });
    contents.push({ id: content.id, status: 'published' });

    const pub = await prisma.contentPublication.create({
      data: {
        contentId: content.id,
        socialAccountId: instagramAccount.id,
        platform: 'instagram',
        externalPostId: `SEED_${content.id}`,
        externalAccountId: instagramAccount.externalAccountId,
        permalink: `https://instagram.com/p/seed-${content.id}`,
        publishedAt: postedAt,
        status: 'published',
        metadata: { seeded: true },
      },
    });

    await prisma.publicationMetricsLatest.create({
      data: {
        publicationId: pub.id,
        platform: 'instagram',
        impressions: 1200 + i * 250,
        reach: 900 + i * 200,
        likes: 80 + i * 15,
        comments: 6 + i * 2,
        saves: 10 + i * 3,
        shares: 3 + i * 1,
        videoViews: 0,
        engagement: 0,
        engagementRate: 0,
        lastUpdated: postedAt,
      },
    });
  }

  for (let i = 0; i < scheduledCount; i++) {
    const scheduledAt = new Date(now + (i + 1) * 24 * 60 * 60 * 1000);
    const content = await prisma.content.create({
      data: {
        brandId: brand.id,
        caption: `Seeded scheduled post ${i + 1}`,
        hashtags: ['#postolio', '#demo'],
        status: 'scheduled',
        scheduledAt,
        contentType: 'post',
      },
    });
    contents.push({ id: content.id, status: 'scheduled' });
  }

  for (let i = 0; i < draftCount; i++) {
    const content = await prisma.content.create({
      data: {
        brandId: brand.id,
        caption: `Seeded draft post ${i + 1}`,
        hashtags: ['#postolio', '#demo'],
        status: 'draft',
        contentType: 'post',
      },
    });
    contents.push({ id: content.id, status: 'draft' });
  }

  console.log('✅ Seed complete');
  console.log('--- Credentials ---');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('-------------------');
  console.log(`User ID:  ${user.id}`);
  console.log(`Brand ID: ${brand.id}`);
  console.log(`IG SA ID: ${instagramAccount.id}`);
  console.log(
    `Posts:    ${contents.length} (${publishedCount} published, ${scheduledCount} scheduled, ${draftCount} draft)`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Seed failed', err);
  process.exitCode = 1;
});
