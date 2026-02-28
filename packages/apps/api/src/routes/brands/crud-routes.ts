import type { FastifyInstance } from 'fastify';

import {
  BrandNotFoundError,
  BrandValidationError,
  createBrand,
  deleteBrand,
  getBrandDetails,
  listUserBrands,
  updateBrand,
  type CreateBrandBody,
  type UpdateBrandBody,
} from '../../services/brand.js';

function registerCreateBrandRoute(fastify: FastifyInstance): void {
  fastify.post<{ Body: CreateBrandBody }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const brand = await createBrand(request.user!.id, request.body);
        return reply.code(201).send({ brand });
      } catch (error) {
        request.log.error({ err: error }, 'Brand creation error');
        if (error instanceof BrandValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
  );
}

function registerListBrandsRoute(fastify: FastifyInstance): void {
  fastify.get('/', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const brands = await listUserBrands(request.user!.id);
      return { brands };
    } catch (error) {
      request.log.error({ err: error }, 'Brands list error');
      return reply.code(500).send({ error: 'Failed to retrieve brands' });
    }
  });
}

function registerGetBrandRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const brand = await getBrandDetails(request.user!.id, request.params.id);
        return { brand };
      } catch (error) {
        request.log.error({ err: error }, 'Brand details error');
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to retrieve brand details' });
      }
    }
  );
}

function registerUpdateBrandRoute(fastify: FastifyInstance): void {
  fastify.put<{ Params: { id: string }; Body: UpdateBrandBody }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const updatedBrand = await updateBrand(request.user!.id, request.params.id, request.body);
        return reply.code(200).send({
          message: 'Brand updated successfully',
          brand: updatedBrand,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Brand update error');
        if (error instanceof BrandValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }
    }
  );
}

function registerDeleteBrandRoute(fastify: FastifyInstance): void {
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const brand = await deleteBrand(request.user!.id, request.params.id);
        return reply.code(200).send({
          message: 'Brand deleted successfully',
          deletedBrand: {
            id: brand.id,
            name: brand.name,
            contentCount: brand._count.content,
          },
        });
      } catch (error) {
        request.log.error({ err: error }, 'Brand deletion error');
        if (error instanceof BrandNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        return reply.code(500).send({ error: 'Failed to delete brand' });
      }
    }
  );
}

export function registerBrandCrudRoutes(fastify: FastifyInstance): void {
  registerCreateBrandRoute(fastify);
  registerListBrandsRoute(fastify);
  registerGetBrandRoute(fastify);
  registerUpdateBrandRoute(fastify);
  registerDeleteBrandRoute(fastify);
}
