import { test } from 'node:test'
import assert from 'node:assert'
import fastify from 'fastify'
import monitoringRoutes from '../src/routes/monitoring.js'
import { monitoringService } from '../src/services/monitoring.js'
import { trackRequest, logResponse } from '../src/plugins/monitoring.js'

// Simple test app for monitoring routes only
function buildTestApp() {
  const app = fastify({ logger: false })
  app.register(monitoringRoutes, { prefix: '/monitoring' })
  return app
}

test('Monitoring system integration', async (t) => {
  const app = buildTestApp()
  
  await t.test('tracks requests using monitoring functions', async () => {
    // Clear any previous data
    monitoringService.clear()
    
    // Simulate tracking a request manually
    const mockRequest = { url: '/test', method: 'GET', user: { id: 'test-user' } }
    const mockReply = { statusCode: 200 }
    
    trackRequest(mockRequest)
    logResponse(mockRequest, mockReply)
    
    const metrics = monitoringService.getMetrics()
    assert.strictEqual(metrics.length, 1, 'Should track the request')
    assert.strictEqual(metrics[0].method, 'GET')
    assert.strictEqual(metrics[0].statusCode, 200)
    assert.strictEqual(metrics[0].userId, 'test-user')
    assert.ok(metrics[0].responseTime >= 0)
  })
  
  await t.test('logs error requests', async () => {
    // Clear any previous data
    monitoringService.clear()
    
    // Simulate tracking an error request manually
    const mockRequest = { url: '/test-error', method: 'GET' }
    const mockReply = { statusCode: 500 }
    
    trackRequest(mockRequest)
    logResponse(mockRequest, mockReply)
    
    const errors = monitoringService.getErrors()
    assert.strictEqual(errors.length, 1, 'Should log the error')
    assert.strictEqual(errors[0].level, 'error')
    assert.strictEqual(errors[0].endpoint, '/test-error')
    assert.ok(errors[0].message.includes('500'))
  })
  
  await t.test('provides metrics endpoint', async () => {
    // Clear any previous data and add some test data
    monitoringService.clear()
    
    // Add some test metrics
    monitoringService.trackApiCall({
      endpoint: '/test',
      method: 'GET',
      statusCode: 200,
      responseTime: 50,
      userId: 'test-user'
    })
    
    const response = await app.inject({
      method: 'GET',
      url: '/api/monitoring/metrics'
    })
    
    assert.strictEqual(response.statusCode, 200)
    const body = JSON.parse(response.body)
    
    assert.ok(body.metrics)
    assert.ok(typeof body.metrics.totalRequests === 'number')
    assert.ok(typeof body.metrics.errorCount === 'number')
    assert.ok(typeof body.metrics.averageResponseTime === 'number')
  })
  
  await app.close()
})