import type { FastifyInstance } from 'fastify';

import { schedulerService } from '../../../services/scheduler.js';
import { verifyContentOwnership } from '../../../services/content-operations/authorization.js';
import type { ApproveContentBody } from '../../../utils/content-management.js';
import { supportsScheduling } from '../../../utils/platform.js';
import { isDisconnected, prisma, type AuthenticatedRequest } from './shared.js';

async function validateSchedulingDestination(params: {
  contentId: string;
  brandId: string;
  targetSocialAccountId: string | null;
}) {
  if (!params.targetSocialAccountId) {
    return null;
  }

  const socialAccount = await prisma.socialAccount.findFirst({
    where: { id: params.targetSocialAccountId, brandId: params.brandId },
    select: { platform: true, metadata: true },
  });

  if (!socialAccount || isDisconnected(socialAccount.metadata)) {
    return {
      statusCode: 400,
      body: {
        error: 'invalid_target_social_account',
        message: 'Target social account is not connected to this brand',
      },
    };
  }

  if (!supportsScheduling(String(socialAccount.platform))) {
    return {
      statusCode: 400,
      body: {
        error: 'scheduling_not_supported',
        message: `Scheduling is not yet supported for ${String(socialAccount.platform)}`,
      },
    };
  }

  return null;
}

async function scheduleApprovedContent(contentId: string, request: AuthenticatedRequest) {
  try {
    const scheduleResult = await schedulerService.scheduleContent(contentId);
    if (!scheduleResult.success) {
      request.log.error({ err: scheduleResult.error, contentId }, 'Failed to create AWS schedule');
      return;
    }
    request.log.info({ contentId }, 'Content scheduled successfully in AWS');
  } catch (error) {
    request.log.error({ err: error, contentId }, 'Error calling scheduler service');
  }
}

export function registerApproveContentRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: ApproveContentBody }>(
    '/approve',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const typedRequest = request as AuthenticatedRequest;
        const userId = typedRequest.user!.id!;
        const { contentId, scheduledAt } = request.body as ApproveContentBody;

        const authResult = await verifyContentOwnership(userId, contentId);
        if (!authResult.authorized) {
          return reply.code(404).send({ error: authResult.error });
        }

        const content = await prisma.content.findFirst({
          where: { id: contentId },
          select: { id: true, status: true, brandId: true, targetSocialAccountId: true },
        });
        if (!content) {
          return reply.code(404).send({ error: 'Content not found' });
        }
        if (content.status !== 'draft') {
          return reply.code(400).send({ error: 'Content is not in draft status' });
        }

        if (scheduledAt) {
          const schedulingError = await validateSchedulingDestination({
            contentId,
            brandId: content.brandId,
            targetSocialAccountId: content.targetSocialAccountId,
          });
          if (schedulingError) {
            return reply.code(schedulingError.statusCode).send(schedulingError.body);
          }
        }

        const updatedContent = await prisma.content.update({
          where: { id: contentId },
          data: {
            status: scheduledAt ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          },
          select: { id: true, caption: true, status: true, scheduledAt: true, updatedAt: true },
        });

        if (scheduledAt) {
          await scheduleApprovedContent(contentId, typedRequest);
        }

        return { content: updatedContent };
      } catch (error) {
        request.log.error({ err: error }, 'Content approval error');
        throw error;
      }
    }
  );
}
