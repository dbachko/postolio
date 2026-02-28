import { schedulerService } from '../../../services/scheduler.js';
import { prisma, type MutableContentUpdate, type RouteError } from './shared.js';

export type SchedulingState = {
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
  requestedScheduledAt: Date | null;
  scheduledInAwsBeforeUpdate: boolean;
  newScheduleFailed: boolean;
  newScheduleError?: string;
  planLimitHit: boolean;
  planLimitMessage?: string;
  needsNewSchedule: boolean;
};

function hasUpgradeRequiredMessage(error: unknown): error is string {
  return typeof error === 'string' && error.toLowerCase().includes('upgrade required');
}

function isMissingScheduleError(error: string): boolean {
  const value = error.toLowerCase();
  return (
    value.includes('not scheduled') ||
    value.includes('content is not scheduled') ||
    value.includes('not found') ||
    value.includes('missing') ||
    value.includes('does not exist')
  );
}

function resolveSchedulingTimes(content: any, updateData: MutableContentUpdate) {
  const originalScheduledTime = content.scheduledAt?.toISOString();
  const newScheduledTime = updateData.scheduledAt?.toISOString();
  const requestedScheduledAt =
    (updateData.scheduledAt as Date | null | undefined) ?? content.scheduledAt ?? null;

  return { originalScheduledTime, newScheduledTime, requestedScheduledAt };
}

async function createScheduleBeforeUpdate(params: {
  contentId: string;
  updateData: MutableContentUpdate;
  firstComment: string | undefined;
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
}): Promise<{ scheduledInAwsBeforeUpdate: boolean; error?: string; planLimitMessage?: string }> {
  if (!params.newScheduledTime || params.originalScheduledTime) {
    return { scheduledInAwsBeforeUpdate: false };
  }

  try {
    if (params.firstComment !== undefined) {
      await prisma.content.update({
        where: { id: params.contentId },
        data: { firstComment: params.firstComment || null },
      });
    }

    const scheduleResult = await schedulerService.scheduleContent(
      params.contentId,
      params.updateData.scheduledAt!
    );
    if (scheduleResult.success) {
      return { scheduledInAwsBeforeUpdate: true };
    }

    return {
      scheduledInAwsBeforeUpdate: false,
      error: scheduleResult.error || 'Scheduling failed',
      planLimitMessage: hasUpgradeRequiredMessage(scheduleResult.error)
        ? scheduleResult.error
        : undefined,
    };
  } catch (error) {
    return {
      scheduledInAwsBeforeUpdate: false,
      error: error instanceof Error ? error.message : 'Scheduling failed unexpectedly',
    };
  }
}

async function rescheduleBeforeUpdate(params: {
  contentId: string;
  updateData: MutableContentUpdate;
  schedulingSupported: boolean;
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
}): Promise<{ needsNewSchedule: boolean; error?: RouteError }> {
  if (
    !params.schedulingSupported ||
    !params.originalScheduledTime ||
    !params.newScheduledTime ||
    params.originalScheduledTime === params.newScheduledTime
  ) {
    return { needsNewSchedule: false };
  }

  try {
    const result = await schedulerService.reschedulePost(
      params.contentId,
      params.updateData.scheduledAt!
    );
    if (result.success) {
      return { needsNewSchedule: false };
    }

    if (result.error && isMissingScheduleError(result.error)) {
      return { needsNewSchedule: true };
    }

    if (result.error?.includes('AWS scheduler temporarily unavailable')) {
      return {
        needsNewSchedule: false,
        error: {
          statusCode: 503,
          body: {
            success: false,
            error:
              'Scheduling service is temporarily unavailable. Please try again in a few moments.',
            data: null,
          },
        },
      };
    }

    return {
      needsNewSchedule: false,
      error: {
        statusCode: 500,
        body: {
          success: false,
          error: result.error,
          data: null,
        },
      },
    };
  } catch (error) {
    return {
      needsNewSchedule: false,
      error: {
        statusCode: 500,
        body: {
          success: false,
          error: `Reschedule failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          data: null,
        },
      },
    };
  }
}

export async function runPreUpdateScheduling(params: {
  content: any;
  contentId: string;
  updateData: MutableContentUpdate;
  firstComment: string | undefined;
  schedulingSupported: boolean;
}): Promise<{ state: SchedulingState; error?: RouteError }> {
  const times = resolveSchedulingTimes(params.content, params.updateData);

  const createResult = await createScheduleBeforeUpdate({
    contentId: params.contentId,
    updateData: params.updateData,
    firstComment: params.firstComment,
    originalScheduledTime: times.originalScheduledTime,
    newScheduledTime: times.newScheduledTime,
  });

  const rescheduleResult = await rescheduleBeforeUpdate({
    contentId: params.contentId,
    updateData: params.updateData,
    schedulingSupported: params.schedulingSupported,
    originalScheduledTime: times.originalScheduledTime,
    newScheduledTime: times.newScheduledTime,
  });

  const state: SchedulingState = {
    originalScheduledTime: times.originalScheduledTime,
    newScheduledTime: times.newScheduledTime,
    requestedScheduledAt: times.requestedScheduledAt,
    scheduledInAwsBeforeUpdate: createResult.scheduledInAwsBeforeUpdate,
    newScheduleFailed: Boolean(createResult.error),
    newScheduleError: createResult.error,
    planLimitHit: Boolean(createResult.planLimitMessage),
    planLimitMessage: createResult.planLimitMessage,
    needsNewSchedule: rescheduleResult.needsNewSchedule,
  };

  if (rescheduleResult.error) {
    return { state, error: rescheduleResult.error };
  }

  return { state };
}

export async function persistPreUpdateSchedulingFailure(
  contentId: string,
  state: SchedulingState
): Promise<void> {
  if (!state.newScheduleFailed || state.planLimitHit) {
    return;
  }

  try {
    await prisma.content.update({
      where: { id: contentId },
      data: {
        status: 'failed',
        scheduledAt: state.requestedScheduledAt,
        schedulingError: state.newScheduleError || 'Failed to schedule content',
      },
    });
  } catch {
    // Best effort only
  }
}

export function buildPreUpdateFailureResponse(state: SchedulingState): RouteError | null {
  if (!state.newScheduleFailed) {
    return null;
  }

  const message =
    state.planLimitHit && state.planLimitMessage
      ? state.planLimitMessage
      : state.newScheduleError || 'Failed to schedule content';

  return {
    statusCode: state.planLimitHit ? 402 : 500,
    body: {
      success: false,
      error: message,
      data: null,
    },
  };
}

async function scheduleAfterUpdate(params: {
  contentId: string;
  updatedContent: any;
  requestedScheduledAt: Date | null;
  needsNewSchedule: boolean;
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
}): Promise<RouteError | null> {
  if (!((!params.originalScheduledTime && params.newScheduledTime) || params.needsNewSchedule)) {
    return null;
  }

  try {
    const scheduleResult = await schedulerService.scheduleContent(params.contentId);
    if (scheduleResult.success) {
      return null;
    }

    await prisma.content.update({
      where: { id: params.contentId },
      data: {
        status: 'failed',
        scheduledAt: params.requestedScheduledAt,
        schedulingError: scheduleResult.error || 'Scheduling failed after saving the post.',
      },
    });

    const planLimitHit = hasUpgradeRequiredMessage(scheduleResult.error);
    return {
      statusCode: planLimitHit ? 402 : 502,
      body: {
        success: false,
        error:
          scheduleResult.error ||
          'Scheduling service unavailable. Your post was saved but not scheduled.',
        data: null,
      },
    };
  } catch (error) {
    await prisma.content.update({
      where: { id: params.contentId },
      data: {
        status: 'failed',
        scheduledAt: params.requestedScheduledAt,
        schedulingError: error instanceof Error ? error.message : 'Scheduling failed unexpectedly',
      },
    });

    return {
      statusCode: 502,
      body: {
        success: false,
        error: 'Scheduling service unavailable. Your post was saved but not scheduled.',
        data: null,
      },
    };
  }
}

async function cancelScheduleAfterUpdate(params: {
  contentId: string;
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
}) {
  if (!(params.originalScheduledTime && !params.newScheduledTime)) {
    return;
  }

  try {
    await schedulerService.cancelScheduledPost(params.contentId);
  } catch {
    // best effort
  }
}

async function syncSchedulePayloadAfterUpdate(params: {
  contentId: string;
  updatedContent: any;
  contentChanged: boolean;
  originalScheduledTime: string | undefined;
  newScheduledTime: string | undefined;
}) {
  const timeChanged = Boolean(
    params.originalScheduledTime &&
    params.newScheduledTime &&
    params.originalScheduledTime !== params.newScheduledTime
  );

  if (!params.updatedContent.scheduledAt || !params.contentChanged || timeChanged) {
    return;
  }

  try {
    await schedulerService.updateScheduledContent(params.contentId);
  } catch {
    // best effort
  }
}

export async function runPostUpdateScheduling(params: {
  contentId: string;
  updatedContent: any;
  state: SchedulingState;
  schedulingSupported: boolean;
  scheduledAt: string | undefined;
  contentChanged: boolean;
}): Promise<RouteError | null> {
  if (
    !params.schedulingSupported ||
    params.scheduledAt === undefined ||
    params.state.scheduledInAwsBeforeUpdate
  ) {
    return null;
  }

  const scheduleError = await scheduleAfterUpdate({
    contentId: params.contentId,
    updatedContent: params.updatedContent,
    requestedScheduledAt: params.state.requestedScheduledAt,
    needsNewSchedule: params.state.needsNewSchedule,
    originalScheduledTime: params.state.originalScheduledTime,
    newScheduledTime: params.state.newScheduledTime,
  });
  if (scheduleError) {
    return scheduleError;
  }

  await cancelScheduleAfterUpdate({
    contentId: params.contentId,
    originalScheduledTime: params.state.originalScheduledTime,
    newScheduledTime: params.state.newScheduledTime,
  });

  await syncSchedulePayloadAfterUpdate({
    contentId: params.contentId,
    updatedContent: params.updatedContent,
    contentChanged: params.contentChanged,
    originalScheduledTime: params.state.originalScheduledTime,
    newScheduledTime: params.state.newScheduledTime,
  });

  return null;
}
