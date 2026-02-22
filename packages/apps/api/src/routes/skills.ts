import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { validateBody, validateQuery, validateParams } from '../middleware/validation.js';
import { assertBrandOwnership } from '../services/ownership.js';
import { prisma } from '../config/database.js';
import {
  ensureDefaultSkillInstallations,
  getSkill,
  installSkill,
  listSkills,
  trySkill,
  toggleSkillInstallation,
  uninstallSkillByInstallationId,
  uninstallSkillBySkillId,
} from '../services/skills/skills-service.js';

const ListSkillsQuerySchema = z.object({
  brandId: z.string().min(1),
});

const SkillDetailQuerySchema = z.object({
  brandId: z.string().min(1),
});

const SkillIdParamsSchema = z.object({
  skillId: z.string().min(1),
});

const InstallSkillBodySchema = z.object({
  brandId: z.string().min(1),
  mode: z.enum(['managed', 'byok']).default('managed'),
  config: z.unknown().optional().default({}),
  secret: z
    .object({
      apiKey: z.string().min(1),
    })
    .optional(),
});

const InstallationIdParamsSchema = z.object({
  installationId: z.string().min(1),
});

const ToggleBodySchema = z.object({
  enabled: z.boolean(),
});

const UninstallSkillBodySchema = z.object({
  brandId: z.string().min(1),
});

const TrySkillBodySchema = z.object({
  brandId: z.string().min(1),
  input: z.unknown().optional(),
});

export const skillsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: z.infer<typeof ListSkillsQuerySchema> }>(
    '/',
    { preHandler: [fastify.authenticate, validateQuery(ListSkillsQuerySchema)] },
    async (request, reply) => {
      const { brandId } = request.query;
      const userId = request.user!.id;

      await assertBrandOwnership(userId, brandId);
      await ensureDefaultSkillInstallations(brandId, userId);

      const skills = await listSkills(brandId);
      return reply.send({ skills });
    }
  );

  fastify.get<{
    Params: z.infer<typeof SkillIdParamsSchema>;
    Querystring: z.infer<typeof SkillDetailQuerySchema>;
  }>(
    '/:skillId',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(SkillIdParamsSchema),
        validateQuery(SkillDetailQuerySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { skillId } = request.params;
      const { brandId } = request.query;

      await assertBrandOwnership(userId, brandId);
      await ensureDefaultSkillInstallations(brandId, userId);

      const skill = await getSkill(brandId, skillId);
      if (!skill) {
        return reply.code(404).send({ error: 'Skill not found' });
      }

      return reply.send({ skill });
    }
  );

  fastify.post<{
    Params: z.infer<typeof SkillIdParamsSchema>;
    Body: z.infer<typeof InstallSkillBodySchema>;
  }>(
    '/:skillId/install',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(SkillIdParamsSchema),
        validateBody(InstallSkillBodySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { skillId } = request.params;
      const body = request.body;

      await assertBrandOwnership(userId, body.brandId);

      try {
        const result = await installSkill({
          brandId: body.brandId,
          userId,
          skillId,
          mode: body.mode,
          config: body.config,
          secret: body.secret,
        });
        return reply.code(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to install skill';
        const isKeyMissing = message.includes('BYOK_SECRETS_MASTER_KEY');
        return reply.code(isKeyMissing ? 503 : 400).send({ error: message });
      }
    }
  );

  fastify.post<{
    Params: z.infer<typeof InstallationIdParamsSchema>;
    Body: z.infer<typeof ToggleBodySchema>;
  }>(
    '/:installationId/toggle',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(InstallationIdParamsSchema),
        validateBody(ToggleBodySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { installationId } = request.params;
      const body = request.body;

      const installation = await prisma.skillInstallation.findUnique({
        where: { id: installationId },
        select: { id: true, brandId: true },
      });
      if (!installation) {
        return reply.code(404).send({ error: 'Skill installation not found' });
      }

      await assertBrandOwnership(userId, installation.brandId);

      const res = await toggleSkillInstallation({ installationId, enabled: body.enabled });
      return reply.send(res);
    }
  );

  fastify.post<{
    Params: z.infer<typeof SkillIdParamsSchema>;
    Body: z.infer<typeof UninstallSkillBodySchema>;
  }>(
    '/:skillId/uninstall',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(SkillIdParamsSchema),
        validateBody(UninstallSkillBodySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { skillId } = request.params;
      const { brandId } = request.body;

      await assertBrandOwnership(userId, brandId);
      const res = await uninstallSkillBySkillId({ brandId, skillId });
      return reply.send(res);
    }
  );

  fastify.delete<{ Params: z.infer<typeof InstallationIdParamsSchema> }>(
    '/:installationId',
    {
      preHandler: [fastify.authenticate, validateParams(InstallationIdParamsSchema)],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { installationId } = request.params;

      const installation = await prisma.skillInstallation.findUnique({
        where: { id: installationId },
        select: { id: true, brandId: true },
      });
      if (!installation) {
        return reply.code(404).send({ error: 'Skill installation not found' });
      }

      await assertBrandOwnership(userId, installation.brandId);
      const res = await uninstallSkillByInstallationId({ installationId });
      return reply.send(res);
    }
  );

  fastify.post<{
    Params: z.infer<typeof SkillIdParamsSchema>;
    Body: z.infer<typeof TrySkillBodySchema>;
  }>(
    '/:skillId/try',
    {
      preHandler: [
        fastify.authenticate,
        validateParams(SkillIdParamsSchema),
        validateBody(TrySkillBodySchema),
      ],
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const { skillId } = request.params;
      const { brandId, input } = request.body;

      await assertBrandOwnership(userId, brandId);
      await ensureDefaultSkillInstallations(brandId, userId);

      try {
        const result = await trySkill({ brandId, skillId, input });
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run skill try stub';
        return reply.code(400).send({ error: message });
      }
    }
  );
};

export default skillsRoutes;
