import type { FastifyInstance } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import {
  deriveTemplateFromDestination,
  ensureMultiDestinationEnabled,
  getProfilePictureUrl,
  isDisconnected,
  prisma,
  type AuthenticatedRequest,
} from './shared.js';

const GROUP_WITH_DESTINATIONS_INCLUDE = {
  brand: { select: { id: true, userId: true } },
  contents: {
    select: {
      id: true,
      caption: true,
      hashtags: true,
      status: true,
      scheduledAt: true,
      postedAt: true,
      createdAt: true,
      updatedAt: true,
      brandId: true,
      contentGroupId: true,
      targetSocialAccountId: true,
      schedulingError: true,
      generationParams: true,
      contentType: true,
      shareToFeed: true,
      thumbOffset: true,
      firstComment: true,
      firstCommentStatus: true,
      firstCommentPostedAt: true,
      firstCommentError: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' as const },
      },
      targetSocialAccount: {
        select: {
          id: true,
          platform: true,
          username: true,
          displayName: true,
          metadata: true,
          sortOrder: true,
          createdAt: true,
        },
      },
    },
  },
} as const;

function compareDestinations(
  a: {
    targetSocialAccount?: { sortOrder?: number | null; createdAt?: Date | null } | null;
  },
  b: {
    targetSocialAccount?: { sortOrder?: number | null; createdAt?: Date | null } | null;
  }
) {
  const aOrder =
    typeof a.targetSocialAccount?.sortOrder === 'number' ? a.targetSocialAccount.sortOrder : 0;
  const bOrder =
    typeof b.targetSocialAccount?.sortOrder === 'number' ? b.targetSocialAccount.sortOrder : 0;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  const aCreated =
    a.targetSocialAccount?.createdAt instanceof Date
      ? a.targetSocialAccount.createdAt.getTime()
      : 0;
  const bCreated =
    b.targetSocialAccount?.createdAt instanceof Date
      ? b.targetSocialAccount.createdAt.getTime()
      : 0;
  return aCreated - bCreated;
}

function mapDestinations(contents: any[]) {
  return contents
    .slice()
    .sort(compareDestinations)
    .map((content) => ({
      content,
      socialAccount: content.targetSocialAccount
        ? {
            id: content.targetSocialAccount.id,
            platform: String(content.targetSocialAccount.platform),
            username: content.targetSocialAccount.username,
            displayName: content.targetSocialAccount.displayName,
            profilePictureUrl: getProfilePictureUrl(content.targetSocialAccount.metadata),
            disconnected: isDisconnected(content.targetSocialAccount.metadata),
          }
        : null,
    }));
}

export function registerGetGroupRoute(fastify: FastifyInstance) {
  fastify.get<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
        return;
      }
      const { contentGroupId } = request.params;
      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: GROUP_WITH_DESTINATIONS_INCLUDE,
      });
      if (!group || group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);
      const destinations = mapDestinations(group.contents as any[]);
      const templateSource = destinations[0]?.content;
      const template = templateSource
        ? deriveTemplateFromDestination({
            templateInitialized: group.templateInitialized,
            templateCaption: group.templateCaption,
            templateContentType: group.templateContentType,
            templateShareToFeed: group.templateShareToFeed,
            templateFirstComment: group.templateFirstComment,
            templateThumbOffset: group.templateThumbOffset,
            templateAssetIds: group.templateAssetIds as string[] | null,
            destination: templateSource,
          })
        : null;

      return reply.send({
        contentGroup: {
          id: group.id,
          brandId: group.brandId,
          createdAt: group.createdAt,
          updatedAt: group.updatedAt,
          template,
        },
        destinations,
      });
    }
  );
}
