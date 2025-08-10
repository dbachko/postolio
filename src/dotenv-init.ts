import dotenv from 'dotenv'
import { getDatabaseUrl } from './config/database.js'

dotenv.config()

// Set DATABASE_URL from individual database components if not already set
if (!process.env.DATABASE_URL && process.env.DB_USERNAME) {
  process.env.DATABASE_URL = getDatabaseUrl()
}
