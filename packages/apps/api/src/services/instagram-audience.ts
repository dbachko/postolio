import axios from 'axios';
import { logger as baseLogger } from '@postolio/logger';
import { prisma } from '../config/database.js';
import { redisService } from './redis.js';
import {
  buildDemographicsFromMaps,
  parseDemographicBreakdownRows,
  type BreakdownDimension,
} from './instagram-audience.helpers.js';
import type {
  InstagramAudienceDemographics,
  InstagramAudienceDemographicsResult,
} from './instagram.js';

const audienceLogger = baseLogger.child({ module: 'instagram-audience' });
const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
const fbGraph = (path: string) => `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

type BrandData = { id: string };
type ServiceLike = any;

function hasAnyDemographics(demographics: InstagramAudienceDemographics): boolean {
  return (
    demographics.totalAudience > 0 ||
    demographics.gender.length > 0 ||
    demographics.age.length > 0 ||
    demographics.countries.length > 0 ||
    demographics.cities.length > 0 ||
    demographics.locales.length > 0
  );
}

function parseSeededAudienceDemographics(seed: any): InstagramAudienceDemographics | null {
  if (!seed || typeof seed !== 'object') {
    return null;
  }

  const demographics: InstagramAudienceDemographics = {
    totalAudience: Number(seed.totalAudience || 0),
    updatedAt: typeof seed.updatedAt === 'string' ? seed.updatedAt : new Date().toISOString(),
    gender: Array.isArray(seed.gender)
      ? seed.gender
          .map((entry: any) => ({
            gender:
              entry.gender === 'M' || entry.gender === 'F' || entry.gender === 'U'
                ? entry.gender
                : 'U',
            value: Number(entry.value || 0),
          }))
          .filter((entry: any) => isFinite(entry.value) && entry.value > 0)
      : [],
    age: Array.isArray(seed.age)
      ? seed.age
          .map((entry: any) => ({
            range: String(entry.range || ''),
            value: Number(entry.value || 0),
          }))
          .filter((entry: any) => entry.range && isFinite(entry.value) && entry.value > 0)
      : [],
    countries: Array.isArray(seed.countries)
      ? seed.countries
          .map((entry: any) => ({
            code: String(entry.code || ''),
            value: Number(entry.value || 0),
          }))
          .filter((entry: any) => entry.code && isFinite(entry.value) && entry.value > 0)
      : [],
    cities: Array.isArray(seed.cities)
      ? seed.cities
          .map((entry: any) => ({
            name: String(entry.name || ''),
            value: Number(entry.value || 0),
          }))
          .filter((entry: any) => entry.name && isFinite(entry.value) && entry.value > 0)
      : [],
    locales: Array.isArray(seed.locales)
      ? seed.locales
          .map((entry: any) => ({
            locale: String(entry.locale || ''),
            value: Number(entry.value || 0),
          }))
          .filter((entry: any) => entry.locale && isFinite(entry.value) && entry.value > 0)
      : [],
  };

  return hasAnyDemographics(demographics) ? demographics : null;
}

async function readCachedDemographics(
  cacheKey: string
): Promise<InstagramAudienceDemographics | null> {
  if (!redisService.isConnected()) {
    return null;
  }

  const cached = await redisService.get(cacheKey);
  if (!cached) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached) as InstagramAudienceDemographics;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildBreakdownUrl(params: {
  accountId: string;
  accessToken: string;
  timeframe: string;
  dimension: BreakdownDimension;
  breakdownKey: 'breakdowns' | 'breakdown';
}) {
  const query = new URLSearchParams();
  query.set('metric', 'follower_demographics');
  query.set('period', 'lifetime');
  query.set('timeframe', params.timeframe);
  query.set('metric_type', 'total_value');
  query.set(params.breakdownKey, params.dimension);
  query.set('access_token', params.accessToken);
  return fbGraph(`${params.accountId}/insights?${query.toString()}`);
}

async function fetchBreakdown(params: {
  service: ServiceLike;
  credentials: { accountId: string };
  accountId: string;
  accessToken: string;
  timeframe: string;
  dimension: BreakdownDimension;
}): Promise<Record<string, number>> {
  const requestWithKey = async (breakdownKey: 'breakdowns' | 'breakdown') => {
    await params.service.checkRateLimit(String(params.credentials.accountId));
    const response = await axios.get(
      buildBreakdownUrl({
        accountId: params.accountId,
        accessToken: params.accessToken,
        timeframe: params.timeframe,
        dimension: params.dimension,
        breakdownKey,
      })
    );
    const rows: any[] = Array.isArray(response.data?.data) ? response.data.data : [];
    return parseDemographicBreakdownRows(rows, params.dimension);
  };

  try {
    return await requestWithKey('breakdowns');
  } catch (error: any) {
    const fbError = error?.response?.data?.error as
      { message?: string; code?: number; error_subcode?: number } | undefined;
    const message =
      (typeof fbError?.message === 'string' && fbError.message) ||
      (error instanceof Error ? error.message : 'Unknown error');
    const shouldRetryWithSingular =
      /breakdowns|breakdown/i.test(String(message)) ||
      (fbError?.code === 100 && /breakdown/i.test(String(message)));
    if (!shouldRetryWithSingular) {
      throw error;
    }
    return requestWithKey('breakdown');
  }
}

function mapAudienceError(error: any): InstagramAudienceDemographicsResult {
  const fbError = error?.response?.data?.error as
    { message?: string; code?: number; error_subcode?: number } | undefined;
  const message =
    (typeof fbError?.message === 'string' && fbError.message) ||
    (error instanceof Error ? error.message : 'Unknown error');
  const code = fbError?.code;
  const subcode = fbError?.error_subcode;

  const permissionLike =
    code === 10 || /permission|insights|manage_insights|oauth/i.test(String(message));
  const noDataLike =
    /less than 100 followers/i.test(String(message)) ||
    /not returned if the ig user has less than 100 followers/i.test(String(message));
  const hideDetails = code === 100;

  audienceLogger.warn('Failed to fetch audience demographics', { code, subcode, message });
  if (noDataLike) {
    return { status: 'no_data' };
  }
  return {
    status: permissionLike ? 'insufficient_permissions' : 'error',
    errorMessage: hideDetails ? undefined : message,
  };
}

function isDisconnectedAccount(metadata: Record<string, unknown>): boolean {
  return metadata && typeof metadata === 'object' && Boolean((metadata as any).disconnected);
}

function getAudienceCredentials(credentials: { accessToken?: string; accountId?: string }): {
  accessToken: string;
  accountId: string;
} {
  const accessToken = credentials.accessToken;
  const accountId = credentials.accountId;
  if (!accessToken || !accountId) {
    throw new Error('Failed to get Instagram credentials');
  }
  return { accessToken, accountId };
}

async function collectBreakdownMaps(params: {
  service: ServiceLike;
  credentials: { accountId: string };
  accountId: string;
  accessToken: string;
  timeframe: string;
  dimensions: BreakdownDimension[];
}): Promise<Map<BreakdownDimension, Record<string, number>>> {
  const settled = await Promise.allSettled(
    params.dimensions.map((dimension) =>
      fetchBreakdown({
        service: params.service,
        credentials: params.credentials,
        accountId: params.accountId,
        accessToken: params.accessToken,
        timeframe: params.timeframe,
        dimension,
      })
    )
  );

  const maps = new Map<BreakdownDimension, Record<string, number>>();
  let firstError: unknown | null = null;
  for (let i = 0; i < params.dimensions.length; i++) {
    const result = settled[i];
    const dimension = params.dimensions[i];
    if (result.status === 'fulfilled') {
      maps.set(dimension, result.value);
      continue;
    }
    if (!firstError) {
      firstError = result.reason;
    }
  }
  if (maps.size === 0 && firstError) {
    throw firstError;
  }
  return maps;
}

async function cacheDemographicsIfPossible(
  cacheKey: string,
  demographics: InstagramAudienceDemographics
): Promise<void> {
  if (!redisService.isConnected()) {
    return;
  }
  await redisService.set(cacheKey, JSON.stringify(demographics), 6 * 60 * 60);
}

export async function getAudienceDemographicsImpl(
  service: ServiceLike,
  brand: BrandData | string
): Promise<InstagramAudienceDemographicsResult> {
  const brandId = typeof brand === 'string' ? brand : brand.id;
  const account = await prisma.socialAccount.findFirst({
    where: { brandId, platform: 'instagram' },
    select: { metadata: true },
  });
  if (!account) {
    return { status: 'not_connected' };
  }

  const accountMetadata = (account.metadata || {}) as Record<string, unknown>;
  if (isDisconnectedAccount(accountMetadata)) {
    return { status: 'not_connected' };
  }

  const seeded = parseSeededAudienceDemographics((accountMetadata as any)?.audienceDemographics);
  if (seeded) {
    return { status: 'available', demographics: seeded };
  }

  try {
    const credentials = await service.getCredentialsOrThrow(brand);
    const { accessToken, accountId } = getAudienceCredentials(credentials);

    const cacheKey = `instagram:audience_demographics:${String(accountId)}`;
    const cached = await readCachedDemographics(cacheKey);
    if (cached) {
      return { status: 'available', demographics: cached };
    }

    const dimensions: BreakdownDimension[] = ['gender', 'age', 'country', 'city'];
    const maps = await collectBreakdownMaps({
      service,
      credentials,
      accountId,
      accessToken,
      timeframe: 'this_month',
      dimensions,
    });

    const demographics = buildDemographicsFromMaps(maps);
    if (!demographics) {
      return { status: 'no_data' };
    }
    await cacheDemographicsIfPossible(cacheKey, demographics);
    return { status: 'available', demographics };
  } catch (error: any) {
    return mapAudienceError(error);
  }
}
