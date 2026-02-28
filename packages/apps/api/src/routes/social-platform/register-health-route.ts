import type { FastifyInstance } from 'fastify';
import type { PlatformName } from '@postolio/connectors';

import { ConnectorFactory } from '../../services/connectors/index.js';
import { logger } from './shared.js';

function buildConnectorHealthSummary() {
  const supportedPlatforms = ConnectorFactory.supportedPlatforms();
  const connectors: Record<string, unknown> = {};

  for (const platform of supportedPlatforms) {
    try {
      const connector = ConnectorFactory.get(platform as PlatformName);
      connectors[platform] = {
        status: 'available',
        capabilities: connector.capabilities,
        rateLimits: connector.rateLimits,
      };
    } catch (error: unknown) {
      connectors[platform] = {
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { connectors, supportedPlatforms };
}

export function registerSocialHealthRoute(app: FastifyInstance) {
  app.get('/api/social/health', async (_req, reply) => {
    try {
      const { connectors, supportedPlatforms } = buildConnectorHealthSummary();
      const totalAvailable = Object.values(connectors).filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as { status?: unknown }).status === 'available'
      ).length;

      return reply.send({
        success: true,
        connectors,
        totalAvailable,
        totalRegistered: supportedPlatforms.length,
      });
    } catch (error: unknown) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return reply.code(500).send({
        success: false,
        error: 'Failed to check connector health',
      });
    }
  });
}
