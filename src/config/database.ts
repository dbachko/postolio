/**
 * Database Configuration
 * Centralized database client management with test support
 */

import { PrismaClient } from '@prisma/client'

export function getDatabaseUrl(): string {
  const {
    DB_USERNAME,
    DB_PASSWORD,
    DB_HOST,
    DB_PORT,
    DB_NAME
  } = process.env

  if (!DB_USERNAME || !DB_PASSWORD || !DB_HOST || !DB_PORT || !DB_NAME) {
    throw new Error('Missing required database environment variables: DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME')
  }

  // URL encode the username and password to handle special characters
  const encodedUsername = encodeURIComponent(DB_USERNAME)
  const encodedPassword = encodeURIComponent(DB_PASSWORD)

  return `postgresql://${encodedUsername}:${encodedPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`
}

// Global database client instance
let prismaInstance: PrismaClient | null = null

/**
 * Get or create the database client instance
 */
export function getDatabaseClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient()
  }
  
  return prismaInstance
}

// Export the client instance for backward compatibility
export const prisma = getDatabaseClient()