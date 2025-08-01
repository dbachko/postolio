import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import { PrismaClient } from '@prisma/client'
import { autopilotService } from '../src/services/autopilot.js'

describe('Autopilot Content Generation', () => {
  let app: any
  let prisma: PrismaClient
  let authToken: string
  let testUserId: string
  let testBrandId: string

  before(async () => {
    app = buildFastify()
    await app.ready()
    prisma = new PrismaClient()

    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: 'autopilot-test@example.com',
        password: 'hashedpassword',
        name: 'Autopilot Test User',
      },
    })
    testUserId = testUser.id

    // Generate JWT token for authentication
    const payload = { id: testUserId, email: testUser.email }
    authToken = app.jwt.sign(payload)

    // Create test brand with Instagram integration
    const testBrand = await prisma.brand.create({
      data: {
        name: 'Autopilot Test Brand',
        description: 'A test brand for autopilot functionality',
        userId: testUserId,
        instagramAccessToken: 'test_token',
        instagramPageId: 'test_page_id',
        styleProfile: {
          aestheticStyle: 'Modern',
          contentThemes: ['lifestyle', 'inspiration'],
          toneOfVoice: 'Friendly',
          targetAudience: 'Young professionals',
          brandPersonality: ['authentic', 'innovative'],
          colorPalette: ['blue', 'white'],
        },
        preferences: {
          contentStrategy: {
            themes: ['lifestyle', 'inspiration', 'behind-the-scenes'],
            postingFrequency: 'daily',
          },
        },
      },
    })
    testBrandId = testBrand.id
  })

  after(async () => {
    // Cleanup test data
    await prisma.content.deleteMany({
      where: { brandId: testBrandId },
    })
    await prisma.brand.deleteMany({
      where: { id: testBrandId },
    })
    await prisma.user.deleteMany({
      where: { id: testUserId },
    })
    await prisma.$disconnect()
    await app.close()
    // Force process exit after all tests complete
    process.exit(0)
  })

  test('should trigger manual autopilot generation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/autopilot/trigger',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, true)
    assert.ok(result.data.generated >= 0)
    assert.ok(result.data.timestamp)
    assert.ok(result.message)
  })

  test('should get autopilot status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/autopilot/status',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, true)
    assert.ok(result.data.brandStatuses)
    assert.ok(Array.isArray(result.data.brandStatuses))
    assert.strictEqual(typeof result.data.running, 'boolean')
  })

  test('should get content gaps analysis', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/autopilot/gaps',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, true)
    assert.ok(result.data.analysis)
    assert.ok(Array.isArray(result.data.analysis))
    assert.ok(result.data.summary)

    // Check that our test brand appears in the analysis
    const brandAnalysis = result.data.analysis.find((b: any) => b.brandId === testBrandId)
    assert.ok(brandAnalysis)
    assert.strictEqual(brandAnalysis.brandName, 'Autopilot Test Brand')
  })

  test('should update brand autopilot configuration', async () => {
    const config = {
      enabled: true,
      minDaysAhead: 10,
      maxContentPerGeneration: 3,
      contentStrategy: {
        themes: ['lifestyle', 'travel'],
        postingFrequency: 'every-other-day' as const,
        optimalTimes: [
          { hour: 9, minute: 0 },
          { hour: 18, minute: 30 },
        ],
      },
    }

    const response = await app.inject({
      method: 'PATCH',
      url: `/autopilot/brands/${testBrandId}/config`,
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify(config),
    })

    assert.strictEqual(response.statusCode, 200)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, true)
    assert.ok(result.message)
  })

  test('should get brand autopilot configuration', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/autopilot/brands/${testBrandId}/config`,
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.data.brandId, testBrandId)
    assert.strictEqual(result.data.brandName, 'Autopilot Test Brand')
    assert.ok(result.data.config)

    // Verify updated config
    const config = result.data.config
    assert.strictEqual(config.enabled, true)
    assert.strictEqual(config.minDaysAhead, 10)
    assert.strictEqual(config.maxContentPerGeneration, 3)
    assert.deepStrictEqual(config.contentStrategy.themes, ['lifestyle', 'travel'])
    assert.strictEqual(config.contentStrategy.postingFrequency, 'every-other-day')
  })

  test('should not allow access to other users brands', async () => {
    // Create another user and brand
    const otherUser = await prisma.user.create({
      data: {
        email: 'other-user@example.com',
        password: 'hashedpassword',
        name: 'Other User',
      },
    })

    const otherBrand = await prisma.brand.create({
      data: {
        name: 'Other Brand',
        userId: otherUser.id,
      },
    })

    // Try to access other brand's config
    const response = await app.inject({
      method: 'GET',
      url: `/autopilot/brands/${otherBrand.id}/config`,
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 404)

    const result = JSON.parse(response.payload)
    assert.strictEqual(result.success, false)
    assert.ok(result.message.includes('not found'))

    // Cleanup
    await prisma.brand.delete({ where: { id: otherBrand.id } })
    await prisma.user.delete({ where: { id: otherUser.id } })
  })

  test('should require authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/autopilot/status',
    })

    assert.strictEqual(response.statusCode, 401)
  })
})
