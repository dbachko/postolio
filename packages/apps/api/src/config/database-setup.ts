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
  ): { cmd: string; cwd?: string; dbPkgDir?: string } => {
    const envBin = process.env.PRISMA_BIN || process.env.PRISMA_CLI;
    if (envBin && fs.existsSync(envBin)) {
      return { cmd: `"${envBin}"`, cwd: process.cwd() };
    }

    let dbPkgDir: string | undefined;
    if (schema) {
      // packages/libs/database/prisma/schema.prisma -> packages/libs/database
      dbPkgDir = path.resolve(schema, '..', '..');
      const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
      const localBin = path.join(dbPkgDir, 'node_modules', '.bin', binName);
      if (fs.existsSync(localBin)) {
        return { cmd: `"${localBin}"`, cwd: process.cwd(), dbPkgDir };
      }
    }

    if (dbPkgDir && fs.existsSync(dbPkgDir)) {
      return { cmd: 'pnpm exec prisma', cwd: dbPkgDir, dbPkgDir };
    }

    return { cmd: 'npx prisma', cwd: process.cwd(), dbPkgDir };
  };

  const { cmd, cwd, dbPkgDir } = resolvePrismaInvocation(schemaPath);

  try {
    // Prefer migrate deploy in prod; use db push in dev to keep DX smooth
    const useDbPush =
      process.env.NODE_ENV !== 'prod' && process.env.DB_SETUP_STRATEGY !== 'migrate';
    const args = useDbPush ? 'db push --skip-generate' : 'migrate deploy --skip-generate';
    const schemaArg = schemaPath ? ` --schema ${schemaPath}` : '';
    const migrateCommand = `${cmd} ${args}${schemaArg}`;

    console.log(
      `🔧 Running: ${migrateCommand}${cwd && cwd !== process.cwd() ? ` (cwd: ${cwd})` : ''}`
    );
    execSync(migrateCommand, {
      stdio: 'inherit',
      cwd: cwd ?? process.cwd(),
    });
    console.log('✅ Database schema synchronized successfully');
  } catch (migrationError) {
    console.error('❌ Failed to run database migrations:', migrationError);
    console.error('Attempted command failed. You can run manually, for example:');
    const example =
      process.env.NODE_ENV === 'prod'
        ? 'pnpm --filter @postolio/database exec prisma migrate deploy'
        : 'pnpm --filter @postolio/database exec prisma db push';
    console.error(`  ${example}`);
    throw new Error(`Database setup failed: ${migrationError}`);
  }

  try {
    // Generate Prisma client only when explicitly requested (avoid dev watch loops)
    const shouldGenerate =
      options?.generateClient === true || process.env.PRISMA_GENERATE === 'true';
    if (shouldGenerate) {
      const schemaArg = schemaPath ? ` --schema ${schemaPath}` : '';
      const generateCommand = `${cmd} generate${schemaArg}`;
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
