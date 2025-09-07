import { execSync } from "child_process";
import { getDatabaseClient } from "./database.js";

interface TableRow {
  table_name: string;
}

export async function ensureDatabaseSchema(): Promise<void> {
  console.log("🔍 Checking database connection and schema...");

  const prisma = getDatabaseClient();

  try {
    // Try to connect to database and check if tables exist
    const result = await prisma.$queryRaw<TableRow[]>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'brands', 'content', 'campaigns')
    `;

    const tables: TableRow[] = Array.isArray(result)
      ? result.filter(
          (r): r is TableRow => typeof (r as TableRow).table_name === "string",
        )
      : [];
    const requiredTables = ["users", "brands", "content", "campaigns"];
    const existingTables = tables.map((row) => row.table_name);
    const missingTables = requiredTables.filter(
      (table) => !existingTables.includes(table),
    );

    if (missingTables.length > 0) {
      console.log(`⚠️  Missing database tables: ${missingTables.join(", ")}`);
      console.log("🚀 Running database migrations to create missing tables...");

      try {
        // Use migrate deploy in production, db push in development
        const migrateCommand =
          process.env.NODE_ENV === "production"
            ? "npx prisma migrate deploy"
            : "npx prisma db push";

        console.log(`🔧 Running: ${migrateCommand}`);
        execSync(migrateCommand, {
          stdio: "inherit",
          cwd: process.cwd(),
        });
        console.log("✅ Database schema synchronized successfully");
      } catch (migrationError) {
        console.error("❌ Failed to run database migrations:", migrationError);
        console.error(
          "Migration command:",
          process.env.NODE_ENV === "production"
            ? "prisma migrate deploy"
            : "prisma db push",
        );
        throw new Error(`Database setup failed: ${migrationError}`);
      }
    } else {
      console.log("✅ All required database tables exist");
    }

    // Test basic connectivity
    await prisma.user.findFirst().catch(() => {
      // Ignore error, just testing connectivity
    });
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw new Error(
      "Cannot connect to database. Please ensure PostgreSQL is running.",
    );
  }
}
