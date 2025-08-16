import test from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('Content Detail API', async (t) => {
  let app: FastifyInstance
  let authToken: string
  let userId: string
  let brandId: string
  let contentId: string

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

    // Create test content
    const content = await prisma.content.create({
      data: {
        brandId,
        caption: 'Test post caption',
        hashtags: ['#test', '#content'],
        imageUrl: 'https://example.com/image.jpg',
        status: 'draft',
        scheduledAt: new Date('2025-02-01T10:00:00Z')
      }
    })
    contentId = content.id
  })

  t.after(async () => {
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()
    await app.close()
  })

  await t.test('GET /api/content/:contentId - should return content details', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/content/${contentId}`,
      headers: { authorization: `Bearer ${authToken}` }
    })

    assert.strictEqual(response.statusCode, 200)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.id, contentId)
    assert.strictEqual(body.data.caption, 'Test post caption')
    assert.deepStrictEqual(body.data.hashtags, ['#test', '#content'])
    assert.strictEqual(body.data.imageUrl, 'https://example.com/image.jpg')
    assert.strictEqual(body.data.status, 'draft')
    assert.ok(body.data.brand)
    assert.strictEqual(body.data.brand.id, brandId)
  })

  await t.test('GET /api/content/:contentId - should return 404 for non-existent content', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/content/non-existent-id',
      headers: { authorization: `Bearer ${authToken}` }
    })

    assert.strictEqual(response.statusCode, 404)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, 'Content not found')
  })

  await t.test('GET /api/content/:contentId - should require authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/content/${contentId}`
    })

    assert.strictEqual(response.statusCode, 401)
  })

  await t.test('GET /api/content/:contentId - should not allow access to other users content', async () => {
    // Create another user
    const otherUserResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'other@example.com',
        password: 'password123',
        name: 'Other User'
      }
    })

    const otherUserData = JSON.parse(otherUserResponse.body)
    const otherToken = otherUserData.data?.token || otherUserData.token

    const response = await app.inject({
      method: 'GET',
      url: `/api/content/${contentId}`,
      headers: { authorization: `Bearer ${otherToken}` }
    })

    assert.strictEqual(response.statusCode, 403)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.success, false)
    assert.strictEqual(body.error, 'Access denied')
  })
})