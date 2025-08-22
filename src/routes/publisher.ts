/**
 * Publisher API Endpoint
 * Provides a secure endpoint for the AWS publisher Lambda to fetch credentials
 * This ensures the Lambda always gets fresh credentials at publish time
 */

import { FastifyPluginAsync } from 'fastify';
import { PublisherCredentialsService } from '../services/publisher-credentials.js';
import crypto from 'crypto';

// Simple API key authentication for Lambda-to-API communication
const PUBLISHER_API_KEY = process.env.PUBLISHER_API_KEY || 'default-publisher-key';

const publisher: FastifyPluginAsync = async function (fastify) {
  /**
   * Get publishing credentials for a brand
   * This endpoint is called by the AWS publisher Lambda at publish time
   */
  fastify.post('/credentials', async function (request, reply) {
    try {
      // Verify API key
      const apiKey = request.headers['x-api-key'] as string;
      
      if (!apiKey || apiKey !== PUBLISHER_API_KEY) {
        return reply.status(401).send({ 
          error: 'Unauthorized',
          message: 'Invalid API key'
        });
      }

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

      // Log for debugging (without exposing full token)
      const tokenPreview = credentials.instagramAccessToken 
        ? `${credentials.instagramAccessToken.substring(0, 10)}...` 
        : 'null';
      console.log(`Publisher credentials fetched for brand ${brandId} (${credentials.brandName}), token: ${tokenPreview}`);

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