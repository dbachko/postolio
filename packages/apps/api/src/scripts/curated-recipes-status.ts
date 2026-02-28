import '../dotenv-init.js';
import { prisma } from '../config/database.js';
import {
  ensureCuratedRecipesSeeded,
  getCuratedRecipeCatalogInfo,
} from '../services/recipes/seed.js';

function logInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function hasArg(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const doSync = hasArg('--sync');
  const catalog = getCuratedRecipeCatalogInfo();

  if (doSync) {
    logInfo(
      `[curated-recipes] Syncing before status version=${catalog.catalogVersion} hash=${catalog.catalogHash.slice(
        0,
        12
      )} size=${catalog.catalogSize}`
    );
    await ensureCuratedRecipesSeeded({ force: true });
  }

  const templates = await prisma.recipeTemplate.findMany({
    where: { brandId: null, isCurated: true },
    orderBy: [{ status: 'asc' }, { slug: 'asc' }],
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 10,
        select: { version: true, isPublished: true, createdAt: true, changelog: true },
      },
    },
  });

  const rows = templates.map((template) => {
    const latest = template.versions[0] || null;
    const published = template.versions.find((v) => v.isPublished) || null;
    return {
      slug: template.slug,
      status: template.status,
      latestVersion: latest?.version ?? null,
      publishedVersion: published?.version ?? null,
      updatedAt: template.updatedAt.toISOString(),
    };
  });

  const activeCount = templates.filter((t) => t.status !== 'archived').length;
  const archivedCount = templates.filter((t) => t.status === 'archived').length;
  const missingPublishedCount = templates.filter(
    (t) => !t.versions.some((v) => v.isPublished)
  ).length;

  logInfo('[curated-recipes] Catalog status');
  logJson({
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalog.catalogHash,
    catalogSize: catalog.catalogSize,
    dbTotalTemplates: templates.length,
    dbActiveTemplates: activeCount,
    dbArchivedTemplates: archivedCount,
    dbMissingPublishedVersion: missingPublishedCount,
  });

  if (rows.length > 0) {
    logJson(rows);
  }

  if (activeCount !== catalog.catalogSize) {
    console.warn(
      `[curated-recipes] WARNING: active curated templates (${activeCount}) differ from catalog size (${catalog.catalogSize})`
    );
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[curated-recipes] Status failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
