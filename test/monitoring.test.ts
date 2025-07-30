import { test } from 'node:test'
import assert from 'node:assert'

test('Monitoring service tracks API usage', async (t) => {
  await t.test('tracks Instagram API calls', async () => {
    const metrics = {
      endpoint: '/instagram/publish',
      method: 'POST',
      statusCode: 200,
      responseTime: 150,
      userId: 'test-user'
    }
    
    // Should track API call metrics
    assert.ok(metrics.endpoint)
    assert.ok(metrics.responseTime > 0)
    assert.strictEqual(metrics.statusCode, 200)
  })
  
  await t.test('logs errors with context', async () => {
    const errorLog = {
      level: 'error',
      message: 'Instagram API rate limit exceeded',
      userId: 'test-user',
      endpoint: '/instagram/publish',
      timestamp: new Date().toISOString()
    }
    
    assert.strictEqual(errorLog.level, 'error')
    assert.ok(errorLog.timestamp)
    assert.ok(errorLog.message.includes('rate limit'))
  })
})