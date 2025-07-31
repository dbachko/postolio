import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { CampaignCoordinationService } from '../src/services/campaign-coordination.js'

const prisma = new PrismaClient()
const coordinationService = new CampaignCoordinationService()

describe('Campaign Coordination Service', () => {
  let userId: string
  let brandId1: string
  let brandId2: string

  beforeEach(async () => {
    // Clean up test data
    await prisma.content.deleteMany({})
    await prisma.campaign.deleteMany({})
    await prisma.brand.deleteMany({})
    await prisma.user.deleteMany({})

    // Create test user and brands
    const user = await prisma.user.create({
      data: {
        email: 'test@coordination.com',
        password: 'hashedpassword',
        name: 'Test User',
        subscriptionTier: 'pro'
      }
    })
    userId = user.id

    const brand1 = await prisma.brand.create({
      data: {
        name: 'Brand 1',
        userId,
        styleProfile: { style: 'professional' }
      }
    })
    brandId1 = brand1.id

    const brand2 = await prisma.brand.create({
      data: {
        name: 'Brand 2', 
        userId,
        styleProfile: { style: 'casual' }
      }
    })
    brandId2 = brand2.id
  })

  test('should detect scheduling conflicts between campaigns', async () => {
    // Create two campaigns with overlapping schedules
    const campaign1 = await prisma.campaign.create({
      data: {
        name: 'Campaign 1',
        brandId: brandId1,
        status: 'active',
        config: {
          duration: { start: '2025-02-01T00:00:00Z', end: '2025-02-07T00:00:00Z' },
          frequency: 'daily',
          postingTime: '10:00'
        },
        priority: 1
      }
    })

    const campaign2Config = {
      name: 'Campaign 2',
      brandId: brandId2,
      config: {
        duration: { start: '2025-02-03T00:00:00Z', end: '2025-02-09T00:00:00Z' },
        frequency: 'daily', 
        postingTime: '10:00'
      },
      priority: 2
    }

    // Test conflict detection
    const conflicts = await coordinationService.detectSchedulingConflicts(campaign2Config, userId)
    
    assert.strictEqual(conflicts.length > 0, true, 'Should detect scheduling conflicts')
    assert.strictEqual(conflicts[0].conflictingCampaignId, campaign1.id, 'Should identify conflicting campaign')
    assert.strictEqual(conflicts[0].conflictType, 'time_overlap', 'Should identify conflict type')
  })

  test('should resolve conflicts using campaign priority', async () => {
    const highPriorityCampaign = {
      name: 'High Priority Campaign',
      brandId: brandId1,
      config: {
        duration: { start: '2025-02-01T00:00:00Z', end: '2025-02-05T00:00:00Z' },
        frequency: 'daily',
        postingTime: '10:00'
      },
      priority: 1
    }

    const lowPriorityCampaign = {
      name: 'Low Priority Campaign', 
      brandId: brandId2,
      config: {
        duration: { start: '2025-02-02T00:00:00Z', end: '2025-02-06T00:00:00Z' },
        frequency: 'daily',
        postingTime: '10:00'
      },
      priority: 3
    }

    const resolution = await coordinationService.resolveSchedulingConflict(
      highPriorityCampaign,
      lowPriorityCampaign,
      userId
    )

    assert.strictEqual(resolution.strategy, 'adjust_lower_priority', 'Should adjust lower priority campaign')
    assert.notStrictEqual(resolution.adjustedPostingTime, '10:00', 'Should suggest different posting time')
  })

  test('should allocate AI generation resources across campaigns', async () => {
    // Create multiple active campaigns
    const campaigns = await Promise.all([
      prisma.campaign.create({
        data: {
          name: 'Campaign A',
          brandId: brandId1,
          status: 'active', 
          config: { frequency: 'daily', themes: ['tech', 'innovation'] },
          priority: 1
        }
      }),
      prisma.campaign.create({
        data: {
          name: 'Campaign B',
          brandId: brandId2,
          status: 'active',
          config: { frequency: 'daily', themes: ['lifestyle', 'wellness'] },
          priority: 2
        }
      })
    ])

    const allocation = await coordinationService.allocateGenerationResources(userId)

    assert.strictEqual(allocation.campaigns.length, 2, 'Should allocate resources to both campaigns')
    assert.strictEqual(allocation.campaigns[0].priority, 1, 'Should prioritize by campaign priority')
    assert.strictEqual(allocation.totalCapacity > 0, true, 'Should have positive generation capacity')
  })
})