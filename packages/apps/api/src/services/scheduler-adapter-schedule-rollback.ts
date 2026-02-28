import type { ContentStatus } from '@postolio/database';
import { getDatabaseClient } from '../config/database.js';
import { logger } from '@postolio/logger';

const prisma = getDatabaseClient();

export async function rollbackSchedulingFailure(params: {
  contentId: string;
  originalStatus: ContentStatus | null;
  originalScheduledAt: Date | null;
  message: string;
  fetchedContent: { brandId: string; brand: { userId: string } } | null;
  userId?: string;
}) {
  if (params.originalStatus === null) {
    return;
  }

  try {
    await prisma.content.update({
      where: { id: params.contentId },
      data: {
        status: params.originalStatus,
        scheduledAt: params.originalScheduledAt,
        schedulingError: `Scheduling failed: ${params.message}`,
      },
    });
  } catch (error) {
    logger.error('Failed to restore original state', { error, contentId: params.contentId });
    return;
  }

  try {
    const { notificationsService } = await import('./notifications.js');
    await notificationsService.emitEvent({
      userId: params.fetchedContent?.brand.userId || params.userId || '',
      brandId: params.fetchedContent?.brandId,
      type: 'publishing.scheduling_failed',
      category: 'publishing',
      severity: 'error',
      title: 'Scheduling failed',
      body: params.message,
      linkUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/posts/${params.contentId}`,
      resource: { type: 'post', id: params.contentId },
      dedupeKey: `content:${params.contentId}:scheduling_failed`,
    });
  } catch (error) {
    logger.error('Failed to emit scheduling failure notification', { error });
  }
}
