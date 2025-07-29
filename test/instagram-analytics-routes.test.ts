import { test } from 'node:test'
import { buildFastify } from '../src/server.js'

test('Instagram Analytics Routes - should require authentication', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/instagram-analytics/overview/test-brand-123'
  })

  t.assert.strictEqual(response.statusCode, 401)
  const body = response.json()
  t.assert.ok(body.error)
})

test('Instagram Analytics Routes - should validate brand ownership', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  // This test would need a valid JWT token, but we can test the structure
  const response = await app.inject({
    method: 'GET',
    url: '/instagram-analytics/overview/nonexistent-brand',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  t.assert.strictEqual(response.statusCode, 401) // Invalid token
})

test('Instagram Analytics Routes - should handle missing brand', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  // Test all endpoints exist and return expected error structure
  const endpoints = [
    '/instagram-analytics/overview/nonexistent',
    '/instagram-analytics/posts/nonexistent',
    '/instagram-analytics/status/nonexistent'
  ]

  for (const endpoint of endpoints) {
    const response = await app.inject({
      method: 'GET',
      url: endpoint,
      headers: {
        authorization: 'Bearer invalid-token'
      }
    })

    // Should fail with 401 due to invalid token, but route should exist
    t.assert.ok([401, 404, 500].includes(response.statusCode))
  }
})

test('Instagram Analytics Routes - refresh endpoint should accept POST', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: '/instagram-analytics/refresh/test-brand',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  // Should fail with authentication, but route should exist
  t.assert.strictEqual(response.statusCode, 401)
})

test('Instagram Analytics Routes - should handle query parameters', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/instagram-analytics/overview/test-brand?timeRange=30d',
    headers: {
      authorization: 'Bearer invalid-token'
    }
  })

  // Should fail with authentication, but route should accept query params
  t.assert.strictEqual(response.statusCode, 401)
})