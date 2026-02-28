import type { FastifyInstance } from 'fastify';

import {
  ContentIdSchema,
  ensurePlatformSupported,
  logger,
  SocialRouteReplyError,
} from './shared.js';
import {
  buildInsightsFromLatestMetrics,
  fetchLiveInsights,
  resolveInsightsPublication,
} from './insights-helpers.js';

async function runInsightsFlow(params: { contentId: string; platform: string }) {
  const { publication } = await resolveInsightsPublication({
    contentId: params.contentId,
    platform: params.platform,
  });
  const latestMetricsResponse = buildInsightsFromLatestMetrics({
    latest: publication.metricsLatest,
    platform: params.platform,
    contentId: params.contentId,
    externalPostId: publication.externalPostId,
  });
  if (latestMetricsResponse) {
    return latestMetricsResponse;
  }

  return fetchLiveInsights({
    publication,
    platform: params.platform,
    contentId: params.contentId,
  });
}

export function registerSocialInsightsRoute(app: FastifyInstance) {
  app.get(
    '/api/social/:platform/insights/:contentId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { platform, contentId } = ContentIdSchema.parse(req.params);
        const platformError = ensurePlatformSupported(platform);
        if (platformError) {
          return reply.code(platformError.statusCode).send(platformError.body);
        }

        const response = await runInsightsFlow({ contentId, platform });
        return reply.send(response);
      } catch (error: unknown) {
        if (error instanceof SocialRouteReplyError) {
          return reply.code(error.statusCode).send(error.body);
        }
        logger.error('Failed to fetch insights', {
          error: error instanceof Error ? error.message : String(error),
          params: req.params,
        });
        return reply.code(500).send({
          error: 'insights_failed',
          message: error instanceof Error ? error.message : 'Failed to fetch insights',
        });
      }
    }
  );
}
