import { test, describe } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.js'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

describe('Instagram OAuth Integration', () => {
  test('should initiate OAuth authorization with brand ID', async () => {
    const app = buildFastify()
    
    // Create test user and brand (using the same ID as the JWT token)
    const userId = 'cmdjwmfik0000iqd9fpcyar2q'
    const hashedPassword = await bcrypt.hash('test123', 10)
    const user = await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: 'oauth-test@example.com',
        password: hashedPassword,
        name: 'OAuth Test User'
      }
    })
    
    const brand = await prisma.brand.create({
      data: {
        name: 'OAuth Test Brand',
        userId: user.id
      }
    })
    
    const authResponse = await app.inject({
      method: 'GET',
      url: `/auth/instagram/authorize?brandId=${brand.id}`,
      headers: {
        'Authorization': 'Bearer REMOVED_HISTORICAL_CREDENTIAL'
      }
    })
    
    assert.strictEqual(authResponse.statusCode, 200)
    const body = JSON.parse(authResponse.body)
    assert.ok(body.authUrl)
    assert.ok(body.state)
    assert.ok(body.authUrl.includes('https://www.facebook.com/dialog/oauth'))
    
    // Cleanup
    await prisma.brand.delete({ where: { id: brand.id } })
    await app.close()
  })

  test('should handle OAuth callback with code exchange', async () => {
    const app = buildFastify()
    
    // Create test user and brand with OAuth state
    const userId = 'cmdjwmfik0000iqd9fpcyar2q'
    const state = 'test_oauth_state_123'
    
    const brand = await prisma.brand.create({
      data: {
        name: 'OAuth Callback Test Brand',
        userId: userId,
        preferences: {
          oauthState: state,
          oauthStateExpires: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }
      }
    })
    
    const callbackResponse = await app.inject({
      method: 'POST',
      url: '/auth/instagram/callback',
      headers: {
        'Authorization': 'Bearer REMOVED_HISTORICAL_CREDENTIAL',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        code: 'mock_oauth_code',
        state: state
      })
    })
    
    // Should return success with mock profile in development
    assert.strictEqual(callbackResponse.statusCode, 200)
    const body = JSON.parse(callbackResponse.body)
    assert.strictEqual(body.success, true)
    assert.ok(body.profile)
    assert.ok(body.brand)
    
    // Cleanup
    await prisma.brand.delete({ where: { id: brand.id } })
    await app.close()
  })

  test('should require authentication for OAuth endpoints', async () => {
    const app = buildFastify()
    
    const response = await app.inject({
      method: 'GET',
      url: '/auth/instagram/authorize?brandId=test-brand-123'
    })
    
    assert.strictEqual(response.statusCode, 401)
    
    await app.close()
  })
})