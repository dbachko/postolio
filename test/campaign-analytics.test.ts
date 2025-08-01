import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { CampaignAnalyticsService } from '../src/services/campaign-analytics.js'

const prisma = new PrismaClient()
const analyticsService = new CampaignAnalyticsService()

describe('Campaign Analytics Service', () => {
  let userId: string
  let brandId: string
  let campaignId1: string
  let campaignId2: string

  beforeEach(async () => {
    // Clean up test data
    await prisma.content.deleteMany({})
    await prisma.campaign.deleteMany({})
    await prisma.brand.deleteMany({})
    await prisma.user.deleteMany({})

    // Create test user and brand
    const user = await prisma.user.create({
      data: {
        email: 'analytics@test.com',
        password: 'hashedpassword',
        name: 'Analytics User',
        subscriptionTier: 'pro'
      }
    })
    userId = user.id

    const brand = await prisma.brand.create({
      data: {
        name: 'Analytics Brand',
        userId,
        styleProfile: { style: 'modern' }
      }
    })
    brandId = brand.id

    // Create test campaigns
    const campaign1 = await prisma.campaign.create({
      data: {
        name: 'Campaign A',
        brandId,
        status: 'active',
        config: {
          frequency: 'daily',
          themes: ['tech', 'innovation'],
          startDate: '2025-01-01',
          endDate: '2025-01-31'
        },
        priority: 1,
        startedAt: new Date('2025-01-01')
      }
    })
    campaignId1 = campaign1.id

    const campaign2 = await prisma.campaign.create({
      data: {
        name: 'Campaign B',
        brandId,
        status: 'active',
        config: {
          frequency: 'daily',
          themes: ['lifestyle'],
          startDate: '2025-01-01',
          endDate: '2025-01-31'
        },
        priority: 2,
        startedAt: new Date('2025-01-01')
      }
    })
    campaignId2 = campaign2.id

    // Create test content for campaigns
    await prisma.content.create({
      data: {
        caption: 'Campaign A Post 1',
        hashtags: ['tech', 'innovation'],
        brandId,
        campaignId: campaignId1,
        status: 'posted',
        scheduledAt: new Date('2025-01-02'),
        postedAt: new Date('2025-01-02'),
        generationParams: { impressions: 1000, engagement: 50, reach: 800 }
      }
    })

    await prisma.content.create({
      data: {
        caption: 'Campaign B Post 1',
        hashtags: ['lifestyle'],
        brandId,
        campaignId: campaignId2,
        status: 'posted',
        scheduledAt: new Date('2025-01-02'),
        postedAt: new Date('2025-01-02'),
        generationParams: { impressions: 500, engagement: 25, reach: 400 }
      }
    })
  })

  test('should calculate campaign performance metrics', async () => {
    const metrics = await analyticsService.getCampaignMetrics(campaignId1, userId)
    
    assert.strictEqual(typeof metrics.totalPosts, 'number')
    assert.strictEqual(typeof metrics.totalImpressions, 'number')
    assert.strictEqual(typeof metrics.totalEngagement, 'number')
    assert.strictEqual(typeof metrics.averageEngagementRate, 'number')
    assert.strictEqual(typeof metrics.reach, 'number')
    assert.ok(metrics.totalPosts >= 0)
  })

  test('should compare campaign performance', async () => {
    const comparison = await analyticsService.compareCampaigns([campaignId1, campaignId2], userId)
    
    assert.strictEqual(comparison.campaigns.length, 2)
    assert.ok(comparison.campaigns[0].metrics)
    assert.ok(comparison.campaigns[1].metrics)
    assert.ok(comparison.summary)
    assert.strictEqual(typeof comparison.topPerformer, 'string')
  })

  test('should generate optimization recommendations', async () => {
    const recommendations = await analyticsService.getOptimizationRecommendations(campaignId1, userId)
    
    assert.ok(Array.isArray(recommendations))
    assert.ok(recommendations.length >= 0)
    if (recommendations.length > 0) {
      assert.ok(recommendations[0].type)
      assert.ok(recommendations[0].message)
      assert.ok(recommendations[0].priority)
    }
  })

  test('should calculate ROI metrics', async () => {
    const roi = await analyticsService.calculateROI(campaignId1, userId)
    
    assert.strictEqual(typeof roi.estimatedValue, 'number')
    assert.strictEqual(typeof roi.engagementValue, 'number')
    assert.strictEqual(typeof roi.reachValue, 'number')
    assert.ok(roi.breakdown)
    assert.ok(roi.methodology)
  })
})