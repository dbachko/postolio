import { test, expect, describe, beforeAll, afterAll } from 'vitest'
import { buildFastify } from '../src/server.js'
import { FastifyInstance } from 'fastify'

describe('Growth Strategy Engine', () => {
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

  test('should analyze growth opportunities', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/growth/analyze',
      headers: { authorization: `Bearer ${token}` },
      payload: { brandId }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.analysis).toBeDefined()
    expect(data.analysis.opportunities).toBeInstanceOf(Array)
    expect(data.analysis.score).toBeGreaterThan(0)
  })

  test('should generate growth strategies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/growth/strategies',
      headers: { authorization: `Bearer ${token}` },
      payload: { 
        brandId,
        focus: 'engagement'
      }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.strategies).toBeInstanceOf(Array)
    expect(data.strategies.length).toBeGreaterThan(0)
    expect(data.strategies[0].title).toBeDefined()
    expect(data.strategies[0].actions).toBeInstanceOf(Array)
  })

  test('should get growth metrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/growth/metrics/${brandId}?period=30`,
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    const data = JSON.parse(response.body)
    expect(data.metrics).toBeDefined()
    expect(data.metrics.growthRate).toBeDefined()
    expect(data.metrics.reach).toBeDefined()
  })
})