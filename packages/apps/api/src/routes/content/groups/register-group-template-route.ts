import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AssetRecord } from '@postolio/assets-client';
import { validateContentPayload } from '@postolio/content-validation';
import { getAssetsClient } from '../../../services/assets-media.js';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { haveUniformAspectRatio } from '../../../utils/aspect-ratio.js';
import { toValidationPlatform } from '../../../utils/platform.js';
import {
  ensureAssetsBelongToBrand,
  ensureMultiDestinationEnabled,
  normalizeThumbOffset,
  toCaptionAndHashtags,
  toFirstComment,
  type AuthenticatedRequest,
  prisma,
} from './shared.js';
import {
  loadGroupForTemplate,
  requireTemplateDestinations,
  resolveEffectiveTemplate,
} from './template-route-helpers.js';

type GroupTemplateBody = {
  caption?: string;
  contentType?: string;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  thumbOffset?: number | null;
  assetIds?: string[];
};

type GroupTemplateRoute = {
  Params: { contentGroupId: string };
  Body: GroupTemplateBody;
};

type GroupTemplateUpdate = {
  caption: string;
  contentType: string;
  shareToFeed: boolean | null;
  firstComment: string | null;
  thumbOffset: number | null;
  assetIds: string[];
};

function normalizeCaption(input: unknown, current: string): string {
  if (input === undefined) {
    return current;
  }
  if (typeof input === 'string') {
    return input;
  }
  return String(input ?? '');
}

function normalizeContentType(input: unknown, current: string): string {
  if (input === undefined) {
    return current;
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    return input.trim();
  }
  return 'post';
}

function normalizeShareToFeed(input: unknown, current: boolean | null): boolean | null {
  if (input === undefined) {
    return current;
  }
  if (input === null) {
    return null;
  }
  return Boolean(input);
}

function normalizeFirstCommentRaw(input: unknown, current: string | null): string | null {
  if (input === undefined) {
    return current;
  }
  if (input === null) {
    return null;
  }
  if (typeof input === 'string') {
    return input;
  }
  return String(input ?? '');
}

function normalizeTemplateAssetIds(input: unknown, current: string[]): string[] {
  const raw = input === undefined ? current : input;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value: unknown): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeTemplateUpdate(
  body: GroupTemplateBody,
  current: GroupTemplateUpdate
): GroupTemplateUpdate {
  return {
    caption: normalizeCaption(body.caption, current.caption),
    contentType: normalizeContentType(body.contentType, current.contentType),
    shareToFeed: normalizeShareToFeed(body.shareToFeed, current.shareToFeed),
    firstComment: normalizeFirstCommentRaw(body.firstComment, current.firstComment),
    thumbOffset: normalizeThumbOffset(body.thumbOffset ?? current.thumbOffset),
    assetIds: normalizeTemplateAssetIds(body.assetIds, current.assetIds),
  };
}

async function resolveTemplateAssetsForUpdate(params: {
  request: { log: { error: (ctx: unknown, message: string) => void } };
  contentGroupId: string;
  brandId: string;
  assetIds: string[];
}) {
  if (params.assetIds.length === 0) {
    return { ok: true as const, assets: [] as AssetRecord[] };
  }

  let assets: Array<AssetRecord | null>;
  try {
    assets = await getAssetsClient().getBatchAssets(params.assetIds);
  } catch (error) {
    params.request.log.error(
      { err: error, contentGroupId: params.contentGroupId },
      'Failed to fetch template media assets'
    );
    return {
      ok: false as const,
      status: 400,
      error: 'Failed to fetch media assets. Please try again.',
    };
  }

  const ownership = await ensureAssetsBelongToBrand(params.assetIds, params.brandId, assets);
  if (!ownership.ok) {
    return {
      ok: false as const,
      status: ownership.error.startsWith('Assets not found:') ? 404 : 400,
      error: ownership.error,
    };
  }

  return { ok: true as const, assets: ownership.assets };
}

function buildMediaAssetsForValidation(mediaAssets: AssetRecord[]) {
  return mediaAssets.map((asset) => ({
    key: asset.id,
    type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
  }));
}

function validateTemplateAcrossPlatforms(params: {
  platforms: string[];
  contentType: string;
  caption: string;
  mediaAssets: AssetRecord[];
}) {
  const mediaAssetsForValidation = buildMediaAssetsForValidation(params.mediaAssets);
  const mediaTypeHint =
    params.contentType === 'reel' ||
    mediaAssetsForValidation.some((asset) => asset.type === 'video')
      ? 'video'
      : mediaAssetsForValidation.length > 0
        ? 'image'
        : undefined;

  for (const platform of params.platforms) {
    const validationPlatform = toValidationPlatform(platform);
    if (!validationPlatform) {
      return {
        ok: false as const,
        error: 'unsupported_platform',
        message: `Platform ${platform} is not supported for template updates yet`,
      };
    }

    const validation = validateContentPayload({
      platform: validationPlatform,
      contentType: params.contentType as any,
      ...(mediaTypeHint ? { mediaType: mediaTypeHint as any } : {}),
      caption: params.contentType === 'story' ? '' : params.caption,
      ...(mediaAssetsForValidation.length > 0 ? { mediaAssets: mediaAssetsForValidation } : {}),
    });

    if (!validation.ok) {
      return {
        ok: false as const,
        error: 'invalid_content',
        message: validation.errors[0]?.message || 'Invalid content payload',
        platform,
        details: validation.errors,
      };
    }
  }

  return { ok: true as const };
}

function parseContentGroupId(
  request: FastifyRequest<GroupTemplateRoute>,
  reply: FastifyReply
): string | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  return contentGroupId;
}

async function loadGroupContext(params: {
  request: FastifyRequest<GroupTemplateRoute>;
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
    group,
    destinations: destinationsResult.destinations,
    template,
  };
}

function validateInstagramCarousel(params: {
  reply: FastifyReply;
  mediaAssets: AssetRecord[];
  destinations: Array<{ targetSocialAccount: { platform: string } | null }>;
}) {
  if (params.mediaAssets.length <= 1) {
    return true;
  }

  const includesInstagram = params.destinations.some(
    (entry) => String(entry.targetSocialAccount?.platform) === 'instagram'
  );
  if (!includesInstagram || haveUniformAspectRatio(params.mediaAssets)) {
    return true;
  }

  void params.reply.code(400).send({
    error:
      'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
  });
  return false;
}

async function updateGroupTemplate(params: { groupId: string; next: GroupTemplateUpdate }) {
  return prisma.contentGroup.update({
    where: { id: params.groupId },
    data: {
      templateInitialized: true,
      templateCaption: params.next.caption,
      templateContentType: params.next.contentType,
      templateShareToFeed: params.next.shareToFeed,
      templateFirstComment: toFirstComment(params.next.firstComment, params.next.contentType),
      templateThumbOffset: normalizeThumbOffset(params.next.thumbOffset),
      templateAssetIds: params.next.assetIds,
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
}

function toTemplateResponse(updated: Awaited<ReturnType<typeof updateGroupTemplate>>) {
  return {
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
  };
}

async function handleGroupTemplatePatch(
  request: FastifyRequest<GroupTemplateRoute>,
  reply: FastifyReply
) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const contentGroupId = parseContentGroupId(request, reply);
  if (!contentGroupId) {
    return;
  }

  const context = await loadGroupContext({ request, reply, contentGroupId });
  if (!context) {
    return;
  }

  const next = normalizeTemplateUpdate(request.body, {
    caption: context.template.caption,
    contentType: context.template.contentType,
    shareToFeed: context.template.shareToFeed,
    firstComment: context.template.firstComment,
    thumbOffset: context.template.thumbOffset,
    assetIds: context.template.assetIds,
  });

  const assets = await resolveTemplateAssetsForUpdate({
    request,
    contentGroupId,
    brandId: context.group.brandId,
    assetIds: next.assetIds,
  });
  if (!assets.ok) {
    return reply.code(assets.status).send({ error: assets.error });
  }

  if (
    !validateInstagramCarousel({
      reply,
      mediaAssets: assets.assets,
      destinations: context.destinations,
    })
  ) {
    return;
  }

  const normalized = toCaptionAndHashtags(next.caption, next.contentType);
  const validation = validateTemplateAcrossPlatforms({
    platforms: Array.from(
      new Set(
        context.destinations.map((entry) =>
          String(entry.targetSocialAccount?.platform || 'instagram')
        )
      )
    ),
    contentType: next.contentType,
    caption: normalized.caption,
    mediaAssets: assets.assets,
  });
  if (!validation.ok) {
    return reply.code(400).send(validation);
  }

  const updated = await updateGroupTemplate({
    groupId: context.group.id,
    next,
  });
  return reply.send(toTemplateResponse(updated));
}

export function registerGroupTemplateRoute(fastify: FastifyInstance) {
  fastify.patch<GroupTemplateRoute>(
    '/groups/:contentGroupId/template',
    { preHandler: fastify.authenticate },
    handleGroupTemplatePatch
  );
}
