import { test, expect, describe, beforeAll, afterAll } from 'vitest'
import { buildFastify } from '../src/server.js'
import { FastifyInstance } from 'fastify'

describe('Advanced AI Features', () => {
  let app: FastifyInstance
  let token: string
  let brandId: string

  beforeAll(async () => {
    app = buildFastify()
    await app.ready()

    // Login and get token
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'demo@example.com',
        password: 'demo123'
      }
    })
    const loginData = JSON.parse(loginResponse.body)
    token = loginData.token
    brandId = 'cmdjtfeaf0002iqkcvd1xciqh' // Demo brand
  })

  afterAll(async () => {
    await app?.close()
  })

  test('should optimize hashtags with AI', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/hashtags/optimize',
      headers: { authorization: `Bearer ${token}` },
      payload: { 
        brandId,
        content: 'Beautiful sunset photography session',
        currentHashtags: ['#photography', '#sunset']
      }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.optimizedHashtags).toBeInstanceOf(Array)
    expect(data.optimizedHashtags.length).toBeGreaterThan(0)
    expect(data.relevanceScore).toBeGreaterThan(0)
  })

  test('should analyze competitors', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/competitors/analyze',
      headers: { authorization: `Bearer ${token}` },
      payload: { 
        brandId,
        competitors: ['@competitor1', '@competitor2']
      }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.analysis).toBeDefined()
    expect(data.analysis.competitorInsights).toBeInstanceOf(Array)
    expect(data.analysis.recommendations).toBeInstanceOf(Array)
  })

  test('should suggest intelligent content ideas', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/content/suggestions',
      headers: { authorization: `Bearer ${token}` },
      payload: { 
        brandId,
        context: 'holiday season',
        contentType: 'post'
      }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.suggestions).toBeInstanceOf(Array)
    expect(data.suggestions.length).toBeGreaterThan(0)
    expect(data.suggestions[0].title).toBeDefined()
    expect(data.suggestions[0].description).toBeDefined()
  })

  test('should optimize posting schedule with AI', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/ai/schedule/optimize',
      headers: { authorization: `Bearer ${token}` },
      payload: { brandId }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.optimizedSchedule).toBeDefined()
    expect(data.optimizedSchedule.recommendedTimes).toBeInstanceOf(Array)
    expect(data.optimizedSchedule.frequency).toBeDefined()
  })
})