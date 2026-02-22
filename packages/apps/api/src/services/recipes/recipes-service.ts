import { prisma } from '../../config/database.js';
import { normalizeInputFields, normalizeSkillRequirements } from './config-schema.js';
import { ensureCuratedRecipesSeeded } from './seed.js';

export type ListRecipesParams = {
  brandId: string;
  q?: string;
  category?: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  status?: 'draft' | 'published' | 'archived';
};

export async function listRecipes(params: ListRecipesParams) {
  const { q, category, status } = params;

  await ensureCuratedRecipesSeeded();

  const where: any = {
    AND: [{ brandId: null, isCurated: true }],
  };

  // Archived recipes should not appear in the default browse experience.
  if (!status) {
    where.AND.push({ status: { not: 'archived' } });
  }
  if (status) {
    where.AND.push({ status });
  }
  if (category) {
    where.AND.push({ category });
  }
  if (q) {
    where.AND.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  const templates = await prisma.recipeTemplate.findMany({
    where,
    orderBy: [{ isCurated: 'desc' }, { updatedAt: 'desc' }],
    include: {
      versions: {
        where: { isPublished: true },
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  return templates.map((t) => ({
    id: t.id,
    brandId: t.brandId,
    slug: t.slug,
    name: t.name,
    description: t.description,
    category: t.category,
    isCurated: t.isCurated,
    status: t.status,
    updatedAt: t.updatedAt,
    publishedVersion: t.versions[0]
      ? { id: t.versions[0].id, version: t.versions[0].version, createdAt: t.versions[0].createdAt }
      : null,
    summary: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return null;
      }
      const summary = (cfg as any).summary;
      if (!summary || typeof summary !== 'object') {
        return null;
      }
      return {
        produces: typeof (summary as any).produces === 'string' ? (summary as any).produces : null,
        postsCount:
          typeof (summary as any).postsCount === 'number' ? (summary as any).postsCount : null,
        cadence: typeof (summary as any).cadence === 'string' ? (summary as any).cadence : null,
      };
    })(),
    skillRequirements: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return [];
      }
      return normalizeSkillRequirements((cfg as any).skills_required);
    })(),
    skillsRequired: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return [];
      }
      return normalizeSkillRequirements((cfg as any).skills_required)
        .filter((s) => !s.optional)
        .map((s) => s.id);
    })(),
    inputSchema: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return { fields: [] };
      }
      const inputs = normalizeInputFields((cfg as any).inputs);
      return { fields: inputs.fields };
    })(),
    inputs: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return { required: [], optional: [] };
      }
      const inputs = normalizeInputFields((cfg as any).inputs);
      return { required: inputs.required, optional: inputs.optional };
    })(),
    cadence: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') {
        return null;
      }
      const cadence = (cfg as any).cadence;
      if (!cadence || typeof cadence !== 'object') {
        return null;
      }
      return cadence;
    })(),
  }));
}
