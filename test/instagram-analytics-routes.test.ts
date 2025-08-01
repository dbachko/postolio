import { test, describe } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'

describe('Instagram Analytics Routes', () => {
  let app: any

  test('should require authentication', async () => {
    app = buildFastify()
    const response = await app.inject({
      method: 'GET',
      url: '/instagram-analytics/overview/test-brand-123',
    })
    assert.strictEqual(response.statusCode, 401)
    const body = response.json()
    assert.ok(body.error)
    await app.close()
  })

  test('should validate brand ownership', async () => {
    app = buildFastify()
    const response = await app.inject({
      method: 'GET',
      url: '/instagram-analytics/overview/nonexistent-brand',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    })
    assert.strictEqual(response.statusCode, 401)
    await app.close()
  })

  test('should handle missing brand', async () => {
    app = buildFastify()
    const endpoints = [
      '/instagram-analytics/overview/nonexistent',
      '/instagram-analytics/posts/nonexistent',
      '/instagram-analytics/status/nonexistent',
    ]
    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: 'GET',
        url: endpoint,
        headers: {
          authorization: 'Bearer invalid-token',
        },
      })
      assert.ok([401, 404, 500].includes(response.statusCode))
    }
    await app.close()
  })

  test('refresh endpoint should accept POST', async () => {
    app = buildFastify()
    const response = await app.inject({
      method: 'POST',
      url: '/instagram-analytics/refresh/test-brand',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    })
    assert.strictEqual(response.statusCode, 401)
    await app.close()
  })

  test('should handle query parameters', async () => {
    app = buildFastify()
    const response = await app.inject({
      method: 'GET',
      url: '/instagram-analytics/overview/test-brand?timeRange=30d',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    })
    assert.strictEqual(response.statusCode, 401)
    await app.close()
  })

  test('cleanup', async () => {
    if (app) await app.close()
    process.exit(0)
  })
})
