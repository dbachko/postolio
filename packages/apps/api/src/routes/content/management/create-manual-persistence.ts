import type { AssetRecord } from '@postolio/assets-client';
import { Prisma } from '@postolio/database';

import {
  createContentInTransaction,
  handleScheduling,
  type CreateManualContentBody,
} from '../../../utils/content-management.js';
import { extractHashtagsFromCaption } from '../../../utils/hashtag-extractor.js';
import { prisma, type DestinationAccount } from './shared.js';

const CONTENT_SELECT = {
  id: true,
  caption: true,
  hashtags: true,
  status: true,
  brandId: true,
  contentGroupId: true,
  targetSocialAccountId: true,
  schedulingError: true,
  generationParams: true,
  createdAt: true,
  updatedAt: true,
  scheduledAt: true,
  postedAt: true,
  contentType: true,
  shareToFeed: true,
  firstComment: true,
  firstCommentStatus: true,
  firstCommentPostedAt: true,
  firstCommentError: true,
  mediaAssets: {
    select: { assetId: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' as const },
  },
};

type CreatedContentBundle = {
  contentGroupId: string | null;
  contents: any[];
};

async function createSingleDestinationContent(
  body: CreateManualContentBody,
  resolvedAssets: AssetRecord[],
  destinations: DestinationAccount[]
): Promise<CreatedContentBundle> {
  const content = await createContentInTransaction(
    {
      brandId: body.brandId,
      caption: body.caption,
      contentType: body.contentType,
      scheduledAt: body.scheduledAt,
      shareToFeed: body.shareToFeed,
      firstComment: body.firstComment,
      contentGroupId: null,
      targetSocialAccountId: destinations[0]?.id ?? null,
      resolvedAssets,
    },
    prisma
  );

  return { contentGroupId: null, contents: content ? [content] : [] };
}

function buildGroupTemplateData(body: CreateManualContentBody, resolvedAssets: AssetRecord[]) {
  return {
    brandId: body.brandId,
    templateInitialized: true,
    templateCaption: body.caption,
    templateContentType: body.contentType || 'post',
    templateShareToFeed: body.shareToFeed ?? null,
    templateFirstComment: body.firstComment ? body.firstComment.trim() : null,
    templateThumbOffset: null,
    templateAssetIds: resolvedAssets.map((asset) => asset.id),
  };
}

function buildContentData(params: {
  body: CreateManualContentBody;
  contentGroupId: string;
  destinationId: string;
  status: 'draft' | 'scheduled';
  hashtags: string[];
}) {
  return {
    caption: params.body.caption,
    hashtags: params.hashtags,
    status: params.status,
    brandId: params.body.brandId,
    contentGroupId: params.contentGroupId,
    scheduledAt: params.body.scheduledAt ? new Date(params.body.scheduledAt) : null,
    contentType: params.body.contentType || 'post',
    shareToFeed: params.body.shareToFeed ?? null,
    firstComment: params.body.firstComment ? params.body.firstComment.trim() : null,
    targetSocialAccountId: params.destinationId,
    generationParams: Prisma.JsonNull,
  };
}

async function createGroupDestinationContent(
  body: CreateManualContentBody,
  resolvedAssets: AssetRecord[],
  destinations: DestinationAccount[]
): Promise<CreatedContentBundle> {
  return prisma.$transaction(async (tx) => {
    const group = await tx.contentGroup.create({
      data: buildGroupTemplateData(body, resolvedAssets),
      select: { id: true },
    });

    const status = body.scheduledAt ? 'scheduled' : 'draft';
    const hashtags = extractHashtagsFromCaption(body.caption);
    const createdIds: string[] = [];

    for (const destination of destinations) {
      const row = await tx.content.create({
        data: buildContentData({
          body,
          contentGroupId: group.id,
          destinationId: destination.id,
          status,
          hashtags,
        }),
        select: { id: true },
      });
      createdIds.push(row.id);
    }

    if (resolvedAssets.length > 0) {
      await tx.contentMediaAsset.createMany({
        data: createdIds.flatMap((contentId) =>
          resolvedAssets.map((asset, index) => ({
            contentId,
            assetId: asset.id,
            displayOrder: index,
          }))
        ),
      });
    }

    const contents = await tx.content.findMany({
      where: { id: { in: createdIds } },
      select: CONTENT_SELECT,
    });

    const byId = new Map(contents.map((content) => [content.id, content]));
    const ordered = createdIds.map((id) => byId.get(id)).filter(Boolean);
    return { contentGroupId: group.id, contents: ordered };
  });
}

export async function createManualContentRecords(params: {
  body: CreateManualContentBody;
  resolvedAssets: AssetRecord[];
  destinations: DestinationAccount[];
}): Promise<CreatedContentBundle> {
  if (params.destinations.length <= 1) {
    return createSingleDestinationContent(params.body, params.resolvedAssets, params.destinations);
  }

  return createGroupDestinationContent(params.body, params.resolvedAssets, params.destinations);
}

export async function scheduleCreatedContent(params: {
  contents: any[];
  scheduledAt?: string;
}): Promise<any | null> {
  if (!params.scheduledAt) {
    return null;
  }

  let upsell: any | null = null;
  for (const content of params.contents) {
    const nextUpsell = await handleScheduling(content.id, params.scheduledAt);
    if (!upsell && nextUpsell) {
      upsell = nextUpsell;
    }
  }

  return upsell;
}
