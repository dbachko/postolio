import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Prisma, createPrismaClient } from '@postolio/database';
import Redis from 'ioredis';
import { InstagramConnector, type AccountIdentity, type Credentials } from '@postolio/connectors';
import fetch from 'node-fetch';
import { signRequest } from '@postolio/aws';
import { initSentry, captureException, registerGlobalErrorHandlers } from '@postolio/observability';

// Minimal scaffolding for the ingestion loop; real selection logic will be added in Phase 3

initSentry({
  serviceName: 'analytics-ingestor',
});
registerGlobalErrorHandlers();

// Ensure DATABASE_URL is available (fallback to discrete DB_* vars when running in ECS)
function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return;
  }
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

const { client: prisma, pool: prismaPool } = createPrismaClient({
  connectionString: process.env.DATABASE_URL,
});
process.on('beforeExit', async () => {
  await prisma.$disconnect();
  await prismaPool.end();
});

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const wantInfo = LOG_LEVEL === 'info' || LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';
const wantDebug = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';
const ACCOUNT_METRICS_MIN_INTERVAL_MS = Number(
  process.env.ACCOUNT_METRICS_MIN_INTERVAL_MS || 24 * 60 * 60 * 1000
);
const IDLE_BACKOFF_MS = Number(process.env.IDLE_BACKOFF_MS || 5 * 60 * 1000);
const MIN_INGESTOR_LOOP_MS = Number(process.env.INGESTOR_LOOP_MIN_MS || 60 * 1000);
const NONRETRYABLE_PUBLICATION_BACKOFF_MS = Number(
  process.env.NONRETRYABLE_PUBLICATION_BACKOFF_MS || 24 * 60 * 60 * 1000
);
const RATE_LIMIT_BACKOFF_BASE_MS = Number(process.env.RATE_LIMIT_BACKOFF_BASE_MS || 60 * 1000);
const RATE_LIMIT_BACKOFF_MAX_MS = Number(process.env.RATE_LIMIT_BACKOFF_MAX_MS || 60 * 60 * 1000);
const RATE_LIMIT_BACKOFF_JITTER = Number(process.env.RATE_LIMIT_BACKOFF_JITTER || 0.2);
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

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
    if (!sa?.brand) {
      throw new Error('SocialAccount not found for credentials lookup');
    }

    const path = `${tokenServiceUrl}/tokens/${sa.brand.userId}/${platform}/${sa.brand.id}/social-accounts/${socialAccountId}`;
    const url = new URL(path);
    const signed = await signRequest({ method: 'GET', url, headers: {} });
    const res = await fetch(path, { method: 'GET', headers: signed });
    if (res.status === 404) {
      throw new Error('No token in Token Service');
    }
    if (!res.ok) {
      throw new Error(`Token Service error: ${res.status}`);
    }
    const data = (await res.json()) as { accessToken: string; expiresAt?: string };
    if (!data?.accessToken) {
      throw new Error('Token Service returned no accessToken');
    }
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
  if (!publishedAt) {
    return 30 * 24 * 60 * 60 * 1000;
  } // default 30 days
  const ageMs = Date.now() - publishedAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays < 2) {
    return 45 * 60 * 1000;
  } // 45 minutes
  if (ageDays < 7) {
    return 24 * 60 * 60 * 1000;
  } // 1 day
  if (ageDays < 30) {
    return 3 * 24 * 60 * 60 * 1000;
  } // 3 days
  return 30 * 24 * 60 * 60 * 1000; // 30 days
}

async function checkAndConsumeRate(platform: string, socialAccountId: string, limit = 200) {
  const envLimitRaw = process.env.RATE_LIMIT_PER_HOUR;
  if (envLimitRaw) {
    const configured = Number(envLimitRaw);
    if (!Number.isNaN(configured) && configured > 0) {
      limit = configured;
    }
  } else {
    // No explicit override configured; apply a safer default cap
    limit = Math.min(limit, 60);
  }
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `rate:${platform}:${socialAccountId}:${hourBucket}`;
  if (!redis) {
    return true;
  }
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 3600);
  }
  return count <= limit;
}

function applyJitter(delayMs: number): number {
  const jitterPortion = RATE_LIMIT_BACKOFF_JITTER * delayMs;
  const min = Math.max(0, delayMs - jitterPortion);
  const max = delayMs + jitterPortion;
  return Math.floor(min + Math.random() * (max - min));
}

function getBackoffKey(platform: string, socialAccountId: string): string {
  return `ingest:backoff:${platform}:${socialAccountId}`;
}

function getBackoffCountKey(platform: string, socialAccountId: string): string {
  return `ingest:backoff:count:${platform}:${socialAccountId}`;
}

async function getBackoffRemainingMs(
  platform: string,
  socialAccountId: string
): Promise<number | null> {
  if (!redis) {
    return null;
  }
  const raw = await redis.get(getBackoffKey(platform, socialAccountId));
  if (!raw) {
    return null;
  }
  const until = Number(raw);
  if (Number.isNaN(until)) {
    return null;
  }
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : null;
}

async function clearBackoff(platform: string, socialAccountId: string): Promise<void> {
  if (!redis) {
    return;
  }
  await redis.del(getBackoffKey(platform, socialAccountId));
  await redis.del(getBackoffCountKey(platform, socialAccountId));
}

async function scheduleBackoff(
  platform: string,
  socialAccountId: string,
  retryAfterMs?: number
): Promise<number> {
  if (!redis) {
    return RATE_LIMIT_BACKOFF_BASE_MS;
  }
  const countKey = getBackoffCountKey(platform, socialAccountId);
  const count = await redis.incr(countKey);
  if (count === 1) {
    await redis.expire(countKey, 3600);
  }
  const base = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : RATE_LIMIT_BACKOFF_BASE_MS;
  const exponent = Math.max(0, count - 1);
  const unclampedDelay = base * Math.pow(2, exponent);
  const clamped = Math.min(unclampedDelay, RATE_LIMIT_BACKOFF_MAX_MS);
  const jittered = applyJitter(clamped);
  const until = Date.now() + jittered;
  await redis.set(
    getBackoffKey(platform, socialAccountId),
    until.toString(),
    'PX',
    Math.max(1000, Math.floor(jittered))
  );
  return jittered;
}

function parseUsageHeader(raw: any): number | null {
  // Meta returns JSON-ish strings like '{"call_count":42,"total_cputime":16,"total_time":22}'
  if (!raw) {
    return null;
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (typeof parsed?.call_count === 'number') {
      return parsed.call_count;
    }
    return null;
  } catch {
    return null;
  }
}

function detectRateLimit(err: any): { isRateLimit: boolean; retryAfterMs?: number } {
  const res = err?.response;
  const status = res?.status;
  const headers = res?.headers || {};
  const retryAfterHeader = headers['retry-after'];
  const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;

  const igError = res?.data?.error;
  const igCode = igError?.code ? Number(igError.code) : undefined;
  const igSubcode = igError?.error_subcode ? Number(igError.error_subcode) : undefined;
  const msg = (igError?.message || err?.message || '').toString().toLowerCase();

  // Doc-aligned rate limit codes
  const igRateCodes = [4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80007, 80008];
  const isRateCode = igCode ? igRateCodes.includes(igCode) : false;
  const isRateSubcode = igSubcode ? igRateCodes.includes(igSubcode) : false;
  const is429 = status === 429;
  const isMessageRate = msg.includes('rate limit') || msg.includes('too many requests');

  // Proactive backoff if usage headers indicate >90% utilization
  const usageHeaders = [
    'x-app-usage',
    'x-page-usage',
    'x-ad-account-usage',
    'x-business-use-case-usage',
  ];
  let nearingLimit = false;
  for (const h of usageHeaders) {
    const callCount = parseUsageHeader(headers[h]);
    if (typeof callCount === 'number' && callCount >= 90) {
      nearingLimit = true;
      break;
    }
  }

  const isRateLimit = is429 || isRateCode || isRateSubcode || isMessageRate || nearingLimit;
  return { isRateLimit, retryAfterMs };
}

function getPublicationRefreshKey(publicationId: string): string {
  return `ingest:last:publication:${publicationId}`;
}

async function getLastPublicationRefresh(publicationId: string): Promise<number | null> {
  if (!redis) {
    return null;
  }
  try {
    const raw = await redis.get(getPublicationRefreshKey(publicationId));
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

async function markPublicationRefreshed(
  publicationId: string,
  publishedAt?: Date | null,
  overrideMs?: number
): Promise<void> {
  if (!redis) {
    return;
  }
  try {
    const thresholdMs =
      overrideMs && overrideMs > 0 ? overrideMs : computeRefreshThresholdMs(publishedAt);
    const ttlSeconds = Math.max(Math.ceil(thresholdMs / 1000), 60);
    await redis.set(
      getPublicationRefreshKey(publicationId),
      Date.now().toString(),
      'EX',
      ttlSeconds
    );
  } catch {}
}

async function isPublicationRefreshDue(pub: {
  id: string;
  publishedAt?: Date | null;
  metricsLatest?: { lastUpdated?: Date | string | null } | null;
}): Promise<boolean> {
  const thresholdMs = computeRefreshThresholdMs(pub.publishedAt ?? null);
  const now = Date.now();

  let lastTs: number | null = null;
  const lastUpdated = pub.metricsLatest?.lastUpdated;

  if (lastUpdated instanceof Date) {
    lastTs = lastUpdated.getTime();
  } else if (typeof lastUpdated === 'string') {
    const parsed = Date.parse(lastUpdated);
    if (!Number.isNaN(parsed)) {
      lastTs = parsed;
    }
  }

  if (!lastTs) {
    const redisTs = await getLastPublicationRefresh(pub.id);
    if (typeof redisTs === 'number') {
      lastTs = redisTs;
    }
  }

  if (!lastTs) {
    return true;
  }

  const ageMs = now - lastTs;
  return ageMs >= thresholdMs;
}

function emitIngestionMetrics(
  ingestedPublications: number,
  dueCount: number,
  candidateCount: number,
  accountUpdated: number
): void {
  const timestamp = Date.now();
  const emfPayload = {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: 'Postolio/AnalyticsIngestor',
          Dimensions: [['service']],
          Metrics: [
            { Name: 'PublicationsIngested', Unit: 'Count' },
            { Name: 'PublicationsDue', Unit: 'Count' },
            { Name: 'CandidatesScanned', Unit: 'Count' },
            { Name: 'AccountsUpdated', Unit: 'Count' },
          ],
        },
      ],
    },
    service: 'analytics-ingestor',
    PublicationsIngested: ingestedPublications,
    PublicationsDue: dueCount,
    CandidatesScanned: candidateCount,
    AccountsUpdated: accountUpdated,
  };

  console.log(JSON.stringify(emfPayload));
  console.log('[Ingestor] Run metrics', {
    ingestedPublications,
    dueCount,
    candidateCount,
    accountUpdated,
  });
}

function classifyNonRetryablePublicationError(err: any): {
  nonRetryable: boolean;
  reason?: string;
  status?: number;
  code?: number;
  subcode?: number;
  message?: string;
} {
  const ig = err?.response?.data?.error;
  const status = err?.response?.status;
  const codeRaw = ig?.code;
  const subcodeRaw = ig?.error_subcode;
  const code = typeof codeRaw === 'number' ? codeRaw : Number(codeRaw);
  const subcode = typeof subcodeRaw === 'number' ? subcodeRaw : Number(subcodeRaw);
  const message = (ig?.message || err?.message || '').toString();
  const lower = message.toLowerCase();

  const unsupported = lower.includes('unsupported get request');
  const doesNotExist =
    lower.includes('does not exist') ||
    lower.includes('cannot be loaded') ||
    lower.includes('not exist');
  const permissionMissing = lower.includes('missing permissions');
  const notFoundCode = code === 100 && (subcode === 33 || subcode === 803);
  const permissionCodes = code === 10 || code === 200;

  if (unsupported || doesNotExist || notFoundCode) {
    return {
      nonRetryable: true,
      reason: 'not_found',
      status,
      code,
      subcode,
      message,
    };
  }

  if (permissionMissing || permissionCodes) {
    return {
      nonRetryable: true,
      reason: 'permissions',
      status,
      code,
      subcode,
      message,
    };
  }

  return { nonRetryable: false };
}

async function recordPublicationErrorMetadata(
  pub: { id: string; metadata?: Prisma.JsonValue | null },
  details: {
    reason?: string;
    message?: string;
    status?: number;
    code?: number;
    subcode?: number;
  }
): Promise<void> {
  try {
    const base =
      pub.metadata && typeof pub.metadata === 'object' && !Array.isArray(pub.metadata)
        ? { ...(pub.metadata as Record<string, any>) }
        : {};
    base.analyticsError = {
      reason: details.reason,
      message: details.message,
      status: details.status,
      code: details.code,
      subcode: details.subcode,
      recordedAt: new Date().toISOString(),
    };
    await prisma.contentPublication.update({
      where: { id: pub.id },
      data: { metadata: base as Prisma.JsonObject },
    });
  } catch (error) {
    console.warn('Failed to persist publication analytics error metadata', {
      publicationId: pub.id,
      error: (error as Error).message,
    });
  }
}

const eventBridge = new EventBridge({ region: process.env.AWS_REGION || 'us-east-1' });

async function emitPublicationUnavailableEvent(detail: {
  publicationId: string;
  contentId?: string | null;
  socialAccountId?: string | null;
  platform?: string | null;
  reason?: string;
}): Promise<void> {
  try {
    const payload = {
      ...detail,
      occurredAt: new Date().toISOString(),
    };
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'postolio.analytics',
            DetailType: 'post.unavailable',
            Detail: JSON.stringify(payload),
            EventBusName: EVENT_BUS_NAME,
          },
        ],
      })
    );
    if (wantDebug) {
      console.debug('[Ingestor] Emitted post.unavailable event', payload);
    }
  } catch (error) {
    console.warn('Failed to emit post.unavailable event', {
      publicationId: detail.publicationId,
      error: (error as Error).message,
    });
  }
}

async function markPublicationUnavailable(
  pub: { id: string; publishedAt?: Date | null; metadata?: Prisma.JsonValue | null },
  reason: string
): Promise<void> {
  try {
    const base =
      pub.metadata && typeof pub.metadata === 'object' && !Array.isArray(pub.metadata)
        ? { ...(pub.metadata as Record<string, any>) }
        : {};
    base.analyticsUnavailable = {
      reason,
      recordedAt: new Date().toISOString(),
    };

    await prisma.contentPublication.update({
      where: { id: pub.id },
      data: {
        status: 'unavailable',
        metadata: base as Prisma.JsonObject,
      },
    });
  } catch (error) {
    console.warn('Failed to mark publication unavailable', {
      publicationId: pub.id,
      error: (error as Error).message,
    });
  }

  await markPublicationRefreshed(
    pub.id,
    pub.publishedAt,
    Math.max(NONRETRYABLE_PUBLICATION_BACKOFF_MS, computeRefreshThresholdMs(pub.publishedAt))
  );
}

async function ingestPublication(publicationId: string) {
  if (wantInfo) {
    console.log('[Ingestor] Ingesting publication', { publicationId });
  }
  const pub = await prisma.contentPublication.findUnique({
    where: { id: publicationId },
    select: {
      contentId: true,
      id: true,
      platform: true,
      socialAccountId: true,
      externalPostId: true,
      externalAccountId: true,
      externalPageId: true,
      publishedAt: true,
      metadata: true,
      socialAccount: { select: { externalAccountId: true, externalPageId: true } },
    },
  });
  if (!pub) {
    return;
  }
  const externalPostId = (pub.externalPostId || '').trim();
  if (!externalPostId || /^invalid/i.test(externalPostId)) {
    console.warn('[Ingestor] Skipping publication with invalid externalPostId', {
      publicationId,
      platform: pub.platform,
      externalPostId: pub.externalPostId,
    });
    return;
  }
  const allowed = await checkAndConsumeRate(pub.platform, pub.socialAccountId, 200);
  if (!allowed) {
    if (wantDebug) {
      console.debug('Rate limit reached; skipping', pub.id);
    }
    return;
  }
  const backoffRemaining = await getBackoffRemainingMs(pub.platform, pub.socialAccountId);
  if (backoffRemaining && backoffRemaining > 0) {
    if (wantInfo) {
      console.log('[Ingestor] Backoff active; skipping publication', {
        publicationId: pub.id,
        backoffMsRemaining: backoffRemaining,
        nextAttemptAt: new Date(Date.now() + backoffRemaining).toISOString(),
      });
    }
    return;
  }
  const connector = getConnector(pub.platform);
  if (wantDebug) {
    console.log('[Ingestor] Connector resolved', { platform: pub.platform });
  }
  const creds = await getCredentialsForSocialAccount(pub.socialAccountId, pub.platform);
  const account: AccountIdentity = {
    platform: pub.platform as any,
    externalAccountId: pub.externalAccountId || pub.socialAccount?.externalAccountId || '',
    externalPageId: pub.externalPageId || pub.socialAccount?.externalPageId || undefined,
  } as any;
  if (wantDebug) {
    console.debug('[Ingestor] Fetching media insights', { mediaId: externalPostId });
  }
  try {
    const insights = await connector.getMediaInsights(creds, account, externalPostId);
    const fields = connector.getMediaFields
      ? await connector.getMediaFields(creds, account, externalPostId)
      : {};
    const merged: Record<string, number> = { ...(insights.metrics as any), ...(fields as any) };
    await recordMetricSamples({ id: pub.id, platform: pub.platform }, merged);
    await upsertPublicationLatest({ id: pub.id, platform: pub.platform }, merged);
    await clearBackoff(pub.platform, pub.socialAccountId);
  } catch (e) {
    const { isRateLimit, retryAfterMs } = detectRateLimit(e);
    const nonRetryable = classifyNonRetryablePublicationError(e);
    if (nonRetryable.nonRetryable) {
      console.warn('[Ingestor] Non-retryable publication error; suppressing retries', {
        publicationId,
        reason: nonRetryable.reason,
        status: nonRetryable.status ?? 'n/a',
        code: nonRetryable.code ?? 'n/a',
        subcode: nonRetryable.subcode ?? 'n/a',
      });
      await recordPublicationErrorMetadata(pub, nonRetryable);
      await emitPublicationUnavailableEvent({
        publicationId: pub.id,
        contentId: pub.contentId,
        socialAccountId: pub.socialAccountId,
        platform: pub.platform,
        reason: nonRetryable.reason,
      });
      await markPublicationUnavailable(pub, nonRetryable.reason || 'not_found');
      return;
    }
    if (isRateLimit) {
      const delay = await scheduleBackoff(pub.platform, pub.socialAccountId, retryAfterMs);
      console.warn('[Ingestor] Rate limited on publication; applying backoff', {
        publicationId,
        socialAccountId: pub.socialAccountId,
        backoffMs: delay,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      });
    }
    throw e;
  }
}

async function drainQueue(max = 20) {
  const queueKey = 'ingest:queue:publications';
  let drained = 0;
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(queueKey);
    if (!id) {
      break;
    }
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
        if (wantInfo) {
          console.log('[Ingestor] Resolved content to publication', {
            contentId,
            publicationId: effectiveId,
          });
        }
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
        if (wantInfo) {
          console.log('[Ingestor] Resolved external media to publication', {
            mediaId,
            publicationId: effectiveId,
          });
        }
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
  if (wantDebug && drained > 0) {
    console.log('[Ingestor] Drained publications', { drained });
  }
  return drained;
}

async function ingestAccountMetrics(socialAccountId: string) {
  const sa = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
  });
  if (!sa) {
    return;
  }
  // Gate by lastUpdated interval
  const latest = await prisma.accountMetricsLatest.findUnique({
    where: { socialAccountId: sa.id },
    select: { lastUpdated: true },
  });
  if (latest?.lastUpdated) {
    const age = Date.now() - new Date(latest.lastUpdated).getTime();
    if (age < ACCOUNT_METRICS_MIN_INTERVAL_MS) {
      if (wantDebug) {
        console.debug('Account metrics within min interval; skipping', {
          socialAccountId: sa.id,
        });
      }
      return;
    }
  }
  const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
  if (!allowed) {
    if (wantDebug) {
      console.debug('Rate limit reached; skipping account', sa.id);
    }
    return;
  }
  const acctBackoffRemaining = await getBackoffRemainingMs(sa.platform, sa.id);
  if (acctBackoffRemaining && acctBackoffRemaining > 0) {
    if (wantInfo) {
      console.log('[Ingestor] Backoff active; skipping account metrics', {
        socialAccountId: sa.id,
        backoffMsRemaining: acctBackoffRemaining,
        nextAttemptAt: new Date(Date.now() + acctBackoffRemaining).toISOString(),
      });
    }
    return;
  }
  const connector = getConnector(sa.platform);
  if (!connector.getAccountInsights) {
    return;
  }
  const creds = await getCredentialsForSocialAccount(sa.id, sa.platform);
  const account: AccountIdentity = {
    platform: sa.platform as any,
    externalAccountId: sa.externalAccountId,
    externalPageId: sa.externalPageId || undefined,
  } as any;
  try {
    const am = await connector.getAccountInsights(creds, account, '7d');
    const asOf = new Date();
    const metrics = am.metrics as Record<string, number>;
    if (typeof metrics.reach === 'number' && typeof metrics.impressions !== 'number') {
      metrics.impressions = metrics.reach;
    }
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
    await clearBackoff(sa.platform, sa.id);
  } catch (e) {
    const { isRateLimit, retryAfterMs } = detectRateLimit(e);
    if (isRateLimit) {
      const delay = await scheduleBackoff(sa.platform, sa.id, retryAfterMs);
      console.warn('[Ingestor] Rate limited on account metrics; applying backoff', {
        socialAccountId: sa.id,
        backoffMs: delay,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      });
    }
    throw e;
  }
}

async function drainAccountQueue(max = 10) {
  const key = 'ingest:queue:accounts';
  let drained = 0;
  for (let i = 0; i < max; i++) {
    const id = await redis.lpop(key);
    if (!id) {
      break;
    }
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
  if (wantDebug && drained > 0) {
    console.log('[Ingestor] Drained accounts', { drained });
  }
  return drained;
}

async function runOnce(): Promise<{ hadWork: boolean }> {
  // First drain any queued refresh requests
  const drainedPubs = await drainQueue(20);
  const drainedAccts = await drainAccountQueue(10);

  // Load recent publications with latest metrics for staleness calculation
  const candidates = await prisma.contentPublication.findMany({
    take: 100,
    where: {
      NOT: [{ status: 'unavailable' }],
    },
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
  const dueChecks = await Promise.all(
    candidates.map((c) =>
      isPublicationRefreshDue({
        id: c.id,
        publishedAt: c.publishedAt,
        metricsLatest: c.metricsLatest,
      })
    )
  );

  for (let i = 0; i < candidates.length && due.length < 10; i += 1) {
    if (dueChecks[i]) {
      due.push(candidates[i]);
    }
  }

  let ingestedPublications = 0;
  let skippedByBackoff = 0;
  for (const pub of due) {
    try {
      const allowed = await checkAndConsumeRate(pub.platform, pub.socialAccountId, 200);
      if (!allowed) {
        if (wantDebug) {
          console.debug('Rate limit reached; skipping', pub.id);
        }
        continue;
      }
      const loopBackoffRemaining = await getBackoffRemainingMs(pub.platform, pub.socialAccountId);
      if (loopBackoffRemaining && loopBackoffRemaining > 0) {
        skippedByBackoff += 1;
        if (wantInfo) {
          console.log('Backoff active; skipping publication ingestion', {
            publicationId: pub.id,
            backoffMsRemaining: loopBackoffRemaining,
            nextAttemptAt: new Date(Date.now() + loopBackoffRemaining).toISOString(),
          });
        }
        continue;
      }
      await ingestPublication(pub.id);
      await markPublicationRefreshed(pub.id, pub.publishedAt);
      ingestedPublications += 1;
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
    let accountsSkippedByBackoff = 0;
    for (const socialAccountId of accountBatch) {
      try {
        const sa = await prisma.socialAccount.findUnique({
          where: { id: socialAccountId },
          select: { id: true, platform: true, externalAccountId: true, externalPageId: true },
        });
        if (!sa) {
          continue;
        }
        // Gate by lastUpdated interval
        const latest = await prisma.accountMetricsLatest.findUnique({
          where: { socialAccountId: sa.id },
          select: { lastUpdated: true },
        });
        if (latest?.lastUpdated) {
          const age = Date.now() - new Date(latest.lastUpdated).getTime();
          if (age < ACCOUNT_METRICS_MIN_INTERVAL_MS) {
            if (wantDebug) {
              console.debug('Account metrics within min interval; skipping', {
                socialAccountId: sa.id,
              });
            }
            continue;
          }
        }
        const allowed = await checkAndConsumeRate(sa.platform, sa.id, 200);
        if (!allowed) {
          if (wantDebug) {
            console.debug('Rate limit reached; skipping account', sa.id);
          }
          continue;
        }

        const batchBackoffRemaining = await getBackoffRemainingMs(sa.platform, sa.id);
        if (batchBackoffRemaining && batchBackoffRemaining > 0) {
          accountsSkippedByBackoff += 1;
          if (wantInfo) {
            console.log('Backoff active; skipping account metrics batch', {
              socialAccountId: sa.id,
              backoffMsRemaining: batchBackoffRemaining,
              nextAttemptAt: new Date(Date.now() + batchBackoffRemaining).toISOString(),
            });
          }
          continue;
        }

        const connector = getConnector(sa.platform);
        const creds = await getCredentialsForSocialAccount(sa.id, sa.platform);
        const account: AccountIdentity = {
          platform: sa.platform as any,
          externalAccountId: sa.externalAccountId,
          externalPageId: sa.externalPageId || undefined,
        } as any;
        if (!connector.getAccountInsights) {
          continue;
        }
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
    emitIngestionMetrics(ingestedPublications, due.length, candidates.length, accountUpdated);
    const hadWork =
      drainedPubs > 0 ||
      drainedAccts > 0 ||
      ingestedPublications > 0 ||
      accountUpdated > 0 ||
      accountsSkippedByBackoff > 0 ||
      skippedByBackoff > 0;
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
    emitIngestionMetrics(ingestedPublications, due.length, candidates.length, 0);
    const hadWork = drainedPubs > 0 || drainedAccts > 0 || due.length > 0;
    return { hadWork };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loopMsRaw = Number(process.env.INGESTOR_LOOP_MS || '0');
  const loopMs = loopMsRaw > 0 ? Math.max(loopMsRaw, MIN_INGESTOR_LOOP_MS) : 0;
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
          captureException(e, {
            scope: 'ingestor-loop',
          });
          await new Promise((r) => setTimeout(r, loopMs));
        }
      }
    })();
  } else {
    runOnce()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        captureException(e, {
          scope: 'ingestor-once',
        });
        process.exit(1);
      });
  }
}
