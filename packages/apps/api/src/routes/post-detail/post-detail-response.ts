import { assertBrandOwnership } from '../../services/ownership.js';

import { prisma } from './shared.js';

type PostWithRelations = {
  id: string;
  caption: string | null;
  hashtags: string[] | null;
  contentType: string;
  shareToFeed: boolean | null;
  status: string;
  scheduledAt: Date | null;
  postedAt: Date | null;
  generationParams: unknown;
  createdAt: Date;
  updatedAt: Date;
  brandId: string;
  contentGroupId: string | null;
  contentSeriesId: string | null;
  recipeRunId: string | null;
  schedulingError: string | null;
  firstComment: string | null;
  firstCommentStatus: string | null;
  firstCommentPostedAt: Date | null;
  firstCommentError: string | null;
  targetSocialAccountId: string | null;
  recipeRun: { recipeTemplate: { id: string; slug: string; name: string } | null } | null;
  mediaAssets: Array<{ assetId: string; displayOrder: number }>;
  brand: { id: string; name: string } | null;
  publications: Array<{ platform: string; permalink: string | null; id: string }>;
};

function deriveRecipeRunId(post: PostWithRelations) {
  const directId = (post as any).recipeRunId ?? null;
  if (typeof directId === 'string' && directId.trim()) {
    return directId.trim();
  }

  const generationParams = post.generationParams as any;
  const derivedId = typeof generationParams?.runId === 'string' ? generationParams.runId : null;
  return typeof derivedId === 'string' && derivedId.trim() ? derivedId.trim() : null;
}

function resolveInstagramPermalink(publications: PostWithRelations['publications']) {
  return (
    publications.find((publication) => publication.platform === 'instagram')?.permalink ||
    publications[0]?.permalink ||
    undefined
  );
}

function mapPostDetailResponse(post: PostWithRelations) {
  return {
    id: post.id,
    caption: post.caption,
    hashtags: post.hashtags,
    contentType: post.contentType,
    shareToFeed: post.shareToFeed,
    status: post.status,
    brandId: post.brandId,
    contentGroupId: post.contentGroupId,
    contentSeriesId: post.contentSeriesId ?? null,
    recipeRunId: deriveRecipeRunId(post),
    generatedByRecipe: post.recipeRun?.recipeTemplate ?? null,
    targetSocialAccountId: post.targetSocialAccountId,
    scheduledAt: post.scheduledAt,
    postedAt: post.postedAt,
    firstComment: post.firstComment,
    firstCommentStatus: post.firstCommentStatus,
    firstCommentPostedAt: post.firstCommentPostedAt,
    firstCommentError: post.firstCommentError,
    instagramPostId: undefined,
    instagramPermalink: resolveInstagramPermalink(post.publications || []),
    analytics: undefined,
    generationParams: post.generationParams,
    schedulingError: post.schedulingError,
    brand: post.brand,
    mediaAssets: post.mediaAssets ?? [],
    mediaAssetCount: post.mediaAssets?.length ?? 0,
    primaryAssetId: post.mediaAssets?.[0]?.assetId ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export async function fetchPostDetailForUser(params: { postId: string; userId: string }) {
  const post = await prisma.content.findUnique({
    where: { id: params.postId },
    select: {
      id: true,
      caption: true,
      hashtags: true,
      contentType: true,
      shareToFeed: true,
      status: true,
      scheduledAt: true,
      postedAt: true,
      generationParams: true,
      createdAt: true,
      updatedAt: true,
      brandId: true,
      contentGroupId: true,
      contentSeriesId: true,
      recipeRunId: true,
      schedulingError: true,
      firstComment: true,
      firstCommentStatus: true,
      firstCommentPostedAt: true,
      firstCommentError: true,
      targetSocialAccountId: true,
      recipeRun: {
        select: {
          id: true,
          recipeTemplate: { select: { id: true, slug: true, name: true } },
        },
      },
      mediaAssets: {
        select: { assetId: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
      brand: { select: { id: true, name: true } },
      publications: { select: { platform: true, permalink: true, id: true } },
    },
  });

  if (!post) {
    return null;
  }

  await assertBrandOwnership(params.userId, post.brandId);
  return mapPostDetailResponse(post as PostWithRelations);
}
