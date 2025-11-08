import { FastifyPluginAsync } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { importImageFromExternalUrl } from '../services/assets-media.js';
import { buildAnalysisAssetMetadata } from '../services/brand-analysis-assets.js';
import { computePlaceholders } from '../services/placeholderService.js';
import { instagramService } from '../services/instagram.js';

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
            instagramAccountId: true,
            instagramPageId: true,
            countryCode: true,
          },
        });

        // If brand name or description changed, trigger a new brand analysis (fire-and-forget)
        const nameChanged =
          typeof name === 'string' && name.trim() !== (existingBrand.name || '').trim();
        const descChanged =
          typeof description === 'string' &&
          (existingBrand.description || '') !== (description?.trim() || '');
        if ((nameChanged || descChanged) && instagramService.isConfigured(updatedBrand)) {
          // Fire-and-forget background job to include a small recent-post sample (with CDN URLs)
          (async () => {
            try {
              const postsRaw = await instagramService.getRecentPosts(
                {
                  id: updatedBrand.id,
                  instagramAccountId: updatedBrand.instagramAccountId,
                  instagramPageId: updatedBrand.instagramPageId,
                },
                20
              );
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
        const monthEnd = TimezoneService.createDateInBrandTimezone(monthEndStr, '23:59', brandTimezone);

        // Get existing content for the month with campaign info for color coding
        const content = await prisma.content.findMany({
          where: {
            brandId,
            OR: [
              { scheduledAt: { gte: monthStart, lte: monthEnd } },
              { postedAt: { gte: monthStart, lte: monthEnd } },
            ],
          },
          include: {
            campaign: {
              select: { id: true, name: true, color: true },
            },
          },
          orderBy: { scheduledAt: 'asc' },
        });

        // Get active campaigns
        const campaigns = await prisma.campaign.findMany({
          where: { brandId, status: { in: ['active', 'preview'] } },
        });

        // Compute placeholders (timezone-aware)
        const placeholders = await computePlaceholders(campaigns, content, monthStart, monthEnd);

        // Map to response format with CDN URLs and campaign colors
        const contentWithUrls = content.map((item) => ({
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
          instagramPostId: item.instagramPostId,
          instagramPermalink: item.instagramPermalink,
        }));

        return { success: true, data: { content: contentWithUrls, placeholders } };
      } catch (error) {
        request.log.error({ err: error }, 'Calendar content error');
        return reply.code(500).send({ error: 'Failed to retrieve calendar content' });
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
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        });

        const historyWithUrls = contentHistory.map((item) => ({
          id: item.id,
          caption: item.caption,
          hashtags: item.hashtags,
          imageUrl: item.primaryAssetCdnUrl,
          status: item.status,
          scheduledAt: item.scheduledAt,
          postedAt: item.postedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }));

        return { content: historyWithUrls };
      } catch (error) {
        request.log.error({ err: error }, 'Content history error');
        return reply.code(500).send({ error: 'Failed to retrieve content history' });
      }
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
