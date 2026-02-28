import { prisma } from '../../config/database.js';
import { normalizeInputFields, normalizeSkillRequirements } from './config-schema.js';
import { ensureCuratedRecipesSeeded } from './seed.js';

export type ListRecipesParams = {
  brandId: string;
  q?: string;
  category?: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  status?: 'draft' | 'published' | 'archived';
};

function buildListRecipesWhere(params: ListRecipesParams) {
  const where: any = {
    AND: [{ brandId: null, isCurated: true }],
  };

  if (!params.status) {
    where.AND.push({ status: { not: 'archived' } });
  }
  if (params.status) {
    where.AND.push({ status: params.status });
  }
  if (params.category) {
    where.AND.push({ category: params.category });
  }
  if (params.q) {
    where.AND.push({
      OR: [
        { name: { contains: params.q, mode: 'insensitive' } },
        { description: { contains: params.q, mode: 'insensitive' } },
      ],
    });
  }

  return where;
}

function getVersionConfig(version: { configJson: unknown } | undefined) {
  const config = version?.configJson;
  if (!config || typeof config !== 'object') {
    return null;
  }
  return config as Record<string, unknown>;
}

function getRecipeSummary(config: Record<string, unknown> | null) {
  const summary = config?.summary;
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const summaryRecord = summary as Record<string, unknown>;
  return {
    produces: typeof summaryRecord.produces === 'string' ? summaryRecord.produces : null,
    postsCount: typeof summaryRecord.postsCount === 'number' ? summaryRecord.postsCount : null,
    cadence: typeof summaryRecord.cadence === 'string' ? summaryRecord.cadence : null,
  };
}

function mapTemplateRecipe(t: {
  id: string;
  brandId: string | null;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  isCurated: boolean;
  status: string;
  updatedAt: Date;
  versions: Array<{ id: string; version: number; createdAt: Date; configJson: unknown }>;
}) {
  const version = t.versions[0];
  const config = getVersionConfig(version);
  const inputFields = normalizeInputFields(config?.inputs);
  const allSkillRequirements = normalizeSkillRequirements(config?.skills_required);

  return {
    id: t.id,
    brandId: t.brandId,
    slug: t.slug,
    name: t.name,
    description: t.description,
    category: t.category,
    isCurated: t.isCurated,
    status: t.status,
    updatedAt: t.updatedAt,
    publishedVersion: version
      ? { id: version.id, version: version.version, createdAt: version.createdAt }
      : null,
    summary: getRecipeSummary(config),
    skillRequirements: allSkillRequirements,
    skillsRequired: allSkillRequirements.filter((s) => !s.optional).map((s) => s.id),
    inputSchema: { fields: inputFields.fields },
    inputs: { required: inputFields.required, optional: inputFields.optional },
    cadence:
      config?.cadence && typeof config.cadence === 'object'
        ? (config.cadence as Record<string, unknown>)
        : null,
  };
}

export async function listRecipes(params: ListRecipesParams) {
  await ensureCuratedRecipesSeeded();
  const where = buildListRecipesWhere(params);
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

  return templates.map(mapTemplateRecipe);
}
