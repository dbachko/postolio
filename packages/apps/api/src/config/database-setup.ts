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
      AND table_name IN ('users', 'brands', 'content', 'campaigns', 'brand_style_profile_projection', 'sessions')
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
    ];
    const existingTables = tables.map((row) => row.table_name);
    const missingTables = requiredTables.filter((table) => !existingTables.includes(table));

    // Also check for required columns that recent releases depend on
    // Currently: users.themePreference, users.uiPreferences
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

        // Prefer globally-installed prisma CLI (baked into the container)
        const baseCmd = 'prisma migrate deploy --skip-generate';
        const migrateCommand = schemaPath ? `${baseCmd} --schema ${schemaPath}` : baseCmd;

        console.log(`🔧 Running: ${migrateCommand}`);
        execSync(migrateCommand, {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        console.log('✅ Database schema synchronized successfully');
      } catch (migrationError) {
        console.error('❌ Failed to run database migrations:', migrationError);
        console.error(
          'Migration command:',
          process.env.NODE_ENV === 'prod' ? 'prisma migrate deploy' : 'prisma db push'
        );
        throw new Error(`Database setup failed: ${migrationError}`);
      }
    } else {
      console.log('✅ All required database tables exist');
    }

    // Test basic connectivity
    await prisma.user.findFirst().catch(() => {
      // Ignore error, just testing connectivity
    });
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw new Error('Cannot connect to database. Please ensure PostgreSQL is running.');
  }
}
