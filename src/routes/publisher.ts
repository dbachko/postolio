/**
 * Publisher API Endpoint
 * Provides a secure endpoint for the AWS publisher Lambda to fetch credentials
 * This ensures the Lambda always gets fresh credentials at publish time
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { PublisherContentService } from '../services/publisher-content.js';
import { createPublisherAuth } from '../middleware/publisher-auth.js';

const publisher: FastifyPluginAsync = async function (fastify) {
  // Retrieve API key inside plugin function for better security
  const PUBLISHER_API_KEY = process.env.PUBLISHER_API_KEY;
  
  // Log the API key status but don't disable the endpoint
  // In production, the secret is injected at runtime by ECS
  if (!PUBLISHER_API_KEY) {
    fastify.log.warn('PUBLISHER_API_KEY not yet loaded - will be checked at request time');
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
  
  // Create middleware that checks API key at request time
  const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
    // Get API key at request time (allows for runtime injection by ECS)
    const apiKey = process.env.PUBLISHER_API_KEY;
    
    if (!apiKey) {
      fastify.log.error('PUBLISHER_API_KEY not configured - publisher endpoints will not work');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Publisher service not configured'
      });
    }
    
    // Now create and execute the actual auth middleware
    const actualMiddleware = createPublisherAuth({
      apiKey,
      requireHttps: process.env.NODE_ENV === 'production',
      ...(allowedIPs && { allowedIPs })
    });
    
    return actualMiddleware(request, reply);
  };

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
          contentId: { type: 'string', minLength: 1 }
        }
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'content', 'timestamp'],
          properties: {
            success: { type: 'boolean' },
            content: {
              type: 'object',
              required: ['id', 'caption', 'hashtags', 'brandId', 'contentType'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                caption: { type: 'string', minLength: 1 },
                hashtags: { type: 'array', items: { type: 'string' } },
                mediaUrls: { 
                  type: 'array', 
                  items: { type: 'string', format: 'uri' },
                  minItems: 0
                },
                cdnImageUrl: { type: 'string', format: 'uri' },
                brandId: { type: 'string', format: 'uuid' },
                contentType: { 
                  type: 'string',
                  enum: ['image', 'video', 'carousel', 'reel', 'story']
                }
              }
            },
            timestamp: { type: 'string', format: 'date-time' }
          }
        },
        400: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            contentId: { type: 'string' }
          }
        },
        404: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            contentId: { type: 'string' }
          }
        }
      }
    }
  }, async function (request, reply) {
    try {
      const { contentId } = request.body as { contentId: string };

      // Fetch fresh content using service layer
      const content = await PublisherContentService.getContentForPublishing(contentId);

      if (!content) {
        return reply.status(404).send({ 
          error: 'Not Found',
          message: `Content not found or not publishable: ${contentId}`,
          contentId 
        });
      }

      // Log for monitoring (structured logging)
      fastify.log.info({
        event: 'publisher_content_fetched',
        contentId: content.id,
        brandId: content.brandId,
        brandName: content.brandName,
        contentType: content.contentType,
        hasCaption: !!content.caption,
        hashtagCount: content.hashtags.length,
        mediaCount: content.mediaUrls.length,
        timestamp: new Date().toISOString(),
        requestId: request.headers['x-request-id'] || 'unknown'
      });

      // Return fresh content details
      reply.send({
        success: true,
        content: {
          id: content.id,
          caption: content.caption,
          hashtags: content.hashtags,
          mediaUrls: content.mediaUrls.length > 0 ? content.mediaUrls : undefined,
          cdnImageUrl: content.cdnImageUrl,
          brandId: content.brandId,
          contentType: content.contentType
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      fastify.log.error({
        event: 'publisher_content_error',
        contentId: (request.body as any)?.contentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });

      reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch content for publishing'
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
          brandId: { type: 'string', minLength: 1 }
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