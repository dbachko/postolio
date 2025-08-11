import { execSync } from 'child_process'
import { getDatabaseClient } from './database.js'

export async function ensureDatabaseSchema(): Promise<void> {
  console.log('🔍 Checking database connection and schema...')
  
  const prisma = getDatabaseClient()
  
  try {
    // Try to connect to database and check if tables exist
    const result = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'brands', 'content', 'campaigns')
    `
    
    const tables = Array.isArray(result) ? result : []
    const requiredTables = ['users', 'brands', 'content', 'campaigns']
    const existingTables = tables.map((row: any) => row.table_name)
    const missingTables = requiredTables.filter(table => !existingTables.includes(table))
    
    if (missingTables.length > 0) {
      console.log(`⚠️  Missing database tables: ${missingTables.join(', ')}`)
      console.log('🚀 Running database migrations to create missing tables...')
      
      try {
        // Run migrations to create tables
        execSync('npx prisma db push', { 
          stdio: 'inherit',
          cwd: process.cwd()
        })
        console.log('✅ Database schema synchronized successfully')
      } catch (migrationError) {
        console.error('❌ Failed to run database migrations:', migrationError)
        throw new Error('Database setup failed. Please run "npx prisma db push" manually.')
      }
    } else {
      console.log('✅ All required database tables exist')
    }
    
    // Test basic connectivity
    await prisma.user.findFirst().catch(() => {
      // Ignore error, just testing connectivity
    })
    
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    throw new Error('Cannot connect to database. Please ensure PostgreSQL is running.')
  }
}