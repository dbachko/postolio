import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';

const prisma = getDatabaseClient();

/**
 * Ingest recent Instagram comments for a brand into publicationComment table.
 * Keeps local workflow state in sync so the inbox can use DB without live Graph lookups.
 */
export async function ingestBrandComments(
  brandId: string,
  maxPosts: number = 50,
  perPostLimit: number = 100
): Promise<{ postsProcessed: number; commentsUpserted: number }> {
  // Load brand with IG connection data
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw new Error('Brand not found');

  const pubs = await prisma.contentPublication.findMany({
    where: { content: { brandId }, platform: 'instagram' },
    orderBy: { publishedAt: 'desc' },
    take: Math.max(1, Math.min(maxPosts, 200)),
    select: { id: true, externalPostId: true },
  });

  let commentsUpserted = 0;
  for (const pub of pubs) {
    if (!pub.externalPostId) continue;
    try {
      const res = await instagramService.getPostComments(
        brand as any,
        String(pub.externalPostId),
        Math.max(1, Math.min(perPostLimit, 200))
      );
      for (const c of res.data) {
        try {
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
              // Do not override workflow status here
            },
            create: {
              publicationId: pub.id,
              platform: 'instagram',
              externalCommentId: String(c.id || ''),
              text: (c as any).text || null,
              authorUsername: (c as any).username || null,
              status: 'open',
              createdAt: c.timestamp ? new Date(c.timestamp) : undefined,
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

  return { postsProcessed: pubs.length, commentsUpserted };
}
