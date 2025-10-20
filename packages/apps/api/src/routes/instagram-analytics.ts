import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { instagramService } from '../services/instagram.js';

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

interface AnalyticsParams {
  brandId: string;
}

function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user || !request.user.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

const instagramAnalyticsRoutes: FastifyPluginAsync = async function (fastify) {
  /**
   * GET /instagram-analytics/overview/:brandId (accessed via CloudFront /api/instagram-analytics/overview/:brandId)
   * Get account-level analytics overview
   */
  fastify.get<{
    Params: AnalyticsParams;
    Querystring: { timeRange?: '7d' | '30d' | '90d' };
  }>('/overview/:brandId', { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!ensureAuth(request, reply)) return;

    const { brandId } = request.params;
    const { timeRange = '7d' } = request.query;
    const userId = request.user.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      });

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' });
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      const overview = await instagramService.getAccountInsights(brand, timeRange);
      return reply.send(overview);
    } catch (error) {
      console.error('Instagram analytics overview error:', error);

      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        return reply.status(429).send({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600, // 1 hour in seconds
        });
      }

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      if (error instanceof Error && error.message.includes('token invalid or expired')) {
        return reply.status(401).send({
          error: 'Instagram token invalid or expired; please reconnect Instagram',
          configured: false,
        });
      }

      if (error instanceof Error && error.message.includes('Missing instagram_manage_insights')) {
        return reply.status(403).send({
          error:
            'Instagram permission missing: instagram_manage_insights. Please reconnect and grant permissions.',
          configured: false,
        });
      }

      if (error instanceof Error && error.message.includes('Unsupported insight metric')) {
        return reply.status(502).send({
          error: 'Instagram insights metric not available for this account',
        });
      }

      // Map missing credentials to a clear client error so UI can degrade gracefully
      if (error instanceof Error && error.message.includes('Failed to get Instagram credentials')) {
        return reply.status(400).send({
          error: 'Instagram credentials missing or expired for this brand',
          configured: false,
        });
      }

      return reply.status(500).send({
        error: 'Failed to fetch Instagram analytics overview',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /instagram-analytics/posts/:brandId (accessed via CloudFront /api/instagram-analytics/posts/:brandId)
   * Get recent posts performance data
   */
  fastify.get<{
    Params: AnalyticsParams;
    Querystring: { limit?: number };
  }>('/posts/:brandId', { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!ensureAuth(request, reply)) return;

    const { brandId } = request.params;
    const { limit = 10 } = request.query;
    const userId = request.user.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      });

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' });
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      const performance = await instagramService.getRecentPostsPerformance(
        brand,
        Math.min(limit, 25)
      );
      return reply.send(performance);
    } catch (error) {
      console.error('Instagram posts performance error:', error);

      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        return reply.status(429).send({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600,
        });
      }

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      if (error instanceof Error && error.message.includes('Failed to get Instagram credentials')) {
        return reply.status(400).send({
          error: 'Instagram credentials missing or expired for this brand',
          configured: false,
        });
      }

      return reply.status(500).send({
        error: 'Failed to fetch Instagram posts performance',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /instagram-analytics/refresh/:brandId (accessed via CloudFront /api/instagram-analytics/refresh/:brandId)
   * Force refresh analytics data (bypass cache)
   */
  fastify.post<{
    Params: AnalyticsParams;
  }>('/refresh/:brandId', { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!ensureAuth(request, reply)) return;

    const { brandId } = request.params;
    const userId = request.user.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      });

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' });
      }

      // Check if Instagram is configured
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      const refreshResult = await instagramService.refreshAnalyticsData(brand);

      if (!refreshResult.success) {
        return reply.status(429).send({
          error: refreshResult.message,
          nextRefreshAllowed: refreshResult.nextRefreshAllowed,
          success: false,
        });
      }

      return reply.send(refreshResult);
    } catch (error) {
      console.error('Instagram analytics refresh error:', error);

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
        });
      }

      return reply.status(500).send({
        error: 'Failed to refresh Instagram analytics data',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /instagram-analytics/status/:brandId (accessed via CloudFront /api/instagram-analytics/status/:brandId)
   * Get cache status and rate limit information
   */
  fastify.get<{
    Params: AnalyticsParams;
  }>('/status/:brandId', { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!ensureAuth(request, reply)) return;

    const { brandId } = request.params;
    const userId = request.user.id;

    try {
      // Verify brand ownership
      const brand = await prisma.brand.findFirst({
        where: {
          id: brandId,
          userId: userId,
        },
      });

      if (!brand) {
        return reply.status(404).send({ error: 'Brand not found or unauthorized' });
      }

      // Check if Instagram is configured (brand fields)
      if (!instagramService.isConfigured(brand)) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
          lastUpdated: null,
          cacheAge: 0,
          rateLimitRemaining: 200,
        });
      }

      // Validate that credentials are available from Token Service; if not, treat as not configured
      try {
        const { PublisherCredentialsService } = await import(
          '../services/publisher-credentials.js'
        );
        const creds = await PublisherCredentialsService.getCredentialsForBrand(brand.id);
        if (!creds || !creds.accessToken) {
          return reply.status(400).send({
            error: 'Instagram credentials missing for this brand',
            configured: false,
            lastUpdated: null,
            cacheAge: 0,
            rateLimitRemaining: 200,
          });
        }
      } catch (credErr) {
        request.log.warn({ err: credErr }, 'Failed to validate credentials; proceeding');
      }

      const status = await instagramService.getAnalyticsCacheStatus(brand);
      return reply.send({
        ...status,
        configured: true,
      });
    } catch (error) {
      console.error('Instagram analytics status error:', error);

      if (error instanceof Error && error.message.includes('Instagram not configured')) {
        return reply.status(400).send({
          error: 'Instagram not configured for this brand',
          configured: false,
          lastUpdated: null,
          cacheAge: 0,
          rateLimitRemaining: 200,
        });
      }

      return reply.status(500).send({
        error: 'Failed to get Instagram analytics status',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};

export default instagramAnalyticsRoutes;
