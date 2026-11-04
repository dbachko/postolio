import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

type PrismaInvocation = {
  cmd: string;
  cwd?: string;
  dbPkgDir?: string;
  configPath?: string;
};

type DbSetupStrategy = 'migrate' | 'db-push' | 'skip';

function logInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

function resolveSchemaPath(): string | undefined {
  const candidateSchemas = [
    path.resolve(process.cwd(), '../../libs/database/prisma/schema.prisma'),
    path.resolve(process.cwd(), 'packages/libs/database/prisma/schema.prisma'),
    path.resolve(process.cwd(), '../libs/database/prisma/schema.prisma'),
  ];
  return candidateSchemas.find((schemaPath) => fs.existsSync(schemaPath));
}

function resolvePrismaInvocation(schemaPath?: string): PrismaInvocation {
  const dbPkgDir = schemaPath ? path.resolve(schemaPath, '..', '..') : undefined;
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
}

function resolveDbSetupStrategy(): DbSetupStrategy {
  const runningInAws = Boolean(
    process.env.AWS_EXECUTION_ENV ||
    process.env.ECS_CONTAINER_METADATA_URI_V4 ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  );

  const strategyEnv = (process.env.DB_SETUP_STRATEGY || '').toLowerCase();
  if (['skip', 'none', 'disabled'].includes(strategyEnv)) {
    return 'skip';
  }
  if (strategyEnv === 'migrate') {
    return 'migrate';
  }
  if (strategyEnv === 'db-push' || strategyEnv === 'dbpush') {
    return 'db-push';
  }
  return runningInAws ? 'migrate' : 'db-push';
}

function runSchemaSync(params: { invocation: PrismaInvocation; schemaPath?: string }): void {
  const strategy = resolveDbSetupStrategy();
  if (strategy === 'skip') {
    logInfo(
      'ℹ️ DB_SETUP_STRATEGY=skip - skipping Prisma schema sync; relying on external migrations.'
    );
    return;
  }

  const args = strategy === 'db-push' ? 'db push' : 'migrate deploy';
  const schemaArg = params.schemaPath ? ` --schema ${params.schemaPath}` : '';
  const configArg = params.invocation.configPath ? ` --config ${params.invocation.configPath}` : '';
  const command = `${params.invocation.cmd} ${args}${schemaArg}${configArg}`;
  const cwd = params.invocation.cwd ?? process.cwd();

  logInfo(`🔧 Running (${strategy}): ${command}${cwd !== process.cwd() ? ` (cwd: ${cwd})` : ''}`);
  execSync(command, { stdio: 'inherit', cwd });
  logInfo('✅ Database schema synchronized successfully');
}

function printMigrationHelp(error: unknown): void {
  console.error('❌ Failed to run database migrations:', error);
  console.error('Attempted command failed. You can run manually, for example:');
  const strategyEnv = (process.env.DB_SETUP_STRATEGY || '').toLowerCase();
  const example =
    strategyEnv === 'db-push' || strategyEnv === 'dbpush'
      ? 'pnpm --filter @postolio/database exec prisma db push'
      : 'pnpm --filter @postolio/database exec prisma migrate deploy';
  console.error(`  ${example}`);
}

function generatePrismaClientIfRequested(params: {
  invocation: PrismaInvocation;
  schemaPath?: string;
  generateClient?: boolean;
}): void {
  const shouldGenerate = params.generateClient === true || process.env.PRISMA_GENERATE === 'true';
  if (!shouldGenerate) {
    return;
  }

  const schemaArg = params.schemaPath ? ` --schema ${params.schemaPath}` : '';
  const configArg = params.invocation.configPath ? ` --config ${params.invocation.configPath}` : '';
  const command = `${params.invocation.cmd} generate${schemaArg}${configArg}`;
  const cwd = params.invocation.dbPkgDir ?? params.invocation.cwd ?? process.cwd();

  logInfo(
    `🔄 Generating Prisma client: ${command}${params.invocation.dbPkgDir ? ` (cwd: ${cwd})` : ''}`
  );
  execSync(command, { stdio: 'inherit', cwd });
  logInfo('✅ Prisma client generated successfully');
}

async function verifyDatabaseConnectivity(): Promise<void> {
  const { getDatabaseClient } = await import('./database.js');
  const prisma = getDatabaseClient();
  await prisma.$queryRaw`SELECT 1`;
  logInfo('✅ Database connectivity verified');
}

export async function ensureDatabaseSchema(options?: { generateClient?: boolean }): Promise<void> {
  logInfo('🔍 Ensuring database schema and Prisma client...');
  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    console.warn(
      '⚠️  Prisma schema not found via known paths; proceeding without explicit --schema'
    );
  }

  const invocation = resolvePrismaInvocation(schemaPath);
  try {
    runSchemaSync({ invocation, schemaPath });
  } catch (migrationError) {
    printMigrationHelp(migrationError);
    throw new Error(`Database setup failed: ${migrationError}`, { cause: migrationError });
  }

  try {
    generatePrismaClientIfRequested({
      invocation,
      schemaPath,
      generateClient: options?.generateClient,
    });
  } catch (genError) {
    console.error('⚠️  Prisma client generation failed:', genError);
  }

  try {
    await verifyDatabaseConnectivity();
  } catch (error) {
    console.error('❌ Database connectivity check failed:', error);
    throw new Error('Cannot connect to database. Please ensure PostgreSQL is running.', {
      cause: error,
    });
  }
}
