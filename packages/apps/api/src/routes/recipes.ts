import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { validateQuery } from '../middleware/validation.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { ensureDefaultSkillInstallations } from '../services/skills/skills-service.js';
import { listRecipes } from '../services/recipes/recipes-service.js';

const RecipeCategorySchema = z.enum(['get_started', 'content', 'growth', 'social', 'other']);
const RecipeStatusSchema = z.enum(['draft', 'published', 'archived']);

const ListRecipesQuerySchema = z.object({
  brandId: z.string().min(1),
  q: z.string().min(1).optional(),
  category: RecipeCategorySchema.optional(),
  status: RecipeStatusSchema.optional(),
});

export const recipesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: z.infer<typeof ListRecipesQuerySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateQuery(ListRecipesQuerySchema)] },
    async (request, reply) => {
      const { brandId, q, category, status } = request.query;
      const userId = request.user!.id;

      await assertBrandOwnership(userId, brandId);
      await ensureDefaultSkillInstallations(brandId, userId);

      const recipes = await listRecipes({ brandId, q, category, status });
      return reply.send({ recipes });
    }
  );
};

export default recipesRoutes;
