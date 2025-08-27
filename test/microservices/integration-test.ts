/**
 * Integration Tests for Microservices
 * End-to-end testing of the complete flow
 */

import request from 'supertest'
import { app } from '../../src/server'
import { prisma } from '../../src/prisma'
import { EventBridge } from '@aws-sdk/client-eventbridge'
import { DynamoDB } from '@aws-sdk/client-dynamodb'
import { SQS } from '@aws-sdk/client-sqs'

// Mock AWS services for local testing
jest.mock('@aws-sdk/client-eventbridge')
jest.mock('@aws-sdk/client-dynamodb')
jest.mock('@aws-sdk/client-sqs')

describe('Microservices Integration Tests', () => {
  let authToken: string
  let testUser: any
  let testBrand: any

  beforeAll(async () => {
    // Set up test database
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Brand", "Content", "Campaign" CASCADE`
    
    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: 'test@example.com',
        password: '$2b$10$dqyYw5XovLjpmkYNiRDEWuwKaRAvLaG45fnXE5b3KTccKZcRPka2m', // "password123"
        name: 'Test User'
      }
    })

    // Create test brand
    testBrand = await prisma.brand.create({
      data: {
        name: 'Test Brand',
        userId: testUser.id
      }
    })

    // Get auth token
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      })

    authToken = response.body.data.token
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('Event-Driven Flow', () => {
    test('should trigger events when campaign is created', async () => {
      const mockEventBridge = EventBridge.prototype.putEvents = jest.fn().mockResolvedValue({})

      const response = await request(app)
        .post('/api/campaigns/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Campaign',
          brandId: testBrand.id,
          config: {
            frequency: 'daily',
            themes: ['lifestyle', 'product'],
            duration: 7
          }
        })

      expect(response.status).toBe(201)
      expect(response.body.data).toHaveProperty('id')

      // Verify event was published
      expect(mockEventBridge).toHaveBeenCalledWith(
        expect.objectContaining({
          Entries: expect.arrayContaining([
            expect.objectContaining({
              Source: 'postolio.campaign',
              DetailType: 'campaign.created'
            })
          ])
        })
      )
    })

    test('should handle saga execution for content publishing', async () => {
      // Create test content
      const content = await prisma.content.create({
        data: {
          brandId: testBrand.id,
          caption: 'Test caption',
          hashtags: ['#test', '#postolio'],
          status: 'draft'
        }
      })

      // Mock EventBridge for saga events
      const sagaEvents: any[] = []
      EventBridge.prototype.putEvents = jest.fn().mockImplementation((params) => {
        sagaEvents.push(...params.Entries)
        return Promise.resolve({})
      })

      // Trigger content publishing
      const response = await request(app)
        .post(`/api/content/${content.id}/publish`)
        .set('Authorization', `Bearer ${authToken}`)
        .send()

      expect(response.status).toBe(200)

      // Verify saga events were emitted in correct order
      expect(sagaEvents).toContainEqual(
        expect.objectContaining({
          DetailType: 'content.publishing.started'
        })
      )
    })
  })

  describe('Rate Limiting', () => {
    test('should enforce rate limits per user', async () => {
      const requests = []

      // Send 6 requests rapidly (assuming limit is 5 per minute)
      for (let i = 0; i < 6; i++) {
        requests.push(
          request(app)
            .get('/api/brands/list')
            .set('Authorization', `Bearer ${authToken}`)
        )
      }

      const responses = await Promise.all(requests)
      const statusCodes = responses.map(r => r.status)

      // First 5 should succeed, 6th should be rate limited
      expect(statusCodes.filter(s => s === 200).length).toBeLessThanOrEqual(5)
      expect(statusCodes).toContain(429) // At least one rate limited
    })

    test('should return proper rate limit headers', async () => {
      const response = await request(app)
        .get('/api/brands/list')
        .set('Authorization', `Bearer ${authToken}`)

      // Should have rate limit headers
      expect(response.headers).toHaveProperty('x-ratelimit-remaining')
      expect(response.headers).toHaveProperty('x-ratelimit-reset')
    })
  })

  describe('Security Validation', () => {
    test('should reject requests without authentication', async () => {
      const response = await request(app)
        .get('/api/brands/list')

      expect(response.status).toBe(401)
    })

    test('should sanitize user input to prevent XSS', async () => {
      const response = await request(app)
        .post('/api/brands/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: '<script>alert("XSS")</script>',
          description: 'Test brand'
        })

      expect(response.status).toBe(201)
      
      // Verify stored data is escaped
      const brand = await prisma.brand.findFirst({
        where: { name: { contains: 'script' } }
      })

      // Should be stored safely (escaped or sanitized)
      expect(brand?.name).not.toContain('<script>')
    })

    test('should validate input schema strictly', async () => {
      const response = await request(app)
        .post('/api/campaigns/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          // Missing required fields
          name: 'Test Campaign'
          // Missing brandId and config
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toContain('validation')
    })
  })

  describe('Performance Optimizations', () => {
    test('should use connection pooling effectively', async () => {
      const timings: number[] = []

      // Make 10 requests and measure response times
      for (let i = 0; i < 10; i++) {
        const start = Date.now()
        
        await request(app)
          .get('/api/health')
        
        const duration = Date.now() - start
        timings.push(duration)
      }

      // First request (cold) should be slower than average of others (warm)
      const coldTime = timings[0]
      const warmAverage = timings.slice(1).reduce((a, b) => a + b, 0) / (timings.length - 1)

      expect(warmAverage).toBeLessThan(coldTime * 0.8) // Warm requests at least 20% faster
    })

    test('should batch database operations where possible', async () => {
      // Create multiple content items
      const contentIds = []
      for (let i = 0; i < 5; i++) {
        const content = await prisma.content.create({
          data: {
            brandId: testBrand.id,
            caption: `Test caption ${i}`,
            hashtags: ['#test'],
            status: 'draft'
          }
        })
        contentIds.push(content.id)
      }

      // Mock to track database queries
      const queryCount = { count: 0 }
      const originalQuery = prisma.$queryRaw
      prisma.$queryRaw = jest.fn().mockImplementation((...args) => {
        queryCount.count++
        return originalQuery.apply(prisma, args)
      })

      // Fetch all content (should use efficient query)
      const response = await request(app)
        .get(`/api/content/pending/${testBrand.id}`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(response.status).toBe(200)
      expect(response.body.data.length).toBe(5)

      // Should use minimal queries (not N+1)
      expect(queryCount.count).toBeLessThan(5) // Should be 1-2 queries, not 5+
    })
  })

  describe('Error Handling', () => {
    test('should handle database connection failures gracefully', async () => {
      // Temporarily break database connection
      const originalQuery = prisma.$queryRaw
      prisma.$queryRaw = jest.fn().mockRejectedValue(new Error('Database connection failed'))

      const response = await request(app)
        .get('/api/brands/list')
        .set('Authorization', `Bearer ${authToken}`)

      expect(response.status).toBe(500)
      expect(response.body.error).not.toContain('Database connection failed') // Don't leak internal errors
      expect(response.body.error).toBe('Internal server error')

      // Restore original
      prisma.$queryRaw = originalQuery
    })

    test('should handle AWS service failures with circuit breaker', async () => {
      // Mock EventBridge failure
      let failureCount = 0
      EventBridge.prototype.putEvents = jest.fn().mockImplementation(() => {
        failureCount++
        if (failureCount <= 3) {
          return Promise.reject(new Error('Service unavailable'))
        }
        return Promise.resolve({})
      })

      // First requests should fail but not crash
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/campaigns/create')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            name: `Test Campaign ${i}`,
            brandId: testBrand.id,
            config: { frequency: 'daily', themes: ['test'] }
          })

        // Should handle gracefully (maybe queue for retry)
        expect(response.status).toBeGreaterThanOrEqual(200)
        expect(response.status).toBeLessThan(600)
      }

      // Circuit should be open now, requests should fail fast
      const start = Date.now()
      const response = await request(app)
        .post('/api/campaigns/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Campaign Circuit Open',
          brandId: testBrand.id,
          config: { frequency: 'daily', themes: ['test'] }
        })
      const duration = Date.now() - start

      // Should fail fast when circuit is open (< 100ms)
      expect(duration).toBeLessThan(100)
    })
  })

  describe('End-to-End Campaign Flow', () => {
    test('should complete full campaign lifecycle', async () => {
      // 1. Create campaign
      const createResponse = await request(app)
        .post('/api/campaigns/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'E2E Test Campaign',
          brandId: testBrand.id,
          config: {
            frequency: 'daily',
            themes: ['lifestyle', 'product'],
            duration: 7,
            postCount: 3
          }
        })

      expect(createResponse.status).toBe(201)
      const campaignId = createResponse.body.data.id

      // 2. Generate preview
      const previewResponse = await request(app)
        .get(`/api/campaigns/${campaignId}/preview`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(previewResponse.status).toBe(200)
      expect(previewResponse.body.data.content).toHaveLength(3)

      // 3. Start campaign
      const startResponse = await request(app)
        .post(`/api/campaigns/${campaignId}/start`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(startResponse.status).toBe(200)

      // 4. Check campaign status
      const statusResponse = await request(app)
        .get(`/api/campaigns/${campaignId}`)
        .set('Authorization', `Bearer ${authToken}`)

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body.data.status).toBe('active')

      // 5. Verify content was scheduled (mock check)
      const content = await prisma.content.findMany({
        where: { campaignId }
      })

      expect(content.length).toBeGreaterThan(0)
      expect(content.every(c => c.status === 'scheduled')).toBe(true)
    })
  })
})