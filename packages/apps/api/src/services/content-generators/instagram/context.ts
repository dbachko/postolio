import type { Prisma, ContentStatus } from '@postolio/database';
import { getDatabaseClient } from '../../../config/database.js';
import { getBrandProfileContext, type BrandProfileContext } from '../../brand-profile.js';
import { contentLogger } from '../logger.js';
import type { BrandLocationContext, RecentItem } from './types.js';

const prisma = getDatabaseClient();

export function pickRecentWindowConfig(): { windowCount: number; windowDays: number } {
  const windowCount = Number.isFinite(parseInt(process.env.ROLLING_WINDOW_POST_COUNT || ''))
    ? Math.max(1, parseInt(process.env.ROLLING_WINDOW_POST_COUNT as string, 10))
    : 20;
  const windowDays = Number.isFinite(parseInt(process.env.ROLLING_WINDOW_DAYS || ''))
    ? Math.max(0, parseInt(process.env.ROLLING_WINDOW_DAYS as string, 10))
    : 0;

  return { windowCount, windowDays };
}

export async function loadBrandContext(
  brandId: string,
  reqId: string
): Promise<BrandProfileContext | null> {
  try {
    return await getBrandProfileContext(brandId);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.warn('Brand profile projection unavailable during generation', {
      reqId,
      brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return null;
  }
}

export async function loadRecentContentWindow(
  brandId: string,
  reqId: string
): Promise<{ priorOpeners: string[]; priorHashtagUsage: Map<string, number> }> {
  const { windowCount, windowDays } = pickRecentWindowConfig();

  const where: Prisma.ContentWhereInput = {
    brandId,
    status: { in: ['draft', 'scheduled', 'published'] as ContentStatus[] },
  };

  if (windowDays > 0) {
    where.createdAt = {
      gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    };
  }

  let recent: RecentItem[] = [];
  try {
    recent = await prisma.content.findMany({
      where,
      select: { caption: true, hashtags: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: windowCount,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.warn('Failed to fetch recent content window; continuing without it', {
      reqId,
      brandId,
      windowCount,
      windowDays,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }

  const firstWords = (text: string, n = 5): string => {
    const words = (text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, n);
    return words.join(' ');
  };

  const sanitizeTag = (value: string): string => value.replace(/^#+/, '').trim().toLowerCase();

  const priorOpeners = Array.from(
    new Set(
      recent
        .map((item) => (item.caption ? firstWords(item.caption, 5) : ''))
        .filter((value) => value && value.length > 0)
    )
  ).slice(0, 20);

  const priorHashtagUsage = new Map<string, number>();
  for (const item of recent) {
    (item.hashtags || []).map(sanitizeTag).forEach((tag) => {
      if (!tag) {
        return;
      }
      priorHashtagUsage.set(tag, (priorHashtagUsage.get(tag) || 0) + 1);
    });
  }

  return { priorOpeners, priorHashtagUsage };
}

export async function loadBrandLocation(
  brandId: string,
  _reqId: string
): Promise<BrandLocationContext | null> {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        postingTimezone: true,
        countryCode: true,
      },
    });

    return brand ?? null;
  } catch {
    return null;
  }
}
