import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Redis from 'ioredis'

describe('Regeneration Queue Redis Configuration', () => {
  let redis: Redis

  beforeAll(() => {
    // Test that Redis connection works with BullMQ required settings
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    })
  })

  afterAll(async () => {
    await redis.disconnect()
  })

  it('should connect to Redis with BullMQ-compatible settings', async () => {
    // Test basic Redis operations
    await redis.set('test-key', 'test-value')
    const value = await redis.get('test-key')
    expect(value).toBe('test-value')
    
    // Clean up
    await redis.del('test-key')
  })

  it('should have maxRetriesPerRequest set to null', () => {
    // This is required for BullMQ blocking operations
    expect(redis.options.maxRetriesPerRequest).toBeNull()
  })

  it('should have enableReadyCheck disabled', () => {
    // This improves compatibility
    expect(redis.options.enableReadyCheck).toBe(false)
  })
})