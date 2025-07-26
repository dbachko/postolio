import { test, describe } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { buildFastify } from '../src/server.js'

const prisma = new PrismaClient()

describe('Engagement Automation', () => {
  let app: any
  let userToken: string
  let userId: string
  let brandId: string

  test('setup', async () => {
    app = buildFastify()
    await app.ready()

    // Clean up test data
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()

    // Create test user
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'engagement@test.com',
        password: 'password123',
        name: 'Engagement Test User'
      }
    })

    const registerData = JSON.parse(registerResponse.body)
    userToken = registerData.token
    userId = registerData.user.id

    // Create test brand
    const brandResponse = await app.inject({
      method: 'POST',
      url: '/brands/create',
      headers: {
        authorization: `Bearer ${userToken}`
      },
      payload: {
        name: 'Test Engagement Brand',
        description: 'Brand for engagement testing'
      }
    })

    const brandData = JSON.parse(brandResponse.body)
    brandId = brandData.brand.id
  })

  test('should create engagement rules for brand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/engagement/rules',
      headers: {
        authorization: `Bearer ${userToken}`
      },
      payload: {
        brandId: brandId,
        rules: {
          autoLike: {
            enabled: true,
            targetHashtags: ['#photography', '#art'],
            maxLikesPerHour: 30
          },
          autoComment: {
            enabled: true,
            templates: ['Great shot! 📸', 'Love this! ❤️'],
            maxCommentsPerHour: 10
          },
          autoFollow: {
            enabled: false,
            maxFollowsPerHour: 5
          },
          autoUnfollow: {
            enabled: false,
            maxUnfollowsPerHour: 5,
            unfollowAfterDays: 7
          },
          safetyLimits: {
            maxActionsPerHour: 50,
            minDelayBetweenActions: 60,
            respectBusinessHours: true
          }
        }
      }
    })

    assert.strictEqual(response.statusCode, 201)
    const data = JSON.parse(response.body)
    
    assert.ok(data.success)
    assert.ok(data.rules)
    assert.strictEqual(data.rules.brandId, brandId)
    assert.strictEqual(data.rules.autoLike.enabled, true)
    assert.strictEqual(data.rules.autoComment.enabled, true)
    assert.strictEqual(data.rules.autoFollow.enabled, false)
    assert.strictEqual(data.rules.safetyLimits.maxActionsPerHour, 50)
  })

  test('should get engagement rules for brand', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/engagement/rules/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`
      }
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)
    
    assert.ok(data.rules)
    assert.strictEqual(data.rules.brandId, brandId)
    assert.strictEqual(data.rules.autoLike.enabled, true)
  })

  test('should validate engagement rules safety limits', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/engagement/rules',
      headers: {
        authorization: `Bearer ${userToken}`
      },
      payload: {
        brandId: brandId,
        rules: {
          autoLike: {
            enabled: true,
            targetHashtags: ['#test'],
            maxLikesPerHour: 100 // Too high
          },
          autoComment: {
            enabled: false,
            templates: [],
            maxCommentsPerHour: 0
          },
          autoFollow: {
            enabled: false,
            maxFollowsPerHour: 0
          },
          autoUnfollow: {
            enabled: false,
            maxUnfollowsPerHour: 0,
            unfollowAfterDays: 1
          },
          safetyLimits: {
            maxActionsPerHour: 50,
            minDelayBetweenActions: 60,
            respectBusinessHours: true
          }
        }
      }
    })

    assert.strictEqual(response.statusCode, 400)
    const data = JSON.parse(response.body)
    assert.ok(data.error)
    assert.ok(data.message.includes('cannot exceed'))
  })

  test('should get engagement status for brand', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/engagement/status/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`
      }
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)
    
    assert.ok(data.status)
    assert.strictEqual(data.status.configured, true)
    assert.strictEqual(data.status.active, false)
    assert.strictEqual(data.status.instagramConnected, false)
  })

  test('should get engagement statistics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/engagement/stats/${brandId}?days=7`,
      headers: {
        authorization: `Bearer ${userToken}`
      }
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)
    
    assert.ok(data.stats)
    assert.ok(typeof data.stats.totalActions === 'number')
    assert.ok(typeof data.stats.likes === 'number')
    assert.ok(typeof data.stats.comments === 'number')
    assert.ok(typeof data.stats.follows === 'number')
  })

  test('should require authentication for all endpoints', async () => {
    const endpoints = [
      { method: 'POST', url: '/engagement/rules' },
      { method: 'GET', url: `/engagement/rules/${brandId}` },
      { method: 'PUT', url: `/engagement/rules/${brandId}` },
      { method: 'DELETE', url: `/engagement/rules/${brandId}` },
      { method: 'GET', url: `/engagement/stats/${brandId}` },
      { method: 'POST', url: `/engagement/start/${brandId}` },
      { method: 'POST', url: `/engagement/stop/${brandId}` },
      { method: 'GET', url: `/engagement/status/${brandId}` }
    ]

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url,
        payload: endpoint.method === 'POST' || endpoint.method === 'PUT' ? {} : undefined
      })

      assert.strictEqual(response.statusCode, 401, 
        `Endpoint ${endpoint.method} ${endpoint.url} should require authentication`)
    }
  })

  test('cleanup', async () => {
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()
    
    await app.close()
  })
})