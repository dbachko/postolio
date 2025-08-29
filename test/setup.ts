import { beforeAll, afterAll, beforeEach } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Test database setup
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postolio_test'
    }
  }
})

beforeAll(async () => {
  // Ensure test database is clean
  await cleanDatabase()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  // Clean database before each test to ensure isolation
  await cleanDatabase()
})

async function cleanDatabase() {
  // Delete in order to respect foreign key constraints
  await prisma.content.deleteMany({})
  await prisma.campaign.deleteMany({})
  await prisma.brand.deleteMany({})
  await prisma.user.deleteMany({})
}

export { prisma }