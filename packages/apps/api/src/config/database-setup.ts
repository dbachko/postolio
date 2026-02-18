import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function ensureDatabaseSchema(options?: { generateClient?: boolean }): Promise<void> {
  console.log('🔍 Ensuring database schema and Prisma client...');

  // Resolve Prisma schema path in the monorepo regardless of current working directory
  const candidateSchemas = [
    // When running from API package directory (e.g., inside container)
    path.resolve(process.cwd(), '../../libs/database/prisma/schema.prisma'),
    // When running from repo root in dev
    path.resolve(process.cwd(), 'packages/libs/database/prisma/schema.prisma'),
    // Fallback: try one level up (in case of different CWD layouts)
    path.resolve(process.cwd(), '../libs/database/prisma/schema.prisma'),
  ];
  const schemaPath = candidateSchemas.find((p) => fs.existsSync(p));
  if (!schemaPath) {
    console.warn(
      '⚠️  Prisma schema not found via known paths; proceeding without explicit --schema'
    );
  }

  const resolvePrismaInvocation = (
    schema?: string
  ): { cmd: string; cwd?: string; dbPkgDir?: string; configPath?: string } => {
    const resolveDbPkgDir = (schemaPath?: string): string | undefined =>
      schemaPath ? path.resolve(schemaPath, '..', '..') : undefined;
    const dbPkgDir = resolveDbPkgDir(schema);
    const configPath =
      dbPkgDir && fs.existsSync(path.join(dbPkgDir, 'prisma.config.ts'))
        ? path.join(dbPkgDir, 'prisma.config.ts')
        : undefined;

    const envBin = process.env.PRISMA_BIN || process.env.PRISMA_CLI;
    if (envBin && fs.existsSync(envBin)) {
      return { cmd: `"${envBin}"`, cwd: dbPkgDir ?? process.cwd(), dbPkgDir, configPath };
    }

    if (dbPkgDir) {
      const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
      const localBin = path.join(dbPkgDir, 'node_modules', '.bin', binName);
      if (fs.existsSync(localBin)) {
        return { cmd: `"${localBin}"`, cwd: dbPkgDir, dbPkgDir, configPath };
      }
    }

    if (dbPkgDir && fs.existsSync(dbPkgDir)) {
      return { cmd: 'pnpm exec prisma', cwd: dbPkgDir, dbPkgDir, configPath };
    }

    return { cmd: 'npx prisma', cwd: process.cwd(), dbPkgDir, configPath };
  };

  const { cmd, cwd, dbPkgDir, configPath } = resolvePrismaInvocation(schemaPath);

  try {
    // Choose strategy based on environment:
    // - In AWS/containerized envs, ALWAYS prefer migrate deploy (safe, migration-driven)
    // - In local dev, default to db push for DX unless overridden
    // - When DB_SETUP_STRATEGY=skip, skip schema sync and only run connectivity check
    const runningInAws = !!(
      process.env.AWS_EXECUTION_ENV ||
      process.env.ECS_CONTAINER_METADATA_URI_V4 ||
      process.env.AWS_LAMBDA_FUNCTION_NAME
    );

    const strategyEnv = (process.env.DB_SETUP_STRATEGY || '').toLowerCase();
    let strategy: 'migrate' | 'db-push' | 'skip';

    if (['skip', 'none', 'disabled'].includes(strategyEnv)) {
      strategy = 'skip';
    } else if (strategyEnv === 'migrate') {
      strategy = 'migrate';
    } else if (strategyEnv === 'db-push' || strategyEnv === 'dbpush') {
      strategy = 'db-push';
    } else {
      strategy = runningInAws ? 'migrate' : 'db-push';
    }

    if (strategy === 'skip') {
      console.log(
        'ℹ️ DB_SETUP_STRATEGY=skip - skipping Prisma schema sync; relying on external migrations.'
      );
    } else {
      const useDbPush = strategy === 'db-push';
      const args = useDbPush ? 'db push' : 'migrate deploy';
      const schemaArg = schemaPath ? ` --schema ${schemaPath}` : '';
      const configArg = configPath ? ` --config ${configPath}` : '';
      const migrateCommand = `${cmd} ${args}${schemaArg}${configArg}`;

      console.log(
        `🔧 Running (${strategy}): ${migrateCommand}${
          cwd && cwd !== process.cwd() ? ` (cwd: ${cwd})` : ''
        }`
      );
      execSync(migrateCommand, {
        stdio: 'inherit',
        cwd: cwd ?? process.cwd(),
      });
      console.log('✅ Database schema synchronized successfully');
    }
  } catch (migrationError) {
    console.error('❌ Failed to run database migrations:', migrationError);
    console.error('Attempted command failed. You can run manually, for example:');
    const strategyEnv = (process.env.DB_SETUP_STRATEGY || '').toLowerCase();
    const example =
      strategyEnv === 'db-push' || strategyEnv === 'dbpush'
        ? 'pnpm --filter @postolio/database exec prisma db push'
        : 'pnpm --filter @postolio/database exec prisma migrate deploy';
    console.error(`  ${example}`);
    throw new Error(`Database setup failed: ${migrationError}`);
  }

  try {
    // Generate Prisma client only when explicitly requested (avoid dev watch loops)
    const shouldGenerate =
      options?.generateClient === true || process.env.PRISMA_GENERATE === 'true';
    if (shouldGenerate) {
      const schemaArg = schemaPath ? ` --schema ${schemaPath}` : '';
      const configArg = configPath ? ` --config ${configPath}` : '';
      const generateCommand = `${cmd} generate${schemaArg}${configArg}`;
      console.log(
        `🔄 Generating Prisma client: ${generateCommand}${dbPkgDir ? ` (cwd: ${dbPkgDir})` : ''}`
      );
      execSync(generateCommand, {
        stdio: 'inherit',
        cwd: dbPkgDir ?? cwd ?? process.cwd(),
      });
      console.log('✅ Prisma client generated successfully');
    }
  } catch (genError) {
    console.error('⚠️  Prisma client generation failed:', genError);
    // Continue; some environments may still function if client is already up-to-date
  }

  // Basic connectivity check using freshly generated client via dynamic import to avoid stale cache
  try {
    const { getDatabaseClient } = await import('./database.js');
    const prisma = getDatabaseClient();
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connectivity verified');
  } catch (error) {
    console.error('❌ Database connectivity check failed:', error);
    throw new Error('Cannot connect to database. Please ensure PostgreSQL is running.');
  }
}
