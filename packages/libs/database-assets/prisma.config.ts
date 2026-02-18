import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

const assetsDatabaseUrl = process.env.ASSETS_DATABASE_URL;
const isGenerateOrValidate = process.argv.includes('generate') || process.argv.includes('validate');
if (!assetsDatabaseUrl && !isGenerateOrValidate) {
  throw new Error('ASSETS_DATABASE_URL must be set');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      assetsDatabaseUrl ??
      'postgresql://prisma:prisma@127.0.0.1:1/__postolio_missing_assets_database_url__?schema=public',
  },
});
