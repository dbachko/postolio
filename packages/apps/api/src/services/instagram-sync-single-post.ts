import { logger as baseLogger } from '@postolio/logger';
import { prisma } from '../config/database.js';
import { attachAssetToContent, importImageFromExternalUrl } from './assets-media.js';
import { extractHashtagsFromCaption } from '../utils/hashtag-extractor.js';
import type { Prisma } from '@postolio/database';
import type { AssetRecord } from '@postolio/assets-client';
import type { InstagramPost } from './instagram.js';
import { findMatchingDraftCandidate } from './instagram-sync-single-post.matching.js';
type BrandData = { id: string };
type ServiceLike = any;
const syncLogger = baseLogger.child({ module: 'instagram-sync-single-post' });
async function ensureNotAlreadyImported(brandId: string, postId: string, skipExisting: boolean) {
  if (!skipExisting) {
    return;
  }
  const duplicatePub = await prisma.contentPublication.findFirst({
    where: {
      platform: 'instagram',
      externalPostId: postId,
      content: { brandId },
    },
    select: { id: true },
  });
  if (duplicatePub) {
    throw new Error('Post already exists');
  }
}

async function importPostAsset(
  brandId: string,
  post: InstagramPost
): Promise<{
  importedAsset: AssetRecord | null;
  imageDownloadFailed: boolean;
}> {
  if (!post.media_url) {
    syncLogger.info('[Instagram Sync] No media URL on imported post', { postId: post.id, brandId });
    return { importedAsset: null, imageDownloadFailed: true };
  }
  try {
    const importedAsset = await importImageFromExternalUrl(post.media_url, {
      contentId: `import-${post.id}`,
      brandId,
      generatedAt: post.timestamp ? new Date(post.timestamp) : new Date(),
      source: 'instagram',
      originalPrompt: post.caption || 'Imported from Instagram',
      publishedAt: post.timestamp ? new Date(post.timestamp) : undefined,
    });
    return { importedAsset, imageDownloadFailed: false };
  } catch (error) {
    syncLogger.error('[Instagram Sync] Failed to download image for post', {
      postId: post.id,
      brandId,
      mediaUrl: post.media_url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { importedAsset: null, imageDownloadFailed: true };
  }
}
function buildImportedContentData(
  brandId: string,
  post: InstagramPost,
  hasImage: boolean,
  imageDownloadFailed: boolean
) {
  const postedAt = post.timestamp ? new Date(post.timestamp) : new Date();
  return {
    postedAt,
    contentData: {
      brandId,
      caption: post.caption,
      hashtags: extractHashtagsFromCaption(post.caption || ''),
      status: 'published' as const,
      postedAt,
      scheduledAt: postedAt,
      generationParams: {
        source: 'instagram_import',
        importedAt: new Date().toISOString(),
        originalPostDate: post.timestamp,
        mediaType: post.media_type,
        hasImage,
        imageDownloadFailed,
      },
    },
  };
}
async function upsertInstagramSocialAccount(
  brandId: string,
  credentials: { accountId: string; pageId?: string }
) {
  return prisma.socialAccount.upsert({
    where: {
      platform_externalAccountId: {
        platform: 'instagram',
        externalAccountId: credentials.accountId || 'unknown',
      },
    },
    update: {
      brandId,
      externalPageId: credentials.pageId || undefined,
    },
    create: {
      brandId,
      platform: 'instagram',
      externalAccountId: credentials.accountId || 'unknown',
      externalPageId: credentials.pageId || undefined,
      displayName: '',
    },
  });
}
async function upsertPublicationForContent(params: {
  contentId: string;
  socialAccountId: string;
  credentials: { accountId: string; pageId?: string };
  post: InstagramPost;
  postedAt: Date;
}) {
  await prisma.contentPublication.upsert({
    where: {
      socialAccountId_externalPostId: {
        socialAccountId: params.socialAccountId,
        externalPostId: params.post.id,
      },
    },
    update: {
      contentId: params.contentId,
      platform: 'instagram',
      permalink: params.post.permalink || undefined,
      publishedAt: params.postedAt,
    },
    create: {
      contentId: params.contentId,
      socialAccountId: params.socialAccountId,
      platform: 'instagram',
      externalPostId: params.post.id,
      externalThreadRootId: null,
      externalAccountId: params.credentials.accountId || undefined,
      externalPageId: params.credentials.pageId || undefined,
      permalink: params.post.permalink || undefined,
      publishedAt: params.postedAt,
      status: 'published',
    },
  });
}
async function mergeIntoMatchingDraft(params: {
  matchingDraftId: string;
  importedAsset: AssetRecord | null;
  post: InstagramPost;
  postedAt: Date;
  brandId: string;
  credentials: { accountId: string; pageId?: string };
  imageDownloadFailed: boolean;
}) {
  const current = await prisma.content.findUnique({
    where: { id: params.matchingDraftId },
    select: {
      generationParams: true,
      scheduledAt: true,
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
        take: 1,
      },
    },
  });
  const existingParams = (current?.generationParams as Record<string, unknown>) || {};
  const hasExistingMedia = Boolean(current?.mediaAssets?.length);
  const finalHasImage = hasExistingMedia || Boolean(params.importedAsset);
  await prisma.content.update({
    where: { id: params.matchingDraftId },
    data: {
      status: 'published',
      postedAt: params.postedAt,
      scheduledAt: current?.scheduledAt ?? params.postedAt,
      schedulingError: null,
      generationParams: {
        ...existingParams,
        source: 'instagram_import',
        importedAt: new Date().toISOString(),
        originalPostDate: params.post.timestamp,
        mediaType: params.post.media_type,
        hasImage: finalHasImage,
        imageDownloadFailed: params.imageDownloadFailed,
      },
    },
  });
  if (params.importedAsset && !hasExistingMedia) {
    await attachAssetToContent({
      contentId: params.matchingDraftId,
      asset: params.importedAsset,
      displayOrder: 0,
    });
  }
  const socialAccount = await upsertInstagramSocialAccount(params.brandId, params.credentials);
  await upsertPublicationForContent({
    contentId: params.matchingDraftId,
    socialAccountId: socialAccount.id,
    credentials: params.credentials,
    post: params.post,
    postedAt: params.postedAt,
  });
}
async function mergeExistingPublication(params: {
  existingPublication: { id: string; contentId: string };
  importedAsset: AssetRecord | null;
  postedAt: Date;
  contentData: {
    generationParams: Record<string, unknown>;
  };
  post: InstagramPost;
}) {
  if (params.importedAsset) {
    try {
      await attachAssetToContent({
        contentId: params.existingPublication.contentId,
        asset: params.importedAsset,
      });
    } catch {
      // best effort attach
    }
  }
  await prisma.content.update({
    where: { id: params.existingPublication.contentId },
    data: {
      status: 'published',
      postedAt: params.postedAt,
      schedulingError: null,
      generationParams: { ...(params.contentData.generationParams as any) },
    },
  });
  await prisma.contentPublication.update({
    where: { id: params.existingPublication.id },
    data: {
      permalink: params.post.permalink || undefined,
      publishedAt: params.postedAt,
      status: 'published',
    },
  });
}
async function createNewImportedContent(params: {
  contentData: Prisma.ContentCreateInput;
  importedAsset: AssetRecord | null;
  socialAccountId: string;
  credentials: { accountId: string; pageId?: string };
  post: InstagramPost;
  postedAt: Date;
}) {
  const created = await prisma.content.create({ data: params.contentData });
  if (params.importedAsset) {
    await attachAssetToContent({ contentId: created.id, asset: params.importedAsset });
  }
  try {
    await prisma.contentPublication.create({
      data: {
        contentId: created.id,
        socialAccountId: params.socialAccountId,
        platform: 'instagram',
        externalPostId: params.post.id,
        externalThreadRootId: null,
        externalAccountId: params.credentials.accountId || undefined,
        externalPageId: params.credentials.pageId || undefined,
        permalink: params.post.permalink || undefined,
        publishedAt: params.postedAt,
        status: 'published',
      },
    });
  } catch (publicationError) {
    if ((publicationError as any)?.code === 'P2002') {
      try {
        await prisma.content.delete({ where: { id: created.id } });
      } catch {
        // best effort cleanup
      }
      return;
    }
    try {
      await prisma.content.delete({ where: { id: created.id } });
    } catch {
      // best effort cleanup
    }
    throw publicationError;
  }
}
export async function syncSinglePostImpl(
  service: ServiceLike,
  brand: BrandData,
  post: InstagramPost,
  skipExisting: boolean
): Promise<void> {
  const credentials = await service.getCredentialsOrThrow(brand);
  await ensureNotAlreadyImported(brand.id, post.id, skipExisting);
  if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') {
    throw new Error(`Unsupported media type: ${post.media_type}`);
  }
  const imported = await importPostAsset(brand.id, post);
  const { postedAt, contentData } = buildImportedContentData(
    brand.id,
    post,
    Boolean(imported.importedAsset),
    imported.imageDownloadFailed
  );
  const matchingDraft = await findMatchingDraftCandidate(brand.id, post);
  if (matchingDraft) {
    await mergeIntoMatchingDraft({
      matchingDraftId: matchingDraft.id,
      importedAsset: imported.importedAsset,
      post,
      postedAt,
      brandId: brand.id,
      credentials,
      imageDownloadFailed: imported.imageDownloadFailed,
    });
    return;
  }
  const socialAccount = await upsertInstagramSocialAccount(brand.id, credentials);
  const existingPublication = await prisma.contentPublication.findUnique({
    where: {
      socialAccountId_externalPostId: {
        socialAccountId: socialAccount.id,
        externalPostId: post.id,
      },
    },
    select: { id: true, contentId: true },
  });
  if (existingPublication?.contentId) {
    await mergeExistingPublication({
      existingPublication,
      importedAsset: imported.importedAsset,
      postedAt,
      contentData: contentData as any,
      post,
    });
    return;
  }
  await createNewImportedContent({
    contentData: contentData as any,
    importedAsset: imported.importedAsset,
    socialAccountId: socialAccount.id,
    credentials,
    post,
    postedAt,
  });
}
