import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';
import { facebookService } from './facebook.js';
import type { Platform } from '@postolio/database';

const prisma = getDatabaseClient();
const SUPPORTED_PLATFORMS = ['instagram', 'facebook'] as const;

function buildPublicationWhere(brandId: string, socialAccountIds: string[]) {
  const where: any = {
    content: { brandId },
    platform: { in: SUPPORTED_PLATFORMS as any },
  };
  if (socialAccountIds.length) {
    where.socialAccountId = { in: socialAccountIds };
  }
  return where;
}

async function loadFreshnessMap(publicationIds: string[], minStaleMs: number) {
  if (minStaleMs <= 0 || publicationIds.length === 0) {
    return new Map<string, Date>();
  }

  const latestFetchRows = await prisma.publicationComment.groupBy({
    by: ['publicationId'],
    where: { publicationId: { in: publicationIds } },
    _max: { fetchedAt: true },
  });

  return new Map(
    latestFetchRows
      .map((row) => [row.publicationId, row._max.fetchedAt] as const)
      .filter(([, fetchedAt]) => fetchedAt instanceof Date)
      .map(([publicationId, fetchedAt]) => [publicationId, fetchedAt as Date])
  );
}

function shouldSkipStalePublication(params: {
  publicationId: string;
  latestFetchedAtByPublicationId: Map<string, Date>;
  minStaleMs: number;
  nowMs: number;
}) {
  if (params.minStaleMs <= 0) {
    return false;
  }
  const lastFetchedAt = params.latestFetchedAtByPublicationId.get(params.publicationId) ?? null;
  return Boolean(lastFetchedAt && params.nowMs - lastFetchedAt.getTime() < params.minStaleMs);
}

async function fetchPublicationComments(
  publication: {
    platform: 'instagram' | 'facebook';
    socialAccountId: string;
    externalPostId: string;
  },
  perPostLimit: number
) {
  const limit = Math.max(1, Math.min(perPostLimit, 200));
  if (publication.platform === 'instagram') {
    return instagramService.getPostCommentsForSocialAccount(
      publication.socialAccountId,
      publication.externalPostId,
      limit
    );
  }
  return facebookService.getPostCommentsForSocialAccount(
    publication.socialAccountId,
    publication.externalPostId,
    limit
  );
}

async function upsertPublicationComment(params: {
  publicationId: string;
  platform: Platform;
  comment: any;
  fetchedAt: Date;
}) {
  const likeCount =
    typeof (params.comment as any).like_count === 'number' ? (params.comment as any).like_count : 0;
  await prisma.publicationComment.upsert({
    where: {
      publicationId_externalCommentId: {
        publicationId: params.publicationId,
        externalCommentId: String(params.comment.id || ''),
      },
    } as any,
    update: {
      text: (params.comment as any).text || null,
      authorUsername: (params.comment as any).username || null,
      likeCount,
      fetchedAt: params.fetchedAt,
    },
    create: {
      publicationId: params.publicationId,
      platform: params.platform,
      externalCommentId: String(params.comment.id || ''),
      text: (params.comment as any).text || null,
      authorUsername: (params.comment as any).username || null,
      likeCount,
      status: 'open',
      createdAt: params.comment.timestamp ? new Date(params.comment.timestamp) : undefined,
      fetchedAt: params.fetchedAt,
    },
  });
}

function normalizeIngestOptions(options?: { minStaleMs?: number; socialAccountIds?: string[] }) {
  return {
    minStaleMs: Number(options?.minStaleMs ?? 0),
    socialAccountIds: (options?.socialAccountIds || []).map(String).filter(Boolean),
  };
}

async function processPublicationComments(params: {
  publicationId: string;
  platform: Platform;
  socialAccountId: string;
  externalPostId: string;
  perPostLimit: number;
}): Promise<number> {
  if (params.platform !== 'instagram' && params.platform !== 'facebook') {
    return 0;
  }

  const fetchedAt = new Date();
  const res = await fetchPublicationComments(
    {
      platform: params.platform,
      socialAccountId: params.socialAccountId,
      externalPostId: params.externalPostId,
    },
    params.perPostLimit
  );

  let commentsUpserted = 0;
  for (const comment of res.data) {
    try {
      await upsertPublicationComment({
        publicationId: params.publicationId,
        platform: params.platform,
        comment,
        fetchedAt,
      });
      commentsUpserted++;
    } catch {
      // Continue with best effort if a single row fails.
    }
  }

  return commentsUpserted;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ingest recent comments for a brand into publicationComment table.
 * Keeps local workflow state in sync so the inbox can use DB without live Graph lookups.
 */
export async function ingestBrandComments(
  brandId: string,
  maxPosts = 50,
  perPostLimit = 100,
  options?: { minStaleMs?: number; socialAccountIds?: string[] }
): Promise<{ postsProcessed: number; commentsUpserted: number }> {
  const brandExists = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true },
  });
  if (!brandExists) {
    throw new Error('Brand not found');
  }

  const { minStaleMs, socialAccountIds } = normalizeIngestOptions(options);
  const where = buildPublicationWhere(brandId, socialAccountIds);

  const pubs = await prisma.contentPublication.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: Math.max(1, Math.min(maxPosts, 200)),
    select: { id: true, platform: true, externalPostId: true, socialAccountId: true },
  });

  const nowMs = Date.now();
  const publicationIds = pubs.map((pub) => pub.id).filter(Boolean);
  const latestFetchedAtByPublicationId = await loadFreshnessMap(publicationIds, minStaleMs);

  let commentsUpserted = 0;
  let postsProcessed = 0;
  for (const pub of pubs) {
    if (!pub.externalPostId) {
      continue;
    }
    if (
      shouldSkipStalePublication({
        publicationId: pub.id,
        latestFetchedAtByPublicationId,
        minStaleMs,
        nowMs,
      })
    ) {
      continue;
    }

    try {
      postsProcessed++;
      commentsUpserted += await processPublicationComments({
        publicationId: pub.id,
        platform: pub.platform,
        socialAccountId: pub.socialAccountId,
        externalPostId: String(pub.externalPostId),
        perPostLimit,
      });
    } catch {
      // Swallow single publication failures; continue to next.
      continue;
    }
    // Small gap to avoid bursting the API if many publications are processed.
    await delay(50);
  }

  return { postsProcessed, commentsUpserted };
}
