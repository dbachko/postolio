/**
 * Publisher API Endpoint
 * Provides a secure endpoint for the AWS publisher Lambda to fetch credentials
 * This ensures the Lambda always gets fresh credentials at publish time
 */

import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { createPublisherAuth } from '../middleware/publisher-auth.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

const publisher: FastifyPluginAsync = async function (fastify) {
  // Retrieve API key inside plugin function for better security
  const PUBLISHER_API_KEY = process.env.PUBLISHER_API_KEY;
  
  // Only enable if API key is configured
  if (!PUBLISHER_API_KEY) {
    fastify.log.warn('Publisher endpoint disabled - PUBLISHER_API_KEY not configured');
    return;
  }

  // Rate limiting for security (max 100 requests per minute per API key)
  await fastify.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => {
      // Use API key as rate limit key for Lambda
      return request.headers['x-api-key'] as string || request.ip;
    }
  });

  // Apply authentication middleware
  // Optional: Set PUBLISHER_ALLOWED_IPS env var to restrict to specific IPs (comma-separated)
  // Example: PUBLISHER_ALLOWED_IPS="10.0.0.1,10.0.0.2" for Lambda NAT Gateway IPs
  const allowedIPs = process.env.PUBLISHER_ALLOWED_IPS?.split(',').filter(Boolean).map(ip => ip.trim());
  const authMiddleware = createPublisherAuth({
    apiKey: PUBLISHER_API_KEY,
    requireHttps: process.env.NODE_ENV === 'production',
    ...(allowedIPs && { allowedIPs })
  });

  /**
   * Get fresh content details for publishing
   * This endpoint is called by the AWS publisher Lambda at publish time
   * to ensure we always publish the latest edited content
   */
  fastify.post('/content', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['contentId'],
        properties: {
          contentId: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            content: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                caption: { type: 'string' },
                hashtags: { type: 'array', items: { type: 'string' } },
                mediaUrls: { type: 'array', items: { type: 'string' } },
                cdnImageUrl: { type: 'string' },
                imageUrl: { type: 'string' },
                brandId: { type: 'string' },
                contentType: { type: 'string' }
              }
            },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    try {
      const { contentId } = request.body as { contentId: string };

      if (!contentId) {
        return reply.status(400).send({ 
          error: 'Bad Request',
          message: 'contentId is required' 
        });
      }

      // Fetch fresh content from database
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        select: {
          id: true,
          caption: true,
          hashtags: true,
          imageUrl: true,
          cdnImageUrl: true,
          brandId: true,
          status: true,
          brand: {
            select: {
              name: true
            }
          }
        }
      });

      if (!content) {
        return reply.status(404).send({ 
          error: 'Not Found',
          message: `Content not found: ${contentId}`,
          contentId 
        });
      }

      // Check if content is in a publishable state
      if (content.status !== 'scheduled') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Content ${contentId} is not scheduled for publishing (status: ${content.status})`,
          contentId,
          status: content.status
        });
      }

      // Prepare media URLs array
      const mediaUrls: string[] = [];
      if (content.cdnImageUrl) {
        mediaUrls.push(content.cdnImageUrl);
      } else if (content.imageUrl) {
        mediaUrls.push(content.imageUrl);
      }

      // Log for monitoring (without exposing content details)
      fastify.log.info({
        event: 'publisher_content_fetched',
        contentId,
        brandId: content.brandId,
        brandName: content.brand.name,
        hasCaption: !!content.caption,
        hashtagCount: content.hashtags.length,
        mediaCount: mediaUrls.length,
        timestamp: new Date().toISOString(),
        source: request.headers['x-request-id'] || 'unknown'
      });

      // Return fresh content details
      reply.send({
        success: true,
        content: {
          id: content.id,
          caption: content.caption,
          hashtags: content.hashtags,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          cdnImageUrl: content.cdnImageUrl,
          imageUrl: content.imageUrl,
          brandId: content.brandId,
          contentType: 'image' // Default for now, could be expanded
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Publisher content error:', error);
      reply.status(500).send({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Failed to fetch content',
      });
    }
  });

  /**
   * Get publishing credentials for a brand
   * This endpoint is called by the AWS publisher Lambda at publish time
   */
  fastify.post('/credentials', {
    preHandler: authMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['brandId'],
        properties: {
          brandId: { type: 'string', format: 'uuid' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            credentials: {
              type: 'object',
              properties: {
                instagramAccessToken: { type: 'string' },
                instagramAccountId: { type: 'string' },
                instagramPageId: { type: 'string' }
              }
            },
            brandName: { type: 'string' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    try {
      const { brandId } = request.body as { brandId: string };

      if (!brandId) {
        return reply.status(400).send({ 
          error: 'Bad Request',
          message: 'brandId is required' 
        });
      }

      // Fetch fresh credentials from database
      const credentials = await PublisherCredentialsService.getPublishingCredentials(brandId);

      if (!credentials) {
        return reply.status(404).send({ 
          error: 'Not Found',
          message: `No valid Instagram credentials found for brand ${brandId}`,
          brandId 
        });
      }

      // Log for monitoring (without exposing any token information)
      fastify.log.info({
        event: 'publisher_credentials_fetched',
        brandId,
        brandName: credentials.brandName,
        hasCredentials: !!credentials.instagramAccessToken,
        timestamp: new Date().toISOString(),
        source: request.headers['x-request-id'] || 'unknown'
      });

      // Return credentials
      reply.send({
        success: true,
        credentials: {
          instagramAccessToken: credentials.instagramAccessToken,
          instagramAccountId: credentials.instagramAccountId,
          instagramPageId: credentials.instagramPageId,
        },
        brandName: credentials.brandName,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Publisher credentials error:', error);
      reply.status(500).send({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Failed to fetch credentials',
      });
    }
  });

  /**
   * Health check endpoint for publisher service
   */
  fastify.get('/health', async function (request, reply) {
    reply.send({
      status: 'ok',
      service: 'publisher',
      timestamp: new Date().toISOString(),
    });
  });
}

export default publisher;