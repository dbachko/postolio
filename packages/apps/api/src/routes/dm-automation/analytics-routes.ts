import { APIError } from '@postolio/errors';
import { logger as baseLogger } from '@postolio/logger';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { analyticsQuerySchema, type AnalyticsQuery } from '../../schemas/dm-automation.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { requireInboxFeature } from './shared.js';

const logger = baseLogger.child({ module: 'dm-automation-analytics-routes' });

type RuleStatsDetail = {
  ruleId: string;
  totalEvents: number;
  messagesSent: number;
  commentRepliesSent: number;
  rateLimited: number;
};

function isZodError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'ZodError';
}

async function fetchOverview(brandId: string, since: Date) {
  const [totalEvents, messagesSent, commentRepliesSent, rateLimitedEvents, uniqueUsers] =
    await Promise.all([
      prisma.dMAutomationEvent.count({ where: { brandId, timestamp: { gte: since } } }),
      prisma.dMAutomationEvent.count({
        where: { brandId, timestamp: { gte: since }, messageSent: true },
      }),
      prisma.dMAutomationEvent.count({
        where: { brandId, timestamp: { gte: since }, commentReplySent: true },
      }),
      prisma.dMAutomationEvent.count({
        where: { brandId, timestamp: { gte: since }, rateLimited: true },
      }),
      prisma.dMAutomationEvent.findMany({
        where: { brandId, timestamp: { gte: since } },
        select: { triggeredBy: true },
        distinct: ['triggeredBy'],
      }),
    ]);

  return {
    totalEvents,
    messagesSent,
    commentRepliesSent,
    rateLimitedEvents,
    uniqueUsers: uniqueUsers.length,
  };
}

async function fetchRuleStats(brandId: string, since: Date): Promise<RuleStatsDetail[]> {
  const ruleStats = await prisma.dMAutomationEvent.groupBy({
    by: ['ruleId'],
    where: { brandId, timestamp: { gte: since } },
    _count: { id: true },
  });

  return Promise.all(
    ruleStats.map(async (stat) => {
      const [messagesSentCount, commentRepliesCount, rateLimitedCount] = await Promise.all([
        prisma.dMAutomationEvent.count({
          where: { brandId, ruleId: stat.ruleId, timestamp: { gte: since }, messageSent: true },
        }),
        prisma.dMAutomationEvent.count({
          where: {
            brandId,
            ruleId: stat.ruleId,
            timestamp: { gte: since },
            commentReplySent: true,
          },
        }),
        prisma.dMAutomationEvent.count({
          where: { brandId, ruleId: stat.ruleId, timestamp: { gte: since }, rateLimited: true },
        }),
      ]);

      return {
        ruleId: stat.ruleId,
        totalEvents: stat._count.id,
        messagesSent: messagesSentCount,
        commentRepliesSent: commentRepliesCount,
        rateLimited: rateLimitedCount,
      };
    })
  );
}

async function fetchRuleNameMap(ruleIds: string[]): Promise<Map<string, string>> {
  if (ruleIds.length === 0) {
    return new Map();
  }

  const rules = await prisma.dMAutomationRule.findMany({
    where: { id: { in: ruleIds } },
    select: { id: true, name: true },
  });

  return new Map(rules.map((rule) => [rule.id, rule.name]));
}

function formatAnalyticsResponse(params: {
  days: number;
  since: Date;
  overview: Awaited<ReturnType<typeof fetchOverview>>;
  ruleStats: RuleStatsDetail[];
  ruleNameMap: Map<string, string>;
}) {
  const byRule = params.ruleStats.map((stat) => ({
    ruleId: stat.ruleId,
    ruleName: params.ruleNameMap.get(stat.ruleId) || 'Unknown',
    totalEvents: stat.totalEvents,
    messagesSent: stat.messagesSent,
    commentRepliesSent: stat.commentRepliesSent,
    rateLimited: stat.rateLimited,
  }));

  return {
    period: {
      days: params.days,
      since: params.since.toISOString(),
    },
    overview: {
      totalEvents: params.overview.totalEvents,
      messagesSent: params.overview.messagesSent,
      commentRepliesSent: params.overview.commentRepliesSent,
      rateLimitedEvents: params.overview.rateLimitedEvents,
      uniqueUsers: params.overview.uniqueUsers,
      successRate:
        params.overview.totalEvents > 0
          ? ((params.overview.messagesSent + params.overview.commentRepliesSent) /
              params.overview.totalEvents) *
            100
          : 0,
    },
    byRule,
  };
}

async function handleGetAnalytics(
  request: { params: { brandId: string }; query: AnalyticsQuery; user: { id: string } },
  reply: {
    send: (payload: unknown) => unknown;
    code: (n: number) => { send: (payload: unknown) => unknown };
  }
) {
  const { brandId } = request.params;
  const userId = request.user.id;

  try {
    const { days } = analyticsQuerySchema.parse(request.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    await assertBrandOwnership(userId, brandId);

    const overview = await fetchOverview(brandId, since);
    const ruleStats = await fetchRuleStats(brandId, since);
    const ruleNameMap = await fetchRuleNameMap(ruleStats.map((stat) => stat.ruleId));

    logger.info('Fetched DM automation analytics', {
      brandId,
      days,
      totalEvents: overview.totalEvents,
      userId,
    });

    return reply.send(
      formatAnalyticsResponse({
        days,
        since,
        overview,
        ruleStats,
        ruleNameMap,
      })
    );
  } catch (error) {
    if (isZodError(error)) {
      return reply.code(400).send({ error: 'Invalid query parameters' });
    }

    logger.error('Error fetching DM automation analytics', {
      brandId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError(
      error instanceof Error ? error.message : 'Failed to fetch DM automation analytics',
      'DM_ANALYTICS_FETCH_FAILED',
      500,
      { brandId, userId }
    );
  }
}

export function registerDmAutomationAnalyticsRoutes(fastify: FastifyInstance): void {
  fastify.get<{ Params: { brandId: string }; Querystring: AnalyticsQuery }>(
    '/brands/:brandId/dm-automation/analytics',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => handleGetAnalytics(request as any, reply as any)
  );
}
