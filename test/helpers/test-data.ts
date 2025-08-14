import { PrismaClient, CampaignStatus } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

export interface TestUser {
  id: string
  email: string
  password: string
  name: string
}

export interface TestBrand {
  id: string
  name: string
  description: string
  userId: string
}

export interface TestCampaign {
  id: string
  name: string
  brandId: string
  status: CampaignStatus
  config: any
  priority: number
}

export async function createTestUser(data: Partial<TestUser> = {}): Promise<TestUser> {
  const hashedPassword = await bcrypt.hash(data.password || 'testpass123', 10)
  
  const user = await prisma.user.create({
    data: {
      email: data.email || `test-${Date.now()}@example.com`,
      password: hashedPassword,
      name: data.name || 'Test User',
    }
  })
  
  return {
    ...user,
    password: data.password || 'testpass123' // Return plain password for testing
  }
}

export async function createTestBrand(userId: string, data: Partial<TestBrand> = {}): Promise<TestBrand> {
  const brand = await prisma.brand.create({
    data: {
      name: data.name || `Test Brand ${Date.now()}`,
      description: data.description || 'Test brand description',
      userId,
    }
  })
  
  return brand
}

export async function createTestCampaign(brandId: string, data: Partial<TestCampaign> = {}): Promise<TestCampaign> {
  const campaign = await prisma.campaign.create({
    data: {
      name: data.name || `Test Campaign ${Date.now()}`,
      brandId,
      status: data.status || 'creating',
      config: data.config || {
        duration: {
          start: '2025-01-15T00:00:00Z',
          end: '2025-01-22T00:00:00Z'
        },
        frequency: 'daily',
        themes: ['lifestyle', 'inspirational'],
        style: 'modern',
        postingTime: '10:00'
      },
      priority: data.priority || 5,
    }
  })
  
  return campaign
}

export function generateAuthToken(userId: string): string {
  // Import JWT service to generate test tokens
  const jwt = require('jsonwebtoken')
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' })
}

export async function cleanup() {
  await prisma.content.deleteMany({})
  await prisma.campaign.deleteMany({})
  await prisma.brand.deleteMany({})
  await prisma.user.deleteMany({})
}