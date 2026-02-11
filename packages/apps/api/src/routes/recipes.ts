import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { validateBody, validateQuery, validateParams } from '../middleware/validation.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { prisma } from '../config/database.js';
import { ensureDefaultSkillInstallations } from '../services/skills/skills-service.js';
import {
  createRecipe,
  createRecipeVersion,
  listRecipes,
  publishLatestRecipeVersion,
  archiveRecipe,
} from '../services/recipes/recipes-service.js';

const RecipeCategorySchema = z.enum(['get_started', 'content', 'growth', 'social', 'other']);
const RecipeStatusSchema = z.enum(['draft', 'published', 'archived']);

const ListRecipesQuerySchema = z.object({
  brandId: z.string().min(1),
  q: z.string().min(1).optional(),
  category: RecipeCategorySchema.optional(),
  status: RecipeStatusSchema.optional(),
  includeCurated: z
    .string()
    .optional()
    .transform((v) => (v == null ? true : v === 'true')),
});

const CreateRecipeBodySchema = z.object({
  brandId: z.string().min(1),
  slug: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  category: RecipeCategorySchema.default('other'),
  config: z.unknown(),
  publish: z.boolean().optional().default(true),
});

const RecipeIdParamsSchema = z.object({
  recipeId: z.string().min(1),
});

const CreateVersionBodySchema = z.object({
  config: z.unknown(),
  changelog: z.string().optional(),
  publish: z.boolean().optional().default(false),
});

export const recipesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: z.infer<typeof ListRecipesQuerySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateQuery(ListRecipesQuerySchema)] },
    async (request, reply) => {
      const { brandId, q, category, status, includeCurated } = request.query;
      const userId = request.user!.id;

      await assertBrandOwnership(userId, brandId);
      await ensureDefaultSkillInstallations(brandId, userId);

      const recipes = await listRecipes({ brandId, q, category, status, includeCurated });
      return reply.send({ recipes });
    }
  );

  fastify.post<{ Body: z.infer<typeof CreateRecipeBodySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateBody(CreateRecipeBodySchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const body = request.body;

      await assertBrandOwnership(userId, body.brandId);

      const result = await createRecipe({
        brandId: body.brandId,
        userId,
        slug: body.slug,
        name: body.name,
        description: body.description,
        category: body.category,
        config: body.config,
        publish: body.publish,
      });

      return reply.code(201).send(result);
    }
  );

  fastify.post<{
    Params: z.infer<typeof RecipeIdParamsSchema>;
    Body: z.infer<typeof CreateVersionBodySchema>;
  }>(
    '/:recipeId/versions',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(RecipeIdParamsSchema),
        validateBody(CreateVersionBodySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { recipeId } = request.params;
      const body = request.body;

      const template = await prisma.recipeTemplate.findUnique({
        where: { id: recipeId },
        select: { id: true, brandId: true, isCurated: true },
      });
      if (!template) return reply.code(404).send({ error: 'Recipe not found' });
      if (!template.brandId || template.isCurated) {
        return reply.code(400).send({ error: 'Curated recipes cannot be modified' });
      }

      await assertBrandOwnership(userId, template.brandId);

      const result = await createRecipeVersion({
        recipeId,
        userId,
        config: body.config,
        changelog: body.changelog,
        publish: body.publish,
      });

      return reply.code(201).send(result);
    }
  );

  fastify.post<{ Params: z.infer<typeof RecipeIdParamsSchema> }>(
    '/:recipeId/publish',
    { preHandler: [fastify.authenticate, validateParams(RecipeIdParamsSchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { recipeId } = request.params;

      const template = await prisma.recipeTemplate.findUnique({
        where: { id: recipeId },
        select: { id: true, brandId: true, isCurated: true },
      });
      if (!template) return reply.code(404).send({ error: 'Recipe not found' });
      if (!template.brandId || template.isCurated) {
        return reply.code(400).send({ error: 'Curated recipes cannot be modified' });
      }

      await assertBrandOwnership(userId, template.brandId);

      const published = await publishLatestRecipeVersion(recipeId);
      if (!published) return reply.code(400).send({ error: 'No versions found to publish' });
      return reply.send({ versionId: published.id, version: published.version });
    }
  );

  fastify.post<{ Params: z.infer<typeof RecipeIdParamsSchema> }>(
    '/:recipeId/archive',
    { preHandler: [fastify.authenticate, validateParams(RecipeIdParamsSchema)] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { recipeId } = request.params;

      const template = await prisma.recipeTemplate.findUnique({
        where: { id: recipeId },
        select: { id: true, brandId: true, isCurated: true },
      });
      if (!template) return reply.code(404).send({ error: 'Recipe not found' });
      if (!template.brandId || template.isCurated) {
        return reply.code(400).send({ error: 'Curated recipes cannot be modified' });
      }

      await assertBrandOwnership(userId, template.brandId);

      const archived = await archiveRecipe(recipeId);
      return reply.send(archived);
    }
  );
};

export default recipesRoutes;
