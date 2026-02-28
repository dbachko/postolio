import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Prisma } from '@postolio/database';

import { buildContentResponse } from '../../../services/content-response-builder.js';
import { verifyContentEditable } from '../../../services/content-operations/authorization.js';
import { extractHashtagsFromCaption } from '../../../utils/hashtag-extractor.js';
import {
  maintainQueueAfterUpdate,
  triggerLearningAfterUpdate,
  broadcastUpdatedContentStatus,
} from './update-effects.js';
import {
  buildPreUpdateFailureResponse,
  persistPreUpdateSchedulingFailure,
  runPostUpdateScheduling,
  runPreUpdateScheduling,
} from './update-scheduling.js';
import {
  resolveTargetForUpdate,
  validatePublishableContent,
  validateSchedulingRequest,
} from './update-validation.js';
import {
  CONTENT_WITH_RELATIONS_INCLUDE,
  UPDATED_CONTENT_SELECT,
  prisma,
  type MutableContentUpdate,
  type UpdateContentBody,
} from './shared.js';

function buildOriginalContent(content: any): { caption: string; scheduledAt?: string } {
  return {
    caption: content.caption,
    ...(content.scheduledAt ? { scheduledAt: content.scheduledAt.toISOString() } : {}),
  };
}

function resolveEffectiveContentType(body: Partial<UpdateContentBody>, content: any) {
  return (body.contentType || content.contentType || 'post') as 'post' | 'reel' | 'story';
}

function resolveEffectiveCaption(
  body: Partial<UpdateContentBody>,
  content: any,
  effectiveContentType: 'post' | 'reel' | 'story'
): string {
  if (body.caption !== undefined) {
    return body.caption;
  }

  if (content.caption) {
    return content.caption;
  }

  return effectiveContentType === 'story' ? '' : '';
}

function applyBodyUpdates(params: {
  updateData: MutableContentUpdate;
  body: Partial<UpdateContentBody> & { scheduledAt?: string | null };
  effectiveCaption: string;
  content: any;
}) {
  if (params.body.caption !== undefined) {
    const normalizedCaption = params.effectiveCaption.trim();
    params.updateData.caption = normalizedCaption;
    params.updateData.hashtags = extractHashtagsFromCaption(normalizedCaption);
  }

  if (params.body.contentType !== undefined) {
    params.updateData.contentType = params.body.contentType;
  }

  if (params.body.scheduledAt !== undefined) {
    params.updateData.scheduledAt = params.body.scheduledAt
      ? new Date(params.body.scheduledAt)
      : null;
    if (params.body.scheduledAt) {
      params.updateData.status = 'scheduled';
    } else if (params.body.scheduledAt === null && params.content.status === 'scheduled') {
      params.updateData.status = 'draft';
    }
  }

  if (params.body.shareToFeed !== undefined) {
    params.updateData.shareToFeed = params.body.shareToFeed ?? null;
  }

  if (params.body.firstComment !== undefined) {
    params.updateData.firstComment = params.body.firstComment || null;
  }
}

async function updateContentRecord(contentId: string, updateData: MutableContentUpdate) {
  return prisma.content.update({
    where: { id: contentId },
    data: updateData as unknown as Prisma.ContentUpdateInput,
    select: UPDATED_CONTENT_SELECT,
  });
}

type PreparedUpdateContext = {
  contentId: string;
  body: Partial<UpdateContentBody> & { scheduledAt?: string | null };
  content: any;
  originalContent: { caption: string; scheduledAt?: string };
  updateData: MutableContentUpdate;
  target: NonNullable<Awaited<ReturnType<typeof resolveTargetForUpdate>>['data']>;
};

async function prepareUpdateContext(
  request: any,
  reply: FastifyReply
): Promise<{ response?: ReturnType<FastifyReply['send']>; context?: PreparedUpdateContext }> {
  const userId = request.user!.id;
  const contentId = request.params.contentId;
  const body = request.body as Partial<UpdateContentBody> & { scheduledAt?: string | null };

  const authResult = await verifyContentEditable(userId, contentId);
  if (!authResult.authorized) {
    return {
      response: reply
        .code(authResult.error?.includes('immutable') ? 400 : 404)
        .send({ error: authResult.error }),
    };
  }

  const content = await prisma.content.findFirst({
    where: { id: contentId },
    include: CONTENT_WITH_RELATIONS_INCLUDE,
  });
  if (!content?.brand) {
    return { response: reply.code(404).send({ error: 'Content not found' }) };
  }

  const originalContent = buildOriginalContent(content);
  const updateData: MutableContentUpdate = {};
  const effectiveContentType = resolveEffectiveContentType(body, content);
  const effectiveCaption = resolveEffectiveCaption(body, content, effectiveContentType);

  const targetResult = await resolveTargetForUpdate({
    userId,
    email: request.user?.email,
    content,
    targetSocialAccountId: body.targetSocialAccountId,
  });
  if (targetResult.error) {
    return {
      response: reply.code(targetResult.error.statusCode).send(targetResult.error.body),
    };
  }

  const target = targetResult.data!;
  if (target.updateTargetSocialAccountId !== undefined) {
    updateData.targetSocialAccountId = target.updateTargetSocialAccountId;
  }

  const schedulingValidation = validateSchedulingRequest({
    scheduledAt: body.scheduledAt ?? undefined,
    destinationPlatform: target.destinationPlatform,
    schedulingSupported: target.schedulingSupported,
    schedulingEligible: target.schedulingEligible,
  });
  if (schedulingValidation) {
    return {
      response: reply.code(schedulingValidation.statusCode).send(schedulingValidation.body),
    };
  }

  const publishableValidation = await validatePublishableContent(request, {
    content,
    contentId,
    effectiveContentType,
    effectiveCaption,
    destinationPlatform: target.destinationPlatform,
    scheduledAt: body.scheduledAt ?? undefined,
  });
  if (publishableValidation) {
    return {
      response: reply.code(publishableValidation.statusCode).send(publishableValidation.body),
    };
  }

  applyBodyUpdates({ updateData, body, effectiveCaption, content });

  return {
    context: {
      contentId,
      body,
      content,
      originalContent,
      updateData,
      target,
    },
  };
}

async function applyUpdateLifecycle(
  reply: FastifyReply,
  context: PreparedUpdateContext
): Promise<ReturnType<FastifyReply['send']> | Record<string, unknown>> {
  const preScheduleResult = await runPreUpdateScheduling({
    content: context.content,
    contentId: context.contentId,
    updateData: context.updateData,
    firstComment: context.body.firstComment,
    schedulingSupported: context.target.schedulingSupported,
  });

  if (preScheduleResult.error) {
    return reply.code(preScheduleResult.error.statusCode).send(preScheduleResult.error.body);
  }

  await persistPreUpdateSchedulingFailure(context.contentId, preScheduleResult.state);
  const preScheduleFailure = buildPreUpdateFailureResponse(preScheduleResult.state);
  if (preScheduleFailure) {
    return reply.code(preScheduleFailure.statusCode).send(preScheduleFailure.body);
  }

  const updatedContent = await updateContentRecord(context.contentId, context.updateData);

  const contentChanged =
    context.body.caption !== undefined ||
    context.body.contentType !== undefined ||
    context.body.shareToFeed !== undefined ||
    context.body.firstComment !== undefined;

  const postScheduleError = await runPostUpdateScheduling({
    contentId: context.contentId,
    updatedContent,
    state: preScheduleResult.state,
    schedulingSupported: context.target.schedulingSupported,
    scheduledAt: context.body.scheduledAt ?? undefined,
    contentChanged,
  });
  if (postScheduleError) {
    return reply.code(postScheduleError.statusCode).send(postScheduleError.body);
  }

  await maintainQueueAfterUpdate({
    content: context.content,
    contentId: context.contentId,
    scheduledAt: context.body.scheduledAt ?? undefined,
    contentType: context.body.contentType,
  });

  const learningResults = triggerLearningAfterUpdate({
    content: context.content,
    originalContent: context.originalContent,
    updatedContent,
    caption: context.body.caption,
    scheduledAt: context.body.scheduledAt ?? undefined,
  });

  const contentWithUrl = buildContentResponse({
    ...(updatedContent as any),
    generatedByRecipe: (updatedContent as any).recipeRun?.recipeTemplate ?? null,
  });

  await broadcastUpdatedContentStatus({
    contentId: context.contentId,
    content: context.content,
    updatedContent,
  });

  return {
    content: contentWithUrl,
    learning: learningResults,
  };
}

async function processUpdateContent(
  request: any,
  reply: FastifyReply
): Promise<ReturnType<FastifyReply['send']> | void | Record<string, unknown>> {
  const prepared = await prepareUpdateContext(request, reply);
  if (prepared.response) {
    return prepared.response;
  }
  return applyUpdateLifecycle(reply, prepared.context!);
}

export function registerContentUpdateRoute(fastify: FastifyInstance): void {
  fastify.put<{
    Params: { contentId: string };
    Body: UpdateContentBody | Omit<UpdateContentBody, 'contentId'>;
  }>('/:contentId', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      return await processUpdateContent(request, reply);
    } catch (error) {
      request.log.error({ err: error }, 'Content update error');
      throw error;
    }
  });
}
