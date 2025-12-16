import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { ensureDatabaseSchema } from '../src/config/database-setup.js';
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
    const token = process.argv[i];

    if (token === '--' || !token.startsWith('--')) {
      continue;
    }

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

  console.log('==> Ensuring database schema…');
  await ensureDatabaseSchema({ generateClient: true });

  // Generate Prisma client and sync DB before importing Prisma-dependent modules
  // This avoids stale @prisma/client after migrations drop/add columns
  const { getDatabaseClient, disconnectDatabase } = await import('../src/config/database.js');
  const prisma = getDatabaseClient();

  console.log(`==> Creating primary dev user ${email}`);
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
        // Seed as the lowest tier so dev flows exercise realistic limits
        // (schedule-ahead capped at ~10 posts instead of paid limits).
        subscriptionTier: 'free',
        timezone: 'UTC',
        timezoneAutoDetected: true,
      },
    }));

  // Secondary dev user for onboarding flow testing (no brands, no social accounts)
  const onboardingTestEmail = 'dev001@postolio.test';
  console.log(`==> Ensuring onboarding test user ${onboardingTestEmail} exists (no brands)`);
  const existingOnboardingUser = await prisma.user.findUnique({
    where: { email: onboardingTestEmail },
  });
  if (!existingOnboardingUser) {
    await prisma.user.create({
      data: {
        email: onboardingTestEmail,
        password: await bcrypt.hash(password, 10),
        name: 'Onboarding Test User',
        subscriptionTier: 'free',
        timezone: 'UTC',
        timezoneAutoDetected: true,
      },
    });
  } else {
    console.log('Onboarding test user already exists; leaving as-is to preserve local state.');
  }

  console.log(`==> Creating brand "${brandName}" for user ${user.id}`);

  // Generate realistic Instagram profile data
  const instagramHandle = brandName.toLowerCase().replace(/\s+/g, '_') + '_official';
  const instagramAccountId = `IG_${Math.random().toString(36).slice(2, 15)}`;
  const instagramPageId = `FB_${Math.random().toString(36).slice(2, 15)}`;

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
  const notificationTypes: Array<{ title: string; body: string; type: string; category: string }> =
    [
      {
        title: 'Welcome to Postolio',
        body: 'Start by creating your first campaign or importing content.',
        type: 'system.welcome',
        category: 'system',
      },
      {
        title: 'AI drafts ready',
        body: 'Your AI-generated drafts are ready for review.',
        type: 'content.draft_ready',
        category: 'publishing',
      },
      {
        title: 'Campaign scheduled',
        body: 'Launch Momentum is scheduled with 12 posts this week.',
        type: 'campaign.scheduled',
        category: 'publishing',
      },
      {
        title: 'Instagram connection missing',
        body: 'Connect Instagram to unlock reach and engagement forecasts.',
        type: 'accounts.missing_connection',
        category: 'accounts',
      },
      {
        title: 'Best time to post updated',
        body: 'We recalculated your posting windows based on recent performance.',
        type: 'analytics.best_time_updated',
        category: 'analytics',
      },
    ];

  // Create SocialAccount for Instagram
  const seededFollowers = Math.floor(Math.random() * 10000) + 1000;
  const seededTotalAudience = Math.max(
    500,
    Math.round(seededFollowers * (0.85 + Math.random() * 0.25))
  );
  const seededUpdatedAt = new Date().toISOString();
  const seededGender = [
    { gender: 'F', value: Math.round(seededTotalAudience * 0.55) },
    { gender: 'M', value: Math.round(seededTotalAudience * 0.43) },
    {
      gender: 'U',
      value: Math.max(
        0,
        seededTotalAudience -
          Math.round(seededTotalAudience * 0.55) -
          Math.round(seededTotalAudience * 0.43)
      ),
    },
  ];

  const seededAgeBuckets = [
    { range: '13-17', share: 0.04 },
    { range: '18-24', share: 0.22 },
    { range: '25-34', share: 0.31 },
    { range: '35-44', share: 0.2 },
    { range: '45-54', share: 0.13 },
    { range: '55-64', share: 0.07 },
    { range: '65+', share: 0.03 },
  ];
  const seededAge = seededAgeBuckets.map((b) => ({
    range: b.range,
    value: Math.round(seededTotalAudience * b.share),
  }));

  const seededCountries = [
    { code: 'US', value: Math.round(seededTotalAudience * 0.34) },
    { code: 'GB', value: Math.round(seededTotalAudience * 0.11) },
    { code: 'CA', value: Math.round(seededTotalAudience * 0.09) },
    { code: 'AU', value: Math.round(seededTotalAudience * 0.07) },
    { code: 'DE', value: Math.round(seededTotalAudience * 0.06) },
    { code: 'FR', value: Math.round(seededTotalAudience * 0.05) },
    { code: 'NL', value: Math.round(seededTotalAudience * 0.04) },
    { code: 'ES', value: Math.round(seededTotalAudience * 0.04) },
    { code: 'IT', value: Math.round(seededTotalAudience * 0.03) },
    { code: 'BR', value: Math.round(seededTotalAudience * 0.03) },
  ].filter((c) => c.value > 0);

  const seededCities = [
    { name: 'New York', value: Math.round(seededTotalAudience * 0.05) },
    { name: 'Los Angeles', value: Math.round(seededTotalAudience * 0.04) },
    { name: 'London', value: Math.round(seededTotalAudience * 0.035) },
    { name: 'Toronto', value: Math.round(seededTotalAudience * 0.03) },
    { name: 'Sydney', value: Math.round(seededTotalAudience * 0.025) },
    { name: 'Berlin', value: Math.round(seededTotalAudience * 0.02) },
    { name: 'Paris', value: Math.round(seededTotalAudience * 0.02) },
    { name: 'Amsterdam', value: Math.round(seededTotalAudience * 0.015) },
  ].filter((c) => c.value > 0);

  const seededLocales = [
    { locale: 'en_US', value: Math.round(seededTotalAudience * 0.38) },
    { locale: 'en_GB', value: Math.round(seededTotalAudience * 0.12) },
    { locale: 'en_CA', value: Math.round(seededTotalAudience * 0.08) },
    { locale: 'en_AU', value: Math.round(seededTotalAudience * 0.06) },
    { locale: 'de_DE', value: Math.round(seededTotalAudience * 0.06) },
    { locale: 'fr_FR', value: Math.round(seededTotalAudience * 0.05) },
    { locale: 'es_ES', value: Math.round(seededTotalAudience * 0.05) },
  ].filter((l) => l.value > 0);

  const instagramSocialAccount = await prisma.socialAccount.create({
    data: {
      brandId: brand.id,
      platform: 'instagram',
      externalAccountId: instagramAccountId,
      externalPageId: instagramPageId,
      username: instagramHandle,
      displayName: brandName,
      metadata: {
        account_type: 'BUSINESS',
        followers_count: seededFollowers,
        biography: `Official account for ${brandName}. Sharing amazing content daily! 🚀`,
        website: `https://${brandName.toLowerCase().replace(/\s+/g, '')}.com`,
        profile_picture_url: `https://i.pravatar.cc/150?u=${instagramAccountId}`,
        audienceDemographics: {
          totalAudience: seededTotalAudience,
          updatedAt: seededUpdatedAt,
          gender: seededGender,
          age: seededAge,
          countries: seededCountries,
          cities: seededCities,
          locales: seededLocales,
        },
      },
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

  const POST_SEED_IMAGE_BASE = process.env.POST_SEED_IMAGE_BASE
    ? process.env.POST_SEED_IMAGE_BASE.replace(/\/$/, '')
    : 'https://picsum.photos';

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

  console.log('==> Seeding notifications');
  const notifications = await prisma.notification.createMany({
    data: notificationTypes.map((n, idx) => ({
      userId: user.id,
      brandId: brand.id,
      type: n.type,
      category: n.category,
      severity: 'info',
      title: n.title,
      body: n.body,
      linkUrl: 'https://postolio.example/notifications',
      createdAt: new Date(Date.now() - idx * hours(6)),
    })),
  });
  console.log(`Seeded ${notifications.count} notifications`);

  // Generate a richer set of content covering all statuses across campaigns
  console.log('==> Generating content across all statuses (campaign-associated)');
  const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = <T>(arr: T[]) => arr[rng(0, arr.length - 1)];

  const baseHashtags = ['#postolio', '#dev', '#demo', '#socialmedia', '#content'];
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
    const { campaign, status, caption, when, themeHint, schedulingError } = opts;
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
      schedulingError: err,
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

  // Normalize statuses so there are no nonsensical cases (e.g., scheduled in the past)
  const normalizeStatuses = (items: any[]) => {
    const nowTs = Date.now();
    const pick = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
    return items.map((it) => {
      if (
        it?.status === 'scheduled' &&
        it?.scheduledAt &&
        new Date(it.scheduledAt).getTime() < nowTs
      ) {
        const newStatus = pick(['published', 'failed', 'skipped']);
        it.status = newStatus;
        if (newStatus === 'published') {
          const postTs = new Date(it.scheduledAt).getTime() + hours(1);
          it.postedAt = new Date(postTs);
          // Publications and metrics are created by ingestion or publishing flows.
        } else if (newStatus === 'failed') {
          it.schedulingError = it.schedulingError || 'Auto-adjusted: failed to post in time';
          it.postedAt = null;
        } else {
          // skipped
          it.postedAt = null;
        }
      }
      return it;
    });
  };

  if (campaignContentPayload.length > 0) {
    await prisma.content.createMany({ data: normalizeStatuses(campaignContentPayload) });
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
    campaignId?: string | null;
    postedAt?: Date | null;
    schedulingError?: string | null;
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
      campaignId: null,
    },
    {
      brandId: brand.id,
      caption: 'Brand-only skipped example',
      hashtags: ['#postolio', '#skipped'],
      status: 'skipped',
      scheduledAt: new Date(Date.now() - days(2)),
      postedAt: null,
      campaignId: null,
    },
  ];

  await prisma.content.createMany({
    data: normalizeStatuses(contentPayload.concat(brandCoverage)),
  });

  // Attach publications + mock comments using the created SocialAccount
  console.log('==> Creating SocialAccount, publications, comments, and saved replies');
  const social = instagramSocialAccount;

  // Pick a few published posts and create publications + comments
  const published = await prisma.content.findMany({
    where: { brandId: brand.id, status: 'published' },
    orderBy: { postedAt: 'desc' },
    take: 3,
    select: { id: true, postedAt: true },
  });
  for (let i = 0; i < published.length; i++) {
    const c = published[i];
    const externalPostId = `IGPOST_${randomSuffix()}_${i + 1}`;
    const pub = await prisma.contentPublication.upsert({
      where: {
        socialAccountId_externalPostId: {
          socialAccountId: social.id,
          externalPostId,
        },
      },
      update: { contentId: c.id, permalink: `https://instagram.com/p/${externalPostId}` },
      create: {
        contentId: c.id,
        socialAccountId: social.id,
        platform: 'instagram',
        externalPostId,
        externalThreadRootId: null,
        externalAccountId: social.externalAccountId,
        externalPageId: social.externalPageId || undefined,
        permalink: `https://instagram.com/p/${externalPostId}`,
        publishedAt: c.postedAt || new Date(),
        status: 'published',
      },
    });

    // Seed a few comments with varied workflow states
    await prisma.publicationComment.createMany({
      data: [
        {
          publicationId: pub.id,
          platform: 'instagram',
          externalCommentId: `${externalPostId}_c1`,
          authorUsername: 'eco.clean.marine',
          text: 'Style meets purpose 💚🌍',
          likeCount: 3,
          status: 'open',
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
        },
        {
          publicationId: pub.id,
          platform: 'instagram',
          externalCommentId: `${externalPostId}_c2`,
          authorUsername: 'sustainably_yours',
          text: 'Eco chic vibes! ✨',
          likeCount: 1,
          status: 'resolved',
          createdAt: new Date(Date.now() - 45 * 60 * 1000),
        },
        {
          publicationId: pub.id,
          platform: 'instagram',
          externalCommentId: `${externalPostId}_c3`,
          authorUsername: 'green.consumer',
          text: 'How much is the set and do you ship to EU?',
          likeCount: 0,
          // Snooze removed; seed as archived to simulate triaged activity
          status: 'archived',
          createdAt: new Date(Date.now() - 30 * 60 * 1000),
        },
      ],
    });
  }

  // Saved replies
  await prisma.savedReply.createMany({
    data: [
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Thanks!',
        body: 'Thanks so much for the love! 🙌',
        isDefault: true,
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Shipping Info',
        body: 'We ship worldwide. Standard delivery is 5–7 business days. 🌍',
        isDefault: false,
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Pricing',
        body: 'Our sets start at $49. Tap the link in bio for details.',
        isDefault: false,
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Support',
        body: 'Sorry about that! Can you DM us your order number so we can help?',
        isDefault: false,
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Collab',
        body: 'Thanks for reaching out! Please email collabs@brand.com 💌',
        isDefault: false,
      },
    ],
    skipDuplicates: true,
  });

  // DM Conversations and Messages for DM Inbox testing
  console.log('==> Creating DM conversations and messages');

  // Helper to create conversations with messages
  async function createConversation(opts: {
    username: string;
    state: 'active' | 'archived' | 'spam';
    messagesCount: number;
    lastMessageDaysAgo: number;
  }) {
    const { username, state, messagesCount, lastMessageDaysAgo } = opts;
    const instagramUserId = `IG_USER_${Math.random().toString(36).slice(2, 15)}`;

    const conversation = await prisma.dMConversation.create({
      data: {
        brandId: brand.id,
        instagramUserId,
        instagramUsername: username,
        state,
        lastMessageAt: new Date(now.getTime() - days(lastMessageDaysAgo)),
      },
    });

    // Create messages for this conversation
    const messages: Array<{
      conversationId: string;
      direction: 'inbound' | 'outbound';
      messageText: string;
      externalMessageId: string;
      status: 'sent' | 'delivered' | 'read' | 'failed';
      sentAt: Date | null;
      createdAt: Date;
    }> = [];

    // Generate realistic message thread
    const messageTemplates = {
      inbound: [
        'Hey! I love your content! 😍',
        'Can you tell me more about your products?',
        'Do you ship internationally?',
        'What are your best sellers?',
        'Thanks for the info!',
        'I have a question about my order',
        'Is this still available?',
        'When will you restock?',
      ],
      outbound: [
        'Thanks so much for reaching out! 🙌',
        'Absolutely! We ship worldwide. Standard delivery is 5-7 business days.',
        'Our best sellers are definitely the starter kits!',
        'Yes, that item is in stock right now!',
        'Happy to help! What can I assist you with?',
        'Let me check that for you...',
        'Great question! Here are the details...',
        'We appreciate your interest! 💚',
      ],
    };

    for (let i = 0; i < messagesCount; i++) {
      const isInbound = i % 2 === 0; // Alternate between inbound and outbound
      const messageAge = lastMessageDaysAgo + (messagesCount - i - 1) * 0.5; // Space messages out
      const messageTime = new Date(now.getTime() - days(messageAge));

      const templates = isInbound ? messageTemplates.inbound : messageTemplates.outbound;
      const text = templates[i % templates.length];

      messages.push({
        conversationId: conversation.id,
        direction: isInbound ? 'inbound' : 'outbound',
        messageText: text,
        externalMessageId: `IG_MSG_${Math.random().toString(36).slice(2, 15)}`,
        status: isInbound ? 'read' : i === messagesCount - 1 ? 'delivered' : 'read',
        sentAt: isInbound ? null : messageTime,
        createdAt: messageTime,
      });
    }

    await prisma.dMMessage.createMany({ data: messages });
    return conversation;
  }

  // Create active conversations (most recent)
  await createConversation({
    username: 'sarah_wellness',
    state: 'active',
    messagesCount: 6,
    lastMessageDaysAgo: 0.5, // 12 hours ago
  });

  await createConversation({
    username: 'eco_enthusiast',
    state: 'active',
    messagesCount: 4,
    lastMessageDaysAgo: 1, // 1 day ago
  });

  await createConversation({
    username: 'fitness_journey_2024',
    state: 'active',
    messagesCount: 8,
    lastMessageDaysAgo: 2,
  });

  await createConversation({
    username: 'small_biz_owner',
    state: 'active',
    messagesCount: 3,
    lastMessageDaysAgo: 3,
  });

  // Create archived conversations
  await createConversation({
    username: 'happy_customer_123',
    state: 'archived',
    messagesCount: 5,
    lastMessageDaysAgo: 7,
  });

  await createConversation({
    username: 'question_asker',
    state: 'archived',
    messagesCount: 4,
    lastMessageDaysAgo: 14,
  });

  // Create spam conversations
  await createConversation({
    username: 'suspicious_account',
    state: 'spam',
    messagesCount: 2,
    lastMessageDaysAgo: 5,
  });

  await createConversation({
    username: 'bot_account_xyz',
    state: 'spam',
    messagesCount: 1,
    lastMessageDaysAgo: 10,
  });

  console.log('✅ Created 8 DM conversations with messages (4 active, 2 archived, 2 spam)');

  // Generate additional historical published content for analytics (60-90 days)
  console.log('==> Generating historical published content for analytics');
  const historicalContent: typeof contentPayload = [];
  const historicalDays = 90;
  const postsPerWeek = 3; // Realistic posting frequency
  const totalHistoricalPosts = Math.floor((historicalDays / 7) * postsPerWeek);

  const themes = [
    'lifestyle',
    'product',
    'tips',
    'behind_the_scenes',
    'testimonial',
    'announcement',
  ];
  const captionTemplates = [
    'Check out our latest update! 🚀',
    'Here are some tips for getting the most out of your day 💡',
    'Behind the scenes look at our process 👀',
    'Customer success story: Amazing results! ⭐',
    'New feature alert! This changes everything 🎉',
    'Quick tutorial: How to maximize your productivity 📚',
    'Weekend inspiration for content creators 🌟',
    'Product spotlight: Features you need to know about 💎',
    'Community highlight: Thank you for your support! 🙏',
    'Industry insights and trends 📊',
  ];

  for (let i = 0; i < totalHistoricalPosts; i++) {
    const daysAgo = Math.floor(Math.random() * historicalDays) + 1;
    const publishedAt = new Date(now.getTime() - days(daysAgo));
    const scheduledAt = new Date(publishedAt.getTime() - hours(rng(12, 48)));

    const theme = pick(themes);
    const caption = pick(captionTemplates);

    historicalContent.push({
      brandId: brand.id,
      caption: `${caption} #${theme}`,
      hashtags: ['#postolio', '#socialmedia', `#${theme}`, '#content', '#marketing'],
      status: 'published',
      scheduledAt,
      postedAt: publishedAt,
      campaignId: null,
    });
  }

  await prisma.content.createMany({ data: historicalContent });
  console.log(
    `✅ Generated ${totalHistoricalPosts} historical posts spanning ${historicalDays} days`
  );

  // Generate analytics data for published content
  console.log('==> Generating analytics data for published content');
  const publishedContent = await prisma.content.findMany({
    where: {
      brandId: brand.id,
      status: 'published',
      postedAt: { not: null },
    },
  });

  console.log(`Found ${publishedContent.length} published posts to generate analytics for`);

  // Helper to generate realistic engagement metrics with variety
  const generateMetrics = (baseFollowers: number, daysAgo: number, postIndex: number) => {
    // Engagement tends to be higher on more recent posts
    const recencyBoost = Math.max(0.5, 1 - daysAgo / 90);

    // Create some exceptional posts (viral) and some underperformers
    let qualityFactor = 0.5 + Math.random() * 1.5;

    // 5% chance of viral post (10-20x normal engagement)
    if (Math.random() < 0.05) {
      qualityFactor *= 10 + Math.random() * 10;
    }
    // 10% chance of underperforming post (0.2-0.5x normal engagement)
    else if (Math.random() < 0.1) {
      qualityFactor *= 0.2 + Math.random() * 0.3;
    }

    // Time-of-day factor (posts at certain times perform better)
    const hour = postIndex % 24;
    const timeBoost =
      hour >= 8 && hour <= 10
        ? 1.3 // Morning peak
        : hour >= 18 && hour <= 20
          ? 1.4 // Evening peak
          : hour >= 12 && hour <= 14
            ? 1.2 // Lunch time
            : 0.8; // Off-peak

    // Calculate engagement based on followers
    const impressions = Math.floor(
      baseFollowers * (1.5 + Math.random() * 2) * qualityFactor * timeBoost
    );
    const reach = Math.floor(impressions * (0.7 + Math.random() * 0.25));
    const likes = Math.floor(reach * (0.03 + Math.random() * 0.07) * recencyBoost * qualityFactor);
    const comments = Math.floor(likes * (0.05 + Math.random() * 0.15));
    const saves = Math.floor(likes * (0.1 + Math.random() * 0.3));
    const shares = Math.floor(likes * (0.02 + Math.random() * 0.08));
    const engagement = likes + comments + saves + shares;
    const engagementRate = reach > 0 ? (engagement / reach) * 100 : 0;

    return {
      impressions,
      reach,
      likes,
      comments,
      saves,
      shares,
      engagement,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
      followers: baseFollowers,
    };
  };

  // Generate publications and metrics for each published content
  let baseFollowers = ((social.metadata as any)?.followers_count as number) || 5000;
  const followerGrowthPerDay = rng(10, 50); // Random daily growth

  // Aggregate account-level daily metrics for analytics v2 (Reach & Impressions Daily charts)
  const accountDailyMetrics: Record<string, { impressions: number; reach: number }> = {};

  for (let idx = 0; idx < publishedContent.length; idx++) {
    const content = publishedContent[idx];
    if (!content.postedAt) continue;

    const publishedAt = content.postedAt;
    const daysAgo = Math.floor((now.getTime() - publishedAt.getTime()) / (24 * 60 * 60 * 1000));

    // Followers were lower in the past
    const followersAtTime = Math.max(1000, baseFollowers - daysAgo * followerGrowthPerDay);

    // Generate metrics for this post (pass index for time-of-day variation)
    const metrics = generateMetrics(followersAtTime, daysAgo, idx);

    // Create publication record
    const externalPostId = `IG_${Math.random().toString(36).slice(2, 15)}`;
    const publication = await prisma.contentPublication.create({
      data: {
        content: {
          connect: { id: content.id },
        },
        socialAccount: {
          connect: { id: social.id },
        },
        platform: 'instagram',
        externalPostId,
        externalAccountId: social.externalAccountId,
        externalPageId: social.externalPageId || undefined,
        publishedAt,
        permalink: `https://instagram.com/p/${Math.random().toString(36).slice(2, 11)}`,
        status: 'published',
      },
    });

    // Create latest metrics snapshot
    await prisma.publicationMetricsLatest.create({
      data: {
        publicationId: publication.id,
        platform: 'instagram',
        impressions: metrics.impressions,
        reach: metrics.reach,
        likes: metrics.likes,
        comments: metrics.comments,
        saves: metrics.saves,
        shares: metrics.shares,
        videoViews: 0,
        engagement: metrics.engagement,
        engagementRate: metrics.engagementRate,
        lastUpdated: publishedAt,
      },
    });

    // Aggregate into account-level daily metrics map
    const dateKey = publishedAt.toISOString().split('T')[0];
    if (!accountDailyMetrics[dateKey]) {
      accountDailyMetrics[dateKey] = { impressions: 0, reach: 0 };
    }
    accountDailyMetrics[dateKey].impressions += metrics.impressions;
    accountDailyMetrics[dateKey].reach += metrics.reach;
  }

  console.log(`✅ Generated analytics data for ${publishedContent.length} posts`);

  // Create account-level daily samples for impressions and reach (used by Reach & Impressions Daily charts)
  if (Object.keys(accountDailyMetrics).length > 0) {
    console.log('==> Generating account-level daily samples for impressions and reach');
    const samplesData: Parameters<(typeof prisma.accountMetricSample)['createMany']>[0]['data'] =
      [];

    const dates = Object.keys(accountDailyMetrics).sort();
    let lastDayImpressions = 0;
    let lastDayReach = 0;

    for (const dateKey of dates) {
      const agg = accountDailyMetrics[dateKey];
      const asOf = new Date(`${dateKey}T00:00:00.000Z`);

      samplesData.push({
        socialAccountId: social.id,
        platform: 'instagram',
        metricName: 'impressions',
        value: agg.impressions,
        period: 'day',
        windowStart: asOf,
        windowEnd: asOf,
        asOf,
        raw: {},
      } as any);

      samplesData.push({
        socialAccountId: social.id,
        platform: 'instagram',
        metricName: 'reach',
        value: agg.reach,
        period: 'day',
        windowStart: asOf,
        windowEnd: asOf,
        asOf,
        raw: {},
      } as any);

      lastDayImpressions = agg.impressions;
      lastDayReach = agg.reach;
    }

    if (samplesData.length > 0) {
      await prisma.accountMetricSample.createMany({
        data: samplesData,
        skipDuplicates: true,
      });
      console.log(
        `✅ Seeded ${samplesData.length} account_metric_samples records for impressions & reach`
      );
    }

    // Best-effort: seed latest account metrics snapshot for follower/overview analytics
    try {
      await prisma.accountMetricsLatest.upsert({
        where: { socialAccountId: social.id },
        update: {
          platform: 'instagram',
          followers: baseFollowers,
          impressions: lastDayImpressions,
          reach: lastDayReach,
          profileViews: Math.floor(lastDayReach * 0.2),
          lastUpdated: new Date(),
        },
        create: {
          socialAccountId: social.id,
          platform: 'instagram',
          followers: baseFollowers,
          impressions: lastDayImpressions,
          reach: lastDayReach,
          profileViews: Math.floor(lastDayReach * 0.2),
          lastUpdated: new Date(),
        },
      });
      console.log('✅ Seeded account_metrics_latest snapshot for Instagram account');
    } catch (err) {
      console.warn('⚠️  Failed to seed account_metrics_latest (non-fatal):', err);
    }
  }

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
    try {
      const { disconnectDatabase } = await import('../src/config/database.js');
      await disconnectDatabase();
    } catch {
      // ignore
    }
  });
