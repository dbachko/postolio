import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';
import { facebookService } from './facebook.js';

const prisma = getDatabaseClient();

/**
 * Ingest recent comments for a brand into publicationComment table.
 * Keeps local workflow state in sync so the inbox can use DB without live Graph lookups.
 */
export async function ingestBrandComments(
  brandId: string,
  maxPosts: number = 50,
  perPostLimit: number = 100,
  options?: { minStaleMs?: number }
): Promise<{ postsProcessed: number; commentsUpserted: number }> {
  // Load brand with IG connection data
  const brandExists = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true },
  });
  if (!brandExists) throw new Error('Brand not found');

  const minStaleMs = Number(options?.minStaleMs ?? 0);
  const supportedPlatforms = ['instagram', 'facebook'] as const;

  const pubs = await prisma.contentPublication.findMany({
    where: { content: { brandId }, platform: { in: supportedPlatforms as any } },
    orderBy: { publishedAt: 'desc' },
    take: Math.max(1, Math.min(maxPosts, 200)),
    select: { id: true, platform: true, externalPostId: true, socialAccountId: true },
  });

  const nowMs = Date.now();
  let latestFetchedAtByPublicationId = new Map<string, Date>();
  if (minStaleMs > 0 && pubs.length > 0) {
    const pubIds = pubs.map((p) => p.id).filter(Boolean);
    const latestFetchRows = pubIds.length
      ? await prisma.publicationComment.groupBy({
          by: ['publicationId'],
          where: { publicationId: { in: pubIds } },
          _max: { fetchedAt: true },
        })
      : [];

    latestFetchedAtByPublicationId = new Map(
      latestFetchRows
        .map((row) => [row.publicationId, row._max.fetchedAt] as const)
        .filter(([, fetchedAt]) => fetchedAt instanceof Date)
        .map(([publicationId, fetchedAt]) => [publicationId, fetchedAt as Date])
    );
  }

  let commentsUpserted = 0;
  let postsProcessed = 0;
  for (const pub of pubs) {
    if (!pub.externalPostId) continue;
    if (minStaleMs > 0) {
      const lastFetchedAt = latestFetchedAtByPublicationId.get(pub.id) ?? null;
      if (lastFetchedAt && nowMs - lastFetchedAt.getTime() < minStaleMs) {
        continue;
      }
    }
    try {
      postsProcessed++;
      const fetchedAt = new Date();
      const externalPostId = String(pub.externalPostId);
      const limit = Math.max(1, Math.min(perPostLimit, 200));
      const res =
        pub.platform === 'instagram'
          ? await instagramService.getPostCommentsForSocialAccount(
              pub.socialAccountId,
              externalPostId,
              limit
            )
          : await facebookService.getPostCommentsForSocialAccount(
              pub.socialAccountId,
              externalPostId,
              limit
            );
      for (const c of res.data) {
        try {
          const likeCount = typeof (c as any).like_count === 'number' ? (c as any).like_count : 0;
          await prisma.publicationComment.upsert({
            where: {
              publicationId_externalCommentId: {
                publicationId: pub.id,
                externalCommentId: String(c.id || ''),
              },
            } as any,
            update: {
              text: (c as any).text || null,
              authorUsername: (c as any).username || null,
              likeCount,
              fetchedAt,
              // Do not override workflow status here
            },
            create: {
              publicationId: pub.id,
              platform: pub.platform,
              externalCommentId: String(c.id || ''),
              text: (c as any).text || null,
              authorUsername: (c as any).username || null,
              likeCount,
              status: 'open',
              createdAt: c.timestamp ? new Date(c.timestamp) : undefined,
              fetchedAt,
            },
          });
          commentsUpserted++;
        } catch {
          // Continue with best effort if single row fails
        }
      }
    } catch {
      // Swallow single publication failures; continue to next
      continue;
    }
    // Small gap to avoid bursting the API if many pubs
    await new Promise((r) => setTimeout(r, 50));
  }

  return { postsProcessed, commentsUpserted };
}
