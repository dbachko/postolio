import '../dotenv-init.js';
import { prisma } from '../config/database.js';
import {
  ensureCuratedRecipesSeeded,
  getCuratedRecipeCatalogInfo,
} from '../services/recipes/seed.js';

async function main() {
  const catalog = getCuratedRecipeCatalogInfo();
  console.log(
    `[curated-recipes] Syncing catalog version=${catalog.catalogVersion} hash=${catalog.catalogHash.slice(
      0,
      12
    )} size=${catalog.catalogSize}`
  );

  const result = await ensureCuratedRecipesSeeded({ force: true });

  console.log(
    `[curated-recipes] Synced skipped=${result.skipped} createdTemplates=${result.createdTemplates} updatedTemplates=${result.updatedTemplates} archivedTemplates=${result.archivedTemplates} createdVersions=${result.createdVersions} unchangedVersions=${result.unchangedVersions}`
  );
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[curated-recipes] Sync failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
