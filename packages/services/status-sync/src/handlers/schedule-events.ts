import type { ContentStatus, PrismaClient as LambdaPrismaClient } from '@postolio/database/lambda';
import { getClient } from '../runtime';
import type { EventDetail } from '../types';

export async function handleScheduleFailed(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  const existingParams = await getGenerationParams(client, contentId);

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'failed' as ContentStatus,
      scheduledAt: null,
      schedulingError: detail.error?.slice(0, 500) || 'Scheduling failed',
      generationParams: {
        ...existingParams,
        processing: null,
        awsScheduleCreated: false,
        failedAt: new Date().toISOString(),
      },
    },
  });
}

export async function handleScheduleCreated(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  const existingParams = await getGenerationParams(client, contentId);

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'scheduled' as ContentStatus,
      scheduledAt: detail.scheduledAt ? new Date(detail.scheduledAt) : undefined,
      schedulingError: null,
      generationParams: {
        ...existingParams,
        scheduleId: detail.scheduleId,
        awsScheduleCreated: true,
        processing: null,
        scheduledAt: detail.scheduledAt,
        scheduledTimestamp: new Date().toISOString(),
      },
    },
  });
}

export async function handleScheduleUpdated(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  const scheduledAt = detail.updates?.scheduledAt;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  const existingParams = await getGenerationParams(client, contentId);

  await client.content.update({
    where: { id: contentId },
    data: {
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      generationParams: {
        ...existingParams,
        ...(detail.scheduleId && { scheduleId: detail.scheduleId }),
        awsScheduleCreated: true,
        processing: null,
        lastUpdated: new Date().toISOString(),
      },
    },
  });
}

export async function handleScheduleCanceled(detail: EventDetail): Promise<void> {
  const contentId = detail.contentId;
  if (!contentId) {
    return;
  }

  const client = await getClient();
  const existingParams = await getGenerationParams(client, contentId);

  await client.content.update({
    where: { id: contentId },
    data: {
      status: 'draft' as ContentStatus,
      scheduledAt: null,
      schedulingError: null,
      generationParams: {
        ...existingParams,
        scheduleId: null,
        awsScheduleCreated: false,
        processing: null,
        canceledAt: new Date().toISOString(),
      },
    },
  });
}

async function getGenerationParams(
  client: LambdaPrismaClient,
  contentId: string
): Promise<Record<string, unknown>> {
  const currentContent = await client.content.findUnique({
    where: { id: contentId },
    select: { generationParams: true },
  });

  return (currentContent?.generationParams as Record<string, unknown>) || {};
}
