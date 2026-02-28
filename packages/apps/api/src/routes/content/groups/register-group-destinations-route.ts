import type { FastifyInstance } from 'fastify';
import type { AssetRecord } from '@postolio/assets-client';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { supportsScheduling } from '../../../utils/platform.js';
import { haveUniformAspectRatio } from '../../../utils/aspect-ratio.js';
import {
  buildForwardAuthHeaders,
  deriveTemplateFromDestination,
  ensureMultiDestinationEnabled,
  normalizeThumbOffset,
  parseTargetSocialAccountIds,
  toCaptionAndHashtags,
  toFirstComment,
  prisma,
  type AuthenticatedRequest,
} from './shared.js';
import {
  applySchedulingToCreatedDestinations,
  createDestinationRows,
  resolveAccountsToAdd,
  resolveScheduledAtToApply,
  resolveTemplateAssets,
  validateResolvedAccounts,
  type ResolvedAccount,
} from './register-group-destinations-helpers.js';

type GroupForAddDestinations = NonNullable<Awaited<ReturnType<typeof loadGroupForDestinations>>>;

const GROUP_FOR_DESTINATIONS_INCLUDE = {
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
        orderBy: { displayOrder: 'asc' as const },
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
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

async function loadGroupForDestinations(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: GROUP_FOR_DESTINATIONS_INCLUDE,
  });
}

function orderDestinations(destinations: GroupForAddDestinations['contents']) {
  return destinations.slice().sort((a, b) => {
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
  });
}

function parseDestinationsRequest(
  request: { user: { id: string }; params: { contentGroupId: string }; body: unknown },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } }
) {
  const userId = request.user.id;
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }
  const targetSocialAccountIds = parseTargetSocialAccountIds(
    (request.body as any)?.targetSocialAccountIds
  );
  if (targetSocialAccountIds.length === 0) {
    reply.code(400).send({
      error: 'invalid_target_social_account',
      message: 'targetSocialAccountIds must include at least one destination',
    });
    return null;
  }
  return { userId, contentGroupId, targetSocialAccountIds };
}

async function loadGroupForAddOperation(params: {
  userId: string;
  contentGroupId: string;
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } };
}) {
  const group = await loadGroupForDestinations(params.contentGroupId);
  if (!group || group.brand.userId !== params.userId) {
    params.reply.code(404).send({ error: 'content_group_not_found' });
    return null;
  }
  await assertBrandOwnership(params.userId, group.brandId);
  const destinations = group.contents.filter((entry) => entry.targetSocialAccountId);
  if (destinations.length === 0) {
    params.reply.code(400).send({ error: 'content_group_missing_destinations' });
    return null;
  }
  if (destinations.some((entry) => entry.status === 'published')) {
    params.reply.code(400).send({
      error: 'content_group_immutable',
      message: 'This content group contains published posts and cannot be modified',
    });
    return null;
  }
  return { group, destinations };
}

async function prepareDestinationAddInputs(params: {
  request: any;
  reply: {
    code: (status: number) => { send: (payload: unknown) => unknown };
    send: (payload: unknown) => unknown;
  };
  contentGroupId: string;
  group: GroupForAddDestinations;
  destinations: GroupForAddDestinations['contents'];
  targetSocialAccountIds: string[];
}) {
  const accountResolution = await resolveAccountsToAdd({
    group: params.group,
    targetSocialAccountIds: params.targetSocialAccountIds,
  });
  if (accountResolution.toAdd.length === 0) {
    params.reply.send({ success: true, added: [] });
    return null;
  }
  if (accountResolution.invalid.length > 0) {
    params.reply.code(400).send({
      error: 'invalid_target_social_account',
      message: 'One or more destination social accounts are not connected to this brand',
      details: accountResolution.invalid,
    });
    return null;
  }

  const templateSource = orderDestinations(params.destinations)[0]!;
  const template = deriveTemplateFromDestination({
    templateInitialized: params.group.templateInitialized,
    templateCaption: params.group.templateCaption,
    templateContentType: params.group.templateContentType,
    templateShareToFeed: params.group.templateShareToFeed,
    templateFirstComment: params.group.templateFirstComment,
    templateThumbOffset: params.group.templateThumbOffset,
    templateAssetIds: params.group.templateAssetIds as string[] | null,
    destination: templateSource,
  });
  const normalized = toCaptionAndHashtags(template.caption, template.contentType);
  const templateAssets = await resolveTemplateAssets({
    request: params.request,
    contentGroupId: params.contentGroupId,
    brandId: params.group.brandId,
    templateAssetIds: template.assetIds,
  });
  if (!templateAssets.ok) {
    params.reply.code(templateAssets.status).send({ error: templateAssets.error });
    return null;
  }
  return { accountResolution, template, normalized, templateAssets };
}

function validatePreparedDestinationAddInputs(params: {
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } };
  destinations: GroupForAddDestinations['contents'];
  resolvedAccounts: ResolvedAccount[];
  template: { contentType: string };
  normalizedCaption: string;
  resolvedAssets: AssetRecord[];
}) {
  const includesInstagram =
    params.destinations.some(
      (entry) => String(entry.targetSocialAccount?.platform) === 'instagram'
    ) || params.resolvedAccounts.some((account) => account.platform === 'instagram');
  if (
    includesInstagram &&
    params.resolvedAssets.length > 1 &&
    !haveUniformAspectRatio(params.resolvedAssets)
  ) {
    params.reply.code(400).send({
      error:
        'All carousel items must have the same aspect ratio. Please crop or resize your media so they match.',
    });
    return false;
  }

  const validation = validateResolvedAccounts({
    resolvedAccounts: params.resolvedAccounts,
    contentType: params.template.contentType,
    caption: params.normalizedCaption,
    mediaAssetsForValidation: params.resolvedAssets.map((asset) => ({
      key: asset.id,
      type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
    })),
  });
  if (!validation.ok) {
    params.reply.code(400).send(validation);
    return false;
  }
  return true;
}

function validateSchedulingSupport(params: {
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } };
  scheduledAtToApply: string | null;
  resolvedAccounts: ResolvedAccount[];
}) {
  if (!params.scheduledAtToApply) {
    return true;
  }
  if (!params.resolvedAccounts.some((account) => !supportsScheduling(account.platform))) {
    return true;
  }
  params.reply.code(400).send({
    error: 'scheduling_not_supported',
    message: 'Scheduling is not yet supported for one or more selected destinations',
    details: Array.from(
      new Set(
        params.resolvedAccounts
          .filter((account) => !supportsScheduling(account.platform))
          .map((account) => account.platform)
      )
    ),
  });
  return false;
}

async function handleGroupDestinationsRequest(fastify: FastifyInstance, request: any, reply: any) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }
  const parsed = parseDestinationsRequest(request, reply);
  if (!parsed) {
    return;
  }

  const loaded = await loadGroupForAddOperation({
    userId: parsed.userId,
    contentGroupId: parsed.contentGroupId,
    reply,
  });
  if (!loaded) {
    return;
  }

  const prepared = await prepareDestinationAddInputs({
    request,
    reply,
    contentGroupId: parsed.contentGroupId,
    group: loaded.group,
    destinations: loaded.destinations,
    targetSocialAccountIds: parsed.targetSocialAccountIds,
  });
  if (!prepared) {
    return;
  }

  const isValid = validatePreparedDestinationAddInputs({
    reply,
    destinations: loaded.destinations,
    resolvedAccounts: prepared.accountResolution.resolvedAccounts,
    template: prepared.template,
    normalizedCaption: prepared.normalized.caption,
    resolvedAssets: prepared.templateAssets.assets,
  });
  if (!isValid) {
    return;
  }

  const scheduledAtToApply = resolveScheduledAtToApply(loaded.destinations);
  if (
    !validateSchedulingSupport({
      reply,
      scheduledAtToApply,
      resolvedAccounts: prepared.accountResolution.resolvedAccounts,
    })
  ) {
    return;
  }

  const created = await createDestinationRows({
    group: loaded.group,
    resolvedAccounts: prepared.accountResolution.resolvedAccounts,
    caption: prepared.normalized.caption,
    hashtags: prepared.normalized.hashtags,
    contentType: prepared.template.contentType,
    shareToFeed: prepared.template.contentType === 'reel' ? prepared.template.shareToFeed : null,
    thumbOffset: normalizeThumbOffset(prepared.template.thumbOffset),
    firstComment: toFirstComment(prepared.template.firstComment, prepared.template.contentType),
    resolvedAssets: prepared.templateAssets.assets,
  });
  const schedulingResults = scheduledAtToApply
    ? await applySchedulingToCreatedDestinations({
        fastify,
        contentIds: created.createdIds,
        headers: buildForwardAuthHeaders(request.headers),
        scheduledAtToApply,
      })
    : undefined;

  return reply.code(201).send({
    success: true,
    contentGroupId: loaded.group.id,
    added: created.created,
    scheduling: scheduledAtToApply
      ? { scheduledAt: scheduledAtToApply, results: schedulingResults }
      : undefined,
  });
}

export function registerGroupDestinationsRoute(fastify: FastifyInstance) {
  fastify.post<{
    Params: { contentGroupId: string };
    Body: { targetSocialAccountIds?: string[] };
  }>(
    '/groups/:contentGroupId/destinations',
    { preHandler: fastify.authenticate },
    async (request, reply) => handleGroupDestinationsRequest(fastify, request, reply)
  );
}
