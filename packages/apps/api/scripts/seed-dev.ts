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

  // Generate realistic Instagram profile data
  const instagramUsername = brandName.toLowerCase().replace(/\s+/g, '_') + '_official';
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
      // Instagram connection data
      instagramPageId,
      instagramAccountId,
      instagramProfileData: {
        id: instagramAccountId,
        username: instagramUsername,
        name: brandName,
        account_type: 'BUSINESS',
        media_count: Math.floor(Math.random() * 300) + 50,
        followers_count: Math.floor(Math.random() * 10000) + 1000,
        follows_count: Math.floor(Math.random() * 500) + 100,
        biography: `Official account for ${brandName}. Sharing amazing content daily! 🚀`,
        website: `https://${brandName.toLowerCase().replace(/\s+/g, '')}.com`,
        profile_picture_url: `https://i.pravatar.cc/150?u=${instagramAccountId}`,
      },
    },
  });

  // Create SocialAccount for Instagram
  const instagramSocialAccount = await prisma.socialAccount.create({
    data: {
      brandId: brand.id,
      platform: 'instagram',
      externalAccountId: instagramAccountId,
      externalPageId: instagramPageId,
      username: instagramUsername,
      displayName: brandName,
      metadata: {
        account_type: 'BUSINESS',
        followers_count: (brand.instagramProfileData as any)?.followers_count,
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

    const assetSeed = Math.random().toString(36).slice(2, 7);
    const assetData = withImage
      ? {
          primaryAssetId: `seed-${campaign.id}-${assetSeed}`,
          primaryAssetCdnUrl: `${POST_SEED_IMAGE_BASE}/1080/1080?random=${campaign.id}-${assetSeed}`,
          primaryAssetWidth: 1080,
          primaryAssetHeight: 1080,
        }
      : {
          primaryAssetId: null as string | null,
          primaryAssetCdnUrl: null as string | null,
          primaryAssetWidth: null as number | null,
          primaryAssetHeight: null as number | null,
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
      // publications will be created by normal app flows; legacy instagram fields removed
      schedulingError: err,
      ...assetData,
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
    primaryAssetId?: string | null;
    primaryAssetCdnUrl?: string | null;
    primaryAssetWidth?: number | null;
    primaryAssetHeight?: number | null;
    campaignId?: string | null;
    postedAt?: Date | null;
    schedulingError?: string | null;
    // legacy fields removed
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
      primaryAssetId: null,
      primaryAssetCdnUrl: null,
      primaryAssetWidth: null,
      primaryAssetHeight: null,
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
      // legacy fields removed
      primaryAssetId: null,
      primaryAssetCdnUrl: null,
      primaryAssetWidth: null,
      primaryAssetHeight: null,
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
      primaryAssetId: null,
      primaryAssetCdnUrl: null,
      primaryAssetWidth: null,
      primaryAssetHeight: null,
      campaignId: null,
    },
    {
      brandId: brand.id,
      caption: 'Brand-only skipped example',
      hashtags: ['#postolio', '#skipped'],
      status: 'skipped',
      scheduledAt: new Date(Date.now() - days(2)),
      postedAt: null,
      primaryAssetId: null,
      primaryAssetCdnUrl: null,
      primaryAssetWidth: null,
      primaryAssetHeight: null,
      campaignId: null,
    },
  ];

  await prisma.content.createMany({
    data: normalizeStatuses(contentPayload.concat(brandCoverage)),
  });

  // Create an Instagram SocialAccount for the brand and attach publications + mock comments
  console.log('==> Creating SocialAccount, publications, comments, and saved replies');
  const social = await prisma.socialAccount.upsert({
    where: {
      platform_externalAccountId: {
        platform: 'instagram',
        externalAccountId: brand.instagramAccountId || 'mock_ig',
      },
    },
    update: {
      brandId: brand.id,
      externalPageId: brand.instagramPageId || undefined,
      username: (brand.instagramProfileData as any)?.username || undefined,
      displayName: brand.name,
    },
    create: {
      brandId: brand.id,
      platform: 'instagram',
      externalAccountId: brand.instagramAccountId || 'mock_ig',
      externalPageId: brand.instagramPageId || undefined,
      username: (brand.instagramProfileData as any)?.username || undefined,
      displayName: brand.name,
    },
  });

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
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Shipping Info',
        body: 'We ship worldwide. Standard delivery is 5–7 business days. 🌍',
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Pricing',
        body: 'Our sets start at $49. Tap the link in bio for details.',
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Support',
        body: 'Sorry about that! Can you DM us your order number so we can help?',
      },
      {
        brandId: brand.id,
        userId: user.id,
        title: 'Collab',
        body: 'Thanks for reaching out! Please email collabs@brand.com 💌',
      },
    ],
    skipDuplicates: true,
  });

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

    const assetSeed = Math.random().toString(36).slice(2, 7);
    const theme = pick(themes);
    const caption = pick(captionTemplates);

    historicalContent.push({
      brandId: brand.id,
      caption: `${caption} #${theme}`,
      hashtags: ['#postolio', '#socialmedia', `#${theme}`, '#content', '#marketing'],
      status: 'published',
      scheduledAt,
      postedAt: publishedAt,
      primaryAssetId: `hist-${brand.id}-${assetSeed}`,
      primaryAssetCdnUrl: `${POST_SEED_IMAGE_BASE}/1080/1080?random=hist-${i}`,
      primaryAssetWidth: 1080,
      primaryAssetHeight: 1080,
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
  let baseFollowers = (brand.instagramProfileData as any)?.followers_count || 5000;
  const followerGrowthPerDay = rng(10, 50); // Random daily growth

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
  }

  console.log(`✅ Generated analytics data for ${publishedContent.length} posts`);

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
