import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { ensureDatabaseSchema } from '../src/config/database-setup.js';
import { getDatabaseClient, disconnectDatabase } from '../src/config/database.js';
import type { ContentStatus, Campaign, CampaignStatus } from '@postolio/database';

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

  // Helper for date formatting to yyyy-MM-dd
  const pad = (n: number) => String(n).padStart(2, '0');
  const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Utility helpers
  const days = (n: number) => 24 * 60 * 60 * 1000 * n;
  const hours = (n: number) => 60 * 60 * 1000 * n;

  // Create several campaigns covering all statuses and varied configs
  console.log('==> Creating demo campaigns with varied statuses and configs');
  const now = new Date();

  type SeedCampaignSpec = {
    name: string;
    status: CampaignStatus;
    start: Date;
    end: Date;
    postingTime?: string;
    postingTimes?: string[];
    frequency: 'daily' | 'every2days' | '3weekly';
    themes: string[];
    style: string;
    goals: string[];
    seasonalityAssist?: boolean;
    color?: string;
    campaignType?: 'promotional' | 'educational' | 'seasonal' | 'thought_leadership' | 'custom';
    withError?: string | null;
    previewGenerated?: boolean;
    startedAt?: Date | null;
    completedAt?: Date | null;
  };

  const campaignSpecs: SeedCampaignSpec[] = [
    {
      name: 'Onboarding Preview',
      status: 'preview',
      start: now,
      end: new Date(now.getTime() + days(14)),
      postingTime: '12:00',
      frequency: 'daily',
      themes: ['announcements', 'education', 'behind_the_scenes'],
      style: 'informative',
      goals: ['increase engagement', 'grow followers'],
      seasonalityAssist: true,
      color: '#6B7280',
      campaignType: 'custom',
      previewGenerated: true,
      startedAt: null,
    },
    {
      name: 'Launch Momentum',
      status: 'active',
      start: new Date(now.getTime() - days(7)),
      end: new Date(now.getTime() + days(14)),
      postingTimes: ['09:00', '18:00'],
      frequency: 'every2days',
      themes: ['product', 'benefits', 'testimonials', 'social_proof'],
      style: 'persuasive',
      goals: ['drive signups', 'improve conversion'],
      seasonalityAssist: false,
      color: '#10B981',
      campaignType: 'promotional',
      previewGenerated: true,
      startedAt: new Date(now.getTime() - days(7)),
    },
    {
      name: 'Evergreen Education',
      status: 'paused',
      start: new Date(now.getTime() - days(14)),
      end: new Date(now.getTime() + days(21)),
      postingTime: '10:30',
      frequency: '3weekly',
      themes: ['tips', 'how_to', 'faq', 'best_practices'],
      style: 'educational',
      goals: ['improve retention', 'reduce support load'],
      seasonalityAssist: true,
      color: '#F59E0B',
      campaignType: 'educational',
      previewGenerated: true,
      startedAt: new Date(now.getTime() - days(14)),
    },
    {
      name: 'Winter Seasonal',
      status: 'completed',
      start: new Date(now.getTime() - days(60)),
      end: new Date(now.getTime() - days(7)),
      postingTimes: ['08:00', '13:00', '20:00'],
      frequency: 'daily',
      themes: ['winter', 'holiday', 'gift_guides'],
      style: 'festive',
      goals: ['holiday sales', 'brand awareness'],
      seasonalityAssist: true,
      color: '#60A5FA',
      campaignType: 'seasonal',
      previewGenerated: true,
      startedAt: new Date(now.getTime() - days(60)),
      completedAt: new Date(now.getTime() - days(5)),
    },
    {
      name: 'Thought Leadership Sprint',
      status: 'creating',
      start: new Date(now.getTime() + days(2)),
      end: new Date(now.getTime() + days(32)),
      postingTime: '15:00',
      frequency: 'every2days',
      themes: ['vision', 'industry_trends', 'behind_the_scenes'],
      style: 'insightful',
      goals: ['build authority'],
      seasonalityAssist: false,
      color: '#8B5CF6',
      campaignType: 'thought_leadership',
      previewGenerated: false,
      startedAt: null,
    },
    {
      name: 'Experimental Ideas',
      status: 'failed',
      start: now,
      end: new Date(now.getTime() + days(7)),
      postingTime: '11:00',
      frequency: 'daily',
      themes: ['experiments', 'polls'],
      style: 'playful',
      goals: ['discover new angles'],
      seasonalityAssist: false,
      color: '#EF4444',
      campaignType: 'custom',
      previewGenerated: false,
      startedAt: now,
      withError: 'LLM generation quota exceeded',
    },
    {
      name: 'Batch Processing Queue',
      status: 'processing',
      start: new Date(now.getTime() + days(1)),
      end: new Date(now.getTime() + days(21)),
      postingTimes: ['07:00', '12:00', '19:00'],
      frequency: '3weekly',
      themes: ['community', 'highlights', 'roundups'],
      style: 'curated',
      goals: ['community engagement'],
      seasonalityAssist: true,
      color: '#34D399',
      campaignType: 'custom',
      previewGenerated: false,
      startedAt: null,
    },
  ];

  const createdCampaigns: Campaign[] = [];
  for (const spec of campaignSpecs) {
    const start = spec.start;
    const end = spec.end;

    const created = await prisma.campaign.create({
      data: {
        name: spec.name,
        brandId: brand.id,
        status: spec.status,
        priority: 5,
        color: spec.color,
        campaignType: spec.campaignType || 'custom',
        previewGenerated: Boolean(spec.previewGenerated),
        errorMessage: spec.withError || null,
        startedAt: spec.startedAt || null,
        completedAt: spec.completedAt || null,
        lastModifiedById: user.id,
        config: {
          duration: { start: toYMD(start), end: toYMD(end) },
          frequency: spec.frequency,
          // Prefer explicit postingTimes when provided, otherwise fallback to single postingTime
          ...(spec.postingTimes ? { postingTimes: spec.postingTimes } : {}),
          ...(spec.postingTime ? { postingTime: spec.postingTime } : {}),
          themes: spec.themes,
          style: spec.style,
          goals: spec.goals,
          seasonalityAssist: spec.seasonalityAssist ?? true,
        } as any,
        contentPillars: spec.themes.slice(0, 3),
        urgencyTactics: ['limited_time', 'social_proof'],
        seasonalContext: spec.campaignType === 'seasonal' ? { season: 'winter' } : null,
      },
    });
    createdCampaigns.push(created);
  }

  // Generate a richer set of content covering all statuses across campaigns
  console.log('==> Generating content across all statuses (campaign-associated)');
  const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = <T>(arr: T[]) => arr[rng(0, arr.length - 1)];

  const baseHashtags = ['#postolio', '#dev', '#demo', '#socialmedia', '#content'];
  const imageRegions = ['US', 'EU', 'UK'];

  const campaignContentPayload: Parameters<typeof prisma.content.createMany>[0]['data'] = [];

  function pushContent(opts: {
    campaign: Campaign;
    status: ContentStatus;
    caption: string;
    when: 'past' | 'future' | 'now';
    themeHint?: string;
    schedulingError?: string | null;
    withImage?: boolean;
  }) {
    const { campaign, status, caption, when, themeHint, schedulingError, withImage } = opts;
    const baseTime =
      when === 'past'
        ? new Date(now.getTime() - days(rng(1, 21)))
        : when === 'future'
          ? new Date(now.getTime() + days(rng(1, 21)))
          : now;

    let scheduledAt: Date | null = null;
    let postedAt: Date | null = null;
    let err: string | null = null;

    if (status === 'published') {
      postedAt = new Date(baseTime.getTime() - hours(rng(1, 6)));
      scheduledAt = new Date(postedAt.getTime() - hours(rng(12, 36)));
    } else if (status === 'scheduled') {
      scheduledAt = new Date(baseTime.getTime() + hours(rng(2, 12)));
    } else if (status === 'failed') {
      scheduledAt = new Date(baseTime.getTime() - hours(rng(2, 12)));
      err = schedulingError || 'Failed to publish: API error rate limit';
    } else if (status === 'skipped') {
      scheduledAt = new Date(baseTime.getTime() - hours(rng(2, 12)));
    }

    const s3 = withImage
      ? {
          s3ImageKey: `images/${toYMD(baseTime)}/${brand.id}/${campaign.id}-${Math.random().toString(36).slice(2, 7)}.jpg`,
          imageRegion: pick(imageRegions),
          retentionExpiresAt: new Date(baseTime.getTime() + days(90)),
        }
      : {
          s3ImageKey: null as string | null,
          imageRegion: null as string | null,
          retentionExpiresAt: null as Date | null,
        };

    campaignContentPayload.push({
      brandId: brand.id,
      campaignId: campaign.id,
      caption,
      hashtags: [
        pick(baseHashtags),
        pick(baseHashtags),
        `#${(themeHint || 'theme').replace(/\s+/g, '_')}`,
      ],
      status,
      scheduledAt,
      postedAt,
      instagramPermalink:
        status === 'published'
          ? `https://instagram.com/p/${Math.random().toString(36).slice(2, 10)}`
          : null,
      instagramPostId:
        status === 'published' ? `IG_${Math.random().toString(36).slice(2, 12)}` : null,
      analytics:
        status === 'published'
          ? { likes: rng(10, 500), comments: rng(0, 50), shares: rng(0, 20), reach: rng(500, 5000) }
          : null,
      schedulingError: err,
      ...s3,
    });
  }

  for (const camp of createdCampaigns) {
    const cfg = camp.config as unknown as {
      themes?: string[];
    } | null;
    const themes =
      Array.isArray(cfg?.themes) && cfg?.themes?.length ? (cfg!.themes as string[]) : ['general'];

    // Ensure every campaign gets a mix; fine-tune by status for realism
    switch (camp.status) {
      case 'active':
        for (let i = 0; i < 5; i++)
          pushContent({
            campaign: camp,
            status: 'published',
            caption: `Published highlight ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            withImage: true,
          });
        for (let i = 0; i < 3; i++)
          pushContent({
            campaign: camp,
            status: 'scheduled',
            caption: `Scheduled teaser ${i + 1}`,
            when: 'future',
            themeHint: themes[i % themes.length],
            withImage: true,
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'failed',
            caption: `Failed post ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            schedulingError: 'Timeout posting to Instagram',
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Draft idea ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        break;
      case 'paused':
        for (let i = 0; i < 4; i++)
          pushContent({
            campaign: camp,
            status: 'skipped',
            caption: `Skipped during pause ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            withImage: false,
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'scheduled',
            caption: `Still scheduled ${i + 1}`,
            when: 'future',
            themeHint: themes[i % themes.length],
            withImage: true,
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Paused draft ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        break;
      case 'completed':
        for (let i = 0; i < 6; i++)
          pushContent({
            campaign: camp,
            status: 'published',
            caption: `Completed showcase ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            withImage: true,
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'failed',
            caption: `Completed failed ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            schedulingError: 'Policy violation',
          });
        break;
      case 'preview':
        for (let i = 0; i < 4; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Preview draft ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        break;
      case 'creating':
        for (let i = 0; i < 3; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Creating draft ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'scheduled',
            caption: `Creating scheduled ${i + 1}`,
            when: 'future',
            themeHint: themes[i % themes.length],
          });
        break;
      case 'failed':
        for (let i = 0; i < 3; i++)
          pushContent({
            campaign: camp,
            status: 'failed',
            caption: `Campaign failed post ${i + 1}`,
            when: 'past',
            themeHint: themes[i % themes.length],
            schedulingError: 'Content moderation rejected',
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Recovery draft ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        break;
      case 'processing':
        for (let i = 0; i < 3; i++)
          pushContent({
            campaign: camp,
            status: 'scheduled',
            caption: `Pipeline scheduled ${i + 1}`,
            when: 'future',
            themeHint: themes[i % themes.length],
            withImage: true,
          });
        for (let i = 0; i < 2; i++)
          pushContent({
            campaign: camp,
            status: 'draft',
            caption: `Pipeline draft ${i + 1}`,
            when: 'now',
            themeHint: themes[i % themes.length],
          });
        break;
    }
  }

  if (campaignContentPayload.length > 0) {
    await prisma.content.createMany({ data: campaignContentPayload });
  }

  // Keep the original brand-only content generation (draft/scheduled),
  // and add a few extra brand-level posts to cover all statuses.
  console.log(`==> Creating ${posts} brand-only content items (draft/scheduled)`);
  const contentPayload: Array<{
    brandId: string;
    caption: string;
    hashtags: string[];
    status: ContentStatus;
    scheduledAt?: Date | null;
    s3ImageKey?: string | null;
    campaignId?: string | null;
    postedAt?: Date | null;
    schedulingError?: string | null;
    instagramPermalink?: string | null;
    instagramPostId?: string | null;
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
      campaignId: null,
    });
  }

  // Extra brand-level coverage for published/failed/skipped
  const brandCoverage: typeof contentPayload = [
    {
      brandId: brand.id,
      caption: 'Brand-only published example',
      hashtags: ['#postolio', '#published'],
      status: 'published',
      scheduledAt: new Date(Date.now() - days(3)),
      postedAt: new Date(Date.now() - days(2)),
      instagramPermalink: `https://instagram.com/p/${Math.random().toString(36).slice(2, 10)}`,
      instagramPostId: `IG_${Math.random().toString(36).slice(2, 12)}`,
      s3ImageKey: null,
      campaignId: null,
    },
    {
      brandId: brand.id,
      caption: 'Brand-only failed example',
      hashtags: ['#postolio', '#failed'],
      status: 'failed',
      scheduledAt: new Date(Date.now() - days(1)),
      postedAt: null,
      schedulingError: 'Network error while posting',
      s3ImageKey: null,
      campaignId: null,
    },
    {
      brandId: brand.id,
      caption: 'Brand-only skipped example',
      hashtags: ['#postolio', '#skipped'],
      status: 'skipped',
      scheduledAt: new Date(Date.now() - days(2)),
      postedAt: null,
      s3ImageKey: null,
      campaignId: null,
    },
  ];

  await prisma.content.createMany({ data: contentPayload.concat(brandCoverage) });

  console.log('\n✅ Seed complete');
  console.log('--- Credentials ---');
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('-------------------');
  console.log(`User ID:  ${user.id}`);
  console.log(`Brand ID: ${brand.id}`);
  console.log('==> Campaigns created:');
  for (const c of createdCampaigns) {
    console.log(` - ${c.name} (${c.status}) -> ${c.id}`);
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined);
  });
