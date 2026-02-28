import { logger as baseLogger } from '@postolio/logger';

import { getDatabaseClient } from '../config/database.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';
import {
  SCHEDULER_LIMITS,
  SCHEDULER_TIME_INTERVALS,
  getPostingIntervalMs,
} from '../constants/scheduler.js';
import { generateInstagramContent, type ContentGenerationRequest } from './content-generator.js';
import { resolveGeneratedImageAsset, attachAssetToContent } from './assets-media.js';
import { schedulerService } from './scheduler.js';

const prisma = getDatabaseClient();
const autopilotLogger = baseLogger.child({ module: 'autopilot-service' });

type ContentGap = {
  brandId: string;
  brandName: string;
  missingDays: number;
  nextScheduledDate: Date | null;
  lastScheduledDate: Date | null;
};

function resolveStrategyFromBrandPreferences(preferences: unknown): {
  themes: string[];
  postingFrequency: 'daily' | 'every-other-day' | 'weekly';
} {
  const prefs = preferences as Record<string, unknown> | null | undefined;
  const rawStrategy =
    prefs && typeof prefs === 'object' && 'contentStrategy' in prefs
      ? (prefs.contentStrategy as unknown)
      : undefined;
  const contentStrategy =
    rawStrategy && typeof rawStrategy === 'object'
      ? (rawStrategy as {
          themes?: string[];
          postingFrequency?: 'daily' | 'every-other-day' | 'weekly';
        })
      : undefined;

  const fallback = {
    themes: ['lifestyle', 'inspiration', 'behind-the-scenes'],
    postingFrequency: 'daily' as const,
  };
  if (!contentStrategy) {
    return fallback;
  }

  const themes =
    Array.isArray(contentStrategy.themes) && contentStrategy.themes.length > 0
      ? contentStrategy.themes.filter((theme): theme is string => typeof theme === 'string')
      : fallback.themes;
  const postingFrequency =
    contentStrategy.postingFrequency === 'daily' ||
    contentStrategy.postingFrequency === 'every-other-day' ||
    contentStrategy.postingFrequency === 'weekly'
      ? contentStrategy.postingFrequency
      : fallback.postingFrequency;

  return { themes, postingFrequency };
}

function buildContentRequests(gap: ContentGap, themes: string[]): ContentGenerationRequest[] {
  const requests: ContentGenerationRequest[] = [];
  const postsToGenerate = Math.min(gap.missingDays, SCHEDULER_LIMITS.MAX_AUTOPILOT_POSTS_PER_RUN);
  for (let i = 0; i < postsToGenerate; i++) {
    const theme = themes[i % themes.length] || 'lifestyle';
    requests.push({ brandId: gap.brandId, count: 1, theme });
  }
  return requests;
}

async function importGeneratedAsset(params: {
  contentId: string;
  brandId: string;
  imageUrl: string;
  imageMetadata: unknown;
}): Promise<void> {
  const { contentId, brandId, imageUrl, imageMetadata } = params;
  try {
    const asset = await resolveGeneratedImageAsset(
      imageUrl,
      imageMetadata as { source: string; originalPrompt: string; assetId?: string } | undefined,
      {
        contentId,
        brandId,
      }
    );
    await attachAssetToContent({ contentId, asset });
    autopilotLogger.info(`[Autopilot] Asset imported for content ${contentId}`, {
      brandId,
      assetId: asset.id,
    });
  } catch (error) {
    autopilotLogger.error(
      `[Autopilot] Failed to import asset for content ${contentId}; leaving post without media`,
      {
        brandId,
        error:
          error instanceof Error ? { name: error.name, message: error.message } : String(error),
      }
    );
  }
}

async function getNextAvailableSlot(brandId: string): Promise<Date> {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(SCHEDULER_LIMITS.DEFAULT_POSTING_HOUR, 0, 0, 0);

  const lastScheduled = await prisma.content.findFirst({
    where: {
      brandId,
      scheduledAt: { gte: now },
    },
    orderBy: { scheduledAt: 'desc' },
  });
  if (!lastScheduled?.scheduledAt) {
    return tomorrow;
  }

  const nextSlot = new Date(
    lastScheduled.scheduledAt.getTime() + SCHEDULER_TIME_INTERVALS.MIN_POST_INTERVAL_MS
  );
  return nextSlot > tomorrow ? nextSlot : tomorrow;
}

async function scheduleGeneratedContent(
  brandId: string,
  strategy: { postingFrequency?: 'daily' | 'every-other-day' | 'weekly' }
): Promise<void> {
  try {
    const unscheduledContent = await prisma.content.findMany({
      where: {
        brandId,
        status: 'draft',
        scheduledAt: null,
        generationParams: {
          path: ['source'],
          equals: 'autopilot',
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (unscheduledContent.length === 0) {
      return;
    }

    const intervalMs = getPostingIntervalMs(strategy.postingFrequency || 'daily');
    let nextScheduleTime = await getNextAvailableSlot(brandId);
    for (const content of unscheduledContent) {
      await schedulerService.scheduleContent(content.id, nextScheduleTime);
      nextScheduleTime = new Date(nextScheduleTime.getTime() + intervalMs);
    }

    autopilotLogger.info('Scheduled autopilot posts for brand', {
      brandId,
      scheduledCount: unscheduledContent.length,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    autopilotLogger.error('Error scheduling generated content', {
      brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }
}

async function maybeImportAutopilotAsset(params: {
  contentId: string;
  brandId: string;
  imageUrl?: string;
  imageMetadata?: unknown;
}): Promise<void> {
  if (!params.imageUrl || !params.imageMetadata) {
    return;
  }
  await importGeneratedAsset({
    contentId: params.contentId,
    brandId: params.brandId,
    imageUrl: params.imageUrl,
    imageMetadata: params.imageMetadata,
  });
}

async function persistGeneratedBatch(params: {
  brandName: string;
  brandId: string;
  request: ContentGenerationRequest;
}): Promise<number> {
  const generatedContent = await generateInstagramContent(params.brandName, params.request);
  let createdCount = 0;

  for (const content of generatedContent) {
    const created = await prisma.content.create({
      data: {
        caption: content.caption,
        hashtags: extractHashtagsFromCaption(content.caption),
        status: 'scheduled',
        brandId: params.brandId,
        generationParams: {
          source: 'autopilot',
          theme: params.request.theme,
          style: params.request.style,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    await maybeImportAutopilotAsset({
      contentId: created.id,
      brandId: params.brandId,
      imageUrl: content.imageUrl,
      imageMetadata: content.imageMetadata,
    });
    createdCount++;
  }

  return createdCount;
}

export async function generateContentForBrand(gap: ContentGap): Promise<number> {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: gap.brandId },
      include: { user: true },
    });
    if (!brand) {
      throw new Error(`Brand not found: ${gap.brandId}`);
    }

    const strategy = resolveStrategyFromBrandPreferences(brand.preferences);
    const contentRequests = buildContentRequests(gap, strategy.themes || ['lifestyle']);
    let totalGenerated = 0;

    for (const request of contentRequests) {
      try {
        totalGenerated += await persistGeneratedBatch({
          brandName: brand.name,
          brandId: gap.brandId,
          request,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        autopilotLogger.error('Failed to generate content batch', {
          brandId: brand.id,
          brandName: brand.name,
          error: { name: err.name, message: err.message, stack: err.stack },
        });
      }
    }

    if (totalGenerated > 0) {
      await scheduleGeneratedContent(gap.brandId, strategy);
    }
    return totalGenerated;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    autopilotLogger.error('Error generating content for brand', {
      brandId: gap.brandId,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    return 0;
  }
}
