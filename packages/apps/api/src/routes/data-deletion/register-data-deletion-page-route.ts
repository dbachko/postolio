import type { FastifyInstance } from 'fastify';

import {
  loadDataDeletionMarkdown,
  renderDataDeletionHtml,
  requestAcceptsHtml,
} from './page-content.js';
import { logRouteError } from './shared.js';

export function registerDataDeletionPageRoute(fastify: FastifyInstance): void {
  fastify.get('/data-deletion', async (request, reply) => {
    try {
      const markdownContent = loadDataDeletionMarkdown();
      if (requestAcceptsHtml(request.headers.accept)) {
        return reply.type('text/html').send(renderDataDeletionHtml(markdownContent));
      }

      return reply.type('text/plain').send(markdownContent);
    } catch (error: unknown) {
      logRouteError(fastify.log, error, 'Error serving data deletion page:');
      return reply.code(500).send({ error: 'Failed to load data deletion instructions' });
    }
  });
}
