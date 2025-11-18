import { PrismaClient, Prisma } from '@postolio/database';
import Redis from 'ioredis';
import { InstagramConnector, type AccountIdentity, type Credentials } from '@postolio/connectors';
import fetch from 'node-fetch';
import { signRequest } from '@postolio/aws';

// Minimal scaffolding for the ingestion loop; real selection logic will be added in Phase 3

// Ensure DATABASE_URL is available (fallback to discrete DB_* vars when running in ECS)
function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME } = process.env as Record<
    string,
    string | undefined
  >;
  if (DB_HOST && DB_PORT && DB_USERNAME && DB_PASSWORD && DB_NAME) {
    const enc = encodeURIComponent;
    process.env.DATABASE_URL = `postgresql://${enc(DB_USERNAME)}:${enc(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`;
    console.log('[Ingestor] DATABASE_URL constructed from DB_* vars', {
      dbHost: DB_HOST,
      dbPort: DB_PORT,
      dbName: DB_NAME,
    });
  }
}

ensureDatabaseUrl();

const prisma = new PrismaClient();

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const wantInfo = LOG_LEVEL === 'info' || LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';
const wantDebug = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';
const ACCOUNT_METRICS_MIN_INTERVAL_MS = Number(
  process.env.ACCOUNT_METRICS_MIN_INTERVAL_MS || 24 * 60 * 60 * 1000
);
const IDLE_BACKOFF_MS = Number(process.env.IDLE_BACKOFF_MS || 5 * 60 * 1000);

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
    const url = new URL(path);
    const signed = await signRequest({ method: 'GET', url, headers: {} });
    const res = await fetch(path, { method: 'GET', headers: signed });
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
  const impressionsSource =
    typeof metrics.impressions === 'number'
      ? metrics.impressions
      : typeof metrics.reach === 'number'
        ? metrics.reach
        : 0;
  const reachSource =
    typeof metrics.reach === 'number'
      ? metrics.reach
      : typeof metrics.impressions === 'number'
        ? metrics.impressions
        : 0;
  const impressions = Math.max(0, Math.floor(impressionsSource || 0));
  const reach = Math.max(0, Math.floor(reachSource || 0));
  // Instagram Graph API has deprecated the `video_views` metric in favor of `views`
  // (and `plays`/`ig_reels_aggregated_all_plays_count` for reels). Our canonical
  // column is still named `videoViews`, so prefer the new `views` metric when present,
  // falling back to `video_views` (old API) and then `plays`.
  const viewsSource =
    typeof metrics.views === 'number'
      ? metrics.views
      : typeof metrics.video_views === 'number'
        ? metrics.video_views
        : typeof metrics.plays === 'number'
          ? metrics.plays
          : 0;
  const videoViews = Math.max(0, Math.floor(viewsSource || 0));
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
  if (wantInfo) {
    console.log('[Ingestor] Upserted metrics', {
      publicationId: pub.id,
      platform: pub.platform,
      impressions,
      reach,
      likes,
      comments,
      saves,
      shares,
      videoViews,
    });
  }
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
  const configured = Number(process.env.RATE_LIMIT_PER_HOUR || NaN);
  if (!Number.isNaN(configured) && configured > 0) {
    limit = configured;
  }
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `rate:${platform}:${socialAccountId}:${hourBucket}`;
  if (!redis) return true;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count <= limit;
}

async function ingestPublication(publicationId: string) {
  if (wantInfo) console.log('[Ingestor] Ingesting publication', { publicationId });
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
  if (!allowed) {
    if (wantDebug) console.debug('Rate limit reached; skipping', pub.id);
    return;
  }
  const connector = getConnector(pub.platform);
  if (wantDebug) console.log('[Ingestor] Connector resolved', { platform: pub.platform });
  const creds = await getCredentialsForSocialAccount(pub.socialAccountId, pub.platform);
  const account: AccountIdentity = {
    platform: pub.platform as any,
    externalAccountId: pub.externalAccountId || pub.socialAccount?.externalAccountId || '',
    externalPageId: pub.externalPageId || pub.socialAccount?.externalPageId || undefined,
  } as any;
  if (wantDebug)
    console.debug('[Ingestor] Fetching media insights', { mediaId: pub.externalPostId });
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
  let drained = 0;
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(queueKey);
    if (!id) break;
    try {
      let effectiveId = String(id);
      // Allow enqueuing by contentId using payload prefix 'content:'
      if (effectiveId.startsWith('content:')) {
        const contentId = effectiveId.substring('content:'.length);
        const pub = await prisma.contentPublication.findFirst({
          where: { contentId },
          orderBy: { publishedAt: 'desc' },
          select: { id: true },
        });
        if (!pub) {
          console.warn('[Ingestor] No publication for content', { contentId });
          continue;
        }
        effectiveId = pub.id;
        if (wantInfo)
          console.log('[Ingestor] Resolved content to publication', {
            contentId,
            publicationId: effectiveId,
          });
      }
      // Allow enqueuing by external media id using payload prefix 'ig:'
      else if (effectiveId.startsWith('ig:')) {
        const mediaId = effectiveId.substring('ig:'.length);
        const pub = await prisma.contentPublication.findFirst({
          where: { externalPostId: mediaId },
          orderBy: { publishedAt: 'desc' },
          select: { id: true },
        });
        if (!pub) {
          console.warn('[Ingestor] No publication for external media', { mediaId });
          continue;
        }
        effectiveId = pub.id;
        if (wantInfo)
          console.log('[Ingestor] Resolved external media to publication', {
            mediaId,
            publicationId: effectiveId,
          });
      }
      drained++;
      await ingestPublication(effectiveId);
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      const status = (e as any)?.response?.status;
      const ig = (e as any)?.response?.data?.error;
      const message = ig?.message || (e as Error).message;
      const code = ig?.code;
      const subcode = ig?.error_subcode;
      console.error(
        `Queue ingestion error for publication ${String(id)}: ${message} (status: ${status ?? 'n/a'}, code: ${
          code ?? 'n/a'
        }${subcode ? `, subcode: ${subcode}` : ''})`
      );
    }
  }
  if (wantDebug && drained > 0) console.log('[Ingestor] Drained publications', { drained });
  return drained;
}

async function ingestAccountMetrics(socialAccountId: string) {
  const sa = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
  });
  if (!sa) return;
  // Gate by lastUpdated interval
  const latest = await prisma.accountMetricsLatest.findUnique({
    where: { socialAccountId: sa.id },
    select: { lastUpdated: true },
  });
  if (latest?.lastUpdated) {
    const age = Date.now() - new Date(latest.lastUpdated).getTime();
    if (age < ACCOUNT_METRICS_MIN_INTERVAL_MS) {
      if (wantDebug)
        console.debug('Account metrics within min interval; skipping', {
          socialAccountId: sa.id,
        });
      return;
    }
  }
  const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
  if (!allowed) {
    if (wantDebug) console.debug('Rate limit reached; skipping account', sa.id);
    return;
  }
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
  let drained = 0;
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(key);
    if (!id) break;
    try {
      drained++;
      await ingestAccountMetrics(id);
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      const status = (e as any)?.response?.status;
      const ig = (e as any)?.response?.data?.error;
      const message = ig?.message || (e as Error).message;
      const code = ig?.code;
      const subcode = ig?.error_subcode;
      console.error(
        `Queue ingestion error for account ${String(id)}: ${message} (status: ${status ?? 'n/a'}, code: ${
          code ?? 'n/a'
        }${subcode ? `, subcode: ${subcode}` : ''})`
      );
    }
  }
  if (wantDebug && drained > 0) console.log('[Ingestor] Drained accounts', { drained });
  return drained;
}

async function runOnce(): Promise<{ hadWork: boolean }> {
  // First drain any queued refresh requests
  const drainedPubs = await drainQueue(20);
  const drainedAccts = await drainAccountQueue(10);

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
        if (wantDebug) console.debug('Rate limit reached; skipping', pub.id);
        continue;
      }
      await ingestPublication(pub.id);
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      const status = (e as any)?.response?.status;
      const ig = (e as any)?.response?.data?.error;
      const message = ig?.message || (e as Error).message;
      const code = ig?.code;
      const subcode = ig?.error_subcode;
      console.error(
        `Ingestion error for publication ${pub.id}: ${message} (status: ${status ?? 'n/a'}, code: ${code ?? 'n/a'}${
          subcode ? `, subcode: ${subcode}` : ''
        })`
      );
    }
  }
  if (wantDebug) {
    console.log('[Ingestor] Run complete', {
      candidates: candidates.length,
      due: due.length,
    });
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
    let accountUpdated = 0;
    for (const socialAccountId of accountBatch) {
      try {
        const sa = await prisma.socialAccount.findUnique({
          where: { id: socialAccountId },
          select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
        });
        if (!sa) continue;
        // Gate by lastUpdated interval
        const latest = await prisma.accountMetricsLatest.findUnique({
          where: { socialAccountId: sa.id },
          select: { lastUpdated: true },
        });
        if (latest?.lastUpdated) {
          const age = Date.now() - new Date(latest.lastUpdated).getTime();
          if (age < ACCOUNT_METRICS_MIN_INTERVAL_MS) {
            if (wantDebug)
              console.debug('Account metrics within min interval; skipping', {
                socialAccountId: sa.id,
              });
            continue;
          }
        }
        const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
        if (!allowed) {
          if (wantDebug) console.debug('Rate limit reached; skipping account', sa.id);
          continue;
        }

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
        accountUpdated++;
      } catch (e) {
        const status = (e as any)?.response?.status;
        const ig = (e as any)?.response?.data?.error;
        const message = ig?.message || (e as Error).message;
        const code = ig?.code;
        const subcode = ig?.error_subcode;
        console.error(
          `Account metrics ingestion error: ${message} (status: ${status ?? 'n/a'}, code: ${code ?? 'n/a'}${
            subcode ? `, subcode: ${subcode}` : ''
          }, sa: ${socialAccountId})`
        );
      }
    }
    const hadWork = drainedPubs > 0 || drainedAccts > 0 || due.length > 0 || accountUpdated > 0;
    return { hadWork };
  } catch (e) {
    const status = (e as any)?.response?.status;
    const ig = (e as any)?.response?.data?.error;
    const message = ig?.message || (e as Error).message;
    const code = ig?.code;
    const subcode = ig?.error_subcode;
    console.error(
      `Account metrics batch error: ${message} (status: ${status ?? 'n/a'}, code: ${code ?? 'n/a'}${
        subcode ? `, subcode: ${subcode}` : ''
      })`
    );
    const hadWork = drainedPubs > 0 || drainedAccts > 0 || due.length > 0;
    return { hadWork };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loopMs = Number(process.env.INGESTOR_LOOP_MS || '0');
  if (loopMs > 0) {
    (async () => {
      // simple loop; do not exit
      while (true) {
        try {
          const { hadWork } = await runOnce();
          const sleepMs = hadWork ? loopMs : IDLE_BACKOFF_MS;
          await new Promise((r) => setTimeout(r, sleepMs));
        } catch (e) {
          console.error('Ingestor loop error', e);
          await new Promise((r) => setTimeout(r, loopMs));
        }
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
