import { FastifyPluginAsync } from 'fastify';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { uploadImageToS3, buildCdnUrl } from '../services/s3-image.js';
import { instagramService } from '../services/instagram.js';
// Legacy AI analyze endpoint removed

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();
const eventBridge = new EventBridge({});

// interface BrandAnalysisBody removed with legacy endpoint

interface CreateBrandBody {
  name: string;
  description?: string;
}

interface UpdateBrandBody {
  name?: string;
  description?: string;
}

const brandsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new brand
  fastify.post<{ Body: CreateBrandBody }>(
    '/create',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { name, description } = request.body;

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
          },
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
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

  // Legacy /analyze endpoint removed in favor of /api/brand-analysis routes

  // Get user's brands
  fastify.get('/list', { preHandler: fastify.authenticate }, async (request, reply) => {
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
        },
        orderBy: { createdAt: 'desc' },
      });

      return { brands };
    } catch (error) {
      console.error('Brands list error:', error);
      return reply.code(500).send({ error: 'Failed to retrieve brands' });
    }
  });

  // Get specific brand details
  fastify.get<{ Params: { id: string } }>(
    '/brand/:id',
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

  // Update a brand
  fastify.put<{ Params: { id: string }; Body: UpdateBrandBody }>(
    '/brand/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;

        const { id } = request.params;
        const { name, description } = request.body;

        // Validate at least one field is provided
        if (!name && description === undefined) {
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
        }
        const updateData: BrandUpdateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || null;

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
                      const uploaded = await uploadImageToS3(p.media_url, {
                        source: 'midjourney',
                        brandId: updatedBrand.id,
                        contentId: p.id,
                        generatedAt: new Date(),
                        originalPrompt: 'brand-analysis cache',
                      });
                      const cdn = buildCdnUrl(uploaded.s3Key);
                      if (cdn) mediaUrl = cdn;
                    } catch (e) {
                      request.log.warn(
                        { err: e, postId: p.id },
                        'Failed to cache image to S3 for analysis; using original URL'
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

  // Delete a brand
  fastify.delete<{ Params: { id: string } }>(
    '/brand/:id',
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
};

export default brandsRoutes;
