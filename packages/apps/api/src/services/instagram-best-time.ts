import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import { redisService } from './redis.js';
import { TimezoneService } from './timezone.js';
import { formatError } from '../utils/logging.js';
import {
  computeFromHistory,
  computeFromInsights,
  computeHeuristic,
} from './instagram-best-time/sources.js';
import { getGraphError, getInsightsUnavailableNote } from './instagram-best-time/utils.js';
import type { BestTimePayload } from './instagram-best-time/types.js';

const prisma = getDatabaseClient();
const bestTimeLogger = baseLogger.child({ module: 'instagram-best-time' });
const CACHE_PREFIX = 'ig_best_time:';

export type { BestTimePayload } from './instagram-best-time/types.js';

export class InstagramBestTimeService {
  private key(brandId: string) {
    return `${CACHE_PREFIX}${brandId}`;
  }

  private applyTopWindowsLimit(
    payload: BestTimePayload,
    topWindowsLimit?: number
  ): BestTimePayload {
    const limit =
      typeof topWindowsLimit === 'number' && Number.isFinite(topWindowsLimit)
        ? Math.floor(topWindowsLimit)
        : undefined;
    if (!limit || limit <= 0) {
      return payload;
    }

    const topWindows = payload.topWindows.slice(0, limit);
    const notes =
      limit < payload.topWindows.length
        ? [...(payload.notes || []), `Top windows truncated to ${limit}`]
        : payload.notes;

    return {
      ...payload,
      topWindows,
      notes,
    };
  }

  async getRecommendations(
    brandId: string,
    force = false,
    topWindowsLimit?: number
  ): Promise<BestTimePayload> {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        id: true,
        socialAccounts: {
          where: { platform: 'instagram' },
          select: { externalAccountId: true, externalPageId: true },
          take: 1,
        },
      },
    });

    if (!brand) {
      throw new Error('Brand not found');
    }
    if (!brand.socialAccounts?.[0]) {
      throw new Error('Instagram account not connected');
    }

    const timezone = await TimezoneService.getBrandTimezone(brandId);
    const cacheKey = this.key(brandId);

    if (!force) {
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return this.applyTopWindowsLimit(JSON.parse(cached) as BestTimePayload, topWindowsLimit);
      }
    }

    const fallbackNotes: string[] = [];
    let payload: BestTimePayload | null = null;

    try {
      payload = await computeFromInsights(brandId, timezone);
      if (!payload) {
        fallbackNotes.push(
          'Insights unavailable: no `online_followers` data returned (Meta may require ≥100 followers)'
        );
      }
    } catch (error) {
      fallbackNotes.push(getInsightsUnavailableNote(error));
      bestTimeLogger.warn('computeFromInsights failed; falling back', {
        brandId,
        graphError: getGraphError(error),
        ...formatError(error),
      });
    }

    if (!payload) {
      try {
        payload = await computeFromHistory(brandId, timezone);
      } catch (error) {
        bestTimeLogger.warn('computeFromHistory failed; falling back', {
          brandId,
          ...formatError(error),
        });
      }
    }

    if (!payload) {
      payload = computeHeuristic(brandId, timezone);
    }

    if (fallbackNotes.length > 0) {
      payload.notes = [...(payload.notes || []), ...fallbackNotes];
    }

    await redisService.set(cacheKey, JSON.stringify(payload), payload.ttlSeconds);
    return this.applyTopWindowsLimit(payload, topWindowsLimit);
  }
}

export const instagramBestTimeService = new InstagramBestTimeService();
