import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import {
  ensureMultiDestinationEnabled,
  toCaptionAndHashtags,
  type AuthenticatedRequest,
} from './shared.js';
import {
  applyTemplateToDestinationIds,
  loadGroupForTemplate,
  requireTemplateDestinations,
  resolveEffectiveTemplate,
  syncScheduledDestinations,
} from './template-route-helpers.js';

type ResetDestinationRoute = {
  Params: {
    contentGroupId: string;
    contentId: string;
  };
};

function parseRouteParams(
  request: FastifyRequest<ResetDestinationRoute>,
  reply: FastifyReply
): { contentGroupId: string; contentId: string } | null {
  const { contentGroupId, contentId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  if (!contentId || typeof contentId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_id' });
    return null;
  }
  return { contentGroupId, contentId };
}

function normalizeFirstComment(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const next = value.trim();
  return next.length > 0 ? next : null;
}

async function handleResetDestination(
  request: FastifyRequest<ResetDestinationRoute>,
  reply: FastifyReply
) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const parsed = parseRouteParams(request, reply);
  if (!parsed) {
    return;
  }

  const userId = request.user!.id;
  const group = await loadGroupForTemplate(parsed.contentGroupId);
  if (!group || group.brand.userId !== userId) {
    return reply.code(404).send({ error: 'content_group_not_found' });
  }

  await assertBrandOwnership(userId, group.brandId);
  const destinationsResult = requireTemplateDestinations(group);
  if (!destinationsResult.ok) {
    return reply.code(400).send({ error: destinationsResult.error });
  }

  const destination = destinationsResult.destinations.find(
    (entry) => entry.id === parsed.contentId
  );
  if (!destination) {
    return reply.code(404).send({ error: 'destination_not_found' });
  }

  const template = resolveEffectiveTemplate(group);
  if (!template) {
    return reply.code(400).send({ error: 'content_group_missing_destinations' });
  }

  const normalized = toCaptionAndHashtags(template.caption, template.contentType);
  await applyTemplateToDestinationIds({
    destinationIds: [destination.id],
    template: {
      caption: normalized.caption,
      hashtags: normalized.hashtags,
      contentType: template.contentType,
      shareToFeed: template.shareToFeed,
      thumbOffset: template.thumbOffset,
      firstComment: normalizeFirstComment(template.firstComment),
      assetIds: template.assetIds,
    },
  });

  if (destination.status === 'scheduled' && destination.scheduledAt) {
    await syncScheduledDestinations([destination.id]);
  }

  return reply.send({ success: true, contentId: destination.id });
}

export function registerResetDestinationRoute(fastify: FastifyInstance) {
  fastify.post<ResetDestinationRoute>(
    '/groups/:contentGroupId/destinations/:contentId/reset-to-template',
    { preHandler: fastify.authenticate },
    handleResetDestination
  );
}
