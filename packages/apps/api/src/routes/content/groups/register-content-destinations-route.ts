import type { FastifyInstance } from 'fastify';
import { verifyContentEditable } from '../../../services/content-operations/authorization.js';
import {
  buildForwardAuthHeaders,
  ensureMultiDestinationEnabled,
  isDisconnected,
  parseTargetSocialAccountIds,
  prisma,
  resetGenerationParamsForDestination,
  type AuthenticatedRequest,
} from './shared.js';

type ContentWithAssets = NonNullable<Awaited<ReturnType<typeof loadContentById>>>;

async function loadContentById(contentId: string) {
  return prisma.content.findUnique({
    where: { id: contentId },
    select: {
      id: true,
      status: true,
      postedAt: true,
      brandId: true,
      contentGroupId: true,
      targetSocialAccountId: true,
      caption: true,
      contentType: true,
      shareToFeed: true,
      thumbOffset: true,
      firstComment: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
  });
}

async function delegateToGroupDestinationRoute(params: {
  fastify: FastifyInstance;
  groupId: string;
  headers: Record<string, string>;
  targetSocialAccountIds: string[];
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } };
}) {
  const response = await params.fastify.inject({
    method: 'POST',
    url: `/api/content/groups/${encodeURIComponent(params.groupId)}/destinations`,
    headers: params.headers,
    payload: { targetSocialAccountIds: params.targetSocialAccountIds },
  });
  let payload: unknown = null;
  try {
    payload = response.json();
  } catch {
    payload = response.payload || null;
  }
  return params.reply.code(response.statusCode).send(payload);
}

async function resolveExistingDestinationId(
  content: ContentWithAssets,
  targetSocialAccountIds: string[]
) {
  const existing =
    typeof content.targetSocialAccountId === 'string' ? content.targetSocialAccountId.trim() : '';
  if (existing) {
    return { ok: true as const, value: existing };
  }
  const fallbackId = targetSocialAccountIds[0];
  const account = await prisma.socialAccount.findFirst({
    where: { id: fallbackId, brandId: content.brandId },
    select: { id: true, metadata: true },
  });
  if (!account || isDisconnected(account.metadata)) {
    return { ok: false as const, invalidIds: [fallbackId] };
  }
  return { ok: true as const, value: fallbackId };
}

async function createContentGroupFromContent(
  content: ContentWithAssets,
  existingDestinationId: string
) {
  const assetIds = content.mediaAssets
    .slice()
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((asset) => asset.assetId);

  return prisma.$transaction(async (tx) => {
    const createdGroup = await tx.contentGroup.create({
      data: {
        brandId: content.brandId,
        templateInitialized: true,
        templateCaption: content.caption,
        templateContentType: content.contentType ?? 'post',
        templateShareToFeed: content.shareToFeed ?? null,
        templateFirstComment: content.firstComment ? content.firstComment.trim() : null,
        templateThumbOffset:
          typeof content.thumbOffset === 'number' && Number.isFinite(content.thumbOffset)
            ? Math.max(0, content.thumbOffset)
            : null,
        templateAssetIds: assetIds,
      },
      select: { id: true },
    });
    await tx.content.update({
      where: { id: content.id },
      data: {
        contentGroupId: createdGroup.id,
        generationParams: resetGenerationParamsForDestination(),
        targetSocialAccountId: existingDestinationId,
      },
    });
    return createdGroup;
  });
}

export function registerContentDestinationsRoute(fastify: FastifyInstance) {
  fastify.post<{
    Params: { contentId: string };
    Body: { targetSocialAccountIds?: string[] };
  }>('/:contentId/destinations', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
      return;
    }
    const { contentId } = request.params;
    if (!contentId || typeof contentId !== 'string') {
      return reply.code(400).send({ error: 'invalid_content_id' });
    }

    const targetSocialAccountIds = parseTargetSocialAccountIds(
      (request.body as any)?.targetSocialAccountIds
    );
    if (targetSocialAccountIds.length === 0) {
      return reply.code(400).send({
        error: 'invalid_target_social_account',
        message: 'targetSocialAccountIds must include at least one destination',
      });
    }

    const authResult = await verifyContentEditable(userId, contentId);
    if (!authResult.authorized) {
      return reply
        .code(authResult.error?.includes('immutable') ? 400 : 404)
        .send({ error: authResult.error });
    }

    const content = await loadContentById(contentId);
    if (!content) {
      return reply.code(404).send({ error: 'content_not_found' });
    }
    if (content.status === 'published' || content.postedAt) {
      return reply.code(400).send({
        error: 'content_immutable',
        message: 'Published posts are immutable and cannot be modified',
      });
    }

    const headers = buildForwardAuthHeaders(request.headers);
    if (typeof content.contentGroupId === 'string' && content.contentGroupId.trim()) {
      return delegateToGroupDestinationRoute({
        fastify,
        groupId: content.contentGroupId.trim(),
        headers,
        targetSocialAccountIds,
        reply,
      });
    }

    const existingDestination = await resolveExistingDestinationId(content, targetSocialAccountIds);
    if (!existingDestination.ok) {
      return reply.code(400).send({
        error: 'invalid_target_social_account',
        message: 'One or more destination social accounts are not connected to this brand',
        details: existingDestination.invalidIds,
      });
    }

    const group = await createContentGroupFromContent(content, existingDestination.value);
    return delegateToGroupDestinationRoute({
      fastify,
      groupId: group.id,
      headers,
      targetSocialAccountIds,
      reply,
    });
  });
}
