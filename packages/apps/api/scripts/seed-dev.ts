import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { ensureDatabaseSchema } from '../src/config/database-setup.js';
import { getDatabaseClient, disconnectDatabase } from '../src/config/database.js';
import type { ContentStatus } from '@postolio/database';

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
    const arg = process.argv[i];
    const [k, vRaw] = arg.includes('=') ? arg.split('=') : [arg, process.argv[i + 1]];
    const v = vRaw as string | undefined;
    switch (k) {
      case '--email':
        if (v) out.email = v;
        break;
      case '--password':
        if (v) out.password = v;
        break;
      case '--name':
        if (v) out.name = v;
        break;
      case '--brand':
        if (v) out.brand = v;
        break;
      case '--posts':
        if (v) out.posts = Number(v);
        break;
      default:
        break;
    }
    if (!arg.includes('=')) i++; // skip value token for --k v style
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

  console.log('==> Ensuring database schema…');
  await ensureDatabaseSchema();

  const prisma = getDatabaseClient();

  console.log(`==> Creating user ${email}`);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('User already exists. Re-using existing user.');
  }

  const user =
    existing ||
    (await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(password, 10),
        name,
        subscriptionTier: 'premium',
        timezone: 'UTC',
        timezoneAutoDetected: true,
      },
    }));

  console.log(`==> Creating brand "${brandName}" for user ${user.id}`);
  const brand = await prisma.brand.create({
    data: {
      name: brandName,
      description: 'Seeded brand for local development',
      userId: user.id,
      preferences: {
        themes: ['lifestyle', 'product', 'behind_the_scenes'],
        postingTimes: ['09:00', '18:00'],
        hashtagStrategy: 'moderate',
      },
      postingTimezone: 'UTC',
    },
  });

  console.log(`==> Creating ${posts} content items (mix of drafts and scheduled)`);
  const contentPayload: Array<{
    brandId: string;
    caption: string;
    hashtags: string[];
    status: ContentStatus;
    scheduledAt?: Date | null;
    s3ImageKey?: string | null;
  }> = [];

  const scheduledCount = Math.min(3, posts);
  for (let i = 0; i < posts; i++) {
    const isScheduled = i < scheduledCount;
    const scheduledAt = isScheduled ? new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000) : null;
    contentPayload.push({
      brandId: brand.id,
      caption: `Seeded content ${i + 1}: tips and tricks #${i + 1}`,
      hashtags: ['#postolio', '#dev', '#demo'],
      status: isScheduled ? ('scheduled' as ContentStatus) : ('draft' as ContentStatus),
      scheduledAt,
      s3ImageKey: null,
    });
  }

  await prisma.content.createMany({ data: contentPayload });

  console.log('==> Creating a demo campaign');
  await prisma.campaign.create({
    data: {
      name: 'Demo Campaign',
      brandId: brand.id,
      status: 'active',
      priority: 5,
      config: {
        frequency: 'daily',
        durationDays: 7,
        topics: ['announcements', 'education'],
      },
    },
  });

  console.log('\n✅ Seed complete');
  console.log('--- Credentials ---');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('-------------------');
  console.log(`User ID:  ${user.id}`);
  console.log(`Brand ID: ${brand.id}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined);
  });
