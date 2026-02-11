import { getDatabaseClient } from '../config/database.js';
import { getAssetsClient } from './assets-media.js';

const prisma = getDatabaseClient();

export type DemoVariantId = 'default';

export interface SeedDemoWorkspaceOptions {
  brandId: string;
  userId: string;
  variantId?: DemoVariantId;
  /** When true, seed lightweight analytics and metrics to make dashboards feel alive. */
  includeAnalytics?: boolean;
}

// S3 prefix for demo assets; should match assets-api sync script.
const DEMO_ASSETS_PREFIX =
  process.env.DEMO_ASSETS_PREFIX && process.env.DEMO_ASSETS_PREFIX.trim().length > 0
    ? process.env.DEMO_ASSETS_PREFIX.trim().replace(/\/+$/, '')
    : 'system/demo/default';

// Ordered list of demo image file names. The first published post gets the first image, and so on.
// These files should exist in the assets bucket under `${DEMO_ASSETS_PREFIX}/${fileName}`.
const DEMO_IMAGE_FILES = [
  'post-welcome.png',
  'post-testimonial.png',
  'post-bts.png',
  'post-tip.png',
  'post-checklist.png',
];

function getDemoAssetS3KeyByIndex(index: number): string | null {
  if (!DEMO_IMAGE_FILES.length) return null;
  const fileName = DEMO_IMAGE_FILES[index % DEMO_IMAGE_FILES.length];
  return `${DEMO_ASSETS_PREFIX}/${fileName}`;
}

/**
 * Seed a per-user demo workspace for a brand.
 *
 * This creates a small set of posts that exercise the main flows:
 * - Draft, scheduled, and published content
 *
 * The seed is intentionally lightweight and idempotent:
 * - If the brand already has content, nothing is created.
 */
export async function seedDemoWorkspace(options: SeedDemoWorkspaceOptions): Promise<void> {
  const { brandId, userId, includeAnalytics = true } = options;

  const contentCount = await prisma.content.count({ where: { brandId } });

  // If this brand already has data, do not overwrite it.
  if (contentCount > 0) {
    return;
  }

  const now = new Date();
  const days = (n: number) => 24 * 60 * 60 * 1000 * n;

  // Create demo assets in the assets service so demo posts can reference real asset IDs.
  const demoAssetIdsByIndex = new Map<number, string>();
  try {
    const assetsClient = getAssetsClient();
    await Promise.all(
      DEMO_IMAGE_FILES.map(async (fileName, idx) => {
        const s3Key = getDemoAssetS3KeyByIndex(idx);
        if (!s3Key) return;
        try {
          const result = await assetsClient.createAsset({
            brandId,
            uploadedBy: userId,
            fileName,
            s3Key,
            fileSize: 250_000,
            mimeType: 'image/png',
            fileType: 'image',
            width: 1080,
            height: 1080,
            tags: ['demo'],
          });
          demoAssetIdsByIndex.set(idx, result.asset.id);
        } catch {
          // Non-fatal: demo can still function with content-only data.
        }
      })
    );
  } catch {
    // Non-fatal: demo can still function with content-only data.
  }

  // Base helper for building demo posts
  const makePost = (input: {
    caption: string;
    status: 'draft' | 'scheduled' | 'published' | 'failed';
    daysOffset: number;
    imageIndex?: number;
  }) => {
    const when = new Date(now.getTime() + days(input.daysOffset));
    const scheduledAt = input.status === 'scheduled' || input.status === 'published' ? when : null;
    const postedAt =
      input.status === 'published' ? new Date(when.getTime() + 60 * 60 * 1000) : null;

    return {
      brandId,
      caption: input.caption,
      hashtags: ['#postolio', '#demo', '#socialmedia'],
      status: input.status,
      scheduledAt,
      postedAt,
      generationParams: {
        isDemo: true,
        seed: 'demo-workspace',
      } as any,
      contentType: 'post',
      demoImageIndex: typeof input.imageIndex === 'number' ? input.imageIndex : null,
    };
  };

  const posts = [
    makePost({
      caption:
        'Welcome to your demo workspace 🎉 Edit this post to see how content changes across the app.',
      status: 'published',
      daysOffset: -2,
      imageIndex: 0, // post-welcome.png
    }),
    makePost({
      caption: 'Share a quick win or testimonial from your customers to build social proof.',
      status: 'published',
      daysOffset: -1,
      imageIndex: 1, // post-testimonial.png
    }),
    makePost({
      caption: 'Behind-the-scenes snapshot: show how your product or service is made.',
      status: 'scheduled',
      daysOffset: 1,
      imageIndex: 2, // post-bts.png
    }),
    makePost({
      caption: 'Educational tip: highlight one problem your audience faces and how to solve it.',
      status: 'draft',
      daysOffset: 0,
      imageIndex: 3, // post-tip.png
    }),
    makePost({
      caption: 'Evergreen post idea: share a checklist or framework your audience can reuse.',
      status: 'draft',
      daysOffset: 0,
      imageIndex: 4, // post-checklist.png
    }),
  ];

  for (const post of posts) {
    const { demoImageIndex, ...postData } = post;

    const created = await prisma.content.create({
      data: postData,
      select: { id: true },
    });

    if (typeof demoImageIndex === 'number') {
      const assetId = demoAssetIdsByIndex.get(demoImageIndex) ?? null;
      if (assetId) {
        await prisma.contentMediaAsset.create({
          data: {
            contentId: created.id,
            displayOrder: 0,
            assetId,
          },
        });
      }
    }
  }

  // Optional: seed lightweight analytics so demo analytics pages feel alive.
  if (!includeAnalytics) {
    return;
  }

  // Attach basic metrics only when a demo social account exists for this brand.
  const socialAccount = await prisma.socialAccount.findFirst({
    where: { brandId, platform: 'instagram' },
  });

  if (!socialAccount) {
    return;
  }

  const seededContent = await prisma.content.findMany({
    where: { brandId },
    orderBy: { createdAt: 'asc' },
  });

  const publishedContent = seededContent.filter((c) => c.status === 'published');

  // Simple metrics generator for demo posts
  const makeMetrics = (index: number) => {
    const baseImpressions = 1200 + index * 300;
    const baseReach = Math.round(baseImpressions * 0.75);
    const likes = 80 + index * 20;
    const comments = 5 + index * 3;
    const saves = 10 + index * 4;
    const shares = 4 + index * 2;
    const engagement = likes + comments + saves + shares;
    const engagementRate = baseReach > 0 ? Number(((engagement / baseReach) * 100).toFixed(2)) : 0;

    return {
      impressions: baseImpressions,
      reach: baseReach,
      likes,
      comments,
      saves,
      shares,
      engagement,
      engagementRate,
    };
  };

  // Create publications and latest metrics for each published demo post
  const publicationIds: string[] = [];
  let totalImpressions = 0;
  let totalReach = 0;

  for (let i = 0; i < publishedContent.length; i++) {
    const content = publishedContent[i];
    const metrics = makeMetrics(i);

    const publishedAt = content.postedAt ?? content.scheduledAt ?? new Date();

    const pub = await prisma.contentPublication.create({
      data: {
        contentId: content.id,
        socialAccountId: socialAccount.id,
        platform: 'instagram',
        externalPostId: `DEMO_${content.id}`,
        externalAccountId: socialAccount.externalAccountId || undefined,
        externalPageId: socialAccount.externalPageId || undefined,
        permalink: `https://instagram.com/p/demo-${content.id}`,
        publishedAt,
        status: 'published',
        metadata: {
          isDemo: true,
        },
      },
    });

    await prisma.publicationMetricsLatest.create({
      data: {
        publicationId: pub.id,
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

    publicationIds.push(pub.id);
    totalImpressions += metrics.impressions;
    totalReach += metrics.reach;
  }

  // Seed simple account-level metrics
  if (totalImpressions > 0 || totalReach > 0) {
    const now = new Date();
    const daysBack = 7;
    const followerBase =
      (socialAccount.metadata as any)?.followers_count &&
      Number((socialAccount.metadata as any).followers_count) > 0
        ? Number((socialAccount.metadata as any).followers_count)
        : 5000;

    // Followers timeline: gently growing over the last 7 days
    const followerSamples: any[] = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const asOf = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const followers = followerBase - (daysBack - 1 - i) * 15;
      followerSamples.push({
        socialAccountId: socialAccount.id,
        platform: 'instagram',
        metricName: 'followers' as any,
        value: followers,
        period: 'day' as any,
        windowStart: null,
        windowEnd: null,
        asOf,
        raw: null,
      } as any);
    }

    // Aggregate impressions/reach into simple daily samples
    const impressionsPerDay = Math.max(1, Math.round(totalImpressions / daysBack));
    const reachPerDay = Math.max(1, Math.round(totalReach / daysBack));

    const trafficSamples: any[] = [];
    for (let i = daysBack - 1; i >= 0; i--) {
      const asOf = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      trafficSamples.push(
        {
          socialAccountId: socialAccount.id,
          platform: 'instagram',
          metricName: 'impressions' as any,
          value: impressionsPerDay,
          period: 'day' as any,
          windowStart: null,
          windowEnd: null,
          asOf,
          raw: null,
        } as any,
        {
          socialAccountId: socialAccount.id,
          platform: 'instagram',
          metricName: 'reach' as any,
          value: reachPerDay,
          period: 'day' as any,
          windowStart: null,
          windowEnd: null,
          asOf,
          raw: null,
        } as any
      );
    }

    await prisma.accountMetricSample.createMany({
      data: [...followerSamples, ...trafficSamples] as any,
    });

    await prisma.accountMetricsLatest.upsert({
      where: { socialAccountId: socialAccount.id },
      update: {
        platform: 'instagram',
        followers: followerBase,
        impressions: totalImpressions,
        reach: totalReach,
        profileViews: Math.round(totalReach * 0.1),
        lastUpdated: now,
      },
      create: {
        socialAccountId: socialAccount.id,
        platform: 'instagram',
        followers: followerBase,
        impressions: totalImpressions,
        reach: totalReach,
        profileViews: Math.round(totalReach * 0.1),
        lastUpdated: now,
      },
    });
  }
}
