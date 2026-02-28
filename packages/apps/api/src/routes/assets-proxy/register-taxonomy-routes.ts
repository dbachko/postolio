import type { FastifyInstance } from 'fastify';

import { formatError } from '../../utils/logging.js';
import { assetsClient, ensureBrandOwned } from './shared.js';

function requireBrandId(body: unknown): string | null {
  const brandId = (body as { brandId?: string })?.brandId;
  return typeof brandId === 'string' && brandId.trim().length > 0 ? brandId : null;
}

export function registerListTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.get<{
    Querystring: {
      brandId?: string;
      type?: 'COLLECTION' | 'LABEL';
      format?: 'tree' | 'flat';
      includeArchived?: string;
    };
  }>('/taxonomy', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { brandId, type, format, includeArchived } = request.query;
      if (!brandId || !type) {
        return reply.code(400).send({ error: 'brandId and type are required' });
      }

      const { owns } = await ensureBrandOwned(brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.listTaxonomy({
        brandId,
        type,
        format,
        includeArchived: includeArchived === 'true' || includeArchived === '1',
      });
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to proxy taxonomy list');
      return reply.code(500).send({ error: 'Failed to fetch taxonomy' });
    }
  });
}

export function registerCreateTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.post('/taxonomy', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as {
        brandId: string;
        type: 'COLLECTION' | 'LABEL';
        name: string;
        parentId?: string | null;
        color?: string;
        sortOrder?: number;
      };
      if (!body.brandId || !body.type || !body.name) {
        return reply.code(400).send({ error: 'brandId, type, and name are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.createTaxonomy({
        brandId: body.brandId,
        type: body.type,
        name: body.name,
        parentId: body.parentId,
        color: body.color,
        sortOrder: body.sortOrder,
        createdBy: userId,
      });
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to create taxonomy item');
      return reply.code(500).send({ error: 'Failed to create taxonomy item' });
    }
  });
}

export function registerUpdateTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.patch('/taxonomy/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId: string;
        name?: string;
        parentId?: string | null;
        sortOrder?: number;
        color?: string;
      };
      if (!body.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.updateTaxonomy(id, {
        ...body,
        createdBy: userId,
      });
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to update taxonomy item');
      return reply.code(500).send({ error: 'Failed to update taxonomy item' });
    }
  });
}

export function registerDeleteTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.delete('/taxonomy/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params as { id: string };
      const body = request.body as {
        brandId: string;
        onNotEmpty?: 'move_to_parent' | 'move_to_unsorted';
      };
      if (!body.brandId) {
        return reply.code(400).send({ error: 'brandId is required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.deleteTaxonomy(id, {
        brandId: body.brandId,
        onNotEmpty: body.onNotEmpty,
        createdBy: userId,
      });
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to delete taxonomy item');
      return reply.code(500).send({ error: 'Failed to delete taxonomy item' });
    }
  });
}

export function registerArchiveTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/taxonomy/:id/archive',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };
        const brandId = requireBrandId(request.body);
        if (!brandId) {
          return reply.code(400).send({ error: 'brandId is required' });
        }

        const { owns } = await ensureBrandOwned(brandId, userId);
        if (!owns) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const result = await assetsClient.archiveTaxonomy(id, { brandId, createdBy: userId });
        return reply.send(result);
      } catch (error) {
        request.log.error(formatError(error), 'Failed to archive label');
        return reply.code(500).send({ error: 'Failed to archive label' });
      }
    }
  );
}

export function registerUnarchiveTaxonomyRoute(fastify: FastifyInstance): void {
  fastify.post(
    '/taxonomy/:id/unarchive',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params as { id: string };
        const brandId = requireBrandId(request.body);
        if (!brandId) {
          return reply.code(400).send({ error: 'brandId is required' });
        }

        const { owns } = await ensureBrandOwned(brandId, userId);
        if (!owns) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const result = await assetsClient.unarchiveTaxonomy(id, { brandId, createdBy: userId });
        return reply.send(result);
      } catch (error) {
        request.log.error(formatError(error), 'Failed to unarchive label');
        return reply.code(500).send({ error: 'Failed to unarchive label' });
      }
    }
  );
}

export function registerMergeLabelsRoute(fastify: FastifyInstance): void {
  fastify.post('/labels:merge', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const body = request.body as { brandId: string; fromLabelId: string; intoLabelId: string };
      if (!body.brandId || !body.fromLabelId || !body.intoLabelId) {
        return reply
          .code(400)
          .send({ error: 'brandId, fromLabelId, and intoLabelId are required' });
      }

      const { owns } = await ensureBrandOwned(body.brandId, userId);
      if (!owns) {
        return reply.code(404).send({ error: 'Brand not found' });
      }

      const result = await assetsClient.mergeLabels({
        ...body,
        createdBy: userId,
      });
      return reply.send(result);
    } catch (error) {
      request.log.error(formatError(error), 'Failed to merge labels');
      return reply.code(500).send({ error: 'Failed to merge labels' });
    }
  });
}
