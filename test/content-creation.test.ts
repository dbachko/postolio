import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { signJWT } from '../src/services/jwt.js'

const prisma = new PrismaClient()

// Test constants
const TEST_BASE64_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('Manual Content Creation', () => {
  let app: FastifyInstance
  let testUserId: string
  let testBrandId: string
  let authToken: string

  beforeEach(async () => {
    app = buildFastify()
    await app.ready()

    // Create test user and brand
    const user = await prisma.user.create({
      data: {
        email: 'test-content@example.com',
        password: 'hashed_password',
        name: 'Test User',
      },
    })
    testUserId = user.id

    const brand = await prisma.brand.create({
      data: {
        name: 'Test Brand',
        userId: testUserId,
        styleProfile: { tone: 'casual' },
      },
    })
    testBrandId = brand.id

    authToken = signJWT({ id: testUserId, email: 'test-content@example.com' })
  })

  afterEach(async () => {
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()
    await app.close()
  })

  test('should create manual content without AI generation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/create',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        brandId: testBrandId,
        caption: 'This is a manually created post',
        hashtags: ['#manual', '#test', '#post'],
      },
    })

    assert.strictEqual(response.statusCode, 201)
    
    const body = JSON.parse(response.body)
    assert.ok(body.content)
    assert.strictEqual(body.content.caption, 'This is a manually created post')
    assert.deepStrictEqual(body.content.hashtags, ['#manual', '#test', '#post'])
    assert.strictEqual(body.content.status, 'draft')
    assert.strictEqual(body.content.brandId, testBrandId)
    assert.strictEqual(body.content.generationParams, null)
  })

  test('should handle image upload for manual content', async () => {
    const base64Image = TEST_BASE64_IMAGE
    
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/create',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        brandId: testBrandId,
        caption: 'Post with image',
        hashtags: ['#image'],
        imageData: base64Image,
        mimeType: 'image/png',
      },
    })

    assert.strictEqual(response.statusCode, 201)
    
    const body = JSON.parse(response.body)
    assert.ok(body.content)
    // In a real test, we'd verify the S3 upload
    // For now, just verify the structure
    assert.strictEqual(body.content.caption, 'Post with image')
  })

  test('should require authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/content/create',
      payload: {
        brandId: testBrandId,
        caption: 'Test',
        hashtags: [],
      },
    })

    assert.strictEqual(response.statusCode, 401)
  })

  test('should verify brand ownership', async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: 'other@example.com',
        password: 'password',
        name: 'Other User',
      },
    })
    
    const otherBrand = await prisma.brand.create({
      data: {
        name: 'Other Brand',
        userId: otherUser.id,
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/content/create',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        brandId: otherBrand.id,
        caption: 'Test',
        hashtags: [],
      },
    })

    assert.strictEqual(response.statusCode, 404)
    
    const body = JSON.parse(response.body)
    assert.strictEqual(body.error, 'Brand not found')
  })
})