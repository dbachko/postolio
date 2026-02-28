import type { AssetRecord } from '@postolio/assets-client';

import { prisma } from '../../config/database.js';
import { getAssetsClient } from '../../services/assets-media.js';
import { extractHashtagsFromCaption } from '../../utils/hashtag-extractor.js';

type SyncStats = {
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
};

function createInitialSyncStats(): SyncStats {
  return {
    syncedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
  };
}

function markSyncFailure(stats: SyncStats, message: string) {
  stats.failedCount += 1;
  stats.errors.push(message);
}

function markSyncSkipped(stats: SyncStats) {
  stats.skippedCount += 1;
}

function markSyncSuccess(stats: SyncStats) {
  stats.syncedCount += 1;
}

async function backfillTargetSocialAccountId(contentId: unknown, destinationId: string) {
  if (typeof contentId !== 'string' || !contentId.trim()) {
    return;
  }
  await prisma.content.updateMany({
    where: { id: contentId.trim(), targetSocialAccountId: null },
    data: { targetSocialAccountId: destinationId },
  });
}

async function findExistingPublication(params: {
  brandId: string;
  platform: string;
  socialAccountId: string;
  externalPostId: string;
}) {
  const existingByBrand = await prisma.contentPublication.findFirst({
    where: {
      platform: params.platform as any,
      externalPostId: params.externalPostId,
      content: { brandId: params.brandId },
    },
  });
  if (existingByBrand) {
    const destinationId =
      typeof (existingByBrand as { socialAccountId?: unknown }).socialAccountId === 'string'
        ? (existingByBrand as { socialAccountId: string }).socialAccountId || params.socialAccountId
        : params.socialAccountId;
    await backfillTargetSocialAccountId(
      (existingByBrand as { contentId?: unknown }).contentId,
      destinationId
    );
    return true;
  }

  const existingByAccount = await prisma.contentPublication.findFirst({
    where: {
      socialAccountId: params.socialAccountId,
      externalPostId: params.externalPostId,
    },
  });
  if (existingByAccount) {
    await backfillTargetSocialAccountId(
      (existingByAccount as { contentId?: unknown }).contentId,
      params.socialAccountId
    );
    return true;
  }

  return false;
}

async function importPostAsset(params: {
  post: any;
  brandId: string;
  userId: string;
  externalPostId: string;
}) {
  if (!params.post.mediaUrl) {
    return null;
  }

  const assetsClient = getAssetsClient();
  const isVideo = params.post.mediaType === 'VIDEO';
  return assetsClient.importFromUrl({
    brandId: params.brandId,
    uploadedBy: params.userId,
    sourceUrl: params.post.mediaUrl,
    fileName: `${params.externalPostId}.${isVideo ? 'mp4' : 'jpg'}`,
    mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
    fileType: isVideo ? 'video' : 'image',
    title: `Imported from ${params.post.platform || 'platform'}`,
  });
}

async function createImportedContent(params: {
  brandId: string;
  socialAccountId: string;
  post: any;
  importedAsset: AssetRecord | null;
}) {
  const content = await prisma.content.create({
    data: {
      brandId: params.brandId,
      targetSocialAccountId: params.socialAccountId,
      caption: params.post.caption,
      hashtags: extractHashtagsFromCaption(params.post.caption),
      status: 'published',
      postedAt: params.post.postedAt ? new Date(params.post.postedAt) : new Date(),
      createdAt: params.post.postedAt ? new Date(params.post.postedAt) : new Date(),
      updatedAt: new Date(),
    },
  });

  if (params.importedAsset) {
    await prisma.contentMediaAsset.create({
      data: {
        contentId: content.id,
        assetId: params.importedAsset.id,
        displayOrder: 0,
      },
    });
  }

  return content;
}

async function createPublicationForImportedContent(params: {
  contentId: string;
  socialAccountId: string;
  platform: string;
  externalPostId: string;
  post: any;
}) {
  await prisma.contentPublication.create({
    data: {
      contentId: params.contentId,
      socialAccountId: params.socialAccountId,
      platform: params.platform as any,
      externalPostId: params.externalPostId,
      permalink: params.post.permalink,
      publishedAt: params.post.postedAt ? new Date(params.post.postedAt) : new Date(),
      metadata: {
        imported: true,
        syncedAt: new Date().toISOString(),
      },
    },
  });
}

async function createImportedContentOrTrackFailure(params: {
  stats: SyncStats;
  post: any;
  brandId: string;
  userId: string;
  socialAccountId: string;
  externalPostId: string;
}) {
  let importedAsset: AssetRecord | null = null;
  try {
    importedAsset = await importPostAsset({
      post: params.post,
      brandId: params.brandId,
      userId: params.userId,
      externalPostId: params.externalPostId,
    });
  } catch (error: unknown) {
    markSyncFailure(
      params.stats,
      `Post ${params.externalPostId}: failed to import media - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }

  try {
    return await createImportedContent({
      brandId: params.brandId,
      socialAccountId: params.socialAccountId,
      post: params.post,
      importedAsset,
    });
  } catch (error: unknown) {
    markSyncFailure(
      params.stats,
      `Post ${params.externalPostId}: failed to create content - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

async function createPublicationOrTrackResult(params: {
  stats: SyncStats;
  contentId: string;
  socialAccountId: string;
  platform: string;
  externalPostId: string;
  post: any;
}) {
  try {
    await createPublicationForImportedContent({
      contentId: params.contentId,
      socialAccountId: params.socialAccountId,
      platform: params.platform,
      externalPostId: params.externalPostId,
      post: params.post,
    });
    markSyncSuccess(params.stats);
  } catch (error: any) {
    if (error?.code === 'P2002') {
      await prisma.content.delete({ where: { id: params.contentId } }).catch(() => undefined);
      markSyncSkipped(params.stats);
      return;
    }

    markSyncFailure(
      params.stats,
      `Post ${params.externalPostId}: failed to create publication - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    await prisma.content.delete({ where: { id: params.contentId } }).catch(() => undefined);
  }
}

async function processSyncPost(params: {
  stats: SyncStats;
  post: any;
  brandId: string;
  userId: string;
  platform: string;
  socialAccountId: string;
}) {
  const externalPostId = params.post.id;
  if (!externalPostId) {
    markSyncFailure(params.stats, 'Post missing external ID; cannot sync');
    return;
  }

  const exists = await findExistingPublication({
    brandId: params.brandId,
    platform: params.platform,
    socialAccountId: params.socialAccountId,
    externalPostId,
  });
  if (exists) {
    markSyncSkipped(params.stats);
    return;
  }

  const content = await createImportedContentOrTrackFailure({
    stats: params.stats,
    post: params.post,
    brandId: params.brandId,
    userId: params.userId,
    socialAccountId: params.socialAccountId,
    externalPostId,
  });
  if (!content) {
    return;
  }

  await createPublicationOrTrackResult({
    stats: params.stats,
    contentId: content.id,
    socialAccountId: params.socialAccountId,
    platform: params.platform,
    externalPostId,
    post: params.post,
  });
}

export async function syncFetchedPosts(params: {
  posts: any[];
  brandId: string;
  userId: string;
  platform: string;
  socialAccountId: string;
}) {
  const stats = createInitialSyncStats();
  for (const post of params.posts) {
    await processSyncPost({
      stats,
      post,
      brandId: params.brandId,
      userId: params.userId,
      platform: params.platform,
      socialAccountId: params.socialAccountId,
    });
  }
  return stats;
}
