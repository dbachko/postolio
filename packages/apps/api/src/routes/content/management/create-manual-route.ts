import { buildContentResponse } from '../../../services/content-response-builder.js';
import { verifyBrandOwnership } from '../../../services/content-operations/authorization.js';
import {
  resolveAssets,
  validateRequestBody,
  type CreateManualContentBody,
} from '../../../utils/content-management.js';
import { createManualContentRecords, scheduleCreatedContent } from './create-manual-persistence.js';
import { resolveCreateDestinations } from './create-manual-destinations.js';
import { validateCreateRequest } from './create-manual-validation.js';
import type { AuthenticatedRequest } from './shared.js';
import type { FastifyInstance, FastifyReply } from 'fastify';

async function handleCreateManualContent(request: AuthenticatedRequest, reply: FastifyReply) {
  try {
    const userId = request.user!.id!;
    const body = request.body as CreateManualContentBody;

    const validationResult = validateRequestBody(body);
    if (validationResult.ok !== true) {
      return reply
        .code(400)
        .send(
          'error' in validationResult
            ? validationResult.error
            : { error: 'invalid_request', details: ['Invalid request body'] }
        );
    }

    const authResult = await verifyBrandOwnership(userId, body.brandId);
    if (!authResult.authorized) {
      return reply.code(404).send({ error: authResult.error });
    }

    const destinations = await resolveCreateDestinations({
      body,
      userId,
      email: request.user?.email,
      reply,
    });
    if (!destinations) {
      return;
    }

    const assetResult = await resolveAssets(body.assetIds, body.brandId, request, {
      enforceUniformAspectRatio: Boolean(body.scheduledAt),
    });
    if (!assetResult.success) {
      return reply.code(assetResult.code || 500).send({ error: assetResult.error });
    }

    const normalizedContentType = String(body.contentType ?? 'post');
    const resolvedAssets = assetResult.resolvedAssets ?? [];
    if (body.scheduledAt) {
      const createValidationError = validateCreateRequest({
        contentType: normalizedContentType,
        caption: body.caption,
        resolvedAssets,
        destinations,
        scheduledAt: body.scheduledAt,
      });
      if (createValidationError) {
        return reply.code(createValidationError.statusCode).send(createValidationError.body);
      }
    }

    const created = await createManualContentRecords({
      body,
      resolvedAssets,
      destinations,
    });
    if (created.contents.length === 0) {
      return reply.code(500).send({ error: 'Failed to create content' });
    }

    const upsell = await scheduleCreatedContent({
      contents: created.contents,
      scheduledAt: body.scheduledAt,
    });

    const contentResponses = created.contents.map(buildContentResponse);
    return reply.code(201).send({
      content: contentResponses[0],
      contents: created.contents.length > 1 ? contentResponses : undefined,
      contentGroupId: created.contentGroupId,
      metadata: { brandId: body.brandId, source: 'manual' },
      ...(upsell ? { upsell } : {}),
    });
  } catch (error) {
    request.log.error({ err: error }, 'Manual content creation error');
    throw error;
  }
}

export function registerCreateManualContentRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: CreateManualContentBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => handleCreateManualContent(request as AuthenticatedRequest, reply)
  );
}
