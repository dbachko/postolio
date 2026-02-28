import type { FastifyInstance } from 'fastify';
import type { ListAssetsResponse } from '@postolio/assets-client';

import { formatError } from '../../utils/logging.js';
import { assetsClient, ensureBrandOwned } from './shared.js';

type ListAssetsQuery = {
  brandId?: string;
  type?: 'image' | 'video';
  search?: string;
  page?: string;
  limit?: string;
  collectionId?: string;
  includeSubcollections?: string;
  labelIds?: string[];
  labelMode?: 'any' | 'all';
  aspectRatio?: string;
  aspectRatios?: string[];
  orientationTypes?: Array<'portrait' | 'landscape' | 'square'>;
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  uploadedAfter?: string;
  uploadedBefore?: string;
  usage?: 'used' | 'unused' | 'any';
};

export function registerListAssetsRoute(fastify: FastifyInstance): void {
  fastify.get<{ Querystring: ListAssetsQuery }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const {
          brandId,
          type,
          search,
          page,
          limit,
          collectionId,
          includeSubcollections,
          labelIds,
          labelMode,
          aspectRatio,
          aspectRatios,
          orientationTypes,
          minWidth,
          maxWidth,
          minHeight,
          maxHeight,
          uploadedAfter,
          uploadedBefore,
          usage,
        } = request.query;

        if (!brandId) {
          return reply.code(400).send({ error: 'brandId is required' });
        }

        const { owns } = await ensureBrandOwned(brandId, userId);
        if (!owns) {
          return reply.code(404).send({ error: 'Brand not found' });
        }

        const result: ListAssetsResponse = await assetsClient.listAssets({
          brandId,
          type,
          search,
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
          collectionId: collectionId || undefined,
          includeSubcollections: includeSubcollections === 'true' || includeSubcollections === '1',
          labelIds,
          labelMode,
          aspectRatio,
          aspectRatios,
          orientationTypes,
          minWidth: minWidth ? Number(minWidth) : undefined,
          maxWidth: maxWidth ? Number(maxWidth) : undefined,
          minHeight: minHeight ? Number(minHeight) : undefined,
          maxHeight: maxHeight ? Number(maxHeight) : undefined,
          uploadedAfter,
          uploadedBefore,
          usage,
        });

        return reply.send(result);
      } catch (error) {
        request.log.error(formatError(error), 'Failed to proxy assets list');
        return reply.code(500).send({ error: 'Failed to fetch assets' });
      }
    }
  );
}
