/**
 * Publisher API Endpoint
 * Provides a secure endpoint for the AWS publisher Lambda to fetch credentials
 * This ensures the Lambda always gets fresh credentials at publish time
 */

import { FastifyPluginAsync } from 'fastify';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import { createPublisherAuth } from '../middleware/publisher-auth.js';

// API key authentication for Lambda-to-API communication
const PUBLISHER_API_KEY = process.env.PUBLISHER_API_KEY;

if (!PUBLISHER_API_KEY) {
  console.error('❌ PUBLISHER_API_KEY not configured. Publisher endpoint disabled.');
}

const publisher: FastifyPluginAsync = async function (fastify) {
  // Only enable if API key is configured
  if (!PUBLISHER_API_KEY) {
    fastify.log.warn('Publisher endpoint disabled - PUBLISHER_API_KEY not configured');
    return;
  }

  // Rate limiting for security (max 100 requests per minute per API key)
  fastify.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Use API key as rate limit key for Lambda
      return request.headers['x-api-key'] as string || request.ip;
    }
  });

  // Apply authentication middleware
  const authMiddleware = createPublisherAuth({
    apiKey: PUBLISHER_API_KEY,
    requireHttps: process.env.NODE_ENV === 'production',
    allowedIPs: process.env.PUBLISHER_ALLOWED_IPS?.split(',').map(ip => ip.trim())
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

      // Log for debugging and monitoring (without exposing full token)
      const tokenPreview = credentials.instagramAccessToken 
        ? `${credentials.instagramAccessToken.substring(0, 10)}...` 
        : 'null';
      
      fastify.log.info({
        event: 'publisher_credentials_fetched',
        brandId,
        brandName: credentials.brandName,
        hasToken: !!credentials.instagramAccessToken,
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