import { Prisma } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { slugify, withRandomSuffix } from '../../utils/slug.js';
import { RecipeConfigSchema, type RecipeConfig } from './config-schema.js';
import { ensureCuratedRecipesSeeded } from './seed.js';

export type ListRecipesParams = {
  brandId: string;
  q?: string;
  category?: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  status?: 'draft' | 'published' | 'archived';
  includeCurated?: boolean;
};

export async function listRecipes(params: ListRecipesParams) {
  const { brandId, q, category, status, includeCurated = true } = params;

  await ensureCuratedRecipesSeeded();

  const where: any = {
    AND: [
      {
        OR: [{ brandId }, ...(includeCurated ? [{ brandId: null, isCurated: true }] : [])],
      },
    ],
  };

  if (status) where.AND.push({ status });
  if (category) where.AND.push({ category });
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
    inputs: (() => {
      const cfg = t.versions[0]?.configJson;
      if (!cfg || typeof cfg !== 'object') return { required: [], optional: [] };
      const inputs = (cfg as any).inputs;
      const required = Array.isArray(inputs?.required)
        ? inputs.required.filter((s: any) => typeof s === 'string')
        : [];
      const optional = Array.isArray(inputs?.optional)
        ? inputs.optional.filter((s: any) => typeof s === 'string')
        : [];
      return { required, optional };
    })(),
  }));
}

export type CreateRecipeParams = {
  brandId: string;
  userId: string;
  slug?: string;
  name: string;
  description?: string;
  category: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  config: unknown;
  publish: boolean;
};

export async function createRecipe(params: CreateRecipeParams) {
  const { brandId, userId, name, description, category, publish } = params;

  const validatedConfig = RecipeConfigSchema.parse(params.config) as RecipeConfig;
  const configJson = JSON.parse(JSON.stringify(validatedConfig)) as Prisma.InputJsonValue;

  const baseSlug = slugify(params.slug || name);

  const existing = await prisma.recipeTemplate.findFirst({
    where: { brandId, slug: baseSlug },
    select: { id: true },
  });

  const finalSlug = existing ? withRandomSuffix(baseSlug) : baseSlug;

  const res = await prisma.$transaction(async (tx) => {
    const template = await tx.recipeTemplate.create({
      data: {
        brandId,
        slug: finalSlug,
        name,
        description: description || null,
        category,
        isCurated: false,
        status: publish ? 'published' : 'draft',
        createdByUserId: userId,
      },
    });

    const version = await tx.recipeTemplateVersion.create({
      data: {
        recipeTemplateId: template.id,
        version: 1,
        configJson,
        isPublished: publish,
        createdByUserId: userId,
      },
    });

    return { template, version };
  });

  return {
    recipeId: res.template.id,
    versionId: res.version.id,
    status: res.template.status,
  };
}

export type CreateRecipeVersionParams = {
  recipeId: string;
  userId: string;
  config: unknown;
  changelog?: string;
  publish: boolean;
};

export async function createRecipeVersion(params: CreateRecipeVersionParams) {
  const { recipeId, userId, changelog, publish } = params;
  const validatedConfig = RecipeConfigSchema.parse(params.config) as RecipeConfig;
  const configJson = JSON.parse(JSON.stringify(validatedConfig)) as Prisma.InputJsonValue;

  return await prisma.$transaction(async (tx) => {
    const latest = await tx.recipeTemplateVersion.findFirst({
      where: { recipeTemplateId: recipeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version || 0) + 1;

    if (publish) {
      await tx.recipeTemplateVersion.updateMany({
        where: { recipeTemplateId: recipeId },
        data: { isPublished: false },
      });
    }

    const version = await tx.recipeTemplateVersion.create({
      data: {
        recipeTemplateId: recipeId,
        version: nextVersion,
        configJson,
        changelog: changelog || null,
        isPublished: publish,
        createdByUserId: userId,
      },
    });

    if (publish) {
      await tx.recipeTemplate.update({
        where: { id: recipeId },
        data: { status: 'published' },
      });
    }

    return { versionId: version.id, version: version.version, isPublished: version.isPublished };
  });
}

export async function publishLatestRecipeVersion(recipeId: string) {
  return await prisma.$transaction(async (tx) => {
    const latest = await tx.recipeTemplateVersion.findFirst({
      where: { recipeTemplateId: recipeId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (!latest) return null;

    await tx.recipeTemplateVersion.updateMany({
      where: { recipeTemplateId: recipeId },
      data: { isPublished: false },
    });

    const updated = await tx.recipeTemplateVersion.update({
      where: { id: latest.id },
      data: { isPublished: true },
      select: { id: true, version: true },
    });

    await tx.recipeTemplate.update({
      where: { id: recipeId },
      data: { status: 'published' },
      select: { id: true },
    });

    return updated;
  });
}

export async function archiveRecipe(recipeId: string) {
  return await prisma.recipeTemplate.update({
    where: { id: recipeId },
    data: { status: 'archived' },
    select: { id: true, status: true },
  });
}
