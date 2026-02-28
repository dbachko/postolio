import learningService from '../../../services/learning.js';
import { publishingQueueScheduler } from '../../../services/publishing-queue/queue-scheduler.js';
import { getStatusBroadcaster } from '../../../services/broadcast-registry.js';
import { prisma } from './shared.js';

export async function maintainQueueAfterUpdate(params: {
  content: any;
  contentId: string;
  scheduledAt: string | undefined;
  contentType: string | undefined;
}): Promise<void> {
  const queueItem = params.content.publishingQueueItem;
  const manualScheduled = params.scheduledAt !== undefined && Boolean(params.scheduledAt);
  const requestedLaneKey =
    params.contentType === 'reel' || params.contentType === 'story' || params.contentType === 'post'
      ? params.contentType
      : null;

  if (!queueItem) {
    return;
  }

  try {
    if (manualScheduled) {
      await prisma.publishingQueueItem.delete({ where: { id: queueItem.id } });
      await publishingQueueScheduler.recomputeBrandWindow(params.content.brand.id);
      return;
    }

    if (requestedLaneKey && requestedLaneKey !== String(queueItem.laneKey)) {
      const maxPosition = await prisma.publishingQueueItem.findFirst({
        where: { queueId: queueItem.queueId, laneKey: requestedLaneKey },
        select: { position: true },
        orderBy: { position: 'desc' },
      });

      await prisma.publishingQueueItem.update({
        where: { id: queueItem.id },
        data: {
          laneKey: requestedLaneKey,
          position: (maxPosition?.position ?? 0) + 1,
        },
      });

      await publishingQueueScheduler.recomputeBrandWindow(params.content.brand.id);
    }
  } catch {
    // Best effort queue maintenance
  }
}

export function triggerLearningAfterUpdate(params: {
  content: any;
  originalContent: { caption: string; scheduledAt?: string };
  updatedContent: any;
  caption: string | undefined;
  scheduledAt: string | undefined;
}): { learningActive: boolean; message: string } | null {
  const hasChanges =
    (params.caption !== undefined && params.caption !== params.originalContent.caption) ||
    (params.scheduledAt !== undefined && params.scheduledAt !== params.originalContent.scheduledAt);

  if (!hasChanges || !params.content.brand?.id) {
    return null;
  }

  const editedContent: { caption: string; scheduledAt?: string } = {
    caption: params.updatedContent.caption,
    ...(params.updatedContent.scheduledAt
      ? { scheduledAt: params.updatedContent.scheduledAt.toISOString() }
      : {}),
  };

  learningService
    .analyzeUserEdit(params.content.brand.id, params.originalContent, editedContent)
    .then((editAnalysis) =>
      learningService.applyLearningToStyleProfile(params.content.brand.id, editAnalysis)
    )
    .catch(() => {
      // Best effort learning process
    });

  return {
    learningActive: true,
    message: 'AI is learning from your edits...',
  };
}

export async function broadcastUpdatedContentStatus(params: {
  contentId: string;
  content: any;
  updatedContent: any;
}) {
  try {
    const broadcaster = getStatusBroadcaster();
    if (!broadcaster || !params.content.brand?.id) {
      return;
    }

    void broadcaster.broadcastStatusChange(
      params.contentId,
      params.content.brand.id,
      params.content.status,
      params.updatedContent.status,
      {
        kind: 'content_updated',
        scheduledAt: params.updatedContent.scheduledAt
          ? params.updatedContent.scheduledAt.toISOString()
          : null,
      }
    );
  } catch {
    // ignore
  }
}
