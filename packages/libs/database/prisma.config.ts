import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

const databaseUrl = process.env.DATABASE_URL;
const isGenerateOrValidate = process.argv.includes('generate') || process.argv.includes('validate');
if (!databaseUrl && !isGenerateOrValidate) {
  throw new Error('DATABASE_URL must be set');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      databaseUrl ??
      'postgresql://prisma:prisma@127.0.0.1:1/__postolio_missing_database_url__?schema=public',
  },
});
