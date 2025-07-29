import { test } from 'node:test'
import { AnalyticsCache } from '../src/services/analytics-cache.js'

test('AnalyticsCache - should store and retrieve account insights', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  const date = '2025-01-29'
  const data = { followers: 1000, impressions: 5000, reach: 3000 }
  
  await cache.setAccountInsights(brandId, date, data)
  const result = await cache.getAccountInsights(brandId, date)
  
  t.assert.deepStrictEqual(result, data)
})

test('AnalyticsCache - should store and retrieve media insights', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  const mediaId = 'media-456'
  const data = { impressions: 500, engagement: 25, saves: 10 }
  
  await cache.setMediaInsights(brandId, mediaId, data)
  const result = await cache.getMediaInsights(brandId, mediaId)
  
  t.assert.deepStrictEqual(result, data)
})

test('AnalyticsCache - should respect TTL for account insights (1 hour)', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  const date = '2025-01-29'
  const data = { followers: 1000, impressions: 5000, reach: 3000 }
  
  await cache.setAccountInsights(brandId, date, data)
  const ttl = await cache.getTTL(`analytics:account:${brandId}:${date}`)
  
  t.assert.ok(ttl <= 3600) // 1 hour
  t.assert.ok(ttl > 3500) // Allow some execution time
})

test('AnalyticsCache - should return null for expired/missing data', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const result = await cache.getAccountInsights('nonexistent', '2025-01-29')
  t.assert.strictEqual(result, null)
})

test('AnalyticsCache - should track rate limits correctly', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  
  const count1 = await cache.incrementRateLimit(brandId)
  const count2 = await cache.incrementRateLimit(brandId)
  
  t.assert.strictEqual(count1, 1)
  t.assert.strictEqual(count2, 2)
  
  const currentCount = await cache.getRateLimit(brandId)
  t.assert.strictEqual(currentCount, 2)
})

test('AnalyticsCache - should check data freshness correctly', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  const mediaId = 'media-456'
  
  // No data initially
  t.assert.strictEqual(await cache.isDataFresh(brandId, 'media', mediaId), false)
  
  // Add data
  await cache.setMediaInsights(brandId, mediaId, { impressions: 100, engagement: 5, reach: 80 })
  
  // Should be fresh now
  t.assert.strictEqual(await cache.isDataFresh(brandId, 'media', mediaId), true)
})

test('AnalyticsCache - should get cache status with metadata', async (t) => {
  const cache = new AnalyticsCache()
  t.after(async () => {
    await cache.clear()
    await cache.disconnect()
  })

  const brandId = 'test-brand-123'
  const today = new Date().toISOString().split('T')[0]
  
  // Add some data
  await cache.setAccountInsights(brandId, today, { followers: 1000, impressions: 5000, reach: 3000 })
  await cache.incrementRateLimit(brandId)
  
  const status = await cache.getCacheStatus(brandId)
  
  t.assert.strictEqual(status.rateLimitCount, 1)
  t.assert.ok(status.accountDataAge >= 0)
  t.assert.ok(status.lastUpdated)
})