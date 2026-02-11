/**
 * Content Group Routes
 * Multi-destination posts are represented as a ContentGroup with one Content row per destination.
 */

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';
import { validateContentPayload } from '@postolio/content-validation';
import type { AssetRecord } from '@postolio/assets-client';

import { getDatabaseClient } from '../../config/database.js';
import { getMaxQueueDepthForTier } from '../../constants/subscription.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { validateQueueableContent } from '../../services/publishing-queue/queue-content-validation.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { schedulerService } from '../../services/scheduler.js';
import { verifyContentEditable } from '../../services/content-operations/authorization.js';
import { extractHashtagsFromCaption } from '../../utils/hashtag-extractor.js';
import { haveUniformAspectRatio } from '../../utils/aspect-ratio.js';
import { supportsScheduling, toValidationPlatform } from '../../utils/platform.js';

const prisma = getDatabaseClient();

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as any).disconnected);
}

function getProfilePictureUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const meta = metadata as Record<string, unknown>;
  const direct = meta.profile_picture_url;
  if (typeof direct === 'string' && direct) return direct;

  const profileData =
    meta.profileData && typeof meta.profileData === 'object' && !Array.isArray(meta.profileData)
      ? (meta.profileData as Record<string, unknown>)
      : null;
  const nested = profileData?.profile_picture_url;
  if (typeof nested === 'string' && nested) return nested;
  return null;
}

const groupsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/content/groups/:contentGroupId
  fastify.get<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
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
                orderBy: { displayOrder: 'asc' },
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
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        // Avoid leaking group existence across users.
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      // Extra safety: ensure brand ownership (centralized authorization behavior)
      await assertBrandOwnership(userId, group.brandId);

      const destinations = group.contents
        .slice()
        .sort((a, b) => {
          const aOrder =
            typeof a.targetSocialAccount?.sortOrder === 'number'
              ? a.targetSocialAccount.sortOrder
              : 0;
          const bOrder =
            typeof b.targetSocialAccount?.sortOrder === 'number'
              ? b.targetSocialAccount.sortOrder
              : 0;
          if (aOrder !== bOrder) return aOrder - bOrder;
          const aCreated =
            a.targetSocialAccount?.createdAt instanceof Date
              ? a.targetSocialAccount.createdAt.getTime()
              : 0;
          const bCreated =
            b.targetSocialAccount?.createdAt instanceof Date
              ? b.targetSocialAccount.createdAt.getTime()
              : 0;
          return aCreated - bCreated;
        })
        .map((content) => {
          const social = content.targetSocialAccount
            ? {
                id: content.targetSocialAccount.id,
                platform: String(content.targetSocialAccount.platform),
                username: content.targetSocialAccount.username,
                displayName: content.targetSocialAccount.displayName,
                profilePictureUrl: getProfilePictureUrl(content.targetSocialAccount.metadata),
                disconnected: isDisconnected(content.targetSocialAccount.metadata),
              }
            : null;

          return {
            content,
            socialAccount: social,
          };
        });

      const templateSource = destinations[0]?.content ?? null;
      const template = {
        initialized: group.templateInitialized === true,
        caption:
          group.templateInitialized === true
            ? (group.templateCaption ?? templateSource?.caption ?? '')
            : (templateSource?.caption ?? ''),
        contentType:
          group.templateInitialized === true
            ? (group.templateContentType ?? templateSource?.contentType ?? 'post')
            : (templateSource?.contentType ?? 'post'),
        shareToFeed:
          group.templateInitialized === true
            ? (group.templateShareToFeed ?? templateSource?.shareToFeed ?? null)
            : (templateSource?.shareToFeed ?? null),
        firstComment:
          group.templateInitialized === true
            ? (group.templateFirstComment ?? templateSource?.firstComment ?? null)
            : (templateSource?.firstComment ?? null),
        thumbOffset:
          group.templateInitialized === true
            ? (group.templateThumbOffset ?? templateSource?.thumbOffset ?? null)
            : (templateSource?.thumbOffset ?? null),
        assetIds:
          group.templateInitialized === true
            ? Array.isArray(group.templateAssetIds)
              ? group.templateAssetIds
              : []
            : Array.isArray(templateSource?.mediaAssets)
              ? templateSource.mediaAssets
                  .slice()
                  .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                  .map((asset) => asset.assetId)
              : [],
      };

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

  // POST /api/content/:contentId/destinations
  // Adds destinations to a single-destination post:
  // - If the post is already part of a group, delegates to the group destination endpoint.
  // - Otherwise, converts the post into a content group (using the post as the initial destination/template)
  //   and then adds the requested destinations.
  fastify.post<{
    Params: { contentId: string };
    Body: { targetSocialAccountIds?: string[] };
  }>('/:contentId/destinations', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { contentId } = request.params;

    if (!contentId || typeof contentId !== 'string') {
      return reply.code(400).send({ error: 'invalid_content_id' });
    }

    const raw = (request.body as any)?.targetSocialAccountIds;
    const targetSocialAccountIds = Array.isArray(raw)
      ? raw
          .filter((v: unknown): v is string => typeof v === 'string')
          .map((v: string) => v.trim())
          .filter((v: string) => v.length > 0)
      : [];

    if (targetSocialAccountIds.length === 0) {
      return reply.code(400).send({
        error: 'invalid_target_social_account',
        message: 'targetSocialAccountIds must include at least one destination',
      });
    }

    const authResult = await verifyContentEditable(userId, contentId);
    if (!authResult.authorized) {
      const isImmutable = Boolean(authResult.error && authResult.error.includes('immutable'));
      return reply.code(isImmutable ? 400 : 404).send({ error: authResult.error });
    }

    const content = await prisma.content.findUnique({
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

    if (!content) {
      return reply.code(404).send({ error: 'content_not_found' });
    }

    if (content.status === 'published' || content.postedAt) {
      return reply.code(400).send({
        error: 'content_immutable',
        message: 'Published posts are immutable and cannot be modified',
      });
    }

    const headers: Record<string, string> = {};
    if (typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;
    if (typeof request.headers.authorization === 'string')
      headers.authorization = request.headers.authorization;
    if (typeof request.headers['csrf-token'] === 'string')
      headers['csrf-token'] = request.headers['csrf-token'];

    const delegateToGroup = async (groupId: string) => {
      const r = await fastify.inject({
        method: 'POST',
        url: `/api/content/groups/${encodeURIComponent(groupId)}/destinations`,
        headers,
        payload: { targetSocialAccountIds },
      });

      let data: unknown = null;
      try {
        data = r.json();
      } catch {
        data = r.payload || null;
      }

      return reply.code(r.statusCode).send(data);
    };

    if (
      content.contentGroupId &&
      typeof content.contentGroupId === 'string' &&
      content.contentGroupId.trim()
    ) {
      return delegateToGroup(content.contentGroupId.trim());
    }

    let existingDestinationId =
      typeof content.targetSocialAccountId === 'string' ? content.targetSocialAccountId.trim() : '';
    if (!existingDestinationId) {
      const fallbackId = targetSocialAccountIds[0];
      const account = await prisma.socialAccount.findFirst({
        where: { id: fallbackId, brandId: content.brandId },
        select: { id: true, metadata: true },
      });

      if (!account || isDisconnected(account.metadata)) {
        return reply.code(400).send({
          error: 'invalid_target_social_account',
          message: 'One or more destination social accounts are not connected to this brand',
          details: [fallbackId],
        });
      }

      existingDestinationId = fallbackId;
    }

    const assetIds = Array.isArray(content.mediaAssets)
      ? content.mediaAssets
          .slice()
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map((asset) => asset.assetId)
      : [];

    const group = await prisma.$transaction(async (tx) => {
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
          generationParams: Prisma.JsonNull,
          targetSocialAccountId: existingDestinationId,
        },
      });

      return createdGroup;
    });

    return delegateToGroup(group.id);
  });

  // POST /api/content/groups/:contentGroupId/destinations
  // Adds one or more destinations to an existing group (creates new Content rows from the group template).
  fastify.post<{
    Params: { contentGroupId: string };
    Body: { targetSocialAccountIds?: string[] };
  }>(
    '/groups/:contentGroupId/destinations',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const raw = (request.body as any)?.targetSocialAccountIds;
      const targetSocialAccountIds = Array.isArray(raw)
        ? raw
            .filter((v: unknown): v is string => typeof v === 'string')
            .map((v: string) => v.trim())
            .filter((v: string) => v.length > 0)
        : [];

      if (targetSocialAccountIds.length === 0) {
        return reply.code(400).send({
          error: 'invalid_target_social_account',
          message: 'targetSocialAccountIds must include at least one destination',
        });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              caption: true,
              hashtags: true,
              status: true,
              scheduledAt: true,
              brandId: true,
              contentGroupId: true,
              targetSocialAccountId: true,
              contentType: true,
              shareToFeed: true,
              thumbOffset: true,
              firstComment: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
              targetSocialAccount: {
                select: {
                  id: true,
                  platform: true,
                  metadata: true,
                  sortOrder: true,
                  createdAt: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      const destinations = group.contents.filter((c) => c.targetSocialAccountId);
      if (destinations.length === 0) {
        return reply.code(400).send({ error: 'content_group_missing_destinations' });
      }

      if (destinations.some((c) => c.status === 'published')) {
        return reply.code(400).send({
          error: 'content_group_immutable',
          message: 'This content group contains published posts and cannot be modified',
        });
      }

      const existingSocialAccountIds = new Set(
        destinations
          .map((c) =>
            typeof c.targetSocialAccountId === 'string' ? c.targetSocialAccountId.trim() : ''
          )
          .filter((id) => id.length > 0)
      );

      const uniqueRequestedIds = Array.from(new Set(targetSocialAccountIds));
      const toAdd = uniqueRequestedIds.filter((id) => !existingSocialAccountIds.has(id));

      if (toAdd.length === 0) {
        return reply.send({ success: true, added: [] });
      }

      const accounts = await prisma.socialAccount.findMany({
        where: { brandId: group.brandId, id: { in: toAdd } },
        select: { id: true, platform: true, metadata: true },
      });
      const byId = new Map(accounts.map((a) => [a.id, a]));

      const invalid: string[] = [];
      const resolvedAccounts: Array<{ id: string; platform: string; metadata: unknown }> = [];
      for (const id of toAdd) {
        const account = byId.get(id);
        if (!account) {
          invalid.push(id);
          continue;
        }
        if (isDisconnected(account.metadata)) {
          invalid.push(id);
          continue;
        }
        resolvedAccounts.push({
          id: account.id,
          platform: String(account.platform),
          metadata: account.metadata,
        });
      }

      if (invalid.length > 0) {
        return reply.code(400).send({
          error: 'invalid_target_social_account',
          message: 'One or more destination social accounts are not connected to this brand',
          details: invalid,
        });
      }

      const orderedDestinations = destinations.slice().sort((a, b) => {
        const aOrder =
          typeof a.targetSocialAccount?.sortOrder === 'number'
            ? a.targetSocialAccount.sortOrder
            : 0;
        const bOrder =
          typeof b.targetSocialAccount?.sortOrder === 'number'
            ? b.targetSocialAccount.sortOrder
            : 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aCreated =
          a.targetSocialAccount?.createdAt instanceof Date
            ? a.targetSocialAccount.createdAt.getTime()
            : 0;
        const bCreated =
          b.targetSocialAccount?.createdAt instanceof Date
            ? b.targetSocialAccount.createdAt.getTime()
            : 0;
        return aCreated - bCreated;
      });

      const templateSource = orderedDestinations[0]!;
      const templateCaption =
        group.templateInitialized === true
          ? (group.templateCaption ?? templateSource.caption ?? '')
          : (templateSource.caption ?? '');
      const templateContentType =
        group.templateInitialized === true
          ? (group.templateContentType ?? templateSource.contentType ?? 'post')
          : (templateSource.contentType ?? 'post');
      const templateShareToFeed =
        group.templateInitialized === true
          ? (group.templateShareToFeed ?? templateSource.shareToFeed ?? null)
          : (templateSource.shareToFeed ?? null);
      const templateFirstComment =
        group.templateInitialized === true
          ? (group.templateFirstComment ?? templateSource.firstComment ?? null)
          : (templateSource.firstComment ?? null);
      const templateThumbOffset =
        group.templateInitialized === true
          ? (group.templateThumbOffset ?? templateSource.thumbOffset ?? null)
          : (templateSource.thumbOffset ?? null);
      const templateAssetIds =
        group.templateInitialized === true
          ? Array.isArray(group.templateAssetIds)
            ? group.templateAssetIds
            : []
          : Array.isArray(templateSource.mediaAssets)
            ? templateSource.mediaAssets
                .slice()
                .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                .map((asset) => asset.assetId)
            : [];

      const captionTrimmed = templateContentType === 'story' ? '' : templateCaption.trim();
      const hashtags = extractHashtagsFromCaption(captionTrimmed);
      const firstComment =
        templateContentType === 'story' || !templateFirstComment?.trim()
          ? null
          : templateFirstComment.trim();
      const shareToFeed = templateContentType === 'reel' ? templateShareToFeed : null;

      const assetsClient = getAssetsClient();
      let resolvedAssets: AssetRecord[] = [];
      if (templateAssetIds.length > 0) {
        let assets: (AssetRecord | null)[];
        try {
          assets = await assetsClient.getBatchAssets(templateAssetIds);
        } catch (error) {
          request.log.error(
            { err: error, contentGroupId },
            'Failed to fetch template media assets'
          );
          return reply.code(400).send({ error: 'Failed to fetch media assets. Please try again.' });
        }

        const missing = assets
          .map((asset, idx) => (!asset ? templateAssetIds[idx] : null))
          .filter((id): id is string => Boolean(id));
        if (missing.length > 0) {
          return reply.code(404).send({ error: `Assets not found: ${missing.join(', ')}` });
        }

        resolvedAssets = assets.filter(Boolean) as AssetRecord[];
        const invalidAssets = resolvedAssets.filter((asset) => asset.brandId !== group.brandId);
        if (invalidAssets.length > 0) {
          return reply
            .code(400)
            .send({ error: 'All media assets must belong to the same brand as the content group' });
        }
      }

      const includesInstagram =
        destinations.some((c) => String(c.targetSocialAccount?.platform) === 'instagram') ||
        resolvedAccounts.some((a) => a.platform === 'instagram');
      if (
        includesInstagram &&
        resolvedAssets.length > 1 &&
        !haveUniformAspectRatio(resolvedAssets)
      ) {
        return reply.code(400).send({
          error:
            'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
        });
      }

      const mediaAssetsForValidation = resolvedAssets.map((asset) => ({
        key: asset.id,
        type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
      }));
      const mediaTypeHint =
        templateContentType === 'reel' || mediaAssetsForValidation.some((a) => a.type === 'video')
          ? 'video'
          : mediaAssetsForValidation.length > 0
            ? 'image'
            : undefined;

      for (const account of resolvedAccounts) {
        const validationPlatform = toValidationPlatform(account.platform);
        if (!validationPlatform) {
          return reply.code(400).send({
            error: 'unsupported_platform',
            message: `Platform ${account.platform} is not supported for content creation yet`,
          });
        }

        const validation = validateContentPayload({
          platform: validationPlatform,
          contentType: templateContentType as any,
          mediaType: mediaTypeHint as any,
          caption: templateContentType === 'story' ? '' : captionTrimmed,
          mediaAssets: mediaAssetsForValidation,
        });

        if (!validation.ok) {
          return reply.code(400).send({
            error: 'invalid_content',
            message: validation.errors[0]?.message || 'Invalid content payload',
            platform: account.platform,
            details: validation.errors,
          });
        }
      }

      const scheduledValues = destinations.map((entry) =>
        entry.scheduledAt ? entry.scheduledAt.toISOString() : null
      );
      const nonNullScheduled = scheduledValues.filter(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      const scheduledAtToApply =
        scheduledValues.length > 0 &&
        nonNullScheduled.length === scheduledValues.length &&
        nonNullScheduled.every((v) => v === nonNullScheduled[0])
          ? nonNullScheduled[0]
          : null;

      if (scheduledAtToApply && resolvedAccounts.some((a) => !supportsScheduling(a.platform))) {
        return reply.code(400).send({
          error: 'scheduling_not_supported',
          message: 'Scheduling is not yet supported for one or more selected destinations',
          details: Array.from(
            new Set(
              resolvedAccounts.filter((a) => !supportsScheduling(a.platform)).map((a) => a.platform)
            )
          ),
        });
      }

      const created: Array<{ contentId: string; targetSocialAccountId: string }> = [];
      const createdIds: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const account of resolvedAccounts) {
          const row = await tx.content.create({
            data: {
              caption: captionTrimmed,
              hashtags,
              status: 'draft',
              brandId: group.brandId,
              contentGroupId: group.id,
              scheduledAt: null,
              postedAt: null,
              contentType: templateContentType || 'post',
              shareToFeed,
              thumbOffset:
                typeof templateThumbOffset === 'number' && Number.isFinite(templateThumbOffset)
                  ? Math.max(0, templateThumbOffset)
                  : null,
              firstComment,
              targetSocialAccountId: account.id,
              generationParams: Prisma.JsonNull,
            },
            select: { id: true },
          });
          created.push({ contentId: row.id, targetSocialAccountId: account.id });
          createdIds.push(row.id);
        }

        if (resolvedAssets.length > 0 && createdIds.length > 0) {
          await tx.contentMediaAsset.createMany({
            data: createdIds.flatMap((contentId) =>
              resolvedAssets.map((asset, idx) => ({
                contentId,
                assetId: asset.id,
                displayOrder: idx,
              }))
            ),
          });
        }
      });

      let schedulingResults:
        | Array<{ contentId: string; ok: boolean; statusCode: number; error?: unknown }>
        | undefined;
      if (scheduledAtToApply && createdIds.length > 0) {
        const headers: Record<string, string> = {};
        if (typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;
        if (typeof request.headers.authorization === 'string')
          headers.authorization = request.headers.authorization;
        if (typeof request.headers['csrf-token'] === 'string')
          headers['csrf-token'] = request.headers['csrf-token'];

        schedulingResults = [];

        for (const contentId of createdIds) {
          const r = await fastify.inject({
            method: 'PUT',
            url: `/api/content/${encodeURIComponent(contentId)}`,
            headers,
            payload: { scheduledAt: scheduledAtToApply },
          });

          if (r.statusCode >= 200 && r.statusCode < 300) {
            schedulingResults.push({ contentId, ok: true, statusCode: r.statusCode });
          } else {
            let data: unknown = null;
            try {
              data = r.json();
            } catch {
              data = r.payload || null;
            }
            schedulingResults.push({ contentId, ok: false, statusCode: r.statusCode, error: data });
          }
        }
      }

      return reply.code(201).send({
        success: true,
        contentGroupId: group.id,
        added: created,
        scheduling: scheduledAtToApply
          ? { scheduledAt: scheduledAtToApply, results: schedulingResults }
          : undefined,
      });
    }
  );

  // PATCH /api/content/groups/:contentGroupId/template
  // Updates the group-level template (does not mutate destination posts unless applied).
  fastify.patch<{
    Params: { contentGroupId: string };
    Body: {
      caption?: string;
      contentType?: string;
      shareToFeed?: boolean | null;
      firstComment?: string | null;
      thumbOffset?: number | null;
      assetIds?: string[];
    };
  }>(
    '/groups/:contentGroupId/template',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;
      const body = request.body as any;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              brandId: true,
              caption: true,
              contentType: true,
              shareToFeed: true,
              thumbOffset: true,
              firstComment: true,
              hashtags: true,
              targetSocialAccountId: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
              targetSocialAccount: { select: { platform: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }
      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      const destinations = group.contents.filter((c) => c.targetSocialAccountId);
      if (destinations.length === 0) {
        return reply.code(400).send({ error: 'content_group_missing_destinations' });
      }

      const templateSource = destinations[0]!;
      const currentCaption =
        group.templateInitialized === true
          ? (group.templateCaption ?? templateSource.caption ?? '')
          : (templateSource.caption ?? '');
      const currentContentType =
        group.templateInitialized === true
          ? (group.templateContentType ?? templateSource.contentType ?? 'post')
          : (templateSource.contentType ?? 'post');
      const currentShareToFeed =
        group.templateInitialized === true
          ? (group.templateShareToFeed ?? templateSource.shareToFeed ?? null)
          : (templateSource.shareToFeed ?? null);
      const currentFirstComment =
        group.templateInitialized === true
          ? (group.templateFirstComment ?? templateSource.firstComment ?? null)
          : (templateSource.firstComment ?? null);
      const currentThumbOffset =
        group.templateInitialized === true
          ? (group.templateThumbOffset ?? templateSource.thumbOffset ?? null)
          : (templateSource.thumbOffset ?? null);
      const currentAssetIds =
        group.templateInitialized === true
          ? Array.isArray(group.templateAssetIds)
            ? group.templateAssetIds
            : []
          : (templateSource.mediaAssets || []).map((a) => a.assetId);

      const nextCaption =
        body.caption === undefined
          ? currentCaption
          : typeof body.caption === 'string'
            ? body.caption
            : String(body.caption ?? '');
      const nextContentType =
        body.contentType === undefined
          ? currentContentType
          : typeof body.contentType === 'string' && body.contentType.trim().length
            ? body.contentType.trim()
            : 'post';
      const nextShareToFeed =
        body.shareToFeed === undefined
          ? currentShareToFeed
          : body.shareToFeed === null
            ? null
            : Boolean(body.shareToFeed);
      const nextFirstComment =
        body.firstComment === undefined
          ? currentFirstComment
          : body.firstComment === null
            ? null
            : typeof body.firstComment === 'string'
              ? body.firstComment
              : String(body.firstComment ?? '');
      const nextThumbOffset =
        body.thumbOffset === undefined
          ? currentThumbOffset
          : body.thumbOffset === null
            ? null
            : typeof body.thumbOffset === 'number'
              ? body.thumbOffset
              : Number(body.thumbOffset);

      const nextAssetIdsRaw = body.assetIds === undefined ? currentAssetIds : body.assetIds;
      const nextAssetIds = Array.isArray(nextAssetIdsRaw)
        ? nextAssetIdsRaw
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        : [];

      const assetsClient = getAssetsClient();
      let resolvedAssets: AssetRecord[] = [];
      if (nextAssetIds.length > 0) {
        let assets: (AssetRecord | null)[];
        try {
          assets = await assetsClient.getBatchAssets(nextAssetIds);
        } catch (error) {
          request.log.error(
            { err: error, contentGroupId },
            'Failed to fetch template media assets'
          );
          return reply.code(400).send({ error: 'Failed to fetch media assets. Please try again.' });
        }

        const missing = assets
          .map((asset, idx) => (!asset ? nextAssetIds[idx] : null))
          .filter((id): id is string => Boolean(id));
        if (missing.length > 0) {
          return reply.code(404).send({ error: `Assets not found: ${missing.join(', ')}` });
        }

        resolvedAssets = assets.filter(Boolean) as AssetRecord[];
        const invalid = resolvedAssets.filter((asset) => asset.brandId !== group.brandId);
        if (invalid.length > 0) {
          return reply
            .code(400)
            .send({ error: 'All media assets must belong to the same brand as the content group' });
        }
      }

      if (
        resolvedAssets.length > 1 &&
        destinations.some((c) => String(c.targetSocialAccount?.platform) === 'instagram')
      ) {
        if (!haveUniformAspectRatio(resolvedAssets)) {
          return reply.code(400).send({
            error:
              'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
          });
        }
      }

      const mediaAssetsForValidation = resolvedAssets.map((asset) => ({
        key: asset.id,
        type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
      }));
      const mediaTypeHint =
        nextContentType === 'reel' || mediaAssetsForValidation.some((a) => a.type === 'video')
          ? 'video'
          : mediaAssetsForValidation.length > 0
            ? 'image'
            : undefined;
      const captionForValidation = nextContentType === 'story' ? '' : nextCaption;

      const platformsToValidate = Array.from(
        new Set(destinations.map((d) => String(d.targetSocialAccount?.platform || 'instagram')))
      );
      for (const platform of platformsToValidate) {
        const validationPlatform = toValidationPlatform(platform);
        if (!validationPlatform) {
          return reply.code(400).send({
            error: 'unsupported_platform',
            message: `Platform ${platform} is not supported for template updates yet`,
          });
        }

        const validation = validateContentPayload({
          platform: validationPlatform,
          contentType: nextContentType as any,
          ...(mediaTypeHint ? { mediaType: mediaTypeHint as any } : {}),
          caption: captionForValidation,
          ...(mediaAssetsForValidation.length > 0 ? { mediaAssets: mediaAssetsForValidation } : {}),
        });

        if (!validation.ok) {
          return reply.code(400).send({
            error: 'invalid_content',
            message: validation.errors[0]?.message || 'Invalid content payload',
            platform,
            details: validation.errors,
          });
        }
      }

      const updated = await prisma.contentGroup.update({
        where: { id: group.id },
        data: {
          templateInitialized: true,
          templateCaption: nextCaption,
          templateContentType: nextContentType,
          templateShareToFeed: nextShareToFeed,
          templateFirstComment: nextFirstComment ? nextFirstComment.trim() : null,
          templateThumbOffset:
            typeof nextThumbOffset === 'number' && Number.isFinite(nextThumbOffset)
              ? Math.max(0, nextThumbOffset)
              : null,
          templateAssetIds: nextAssetIds,
        },
        select: {
          id: true,
          brandId: true,
          updatedAt: true,
          templateInitialized: true,
          templateCaption: true,
          templateContentType: true,
          templateShareToFeed: true,
          templateFirstComment: true,
          templateThumbOffset: true,
          templateAssetIds: true,
        },
      });

      return reply.send({
        contentGroup: {
          id: updated.id,
          brandId: updated.brandId,
          updatedAt: updated.updatedAt,
          template: {
            initialized: updated.templateInitialized,
            caption: updated.templateCaption ?? '',
            contentType: updated.templateContentType ?? 'post',
            shareToFeed: updated.templateShareToFeed ?? null,
            firstComment: updated.templateFirstComment ?? null,
            thumbOffset: updated.templateThumbOffset ?? null,
            assetIds: updated.templateAssetIds ?? [],
          },
        },
      });
    }
  );

  // POST /api/content/groups/:contentGroupId/apply-template
  // Copies the template onto every destination post.
  fastify.post<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId/apply-template',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              status: true,
              scheduledAt: true,
              caption: true,
              contentType: true,
              shareToFeed: true,
              thumbOffset: true,
              firstComment: true,
              targetSocialAccountId: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
              targetSocialAccount: { select: { platform: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }
      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }
      await assertBrandOwnership(userId, group.brandId);

      const destinations = group.contents.filter((c) => c.targetSocialAccountId);
      if (destinations.length === 0) {
        return reply.code(400).send({ error: 'content_group_missing_destinations' });
      }

      const templateSource = destinations[0]!;
      const templateCaption =
        group.templateInitialized === true
          ? (group.templateCaption ?? templateSource.caption ?? '')
          : (templateSource.caption ?? '');
      const templateContentType =
        group.templateInitialized === true
          ? (group.templateContentType ?? templateSource.contentType ?? 'post')
          : (templateSource.contentType ?? 'post');
      const templateShareToFeed =
        group.templateInitialized === true
          ? (group.templateShareToFeed ?? templateSource.shareToFeed ?? null)
          : (templateSource.shareToFeed ?? null);
      const templateFirstComment =
        group.templateInitialized === true
          ? (group.templateFirstComment ?? templateSource.firstComment ?? null)
          : (templateSource.firstComment ?? null);
      const templateThumbOffset =
        group.templateInitialized === true
          ? (group.templateThumbOffset ?? templateSource.thumbOffset ?? null)
          : (templateSource.thumbOffset ?? null);
      const templateAssetIds =
        group.templateInitialized === true
          ? Array.isArray(group.templateAssetIds)
            ? group.templateAssetIds
            : []
          : (templateSource.mediaAssets || []).map((a) => a.assetId);

      const captionTrimmed = templateCaption.trim();
      const hashtags = extractHashtagsFromCaption(captionTrimmed);

      const destinationIds = destinations.map((c) => c.id);
      await prisma.$transaction(async (tx) => {
        await tx.content.updateMany({
          where: { id: { in: destinationIds } },
          data: {
            caption: captionTrimmed,
            hashtags,
            contentType: templateContentType,
            shareToFeed: templateShareToFeed,
            thumbOffset: templateThumbOffset,
            firstComment: templateFirstComment ? templateFirstComment.trim() : null,
          },
        });

        await tx.contentMediaAsset.deleteMany({ where: { contentId: { in: destinationIds } } });
        if (templateAssetIds.length > 0) {
          await tx.contentMediaAsset.createMany({
            data: destinationIds.flatMap((contentId) =>
              templateAssetIds.map((assetId, idx) => ({
                contentId,
                assetId,
                displayOrder: idx,
              }))
            ),
          });
        }
      });

      // Best-effort sync of AWS schedules for scheduled posts.
      const scheduledIds = destinations
        .filter((c) => c.status === 'scheduled' && c.scheduledAt)
        .map((c) => c.id);
      for (const id of scheduledIds) {
        try {
          await schedulerService.updateScheduledContent(id);
        } catch {
          // best-effort; status-sync will surface errors from publisher/scheduler
        }
      }

      return reply.send({ success: true, updatedContentIds: destinationIds });
    }
  );

  // POST /api/content/groups/:contentGroupId/destinations/:contentId/reset-to-template
  fastify.post<{ Params: { contentGroupId: string; contentId: string } }>(
    '/groups/:contentGroupId/destinations/:contentId/reset-to-template',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId, contentId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }
      if (!contentId || typeof contentId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              status: true,
              scheduledAt: true,
              caption: true,
              contentType: true,
              shareToFeed: true,
              thumbOffset: true,
              firstComment: true,
              targetSocialAccountId: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }
      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }
      await assertBrandOwnership(userId, group.brandId);

      const destinations = group.contents.filter((c) => c.targetSocialAccountId);
      const destination = destinations.find((c) => c.id === contentId);
      if (!destination) {
        return reply.code(404).send({ error: 'destination_not_found' });
      }

      const templateSource = destinations[0]!;
      const templateCaption =
        group.templateInitialized === true
          ? (group.templateCaption ?? templateSource.caption ?? '')
          : (templateSource.caption ?? '');
      const templateContentType =
        group.templateInitialized === true
          ? (group.templateContentType ?? templateSource.contentType ?? 'post')
          : (templateSource.contentType ?? 'post');
      const templateShareToFeed =
        group.templateInitialized === true
          ? (group.templateShareToFeed ?? templateSource.shareToFeed ?? null)
          : (templateSource.shareToFeed ?? null);
      const templateFirstComment =
        group.templateInitialized === true
          ? (group.templateFirstComment ?? templateSource.firstComment ?? null)
          : (templateSource.firstComment ?? null);
      const templateThumbOffset =
        group.templateInitialized === true
          ? (group.templateThumbOffset ?? templateSource.thumbOffset ?? null)
          : (templateSource.thumbOffset ?? null);
      const templateAssetIds =
        group.templateInitialized === true
          ? Array.isArray(group.templateAssetIds)
            ? group.templateAssetIds
            : []
          : (templateSource.mediaAssets || []).map((a) => a.assetId);

      const captionTrimmed = templateCaption.trim();
      const hashtags = extractHashtagsFromCaption(captionTrimmed);

      await prisma.$transaction(async (tx) => {
        await tx.content.update({
          where: { id: destination.id },
          data: {
            caption: captionTrimmed,
            hashtags,
            contentType: templateContentType,
            shareToFeed: templateShareToFeed,
            thumbOffset: templateThumbOffset,
            firstComment: templateFirstComment ? templateFirstComment.trim() : null,
          },
        });

        await tx.contentMediaAsset.deleteMany({ where: { contentId: destination.id } });
        if (templateAssetIds.length > 0) {
          await tx.contentMediaAsset.createMany({
            data: templateAssetIds.map((assetId, idx) => ({
              contentId: destination.id,
              assetId,
              displayOrder: idx,
            })),
          });
        }
      });

      if (destination.status === 'scheduled' && destination.scheduledAt) {
        try {
          await schedulerService.updateScheduledContent(destination.id);
        } catch {
          // best-effort
        }
      }

      return reply.send({ success: true, contentId: destination.id });
    }
  );

  // POST /api/content/groups/:contentGroupId/queue
  // Fan-out into each destination account’s Default queue (Buffer-style).
  fastify.post<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId/queue',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ success: false, error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: {
            select: { id: true, userId: true, user: { select: { subscriptionTier: true } } },
          },
          contents: {
            select: {
              id: true,
              status: true,
              contentType: true,
              targetSocialAccountId: true,
            },
          },
        },
      });

      if (!group || !group.brand) {
        return reply.code(404).send({ success: false, error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        return reply.code(404).send({ success: false, error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      if (group.contents.some((c) => c.status === 'published')) {
        return reply.code(400).send({
          success: false,
          error: 'content_group_immutable',
          message: 'This content group contains published posts and cannot be enqueued',
        });
      }

      const destinations = group.contents
        .map((c) => ({
          contentId: c.id,
          contentType: c.contentType,
          targetSocialAccountId: c.targetSocialAccountId,
        }))
        .filter(
          (c): c is { contentId: string; contentType: string; targetSocialAccountId: string } =>
            Boolean(c.targetSocialAccountId && c.targetSocialAccountId.trim())
        )
        .map((c) => ({
          ...c,
          targetSocialAccountId: c.targetSocialAccountId.trim(),
        }));

      if (destinations.length !== group.contents.length) {
        return reply.code(400).send({
          success: false,
          error: 'invalid_target_social_account',
          message: 'One or more destination social accounts are missing from this group',
        });
      }

      for (const dest of destinations) {
        const readiness = await validateQueueableContent({
          contentId: dest.contentId,
          brandId: group.brandId,
          socialAccountId: dest.targetSocialAccountId,
        });
        if (!readiness.ok) {
          return reply.code(400).send({
            success: false,
            error: readiness.code,
            message: readiness.message,
            details: {
              contentId: dest.contentId,
              socialAccountId: dest.targetSocialAccountId,
              readinessDetails: readiness.details,
            },
          });
        }
      }

      const tier = group.brand.user?.subscriptionTier || 'free';
      const maxDepth = getMaxQueueDepthForTier(tier);

      const normalizeLaneKey = (raw: unknown): 'post' | 'reel' | 'story' => {
        if (raw === 'reel' || raw === 'story') return raw;
        return 'post';
      };

      const enqueued: Array<{
        contentId: string;
        socialAccountId: string;
        queueId: string;
        itemId: string;
      }> = [];

      try {
        await prisma.$transaction(async (tx) => {
          const uniqueSocialAccountIds = Array.from(
            new Set(destinations.map((d) => d.targetSocialAccountId))
          );

          const currentDepthByAccount = new Map<string, number>();
          if (Number.isFinite(maxDepth)) {
            for (const saId of uniqueSocialAccountIds) {
              const count = await tx.publishingQueueItem.count({
                where: { queue: { socialAccountId: saId } },
              });
              currentDepthByAccount.set(saId, count);
            }
          }

          const resolveDefaultQueueId = async (socialAccountId: string): Promise<string> => {
            const existingDefault = await tx.publishingQueue.findFirst({
              where: { socialAccountId, isDefault: true },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
            });
            if (existingDefault) return existingDefault.id;

            const byName = await tx.publishingQueue.findFirst({
              where: { socialAccountId, name: 'Default' },
              select: { id: true },
              orderBy: { createdAt: 'asc' },
            });
            if (byName) {
              await tx.publishingQueue.update({
                where: { id: byName.id },
                data: { isDefault: true },
              });
              return byName.id;
            }

            const created = await tx.publishingQueue.create({
              data: {
                socialAccountId,
                name: 'Default',
                isDefault: true,
              },
              select: { id: true },
            });
            return created.id;
          };

          const defaultQueueIdByAccount = new Map<string, string>();
          for (const saId of uniqueSocialAccountIds) {
            defaultQueueIdByAccount.set(saId, await resolveDefaultQueueId(saId));
          }

          const nextPositionByQueueLane = new Map<string, number>();
          const resolveNextPosition = async (queueId: string, laneKey: string): Promise<number> => {
            const key = `${queueId}:${laneKey}`;
            const existing = nextPositionByQueueLane.get(key);
            if (typeof existing === 'number') {
              nextPositionByQueueLane.set(key, existing + 1);
              return existing;
            }

            const maxRow = await tx.publishingQueueItem.findFirst({
              where: { queueId, laneKey },
              select: { position: true },
              orderBy: { position: 'desc' },
            });
            const start = (maxRow?.position ?? 0) + 1;
            nextPositionByQueueLane.set(key, start + 1);
            return start;
          };

          for (const dest of destinations) {
            const socialAccountId = dest.targetSocialAccountId;
            const queueId = defaultQueueIdByAccount.get(socialAccountId)!;
            const laneKey = normalizeLaneKey(dest.contentType);

            const existingItem = await tx.publishingQueueItem.findUnique({
              where: { contentId: dest.contentId },
              select: { id: true },
            });

            if (!existingItem && Number.isFinite(maxDepth)) {
              const current = currentDepthByAccount.get(socialAccountId) ?? 0;
              if (current + 1 > (maxDepth as number)) {
                throw new Error('queue_depth_limit');
              }
              currentDepthByAccount.set(socialAccountId, current + 1);
            }

            const position = await resolveNextPosition(queueId, laneKey);

            const item = await tx.publishingQueueItem.upsert({
              where: { contentId: dest.contentId },
              create: {
                queueId,
                contentId: dest.contentId,
                laneKey,
                position,
              },
              update: {
                queueId,
                laneKey,
                position,
              },
              select: { id: true, queueId: true, contentId: true },
            });

            enqueued.push({
              contentId: item.contentId,
              socialAccountId,
              queueId: item.queueId,
              itemId: item.id,
            });
          }
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'queue_depth_limit') {
          return reply.code(402).send({
            success: false,
            error: 'queue_depth_limit',
            maxAllowed: maxDepth,
          });
        }
        request.log.error({ err: error }, 'Failed to enqueue content group');
        return reply.code(500).send({ success: false, error: 'failed_to_enqueue_group' });
      }

      const recompute = await publishingQueueScheduler.recomputeBrandWindow(group.brandId);

      return reply.send({
        success: true,
        data: {
          contentGroupId,
          enqueued,
          recompute,
        },
      });
    }
  );

  // POST /api/content/groups/:contentGroupId/schedule
  // Applies the same scheduledAt to every destination post in the group.
  fastify.post<{ Params: { contentGroupId: string }; Body: { scheduledAt?: string | null } }>(
    '/groups/:contentGroupId/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      const rawScheduledAt = (request.body as any)?.scheduledAt;
      const scheduledAt =
        rawScheduledAt === null
          ? null
          : typeof rawScheduledAt === 'string'
            ? rawScheduledAt.trim()
            : undefined;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      if (scheduledAt === undefined) {
        return reply.code(400).send({ error: 'scheduledAt is required' });
      }

      if (scheduledAt) {
        const ts = new Date(scheduledAt).getTime();
        if (Number.isNaN(ts)) {
          return reply.code(400).send({ error: 'invalid_scheduledAt' });
        }
        if (ts <= Date.now()) {
          return reply.code(400).send({ error: 'scheduledAt must be in the future' });
        }
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              status: true,
              scheduledAt: true,
              targetSocialAccountId: true,
              brandId: true,
            },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      if (group.contents.some((c) => c.status === 'published')) {
        return reply.code(400).send({
          error: 'content_group_immutable',
          message: 'This content group contains published posts and cannot be rescheduled',
        });
      }

      // Scheduling is platform-dependent.
      if (scheduledAt) {
        const destinationIds = group.contents
          .map((c) => c.targetSocialAccountId)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map((id) => id.trim());

        if (destinationIds.length !== group.contents.length) {
          return reply.code(400).send({
            error: 'invalid_target_social_account',
            message: 'One or more destination social accounts are missing from this group',
          });
        }

        const uniqueDestinationIds = Array.from(new Set(destinationIds));
        const accounts = await prisma.socialAccount.findMany({
          where: { brandId: group.brandId, id: { in: uniqueDestinationIds } },
          select: { id: true, platform: true, metadata: true },
        });
        const byId = new Map(accounts.map((a) => [a.id, a]));

        const invalid: string[] = [];
        const unsupportedPlatforms = new Set<string>();
        for (const id of destinationIds) {
          const account = byId.get(id);
          if (!account) {
            invalid.push(id);
            continue;
          }
          if (isDisconnected(account.metadata)) {
            invalid.push(id);
            continue;
          }
          if (!supportsScheduling(String(account.platform))) {
            unsupportedPlatforms.add(String(account.platform));
          }
        }

        if (unsupportedPlatforms.size > 0) {
          return reply.code(400).send({
            error: 'scheduling_not_supported',
            message: 'Scheduling is not yet supported for one or more selected destinations',
            details: Array.from(unsupportedPlatforms),
          });
        }

        if (invalid.length > 0) {
          return reply.code(400).send({
            error: 'invalid_target_social_account',
            message: 'One or more destination social accounts are not connected to this brand',
            details: invalid,
          });
        }
      }

      const headers: Record<string, string> = {};
      if (typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;
      if (typeof request.headers.authorization === 'string')
        headers.authorization = request.headers.authorization;
      if (typeof request.headers['csrf-token'] === 'string')
        headers['csrf-token'] = request.headers['csrf-token'];

      const results: Array<{
        contentId: string;
        ok: boolean;
        statusCode: number;
        error?: unknown;
      }> = [];

      for (const content of group.contents) {
        const r = await fastify.inject({
          method: 'PUT',
          url: `/api/content/${encodeURIComponent(content.id)}`,
          headers,
          payload: { scheduledAt: scheduledAt || null },
        });

        if (r.statusCode >= 200 && r.statusCode < 300) {
          results.push({ contentId: content.id, ok: true, statusCode: r.statusCode });
        } else {
          let data: unknown = null;
          try {
            data = r.json();
          } catch {
            data = r.payload || null;
          }
          results.push({ contentId: content.id, ok: false, statusCode: r.statusCode, error: data });
        }
      }

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        return reply.code(502).send({
          success: false,
          error: 'Failed to update one or more destination posts',
          results,
        });
      }

      return reply.send({ success: true, results });
    }
  );

  // POST /api/content/groups/:contentGroupId/publish-now
  // Publishes all non-published destinations in the group via the scheduler pipeline.
  fastify.post<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId/publish-now',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      const publishable = group.contents.filter((c) => c.status !== 'published');
      if (publishable.length === 0) {
        return reply.code(400).send({
          error: 'content_group_already_published',
          message: 'All destinations in this group are already published',
        });
      }

      const headers: Record<string, string> = {};
      if (typeof request.headers.cookie === 'string') headers.cookie = request.headers.cookie;
      if (typeof request.headers.authorization === 'string')
        headers.authorization = request.headers.authorization;
      if (typeof request.headers['csrf-token'] === 'string')
        headers['csrf-token'] = request.headers['csrf-token'];

      const results: Array<{
        contentId: string;
        ok: boolean;
        statusCode: number;
        error?: unknown;
      }> = [];

      for (const content of publishable) {
        const r = await fastify.inject({
          method: 'POST',
          url: `/api/content/${encodeURIComponent(content.id)}/publish-now`,
          headers,
        });

        if (r.statusCode >= 200 && r.statusCode < 300) {
          results.push({ contentId: content.id, ok: true, statusCode: r.statusCode });
        } else {
          let data: unknown = null;
          try {
            data = r.json();
          } catch {
            data = r.payload || null;
          }
          results.push({ contentId: content.id, ok: false, statusCode: r.statusCode, error: data });
        }
      }

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        return reply.code(502).send({
          success: false,
          error: 'Failed to publish one or more destination posts',
          results,
        });
      }

      return reply.send({ success: true, results });
    }
  );

  // DELETE /api/content/groups/:contentGroupId
  // Deletes all destination posts in the group (best-effort cancels schedules first).
  fastify.delete<{ Params: { contentGroupId: string } }>(
    '/groups/:contentGroupId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { contentGroupId } = request.params;

      if (!contentGroupId || typeof contentGroupId !== 'string') {
        return reply.code(400).send({ error: 'invalid_content_group_id' });
      }

      const group = await prisma.contentGroup.findUnique({
        where: { id: contentGroupId },
        include: {
          brand: { select: { id: true, userId: true } },
          contents: {
            select: { id: true, status: true },
          },
        },
      });

      if (!group) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      if (group.brand.userId !== userId) {
        return reply.code(404).send({ error: 'content_group_not_found' });
      }

      await assertBrandOwnership(userId, group.brandId);

      if (group.contents.some((c) => c.status === 'published')) {
        return reply.code(400).send({
          error: 'content_group_not_deletable',
          message: 'This content group contains published posts and cannot be deleted',
        });
      }

      const contentIds = group.contents.map((c) => c.id);

      // Best-effort cancel schedules before delete (keeps scheduler adapter happy).
      for (const content of group.contents) {
        try {
          if (content.status === 'scheduled') {
            await schedulerService.cancelScheduledPost(content.id);
          }
        } catch (e) {
          request.log.warn(
            { err: e, contentId: content.id },
            'Failed to cancel schedule during group delete'
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.content.deleteMany({ where: { id: { in: contentIds } } });
        await tx.contentGroup.delete({ where: { id: contentGroupId } });
      });

      return reply.send({
        success: true,
        deleted: {
          contentGroupId,
          contentIds,
        },
      });
    }
  );
};

export default groupsRoutes;
