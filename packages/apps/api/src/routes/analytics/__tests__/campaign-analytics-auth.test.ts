import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

// Prevent real DB access; these tests validate auth gating only.
vi.mock('../../../config/database.js', () => {
  return {
    getDatabaseClient: () => ({
      content: { findMany: vi.fn(async () => []) },
      contentPublication: { findMany: vi.fn(async () => []) },
      campaign: { findFirst: vi.fn(async () => null) },
    }),
  };
});

import { campaignAnalyticsRoutes } from '../campaign-analytics-routes.js';

describe('campaign analytics routes auth', () => {
  it('requires authentication for campaign analytics endpoints', async () => {
    const app = Fastify();

    // Stub auth decorator used by route preHandlers.
    app.decorate('authenticate', async (_request: any, reply: any) => {
      return reply.code(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    });

    await app.register(campaignAnalyticsRoutes);
    await app.ready();

    const endpoints = [
      '/analytics/campaigns/camp-1',
      '/analytics/campaigns/camp-1/metrics',
      '/analytics/campaigns/camp-1/recommendations',
      '/analytics/campaigns/camp-1/roi',
    ];

    for (const url of endpoints) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });
});
