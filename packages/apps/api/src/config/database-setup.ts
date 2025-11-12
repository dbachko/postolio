import { execSync } from 'child_process';
import { getDatabaseClient } from './database.js';
import fs from 'fs';
import path from 'path';

interface TableRow {
  table_name: string;
}

export async function ensureDatabaseSchema(): Promise<void> {
  console.log('🔍 Checking database connection and schema...');

  const prisma = getDatabaseClient();

  try {
    // Try to connect to database and check if tables exist
    const result = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'users',
        'brands',
        'content',
        'campaigns',
        'brand_style_profile_projection',
        'sessions',
        -- analytics v2 tables (ensure these exist; triggers migration if missing)
        'social_accounts',
        'content_publications',
        'publication_metrics_latest',
        'metric_samples',
        'publication_comments',
        'account_metric_samples',
        'account_metrics_latest'
      )
    `;

    const tables: TableRow[] = Array.isArray(result)
      ? result.filter((r): r is TableRow => typeof (r as TableRow).table_name === 'string')
      : [];
    const requiredTables = [
      'users',
      'brands',
      'content',
      'campaigns',
      'brand_style_profile_projection',
      'sessions',
      // analytics v2
      'social_accounts',
      'content_publications',
      'publication_metrics_latest',
      'metric_samples',
      'publication_comments',
      'account_metric_samples',
      'account_metrics_latest',
      // inbox/saved replies
      'saved_replies',
    ];
    const existingTables = tables.map((row) => row.table_name);
    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));

    // Also check for required columns that recent releases depend on
    // Currently: users.themePreference, users.uiPreferences,
    // publication_comments.status/snoozedUntil/assigneeUserId
    type ColumnRow = { column_name: string };
    let missingColumns: string[] = [];
    try {
      const columnCheck = await prisma.$queryRaw<ColumnRow[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name IN ('themePreference', 'uiPreferences')
      `;
      const existingColumns = (Array.isArray(columnCheck) ? columnCheck : []).map(
        (r) => r.column_name
      );
      missingColumns = ['themePreference', 'uiPreferences'].filter(
        (c) => !existingColumns.includes(c)
      );
    } catch {
      // If this fails, proceed conservatively and attempt to sync schema below
      missingColumns = ['themePreference', 'uiPreferences'];
    }

    // publication_comments workflow columns (assignee/snooze removed)
    try {
      const pubCols = await prisma.$queryRaw<ColumnRow[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'publication_comments'
          AND column_name IN ('status')
      `;
      const exist = (Array.isArray(pubCols) ? pubCols : []).map((r) => r.column_name);
      for (const c of ['status']) {
        if (!exist.includes(c)) missingColumns.push(`publication_comments.${c}`);
      }
    } catch {
      missingColumns.push('publication_comments.status');
    }

    if (missingTables.length > 0 || missingColumns.length > 0) {
      if (missingTables.length > 0) {
        console.log(`⚠️  Missing database tables: ${missingTables.join(', ')}`);
      }
      if (missingColumns.length > 0) {
        console.log(`⚠️  Missing required columns: ${missingColumns.join(', ')}`);
      }
      console.log('🚀 Running database migrations to synchronize schema...');

      try {
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

        // Helper to resolve a reliable Prisma CLI invocation
        const resolvePrismaInvocation = (schema?: string): { cmd: string; cwd?: string } => {
          // Allow overriding via env var
          const envBin = process.env.PRISMA_BIN || process.env.PRISMA_CLI;
          if (envBin && fs.existsSync(envBin)) {
            return { cmd: `"${envBin}"`, cwd: process.cwd() };
          }

          // If we have a schema, try the local binary in the database package
          let dbPkgDir: string | undefined;
          if (schema) {
            // packages/libs/database/prisma/schema.prisma -> packages/libs/database
            dbPkgDir = path.resolve(schema, '..', '..');
            const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
            const localBin = path.join(dbPkgDir, 'node_modules', '.bin', binName);
            if (fs.existsSync(localBin)) {
              return { cmd: `"${localBin}"`, cwd: process.cwd() };
            }
          }

          // Prefer pnpm exec from the database package directory so resolution finds the workspace dep
          if (dbPkgDir && fs.existsSync(dbPkgDir)) {
            return { cmd: 'pnpm exec prisma', cwd: dbPkgDir };
          }

          // Fallback to npx which will use local if available
          return { cmd: 'npx prisma', cwd: process.cwd() };
        };

        // Prefer migrate deploy in prod; use db push in dev to keep DX smooth
        const useDbPush =
          process.env.NODE_ENV !== 'prod' && process.env.DB_SETUP_STRATEGY !== 'migrate';
        const args = useDbPush ? 'db push --skip-generate' : 'migrate deploy --skip-generate';
        const schemaArg = schemaPath ? ` --schema ${schemaPath}` : '';

        const { cmd, cwd } = resolvePrismaInvocation(schemaPath);
        const migrateCommand = `${cmd} ${args}${schemaArg}`;

        console.log(`🔧 Running: ${migrateCommand}${cwd && cwd !== process.cwd() ? ` (cwd: ${cwd})` : ''}`);
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
    } else {
      console.log('✅ All required database tables exist');
    }

    // Test basic connectivity without relying on generated model access
    // Some environments may have client generation timing issues; a raw query is sufficient
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw new Error('Cannot connect to database. Please ensure PostgreSQL is running.');
  }
}
