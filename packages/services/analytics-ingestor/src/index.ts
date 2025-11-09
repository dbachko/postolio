import { PrismaClient, Prisma } from '@postolio/database';
import Redis from 'ioredis';
import { InstagramConnector, type AccountIdentity, type Credentials } from '@postolio/connectors';
import fetch from 'node-fetch';

// Minimal scaffolding for the ingestion loop; real selection logic will be added in Phase 3

const prisma = new PrismaClient();

const redis = new Redis(
  process.env.REDIS_URL || process.env.REDIS_URI || 'redis://localhost:6379',
  {
    enableReadyCheck: false,
  }
);

function getConnector(platform: string) {
  switch (platform) {
    case 'instagram':
      return new InstagramConnector();
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function getCredentialsForSocialAccount(
  socialAccountId: string,
  platform: string
): Promise<Credentials> {
  // Prefer Token Service if configured; fallback to DUMMY_ACCESS_TOKEN for local dev
  const tokenServiceUrl = process.env.TOKEN_SERVICE_URL || process.env.TOKEN_SERVICE_FUNCTION_URL;
  if (tokenServiceUrl) {
    // Look up brand + user for the social account
    const sa = await prisma.socialAccount.findUnique({
      where: { id: socialAccountId },
      include: { brand: { select: { id: true, userId: true } } },
    });
    if (!sa || !sa.brand) throw new Error('SocialAccount not found for credentials lookup');

    const path = `${tokenServiceUrl}/tokens/${sa.brand.userId}/${platform}/${sa.brand.id}`;
    const res = await fetch(path, { method: 'GET' });
    if (res.status === 404) throw new Error('No token in Token Service');
    if (!res.ok) throw new Error(`Token Service error: ${res.status}`);
    const data = (await res.json()) as { accessToken: string; expiresAt?: string };
    if (!data?.accessToken) throw new Error('Token Service returned no accessToken');
    return { accessToken: data.accessToken, expiresAt: data.expiresAt } as Credentials;
  }

  const token = process.env.DUMMY_ACCESS_TOKEN || '';
  if (!token) {
    throw new Error('No TOKEN_SERVICE_URL or DUMMY_ACCESS_TOKEN provided');
  }
  return { accessToken: token };
}

async function upsertPublicationLatest(
  pub: { id: string; platform: string },
  metrics: Record<string, number>
) {
  const likes = Math.max(0, Math.floor(metrics.likes || 0));
  const comments = Math.max(0, Math.floor(metrics.comments || 0));
  const saves = Math.max(0, Math.floor(metrics.saves || 0));
  const shares = Math.max(0, Math.floor(metrics.shares || 0));
  const impressions = Math.max(0, Math.floor(metrics.impressions || 0));
  const reach = Math.max(0, Math.floor(metrics.reach || 0));
  const videoViews = Math.max(0, Math.floor(metrics.video_views || 0));
  const engagement = likes + comments + saves + shares;
  const denom = reach > 0 ? reach : impressions > 0 ? impressions : 1;
  const engagementRate = new Prisma.Decimal(((engagement / denom) * 100).toFixed(4));

  await prisma.publicationMetricsLatest.upsert({
    where: { publicationId: pub.id },
    update: {
      platform: pub.platform as any,
      impressions,
      reach,
      likes,
      comments,
      saves,
      shares,
      videoViews,
      engagement,
      engagementRate,
      lastUpdated: new Date(),
    },
    create: {
      publicationId: pub.id,
      platform: pub.platform as any,
      impressions,
      reach,
      likes,
      comments,
      saves,
      shares,
      videoViews,
      engagement,
      engagementRate,
      lastUpdated: new Date(),
    },
  });
}

async function recordMetricSamples(
  pub: { id: string; platform: string },
  metrics: Record<string, number>
) {
  const asOf = new Date();
  const period: any = 'lifetime';
  const entries = Object.entries(metrics).filter(([, v]) => typeof v === 'number');
  for (const [name, value] of entries) {
    try {
      await prisma.metricSample.create({
        data: {
          publicationId: pub.id,
          platform: pub.platform as any,
          metricName: name as any,
          value: new Prisma.Decimal((value as number).toString()),
          period,
          asOf,
        },
      });
    } catch (e) {
      // Ignore duplicates or unexpected enum values gracefully for now
      console.warn('MetricSample create failed', {
        pubId: pub.id,
        name,
        error: (e as Error).message,
      });
    }
  }
}

function computeRefreshThresholdMs(publishedAt?: Date | null): number {
  if (!publishedAt) return 30 * 24 * 60 * 60 * 1000; // default 30 days
  const ageMs = Date.now() - publishedAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays < 2) return 45 * 60 * 1000; // 45 minutes
  if (ageDays < 7) return 24 * 60 * 60 * 1000; // 1 day
  if (ageDays < 30) return 3 * 24 * 60 * 60 * 1000; // 3 days
  return 30 * 24 * 60 * 60 * 1000; // 30 days
}

async function checkAndConsumeRate(platform: string, socialAccountId: string, limit = 200) {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `rate:${platform}:${socialAccountId}:${hourBucket}`;
  if (!redis) return true;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count <= limit;
}

async function ingestPublication(publicationId: string) {
  const pub = await prisma.contentPublication.findUnique({
    where: { id: publicationId },
    select: {
      id: true,
      platform: true,
      socialAccountId: true,
      externalPostId: true,
      externalAccountId: true,
      externalPageId: true,
      publishedAt: true,
      socialAccount: { select: { externalAccountId: true, externalPageId: true } },
    },
  });
  if (!pub) return;
  const allowed = await checkAndConsumeRate(pub.platform, pub.socialAccountId, 200);
  if (!allowed) return;
  const connector = getConnector(pub.platform);
  const creds = await getCredentialsForSocialAccount(pub.socialAccountId, pub.platform);
  const account: AccountIdentity = {
    platform: pub.platform as any,
    externalAccountId: pub.externalAccountId || pub.socialAccount?.externalAccountId || '',
    externalPageId: pub.externalPageId || pub.socialAccount?.externalPageId || undefined,
  } as any;
  const insights = await connector.getMediaInsights(creds, account, pub.externalPostId);
  const fields = connector.getMediaFields
    ? await connector.getMediaFields(creds, account, pub.externalPostId)
    : {};
  const merged: Record<string, number> = { ...(insights.metrics as any), ...(fields as any) };
  await recordMetricSamples({ id: pub.id, platform: pub.platform }, merged);
  await upsertPublicationLatest({ id: pub.id, platform: pub.platform }, merged);
}

async function drainQueue(max = 20) {
  const queueKey = 'ingest:queue:publications';
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(queueKey);
    if (!id) break;
    try {
      await ingestPublication(id);
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      console.error('Queue ingestion error for publication', id, e);
    }
  }
}

async function ingestAccountMetrics(socialAccountId: string) {
  const sa = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
  });
  if (!sa) return;
  const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
  if (!allowed) return;
  const connector = getConnector(sa.platform);
  if (!connector.getAccountInsights) return;
  const creds = await getCredentialsForSocialAccount(sa.id, sa.platform);
  const account: AccountIdentity = {
    platform: sa.platform as any,
    externalAccountId: sa.externalAccountId,
    externalPageId: sa.externalPageId || undefined,
  } as any;
  const am = await connector.getAccountInsights(creds, account, '7d');
  const asOf = new Date();
  const metrics = am.metrics as Record<string, number>;
  for (const [name, value] of Object.entries(metrics)) {
    try {
      await prisma.accountMetricSample.create({
        data: {
          socialAccountId: sa.id,
          platform: sa.platform as any,
          metricName: name as any,
          value: new Prisma.Decimal((value as number).toString()),
          period: 'day' as any,
          asOf,
        },
      });
    } catch {
      // ignore
    }
  }
  await prisma.accountMetricsLatest.upsert({
    where: { socialAccountId: sa.id },
    update: {
      platform: sa.platform as any,
      followers: Math.floor(metrics.followers || 0),
      impressions: Math.floor(metrics.impressions || 0),
      reach: Math.floor(metrics.reach || 0),
      profileViews: Math.floor((metrics as any).profile_views || 0),
      lastUpdated: asOf,
    },
    create: {
      socialAccountId: sa.id,
      platform: sa.platform as any,
      followers: Math.floor(metrics.followers || 0),
      impressions: Math.floor(metrics.impressions || 0),
      reach: Math.floor(metrics.reach || 0),
      profileViews: Math.floor((metrics as any).profile_views || 0),
      lastUpdated: asOf,
    },
  });
}

async function drainAccountQueue(max = 10) {
  const key = 'ingest:queue:accounts';
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(key);
    if (!id) break;
    try {
      await ingestAccountMetrics(id);
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      console.error('Queue ingestion error for account', id, e);
    }
  }
}

async function runOnce() {
  // First drain any queued refresh requests
  await drainQueue(20);
  await drainAccountQueue(10);

  // Load recent publications with latest metrics for staleness calculation
  const candidates = await prisma.contentPublication.findMany({
    take: 100,
    orderBy: { publishedAt: 'desc' },
    select: {
      id: true,
      platform: true,
      socialAccountId: true,
      externalPostId: true,
      externalAccountId: true,
      externalPageId: true,
      publishedAt: true,
      socialAccount: { select: { externalAccountId: true, externalPageId: true } },
      metricsLatest: { select: { lastUpdated: true } },
    },
  });

  const due: typeof candidates = [] as any;
  for (const c of candidates) {
    const thresholdMs = computeRefreshThresholdMs(c.publishedAt);
    const last = c.metricsLatest?.lastUpdated ? new Date(c.metricsLatest.lastUpdated) : null;
    const ageMs = last ? Date.now() - last.getTime() : Infinity;
    if (ageMs >= thresholdMs) due.push(c);
    if (due.length >= 10) break;
  }

  for (const pub of due) {
    try {
      const allowed = await checkAndConsumeRate(pub.platform, pub.socialAccountId, 200);
      if (!allowed) {
        console.warn('Rate limit reached; skipping', pub.id);
        continue;
      }
      await ingestPublication(pub.id);
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      console.error('Ingestion error for publication', pub.id, e);
    }
  }

  // Also refresh account-level metrics for the social accounts involved
  try {
    const accountIds = Array.from(
      new Set(
        candidates
          .map((c: { socialAccountId: string }) => c.socialAccountId)
          .filter(Boolean) as string[]
      )
    );
    // Limit to 10 accounts per pass
    const accountBatch = accountIds.slice(0, 10);
    for (const socialAccountId of accountBatch) {
      try {
        const sa = await prisma.socialAccount.findUnique({
          where: { id: socialAccountId },
          select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
        });
        if (!sa) continue;
        const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
        if (!allowed) continue;

        const connector = getConnector(sa.platform);
        const creds = await getCredentialsForSocialAccount(sa.id, sa.platform);
        const account: AccountIdentity = {
          platform: sa.platform as any,
          externalAccountId: sa.externalAccountId,
          externalPageId: sa.externalPageId || undefined,
        } as any;
        if (!connector.getAccountInsights) continue;
        const am = await connector.getAccountInsights(creds, account, '7d');

        // Insert daily aggregate sample (period=day, asOf=now)
        const asOf = new Date();
        const metrics = am.metrics as Record<string, number>;
        const dataEntries: Array<[string, number]> = Object.entries(metrics);
        for (const [name, value] of dataEntries) {
          try {
            await prisma.accountMetricSample.create({
              data: {
                socialAccountId: sa.id,
                platform: sa.platform as any,
                metricName: name as any,
                value: new Prisma.Decimal((value as number).toString()),
                period: 'day' as any,
                asOf,
              },
            });
          } catch (e) {
            console.warn('AccountMetricSample create failed', {
              sa: sa.id,
              name,
              error: (e as Error).message,
            });
          }
        }
        // Upsert latest
        await prisma.accountMetricsLatest.upsert({
          where: { socialAccountId: sa.id },
          update: {
            platform: sa.platform as any,
            followers: Math.floor(metrics.followers || 0),
            impressions: Math.floor(metrics.impressions || 0),
            reach: Math.floor(metrics.reach || 0),
            profileViews: Math.floor((metrics as any).profile_views || 0),
            lastUpdated: asOf,
          },
          create: {
            socialAccountId: sa.id,
            platform: sa.platform as any,
            followers: Math.floor(metrics.followers || 0),
            impressions: Math.floor(metrics.impressions || 0),
            reach: Math.floor(metrics.reach || 0),
            profileViews: Math.floor((metrics as any).profile_views || 0),
            lastUpdated: asOf,
          },
        });
      } catch (e) {
        console.error('Account metrics ingestion error', e);
      }
    }
  } catch (e) {
    console.error('Account metrics batch error', e);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loopMs = Number(process.env.INGESTOR_LOOP_MS || '0');
  if (loopMs > 0) {
    (async () => {
      // simple loop; do not exit
      while (true) {
        try {
          await runOnce();
        } catch (e) {
          console.error('Ingestor loop error', e);
        }
        await new Promise((r) => setTimeout(r, loopMs));
      }
    })();
  } else {
    runOnce()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  }
}
