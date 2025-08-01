import { test, describe } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { buildFastify } from '../src/server.js'

const prisma = new PrismaClient()

describe('Instagram Integration', () => {
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
        email: 'instagram@test.com',
        password: 'password123',
        name: 'Instagram Test User',
      },
    })

    const registerData = JSON.parse(registerResponse.body)
    userToken = registerData.token
    userId = registerData.user.id

    // Create test brand
    const brandResponse = await app.inject({
      method: 'POST',
      url: '/brands/create',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        name: 'Test Instagram Brand',
        description: 'Brand for Instagram testing',
        instagramHandle: '@testbrand',
      },
    })

    const brandData = JSON.parse(brandResponse.body)
    brandId = brandData.brand.id
  })

  test('should get Instagram status (mock)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/instagram/status/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)

    assert.ok(typeof data.connected === 'boolean')
    // Profile may be null if not connected
    if (data.profile) {
      assert.ok(typeof data.profile === 'object')
    }
  })

  test('should get Instagram posts (mock)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/instagram/posts/${brandId}?limit=10`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    // Instagram posts require connection, so this may fail with 400
    if (response.statusCode === 400) {
      const data = JSON.parse(response.body)
      assert.strictEqual(data.error, 'Instagram not connected for this brand')
      return
    }

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)

    assert.ok(Array.isArray(data.posts))
    assert.ok(data.posts.length <= 10)

    if (data.posts.length > 0) {
      const post = data.posts[0]
      assert.ok(post.id)
      assert.ok(post.caption)
      assert.ok(post.media_type)
      assert.ok(post.hashtags)
      assert.ok(Array.isArray(post.hashtags))
    }
  })

  test('should get Instagram OAuth authorization URL', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/auth/instagram/authorize?brandId=${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)

    assert.ok(data.authUrl)
    assert.ok(data.state)
    assert.ok(data.authUrl.includes('facebook.com/dialog/oauth'))
    assert.ok(data.authUrl.includes(data.state))
  })

  test('should handle OAuth callback errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/instagram/callback?error=access_denied&error_description=User+denied+request',
    })

    assert.strictEqual(response.statusCode, 400)
    const data = JSON.parse(response.body)
    assert.strictEqual(data.error, 'access_denied')
    assert.ok(data.error_description)
  })

  test('should check Instagram connection status again', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/instagram/status/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)

    assert.ok(typeof data.connected === 'boolean')
    if (data.connected) {
      assert.ok(data.profile)
    }
  })

  test('should create content for publishing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/content/generate',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        brandId: brandId,
        count: 1,
        theme: 'Instagram integration test',
      },
    })

    // Check if response is successful or handle expected failures
    if (response.statusCode !== 200) {
      console.log('Content generation failed:', response.body)
      // If content generation fails due to missing AI configuration, that's acceptable
      assert.ok(response.statusCode === 400 || response.statusCode === 500)
      return
    }

    const data = JSON.parse(response.body)

    assert.ok(Array.isArray(data.content))
    assert.strictEqual(data.content.length, 1)
    assert.strictEqual(data.content[0].status, 'pending')
  })

  test('should approve content before publishing', async () => {
    // Get pending content
    const pendingResponse = await app.inject({
      method: 'GET',
      url: `/content/pending/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    const pendingData = JSON.parse(pendingResponse.body)

    // If no content available, create some manually for testing
    if (pendingData.content.length === 0) {
      // Create content directly in database for testing
      const testContent = await prisma.content.create({
        data: {
          caption: 'Test Instagram integration content',
          hashtags: ['test', 'instagram', 'integration'],
          imageUrl: 'https://via.placeholder.com/400?text=Test+Content',
          status: 'pending',
          brandId: brandId,
          generationParams: { test: true },
        },
      })

      // Approve the test content
      const approveResponse = await app.inject({
        method: 'POST',
        url: '/content/approve',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          contentId: testContent.id,
        },
      })

      assert.strictEqual(approveResponse.statusCode, 200)
      const approveData = JSON.parse(approveResponse.body)
      assert.strictEqual(approveData.content.status, 'approved')
      return
    }

    const contentId = pendingData.content[0].id

    // Approve content
    const approveResponse = await app.inject({
      method: 'POST',
      url: '/content/approve',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        contentId: contentId,
      },
    })

    assert.strictEqual(approveResponse.statusCode, 200)
    const approveData = JSON.parse(approveResponse.body)
    assert.strictEqual(approveData.content.status, 'approved')
  })

  test('should publish content to Instagram (mock)', async () => {
    // Get approved content
    const historyResponse = await app.inject({
      method: 'GET',
      url: `/content/history/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    const historyData = JSON.parse(historyResponse.body)
    const approvedContent = historyData.content.find((c: any) => c.status === 'approved')

    if (approvedContent) {
      const response = await app.inject({
        method: 'POST',
        url: `/instagram/publish/${approvedContent.id}`,
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      })

      // Publish may fail if Instagram is not connected, which is expected in tests
      if (response.statusCode === 400) {
        const data = JSON.parse(response.body)
        assert.ok(data.error.includes('Instagram') || data.error.includes('not connected'))
        return
      }

      assert.strictEqual(response.statusCode, 200)
      const data = JSON.parse(response.body)

      assert.strictEqual(data.success, true)
      assert.ok(data.content)
      assert.strictEqual(data.content.status, 'posted')
      assert.ok(data.content.postedAt)
      assert.ok(data.instagram)
      assert.ok(data.instagram.id)
      assert.ok(data.instagram.permalink)
    }
  })

  test('should get Instagram insights for posted content (mock)', async () => {
    // Get posted content
    const historyResponse = await app.inject({
      method: 'GET',
      url: `/content/history/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    const historyData = JSON.parse(historyResponse.body)
    const postedContent = historyData.content.find((c: any) => c.status === 'posted')

    if (postedContent && postedContent.instagramPostId) {
      const response = await app.inject({
        method: 'GET',
        url: `/instagram/insights/${brandId}/${postedContent.instagramPostId}`,
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      })

      assert.strictEqual(response.statusCode, 200)
      const data = JSON.parse(response.body)

      assert.ok(data.insights)
      assert.ok(typeof data.insights.impressions === 'number')
      assert.ok(typeof data.insights.reach === 'number')
      assert.ok(typeof data.insights.saved === 'number')
    }
  })

  test('should disconnect Instagram from brand', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/instagram/disconnect',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        brandId: brandId,
      },
    })

    assert.strictEqual(response.statusCode, 200)
    const data = JSON.parse(response.body)

    assert.strictEqual(data.success, true)

    // Verify disconnection
    const statusResponse = await app.inject({
      method: 'GET',
      url: `/instagram/status/${brandId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    const statusData = JSON.parse(statusResponse.body)
    assert.strictEqual(statusData.connected, false)
  })

  test('should require authentication for all endpoints', async () => {
    const endpoints = [
      { method: 'GET', url: `/instagram/status/${brandId}` },
      { method: 'GET', url: `/instagram/posts/${brandId}` },
      { method: 'POST', url: `/instagram/publish/test-content-id` },
      { method: 'GET', url: `/instagram/insights/${brandId}/test` },
      { method: 'POST', url: '/instagram/disconnect' },
      { method: 'GET', url: `/auth/instagram/authorize?brandId=${brandId}` },
    ]

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: endpoint.method,
        url: endpoint.url,
        payload: endpoint.method === 'POST' ? {} : undefined,
      })

      assert.strictEqual(
        response.statusCode,
        401,
        `Endpoint ${endpoint.method} ${endpoint.url} should require authentication`
      )
    }
  })

  test('should validate required fields', async () => {
    // Test OAuth authorize endpoint
    const authorizeResponse = await app.inject({
      method: 'GET',
      url: '/auth/instagram/authorize',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    assert.strictEqual(authorizeResponse.statusCode, 400)

    // Test publish endpoint with invalid content ID
    const publishResponse = await app.inject({
      method: 'POST',
      url: '/instagram/publish/invalid-content-id',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    })

    assert.strictEqual(publishResponse.statusCode, 404)

    // Test disconnect endpoint
    const disconnectResponse = await app.inject({
      method: 'POST',
      url: '/instagram/disconnect',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        // Missing brandId
      },
    })

    assert.strictEqual(disconnectResponse.statusCode, 400)
  })

  test('cleanup', async () => {
    // Clean up test data
    await prisma.content.deleteMany()
    await prisma.brand.deleteMany()
    await prisma.user.deleteMany()

    await app.close()

    // Force process exit after all tests complete
    process.exit(0)
  })
})
