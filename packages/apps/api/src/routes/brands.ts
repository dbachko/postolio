import { FastifyPluginAsync } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';
import { computePlaceholders } from '../services/placeholderService.js';
import { instagramService } from '../services/instagram.js';
import { getRedisClient } from '../services/redis.js';
import { ingestBrandComments } from '../services/inbox-comments-ingestor.js';

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();
const eventBridge = new EventBridge({});

interface CreateBrandBody {
  name: string;
  description?: string;
  countryCode?: string | null;
}

interface UpdateBrandBody {
  name?: string;
  description?: string;
  countryCode?: string | null;
}

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new brand (RESTful: POST /)
  fastify.post<{ Body: CreateBrandBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { name, description, countryCode } = request.body;

        // Validate required fields
        if (!name || name.trim().length === 0) {
          return reply.code(400).send({ error: 'Brand name is required' });
        }

        if (name.length > 100) {
          return reply.code(400).send({ error: 'Brand name must be less than 100 characters' });
        }

        const brand = await prisma.brand.create({
          data: {
            name: name.trim(),
            description: description?.trim() || null,
            userId,
            ...(countryCode
              ? {
                  countryCode:
                    typeof countryCode === 'string' && countryCode.length === 2
                      ? countryCode.toUpperCase()
                      : null,
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            countryCode: true,
          },
        });

        // Note: do not auto-start brand analysis on creation.
        // Analysis runs only on IG connect, brand updates, or manual trigger.
        return reply.code(201).send({ brand });
      } catch (error) {
        console.error('Brand creation error:', error);

        // Handle specific Prisma errors
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A brand with this name already exists' });
        }

        return reply.code(500).send({ error: 'Failed to create brand. Please try again.' });
      }
    }
  );

  // Get user's brands (RESTful: GET /)
  fastify.get('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;

      const brands = await prisma.brand.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          description: true,
          styleProfile: true,
          createdAt: true,
          countryCode: true,
          postingTimezone: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return { brands };
    } catch (error) {
      console.error('Brands list error:', error);
      return reply.code(500).send({ error: 'Failed to retrieve brands' });
    }
  });

  // Get specific brand details (RESTful: GET /:id)
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;

        const brand = await prisma.brand.findFirst({
          where: {
            id,
            userId, // Ensure user owns this brand
          },
          select: {
            id: true,
            name: true,
            description: true,
            styleProfile: true,
            preferences: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        return { brand };
      } catch (error) {
        console.error('Brand details error:', error);
        return reply.code(500).send({ error: 'Failed to retrieve brand details' });
      }
    }
  );

  // Update a brand (RESTful: PUT /:id)
  fastify.put<{ Params: { id: string }; Body: UpdateBrandBody }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;
        const { name, description, countryCode } = request.body;

        // Validate at least one field is provided
        if (!name && description === undefined && countryCode === undefined) {
          return reply.code(400).send({ error: 'At least one field must be provided for update' });
        }

        // Validate name if provided
        if (name !== undefined) {
          if (!name || name.trim().length === 0) {
            return reply.code(400).send({ error: 'Brand name cannot be empty' });
          }
          if (name.length > 100) {
            return reply.code(400).send({ error: 'Brand name must be less than 100 characters' });
          }
        }

        // Basic validation for countryCode if provided
        if (countryCode !== undefined && countryCode !== null) {
          if (typeof countryCode !== 'string' || countryCode.length !== 2) {
            return reply.code(400).send({ error: 'countryCode must be a 2-letter ISO code' });
          }
        }

        // Check if brand exists and user owns it
        const existingBrand = await prisma.brand.findFirst({
          where: {
            id,
            userId,
          },
        });

        if (!existingBrand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Prepare update data with explicit typing
        interface BrandUpdateData {
          name?: string;
          description?: string | null;
          countryCode?: string | null;
        }
        const updateData: BrandUpdateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (countryCode !== undefined)
          updateData.countryCode = countryCode ? countryCode.toUpperCase() : null;

        // Update the brand
        const updatedBrand = await prisma.brand.update({
          where: { id },
          data: updateData,
          select: {
            id: true,
            name: true,
            description: true,
            styleProfile: true,
            createdAt: true,
            updatedAt: true,
            countryCode: true,
          },
        });

        // If brand name or description changed, trigger a new brand analysis (fire-and-forget)
        const nameChanged =
          typeof name === 'string' && name.trim() !== (existingBrand.name || '').trim();
        const descChanged =
          typeof description === 'string' &&
          (existingBrand.description || '') !== (description?.trim() || '');

        // Check if Instagram is connected via SocialAccount (and not soft-disconnected)
        const instagramAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId: id,
            platform: 'instagram',
          },
          select: { id: true, metadata: true },
        });

        const isDisconnected =
          instagramAccount && (instagramAccount.metadata as any)?.disconnected === true;

        if ((nameChanged || descChanged) && instagramAccount && !isDisconnected) {
          // Fire-and-forget background job to include a small recent-post sample (with CDN URLs)
          (async () => {
            try {
              const postsRaw = await instagramService.getRecentPosts({ id: updatedBrand.id }, 20);
              const posts = await Promise.all(
                postsRaw.map(async (p) => {
                  let mediaUrl = p.media_url;
                  if (
                    p.media_type?.toUpperCase() !== 'VIDEO' &&
                    typeof p.media_url === 'string' &&
                    p.media_url
                  ) {
                    try {
                      const metadata = await buildAnalysisAssetMetadata({
                        brandId: updatedBrand.id,
                        contentId: p.id,
                        generatedAt: p.timestamp ? new Date(p.timestamp) : new Date(),
                      });
                      const asset = await importImageFromExternalUrl(p.media_url, metadata);
                      mediaUrl = asset.url;
                    } catch (e) {
                      request.log.warn(
                        { err: e, postId: p.id },
                        'Failed to cache image via assets service for analysis; using original URL'
                      );
                    }
                  }
                  return {
                    id: p.id,
                    caption: p.caption,
                    hashtags: p.hashtags,
                    timestamp: p.timestamp,
                    like_count: p.like_count,
                    comments_count: p.comments_count,
                    media_type: p.media_type,
                    media_url: mediaUrl,
                  };
                })
              );
              await eventBridge.send(
                new PutEventsCommand({
                  Entries: [
                    {
                      DetailType: 'brand.analysis.requested',
                      Source: 'postolio.brand',
                      EventBusName: process.env.EVENT_BUS_NAME || 'default',
                      Detail: JSON.stringify({
                        brandId: updatedBrand.id,
                        requestedBy: request.user.id,
                        options: { reason: 'brand-updated', maxPosts: 20 },
                        posts,
                      }),
                    },
                  ],
                })
              );
            } catch (e) {
              request.log.warn({ err: e }, 'Failed to emit brand.analysis.requested on update');
            }
          })();
        }

        return reply.code(200).send({
          message: 'Brand updated successfully',
          brand: updatedBrand,
        });
      } catch (error) {
        console.error('Brand update error:', error);

        // Handle specific Prisma errors
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return reply.code(400).send({ error: 'A brand with this name already exists' });
        }

        return reply.code(500).send({ error: 'Failed to update brand' });
      }
    }
  );

  // Delete a brand (RESTful: DELETE /:id)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;

        // Check if brand exists and user owns it
        const brand = await prisma.brand.findFirst({
          where: {
            id,
            userId,
          },
          select: {
            id: true,
            name: true,
            _count: {
              select: {
                content: true,
              },
            },
          },
        });

        if (!brand) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        // Delete the brand (cascade will handle related content)
        await prisma.brand.delete({
          where: { id },
        });

        return reply.code(200).send({
          message: 'Brand deleted successfully',
          deletedBrand: {
            id: brand.id,
            name: brand.name,
            contentCount: brand._count.content,
          },
        });
      } catch (error) {
        console.error('Brand deletion error:', error);
        return reply.code(500).send({ error: 'Failed to delete brand' });
      }
    }
  );

  // Brand calendar (moved from content.ts)
  fastify.get<{ Params: { id: string; month: string } }>(
    '/:id/calendar/:month',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId, month } = request.params;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ success: false, error: 'Brand not found' });

        // Parse month string (format: YYYY-MM)
        const parts = month.split('-');
        if (parts.length !== 2)
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        const [yearStr, monthStr] = parts;
        if (!yearStr || !monthStr)
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        const year = parseInt(yearStr, 10);
        const monthNum = parseInt(monthStr, 10);
        if (isNaN(year) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
          return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
        }

        // CRITICAL: Create month boundaries in the brand's timezone, not server's timezone
        const { TimezoneService } = await import('../services/timezone.js');
        const brandTimezone = await TimezoneService.getBrandTimezone(brandId);

        // Create month start (first day of month at 00:00:00 in brand's timezone)
        const monthStartStr = `${year}-${String(monthNum).padStart(2, '0')}-01`;
        const monthStart = TimezoneService.createDateInBrandTimezone(
          monthStartStr,
          '00:00',
          brandTimezone
        );

        // Create month end (last day of month at 23:59:59 in brand's timezone)
        const lastDay = new Date(year, monthNum, 0).getDate(); // Get last day of month
        const monthEndStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const monthEnd = TimezoneService.createDateInBrandTimezone(
          monthEndStr,
          '23:59',
          brandTimezone
        );

        // Get existing content for the month with campaign info for color coding
        let content: Array<any> = [];
        let hasPublications = true;
        try {
          content = await prisma.content.findMany({
            where: {
              brandId,
              OR: [
                { scheduledAt: { gte: monthStart, lte: monthEnd } },
                { postedAt: { gte: monthStart, lte: monthEnd } },
              ],
            },
            include: {
              campaign: { select: { id: true, name: true, color: true } },
              publications: { select: { platform: true, permalink: true } },
            },
            orderBy: { scheduledAt: 'asc' },
          });
        } catch (e: any) {
          // If publications table missing (pre-migration), retry without publications include
          const code = e?.code || e?.meta?.code;
          if (code === 'P2021' || /content_publications/.test(String(e?.message || ''))) {
            hasPublications = false;
            content = await prisma.content.findMany({
              where: {
                brandId,
                OR: [
                  { scheduledAt: { gte: monthStart, lte: monthEnd } },
                  { postedAt: { gte: monthStart, lte: monthEnd } },
                ],
              },
              include: {
                campaign: { select: { id: true, name: true, color: true } },
              },
              orderBy: { scheduledAt: 'asc' },
            });
            request.log.warn(
              { err: e },
              'Publications table missing; calendar will omit permalinks until migrations are applied'
            );
          } else {
            throw e;
          }
        }

        // Get active campaigns
        const campaigns = await prisma.campaign.findMany({
          where: { brandId, status: { in: ['active', 'preview'] } },
        });

        // Compute placeholders (timezone-aware). If it fails, degrade gracefully to empty.
        let placeholders: any[] = [];
        try {
          placeholders = await computePlaceholders(campaigns, content, monthStart, monthEnd);
        } catch (e) {
          request.log.warn({ err: e }, 'Placeholder computation failed; returning content only');
          placeholders = [];
        }

        // Map to response format with CDN URLs and campaign colors
        const contentWithUrls = content.map((item) => {
          const pubs = hasPublications ? item.publications || [] : [];
          const ig = hasPublications ? pubs.find((p: any) => p.platform === 'instagram') : null;
          const primaryPermalink = hasPublications
            ? ig?.permalink || pubs[0]?.permalink || null
            : null;
          return {
            id: item.id,
            caption: item.caption,
            hashtags: item.hashtags,
            imageUrl: item.primaryAssetCdnUrl,
            status: item.status,
            scheduledAt: item.scheduledAt,
            postedAt: item.postedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            brandId: item.brandId,
            campaignId: item.campaignId,
            campaignName: item.campaign?.name,
            campaignColor: item.campaign?.color,
            permalink: primaryPermalink,
          };
        });

        return { success: true, data: { content: contentWithUrls, placeholders } };
      } catch (error) {
        request.log.error({ err: error }, 'Calendar content error');
        return reply.code(500).send({ error: 'Failed to retrieve calendar content' });
      }
    }
  );

  // Inbox: Comments overview with unread counts per post
  fastify.get<{ Params: { id: string } }>(
    '/:id/inbox/comments',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        // Verify ownership
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ error: 'Brand not found' });

        // Get Instagram SocialAccount for API calls
        const instagramAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId,
            platform: 'instagram',
          },
        });

        // Prefer unresolved comment counts per publication for "new" activity.
        const pubs = await prisma.contentPublication.findMany({
          where: {
            platform: 'instagram',
            socialAccount: { brandId, platform: 'instagram' },
          },
          orderBy: { publishedAt: 'desc' },
          take: 200,
          select: {
            id: true,
            externalPostId: true,
            permalink: true,
            publishedAt: true,
            content: {
              select: { id: true, caption: true, primaryAssetCdnUrl: true, postedAt: true },
            },
          },
        });

        let items = await Promise.all(
          pubs.map(async (pub) => {
            // Local workflow counts
            const [unresolvedCount, resolvedCount] = await Promise.all([
              prisma.publicationComment.count({
                where: { publicationId: pub.id, status: { not: 'resolved' } },
              }),
              prisma.publicationComment.count({
                where: { publicationId: pub.id, status: 'resolved' },
              }),
            ]);

            let totalComments = unresolvedCount + resolvedCount;
            let newCount = unresolvedCount;

            // If no local comment records, try a lightweight Graph lookup for counts
            if (totalComments === 0 && pub.externalPostId && instagramAccount) {
              try {
                const redis = getRedisClient();
                const cacheKey = `ig:comments_count:${pub.externalPostId}`;
                const cached = redis ? await redis.get(cacheKey) : null;
                if (cached !== null) {
                  totalComments = Number(cached) || 0;
                } else {
                  const res = await instagramService.getPostComments(
                    {
                      id: brandId,
                      instagramAccountId: instagramAccount.externalAccountId,
                      instagramPageId: instagramAccount.externalPageId,
                    } as any,
                    String(pub.externalPostId),
                    1 // minimal page to fetch accurate comments_count
                  );
                  totalComments = Number(res.total || 0);
                  if (redis) await redis.setex(cacheKey, 300, String(totalComments));
                }
                newCount = Math.max(0, totalComments - resolvedCount);
              } catch (e) {
                request.log.warn({ err: e, pubId: pub.id }, 'Graph comments count fallback failed');
              }
            }

            return {
              postId: pub.content?.id || '',
              caption: pub.content?.caption || null,
              imageUrl: pub.content?.primaryAssetCdnUrl || null,
              permalink: pub.permalink || null,
              postedAt: pub.content?.postedAt || pub.publishedAt || null,
              totalComments,
              resolvedCount,
              newCount,
            };
          })
        );

        // Keep only those with new activity
        items = items.filter((r) => r.postId && r.newCount > 0);

        // Sort and trim
        items = items
          .sort((a, b) => {
            const ta = a.postedAt ? new Date(a.postedAt).getTime() : 0;
            const tb = b.postedAt ? new Date(b.postedAt).getTime() : 0;
            return tb - ta;
          })
          .slice(0, 50);

        return reply.send({ items });
      } catch (error) {
        request.log.error({ err: error }, 'Inbox comments overview error');
        return reply.code(500).send({ error: 'Failed to retrieve inbox comments' });
      }
    }
  );

  // Enqueue/trigger background ingestion of comments for a brand
  fastify.post<{ Params: { id: string } }>(
    '/:id/inbox/comments/ingest',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ error: 'Brand not found' });

        // Throttle via Redis to avoid overloading the Graph API
        const redis = getRedisClient();
        const throttleKey = `ingest:brand:comments:${brandId}`;
        let nextAllowed: string | null = null;
        if (redis) {
          const ttl = await redis.ttl(throttleKey);
          if (ttl > 0) {
            nextAllowed = new Date(Date.now() + ttl * 1000).toISOString();
            return reply.code(429).send({
              success: false,
              error: 'Ingestion recently requested',
              nextAllowed,
            });
          }
          await redis.setex(throttleKey, 5 * 60, '1'); // 5 minutes
        }

        // Run ingestion in the background (non-blocking)
        setImmediate(async () => {
          try {
            await ingestBrandComments(brandId, 50, 100);
          } catch (e) {
            request.log.warn({ err: e }, 'Background comments ingestion failed');
          }
        });

        nextAllowed = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        return reply.send({ success: true, enqueued: true, nextAllowed });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enqueue comments ingestion');
        return reply.code(500).send({ error: 'Failed to enqueue comments ingestion' });
      }
    }
  );

  // Brand content history (moved from content.ts)
  fastify.get<{ Params: { id: string } }>(
    '/:id/content/history',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId } = request.params;

        // Verify ownership
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(404).send({ error: 'Brand not found' });

        const contentHistory = await prisma.content.findMany({
          where: {
            brandId,
            status: { in: ['draft', 'scheduled', 'published', 'failed', 'skipped'] },
          },
          select: {
            id: true,
            caption: true,
            hashtags: true,
            primaryAssetCdnUrl: true,
            status: true,
            scheduledAt: true,
            postedAt: true,
            createdAt: true,
            updatedAt: true,
            publications: { select: { platform: true, permalink: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        });

        const historyWithUrls = contentHistory.map((item) => {
          const pubs = (item as any).publications || [];
          const ig = pubs.find((p: any) => p.platform === 'instagram');
          const primaryPermalink = ig?.permalink || pubs[0]?.permalink || null;
          return {
            id: item.id,
            caption: item.caption,
            hashtags: item.hashtags,
            imageUrl: item.primaryAssetCdnUrl,
            status: item.status,
            scheduledAt: item.scheduledAt,
            postedAt: item.postedAt,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            permalink: primaryPermalink,
          };
        });

        return { content: historyWithUrls };
      } catch (error) {
        request.log.error({ err: error }, 'Content history error');
        return reply.code(500).send({ error: 'Failed to retrieve content history' });
      }
    }
  );

  // ==========================
  // Saved Replies (brand-level)
  // ==========================
  fastify.get<{ Params: { id: string } }>(
    '/:id/replies',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: brandId } = request.params;
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      const rows = await prisma.savedReply.findMany({
        where: { brandId },
        orderBy: { updatedAt: 'desc' },
      });
      return reply.send({ replies: rows });
    }
  );

  fastify.post<{
    Params: { id: string };
    Body: { title: string; body: string; isDefault?: boolean };
  }>('/:id/replies', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id: brandId } = request.params;
    const userId = request.user!.id;
    const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
    if (!brand) return reply.code(404).send({ error: 'Brand not found' });
    const { title, body, isDefault } = request.body || ({} as any);
    if (!title?.trim() || !body?.trim())
      return reply.code(400).send({ error: 'Title and body are required' });
    const row = await prisma.savedReply.create({
      data: { brandId, userId, title: title.trim(), body, isDefault: !!isDefault },
    });
    return reply.code(201).send({ reply: row });
  });

  fastify.put<{
    Params: { id: string; replyId: string };
    Body: { title?: string; body?: string; isDefault?: boolean };
  }>('/:id/replies/:replyId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { id: brandId, replyId } = request.params;
    const userId = request.user!.id;
    const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
    if (!brand) return reply.code(404).send({ error: 'Brand not found' });
    const data: any = {};
    if (request.body?.title !== undefined) data.title = request.body.title;
    if (request.body?.body !== undefined) data.body = request.body.body;
    if (request.body?.isDefault !== undefined) data.isDefault = request.body.isDefault;
    const row = await prisma.savedReply.update({ where: { id: replyId }, data });
    return reply.send({ reply: row });
  });

  fastify.delete<{ Params: { id: string; replyId: string } }>(
    '/:id/replies/:replyId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id: brandId, replyId } = request.params;
      const userId = request.user!.id;
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      if (!brand) return reply.code(404).send({ error: 'Brand not found' });
      await prisma.savedReply.delete({ where: { id: replyId } });
      return reply.send({ success: true });
    }
  );

  // Instagram authorize alias -> forwards to auth route
  fastify.get<{ Params: { id: string } }>(
    '/:id/instagram/authorize',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const r = await fastify.inject({
        method: 'GET',
        url: `/api/auth/instagram/authorize?brandId=${encodeURIComponent(id)}`,
        headers: { cookie: request.headers.cookie as string },
      });
      return reply.code(r.statusCode).send(r.json());
    }
  );
};

export default brandsRoutes;
