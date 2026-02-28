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

type ApplyTemplateRoute = {
  Params: { contentGroupId: string };
};

function parseContentGroupId(
  request: FastifyRequest<ApplyTemplateRoute>,
  reply: FastifyReply
): string | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  return contentGroupId;
}

async function loadApplyTemplateContext(params: {
  request: FastifyRequest<ApplyTemplateRoute>;
  reply: FastifyReply;
  contentGroupId: string;
}) {
  const userId = params.request.user!.id;
  const group = await loadGroupForTemplate(params.contentGroupId);
  if (!group || group.brand.userId !== userId) {
    void params.reply.code(404).send({ error: 'content_group_not_found' });
    return null;
  }

  await assertBrandOwnership(userId, group.brandId);
  const destinationsResult = requireTemplateDestinations(group);
  if (!destinationsResult.ok) {
    void params.reply.code(400).send({ error: destinationsResult.error });
    return null;
  }

  const template = resolveEffectiveTemplate(group);
  if (!template) {
    void params.reply.code(400).send({ error: 'content_group_missing_destinations' });
    return null;
  }

  return {
    destinations: destinationsResult.destinations,
    template,
  };
}

function normalizeFirstComment(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const next = value.trim();
  return next.length > 0 ? next : null;
}

async function handleApplyTemplate(
  request: FastifyRequest<ApplyTemplateRoute>,
  reply: FastifyReply
) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const contentGroupId = parseContentGroupId(request, reply);
  if (!contentGroupId) {
    return;
  }

  const context = await loadApplyTemplateContext({ request, reply, contentGroupId });
  if (!context) {
    return;
  }

  const normalized = toCaptionAndHashtags(context.template.caption, context.template.contentType);
  const destinationIds = context.destinations.map((entry) => entry.id);
  await applyTemplateToDestinationIds({
    destinationIds,
    template: {
      caption: normalized.caption,
      hashtags: normalized.hashtags,
      contentType: context.template.contentType,
      shareToFeed: context.template.shareToFeed,
      thumbOffset: context.template.thumbOffset,
      firstComment: normalizeFirstComment(context.template.firstComment),
      assetIds: context.template.assetIds,
    },
  });

  const scheduledIds = context.destinations
    .filter((entry) => entry.status === 'scheduled' && entry.scheduledAt)
    .map((entry) => entry.id);
  await syncScheduledDestinations(scheduledIds);

  return reply.send({ success: true, updatedContentIds: destinationIds });
}

export function registerApplyTemplateRoute(fastify: FastifyInstance) {
  fastify.post<ApplyTemplateRoute>(
    '/groups/:contentGroupId/apply-template',
    { preHandler: fastify.authenticate },
    handleApplyTemplate
  );
}
