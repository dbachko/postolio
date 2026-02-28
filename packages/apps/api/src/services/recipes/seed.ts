import type { Prisma } from '@postolio/database';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prisma } from '../../config/database.js';
import { acquireDistributedLock } from '../distributed-lock.js';
import { RecipeConfigSchema, type RecipeConfig } from './config-schema.js';

type CuratedRecipeSeed = {
  slug: string;
  name: string;
  description: string;
  category: 'get_started' | 'content' | 'growth' | 'social' | 'other';
  config: RecipeConfig;
};

type RawCuratedRecipeRecord = {
  slug: unknown;
  name: unknown;
  description: unknown;
  category: unknown;
  config: unknown;
};

const MIN_CURATED_RECIPE_COUNT = 12;
const MIN_ASSET_PICKER_RECIPES = 2;
export const CURATED_RECIPE_CATALOG_VERSION = '2026-02-11-m5.3';

function readRawCuratedRecipeRecords(): RawCuratedRecipeRecord[] {
  const catalogPath = new URL('./curated-recipes.json', import.meta.url);
  const rawText = readFileSync(catalogPath, 'utf8');
  const parsed = JSON.parse(rawText);
  if (!Array.isArray(parsed)) {
    throw new Error('Curated recipe catalog JSON must be an array');
  }
  return parsed as RawCuratedRecipeRecord[];
}

function parseCategory(value: unknown): CuratedRecipeSeed['category'] {
  if (value === 'get_started') {
    return 'get_started';
  }
  if (value === 'content') {
    return 'content';
  }
  if (value === 'growth') {
    return 'growth';
  }
  if (value === 'social') {
    return 'social';
  }
  return 'other';
}

function parseRawCuratedRecipe(record: RawCuratedRecipeRecord, index: number): CuratedRecipeSeed {
  const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const description = typeof record.description === 'string' ? record.description : '';
  if (!slug || !name) {
    throw new Error(`Invalid curated recipe record at index ${index}: missing slug or name`);
  }

  return {
    slug,
    name,
    description,
    category: parseCategory(record.category),
    config: RecipeConfigSchema.parse(record.config),
  };
}

function loadCuratedRecipes(): CuratedRecipeSeed[] {
  const rawRecords = readRawCuratedRecipeRecords();
  return rawRecords.map(parseRawCuratedRecipe);
}

const CURATED_RECIPES: CuratedRecipeSeed[] = loadCuratedRecipes();

function assertCuratedRecipePack(recipes: CuratedRecipeSeed[]) {
  if (recipes.length < MIN_CURATED_RECIPE_COUNT) {
    throw new Error(
      `Curated recipe seed pack is too small (${recipes.length}); expected at least ${MIN_CURATED_RECIPE_COUNT}`
    );
  }

  const duplicateSlugs = recipes
    .map((recipe) => recipe.slug)
    .filter((slug, index, all) => all.indexOf(slug) !== index);
  if (duplicateSlugs.length > 0) {
    throw new Error(
      `Curated recipe seed pack has duplicate slugs: ${Array.from(new Set(duplicateSlugs)).join(', ')}`
    );
  }

  const assetPickerRecipeCount = recipes.filter((recipe) => {
    const typedInputs =
      recipe.config?.inputs && typeof recipe.config.inputs === 'object'
        ? (recipe.config.inputs as Record<string, unknown>)
        : null;
    const ui = typedInputs?.ui;
    if (!Array.isArray(ui)) {
      return false;
    }

    return ui.some((field) => {
      if (!field || typeof field !== 'object') {
        return false;
      }
      return (field as Record<string, unknown>).type === 'asset_picker';
    });
  }).length;

  if (assetPickerRecipeCount < MIN_ASSET_PICKER_RECIPES) {
    throw new Error(
      `Curated recipe seed pack needs at least ${MIN_ASSET_PICKER_RECIPES} asset-picker recipes; got ${assetPickerRecipeCount}`
    );
  }
}

assertCuratedRecipePack(CURATED_RECIPES);

function stableStringify(value: unknown): string {
  if (value == null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function curatedCatalogFingerprint() {
  const canonicalCatalog = CURATED_RECIPES.map((recipe) => ({
    slug: recipe.slug,
    name: recipe.name,
    description: recipe.description,
    category: recipe.category,
    config: recipe.config,
  }));
  const serialized = stableStringify(canonicalCatalog);
  const hash = createHash('sha256').update(serialized).digest('hex');
  return {
    version: CURATED_RECIPE_CATALOG_VERSION,
    hash,
    size: CURATED_RECIPES.length,
  };
}

export type CuratedRecipeSyncResult = {
  catalogVersion: string;
  catalogHash: string;
  catalogSize: number;
  skipped: boolean;
  archivedTemplates: number;
  createdTemplates: number;
  updatedTemplates: number;
  createdVersions: number;
  unchangedVersions: number;
};

let lastSyncedCatalogHash: string | null = null;
let syncInFlight: Promise<CuratedRecipeSyncResult> | null = null;

export function getCuratedRecipeCatalogInfo() {
  const fp = curatedCatalogFingerprint();
  return {
    catalogVersion: fp.version,
    catalogHash: fp.hash,
    catalogSize: fp.size,
  };
}

type CuratedCatalogFingerprint = ReturnType<typeof curatedCatalogFingerprint>;

type CuratedSyncCounters = {
  archivedTemplates: number;
  createdTemplates: number;
  updatedTemplates: number;
  createdVersions: number;
  unchangedVersions: number;
};

function createSyncCounters(): CuratedSyncCounters {
  return {
    archivedTemplates: 0,
    createdTemplates: 0,
    updatedTemplates: 0,
    createdVersions: 0,
    unchangedVersions: 0,
  };
}

function buildSkippedSyncResult(fp: CuratedCatalogFingerprint): CuratedRecipeSyncResult {
  return {
    catalogVersion: fp.version,
    catalogHash: fp.hash,
    catalogSize: fp.size,
    skipped: true,
    archivedTemplates: 0,
    createdTemplates: 0,
    updatedTemplates: 0,
    createdVersions: 0,
    unchangedVersions: 0,
  };
}

function buildCompletedSyncResult(
  fp: CuratedCatalogFingerprint,
  counters: CuratedSyncCounters
): CuratedRecipeSyncResult {
  return {
    catalogVersion: fp.version,
    catalogHash: fp.hash,
    catalogSize: fp.size,
    skipped: false,
    archivedTemplates: counters.archivedTemplates,
    createdTemplates: counters.createdTemplates,
    updatedTemplates: counters.updatedTemplates,
    createdVersions: counters.createdVersions,
    unchangedVersions: counters.unchangedVersions,
  };
}

async function archiveMissingCuratedTemplates(): Promise<number> {
  const curatedSlugs = CURATED_RECIPES.map((recipe) => recipe.slug);
  const archived = await prisma.recipeTemplate.updateMany({
    where: {
      brandId: null,
      isCurated: true,
      status: { not: 'archived' },
      slug: { notIn: curatedSlugs },
    },
    data: { status: 'archived' },
  });
  return archived.count;
}

async function upsertCuratedTemplateRecord(
  recipe: CuratedRecipeSeed,
  counters: CuratedSyncCounters
) {
  const existingTemplate = await prisma.recipeTemplate.findFirst({
    where: { brandId: null, slug: recipe.slug, isCurated: true },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      status: true,
      isCurated: true,
    },
  });

  if (!existingTemplate) {
    counters.createdTemplates += 1;
    return prisma.recipeTemplate.create({
      data: {
        brandId: null,
        slug: recipe.slug,
        name: recipe.name,
        description: recipe.description,
        category: recipe.category,
        isCurated: true,
        status: 'published',
      },
      select: { id: true },
    });
  }

  const shouldUpdate =
    existingTemplate.name !== recipe.name ||
    (existingTemplate.description || null) !== (recipe.description || null) ||
    existingTemplate.category !== recipe.category ||
    existingTemplate.status !== 'published' ||
    existingTemplate.isCurated !== true;
  if (!shouldUpdate) {
    return { id: existingTemplate.id };
  }

  counters.updatedTemplates += 1;
  return prisma.recipeTemplate.update({
    where: { id: existingTemplate.id },
    data: {
      name: recipe.name,
      description: recipe.description,
      category: recipe.category,
      isCurated: true,
      status: 'published',
    },
    select: { id: true },
  });
}

async function syncTemplateVersion(
  templateId: string,
  desiredConfig: Prisma.InputJsonValue,
  desiredSig: string,
  counters: CuratedSyncCounters
) {
  const versions = await prisma.recipeTemplateVersion.findMany({
    where: { recipeTemplateId: templateId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, isPublished: true, configJson: true },
    take: 5,
  });

  const published = versions.find((version) => version.isPublished) || null;
  const publishedSig = published ? stableStringify(published.configJson) : null;

  if (!published) {
    counters.createdVersions += 1;
    await prisma.recipeTemplateVersion.create({
      data: {
        recipeTemplateId: templateId,
        version: 1,
        configJson: desiredConfig,
        isPublished: true,
        changelog: `Curated catalog sync (${CURATED_RECIPE_CATALOG_VERSION})`,
      },
    });
    return;
  }

  if (publishedSig === desiredSig) {
    counters.unchangedVersions += 1;
    return;
  }

  const nextVersion = (versions[0]?.version || published.version || 0) + 1;
  counters.createdVersions += 1;
  await prisma.$transaction([
    prisma.recipeTemplateVersion.updateMany({
      where: { recipeTemplateId: templateId, isPublished: true },
      data: { isPublished: false },
    }),
    prisma.recipeTemplateVersion.create({
      data: {
        recipeTemplateId: templateId,
        version: nextVersion,
        configJson: desiredConfig,
        isPublished: true,
        changelog: `Curated catalog sync (${CURATED_RECIPE_CATALOG_VERSION})`,
      },
    }),
  ]);
}

async function syncCuratedRecipe(recipe: CuratedRecipeSeed, counters: CuratedSyncCounters) {
  const desiredConfig = JSON.parse(JSON.stringify(recipe.config)) as Prisma.InputJsonValue;
  const desiredSig = stableStringify(desiredConfig);
  const template = await upsertCuratedTemplateRecord(recipe, counters);
  await syncTemplateVersion(template.id, desiredConfig, desiredSig, counters);
}

async function runCuratedCatalogSync(
  fp: CuratedCatalogFingerprint
): Promise<CuratedRecipeSyncResult> {
  const lock = await acquireDistributedLock({
    key: `recipes:curated-sync:${fp.version}:${fp.hash}`,
    ttlSeconds: 180,
  });
  if (!lock.acquired) {
    return buildSkippedSyncResult(fp);
  }

  const counters = createSyncCounters();
  try {
    counters.archivedTemplates = await archiveMissingCuratedTemplates();
    for (const recipe of CURATED_RECIPES) {
      await syncCuratedRecipe(recipe, counters);
    }
    lastSyncedCatalogHash = fp.hash;
    return buildCompletedSyncResult(fp, counters);
  } finally {
    await lock.release();
  }
}

export async function ensureCuratedRecipesSeeded(opts?: {
  force?: boolean;
}): Promise<CuratedRecipeSyncResult> {
  const { force = false } = opts || {};
  const fp = curatedCatalogFingerprint();

  if (!force && lastSyncedCatalogHash === fp.hash) {
    return buildSkippedSyncResult(fp);
  }

  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runCuratedCatalogSync(fp);
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}
