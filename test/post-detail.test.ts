import test from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('Post Detail API', async (t) => {
  let app: FastifyInstance
  let authToken: string
  let userId: string
  let brandId: string
  let postId: string

  t.before(async () => {
    app = buildFastify()
    await app.ready()

    // Clean up database
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()

    // Create test user
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User'
      }
    })

    const registerData = JSON.parse(registerResponse.body)
    authToken = registerData.token
    if (!authToken) {
      throw new Error(`Failed to get authToken from response: ${JSON.stringify(registerData)}`)
    }
    userId = registerData.user?.id
    if (!userId) {
      throw new Error(`Failed to get userId from response: ${JSON.stringify(registerData)}`)
    }

    // Create test brand
    const brandResponse = await app.inject({
      method: 'POST',
      url: '/api/brands/create',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test Brand',
        description: 'Test brand description'
      }
    })

    const brandData = JSON.parse(brandResponse.body)
    brandId = brandData.brand?.id || brandData.data?.id || brandData.id
    
    if (!brandId) {
      throw new Error(`Failed to get brandId from response: ${JSON.stringify(brandData)}`)
    }

    // Create test post with campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Test Campaign',
        brandId,
        status: 'active',
        config: {},
        priority: 5
      }
    })

    const content = await prisma.content.create({
      data: {
        brandId,
        campaignId: campaign.id,
        caption: 'Test post caption with hashtags',
        hashtags: ['#test', '#content', '#postolio'],
        imageUrl: 'https://example.com/image.jpg',
        status: 'scheduled',
        scheduledAt: new Date('2025-02-01T10:00:00Z'),
        generationParams: {
          theme: 'lifestyle',
          style: 'modern'
        }
      }
    })
    postId = content.id
  })

  t.after(async () => {
    await prisma.content.deleteMany()
    await prisma.campaign.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()
    await app.close()
  })

  await t.test('GET /api/posts/:postId/detail - should return comprehensive post data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/detail`,
      headers: { authorization: `Bearer ${authToken}` }
    })

    assert.strictEqual(response.statusCode, 200)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, true)
    
    // Basic post data
    assert.strictEqual(body.data.id, postId)
    assert.strictEqual(body.data.caption, 'Test post caption with hashtags')
    assert.deepStrictEqual(body.data.hashtags, ['#test', '#content', '#postolio'])
    assert.strictEqual(body.data.imageUrl, 'https://example.com/image.jpg')
    assert.strictEqual(body.data.status, 'scheduled')
    
    // Relations
    assert.ok(body.data.brand)
    assert.strictEqual(body.data.brand.id, brandId)
    assert.strictEqual(body.data.brand.name, 'Test Brand')
    
    assert.ok(body.data.campaign)
    assert.strictEqual(body.data.campaign.name, 'Test Campaign')
    assert.strictEqual(body.data.campaign.status, 'active')
    
    // Additional metadata
    assert.ok(body.data.generationParams)
    assert.strictEqual(body.data.generationParams.theme, 'lifestyle')
    assert.strictEqual(body.data.generationParams.style, 'modern')
  })

  await t.test('GET /api/posts/:postId/detail - should return 404 for non-existent post', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/posts/non-existent-id/detail',
      headers: { authorization: `Bearer ${authToken}` }
    })

    assert.strictEqual(response.statusCode, 404)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, 'Post not found')
  })

  await t.test('GET /api/posts/:postId/detail - should require authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/detail`
    })

    assert.strictEqual(response.statusCode, 401)
  })

  await t.test('GET /api/posts/:postId/insights - should return Instagram metrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/insights`,
      headers: { authorization: `Bearer ${authToken}` }
    })

    // For now, expect 200 with empty metrics since post isn't published
    assert.strictEqual(response.statusCode, 200)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, true)
    assert.ok(body.data)
    assert.ok(body.data.metrics)
  })

  await t.test('GET /api/posts/:postId/comments - should return paginated comments', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/posts/${postId}/comments`,
      headers: { authorization: `Bearer ${authToken}` }
    })

    assert.strictEqual(response.statusCode, 200)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, true)
    assert.ok(body.data)
    assert.ok(Array.isArray(body.data.comments))
    assert.ok(body.data.pagination)
    assert.strictEqual(body.data.pagination.total, 0) // No comments initially
  })
})