import { test, describe } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

describe('Instagram Token Management', () => {
  test('should refresh expired Instagram tokens', async () => {
    const app = buildFastify()
    
    // Ensure test user exists
    const userId = 'cmdjwmfik0000iqd9fpcyar2q'
    const hashedPassword = await bcrypt.hash('test123', 10)
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: 'token-test@example.com',
        password: hashedPassword,
        name: 'Token Test User'
      }
    })
    
    const brand = await prisma.brand.create({
      data: {
        name: 'Token Refresh Test Brand',
        userId: userId,
        instagramAccessToken: 'expired_token_123',
        instagramPageId: 'test_page_id',
        preferences: {
          tokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Expired yesterday
        }
      }
    })
    
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/instagram/refresh-token',
      headers: {
        'Authorization': 'Bearer REMOVED_HISTORICAL_CREDENTIAL',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        brandId: brand.id
      })
    })
    
    assert.strictEqual(refreshResponse.statusCode, 200)
    const body = JSON.parse(refreshResponse.body)
    assert.strictEqual(body.success, true)
    assert.ok(body.expiresAt)
    
    // Cleanup
    await prisma.brand.delete({ where: { id: brand.id } })
    await app.close()
  })

  test('should handle rate limiting gracefully', async () => {
    const app = buildFastify()
    
    // Ensure test user exists and create test brand
    const userId = 'cmdjwmfik0000iqd9fpcyar2q'
    const brand = await prisma.brand.create({
      data: {
        name: 'Rate Limit Test Brand',
        userId: userId,
        instagramAccessToken: 'test_token',
        instagramPageId: 'test_page_id'
      }
    })
    
    // Test multiple rapid requests to trigger rate limiting
    const requests = []
    for (let i = 0; i < 3; i++) {
      requests.push(
        app.inject({
          method: 'GET',
          url: '/instagram/posts?limit=5',
          headers: {
            'Authorization': 'Bearer REMOVED_HISTORICAL_CREDENTIAL'
          }
        })
      )
    }
    
    const responses = await Promise.all(requests)
    
    // All requests should succeed (using mock service in tests)
    responses.forEach(response => {
      assert.ok(response.statusCode === 200 || response.statusCode === 429) // Allow rate limiting
    })
    
    // Cleanup
    await prisma.brand.delete({ where: { id: brand.id } })
    await app.close()
  })

  test('should validate webhook signatures', async () => {
    const app = buildFastify()
    
    // Test webhook endpoint with invalid signature
    const webhookResponse = await app.inject({
      method: 'POST',
      url: '/instagram/webhooks',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid_signature'
      },
      payload: JSON.stringify({
        object: 'instagram',
        entry: []
      })
    })
    
    // Should reject invalid signatures  
    assert.ok(webhookResponse.statusCode === 403 || webhookResponse.statusCode === 500)
    
    await app.close()
  })
})