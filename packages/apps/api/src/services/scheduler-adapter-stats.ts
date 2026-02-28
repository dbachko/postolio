import { getDatabaseClient } from '../config/database.js';
import { logger } from '@postolio/logger';
import type { GenerationParams } from '../types/scheduler.js';
import { SYNC_TOLERANCE } from '../constants/scheduler.js';

const prisma = getDatabaseClient();

type ServiceLike = any;

type LocalScheduledContent = {
  id: string;
  brandId: string;
  caption: string;
  status: string;
  scheduledAt: Date | null;
  [key: string]: unknown;
};

type AwsScheduledContent = {
  contentId: string;
  scheduledAt: string;
  [key: string]: unknown;
};

type LocalStats = {
  total: number;
  scheduled: number;
  draft: number;
  published: number;
};

function mergeScheduledContent(
  awsSchedules: AwsScheduledContent[],
  localContent: LocalScheduledContent[]
) {
  const contentMap = new Map<string, any>();
  for (const schedule of awsSchedules) {
    contentMap.set(schedule.contentId, { ...schedule, source: 'aws' as const });
  }
  for (const content of localContent) {
    const existing = contentMap.get(content.id);
    if (existing) {
      contentMap.set(content.id, { ...content, ...existing, source: 'both' as const });
      continue;
    }
    contentMap.set(content.id, { ...content, source: 'local' as const });
  }
  return Array.from(contentMap.values());
}

async function getLocalSchedulingStats(brandId: string): Promise<LocalStats> {
  const [draft, scheduled, published] = await Promise.all([
    prisma.content.count({ where: { brandId, status: 'draft' } }),
    prisma.content.count({ where: { brandId, status: 'scheduled' } }),
    prisma.content.count({ where: { brandId, status: 'published' } }),
  ]);
  return {
    draft,
    scheduled,
    published,
    total: draft + scheduled + published,
  };
}

function areStatsSynced(
  awsStats: { total: number; upcoming: number; failed: number } | null,
  localStats: LocalStats
): boolean {
  if (!awsStats) {
    return false;
  }
  return (
    Math.abs((awsStats.upcoming || 0) - (localStats.scheduled || 0)) <= SYNC_TOLERANCE &&
    Math.abs((awsStats.total || 0) - (localStats.total || 0)) <= SYNC_TOLERANCE
  );
}

export async function logInconsistencyImpl(
  contentId: string,
  type:
    | 'AWS_SCHEDULE_WITHOUT_LOCAL'
    | 'AWS_CANCEL_FAILED'
    | 'LOCAL_WITHOUT_AWS'
    | 'DATA_MISMATCH'
    | 'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS',
  details: Record<string, unknown>
) {
  try {
    logger.error('DATA INCONSISTENCY', {
      type,
      contentId,
      timestamp: new Date().toISOString(),
      ...details,
    });

    const content = await prisma.content.findUnique({ where: { id: contentId } });
    if (!content) {
      return;
    }
    const generationParams = (content.generationParams as GenerationParams | null) || {};
    const inconsistencies = (generationParams.inconsistencies as unknown[]) || [];
    inconsistencies.push({ type, timestamp: new Date().toISOString(), details });
    await prisma.content.update({
      where: { id: contentId },
      data: {
        generationParams: JSON.parse(
          JSON.stringify({
            ...generationParams,
            inconsistencies,
            lastInconsistency: type,
            lastInconsistencyAt: new Date().toISOString(),
          })
        ),
      },
    });
  } catch (error) {
    logger.error('Failed to log inconsistency', { error });
  }
}

export async function getScheduledContentImpl(service: ServiceLike, brandId: string, limit = 10) {
  try {
    const schedules = await (await service.client).getUpcomingSchedules(brandId, limit);
    const localContent = await prisma.content.findMany({
      where: { brandId, status: 'scheduled', scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
    return mergeScheduledContent(schedules, localContent);
  } catch (error) {
    logger.error('Error getting scheduled content', { error });
    const content = await prisma.content.findMany({
      where: { brandId, status: 'scheduled', scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
    return content.map((item) => ({ ...item, status: item.status, source: 'local' as const }));
  }
}

export async function getSchedulingStatsImpl(service: ServiceLike, brandId: string) {
  try {
    const awsRawStats = await (await service.client).getSchedulingStats(brandId);
    const awsStats = {
      total:
        awsRawStats.scheduled +
        awsRawStats.published +
        awsRawStats.failed +
        awsRawStats.cancelled +
        awsRawStats.processing,
      upcoming: awsRawStats.scheduled + awsRawStats.processing,
      failed: awsRawStats.failed,
    };
    const localStats = await getLocalSchedulingStats(brandId);
    return {
      aws: awsStats,
      local: localStats,
      synced: areStatsSynced(awsStats, localStats),
    };
  } catch (error) {
    logger.error('Error getting scheduling stats', { error });
    return {
      local: await getLocalSchedulingStats(brandId),
      aws: null,
      synced: false,
    };
  }
}
