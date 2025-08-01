import { test } from 'node:test'
import assert from 'node:assert'
import { AnalyticsCache } from '../src/services/analytics-cache.js'

test('AnalyticsCache suite', async (t) => {
  await t.test('should store and retrieve account insights', async () => {
    const cache = new AnalyticsCache()
    await cache.setAccountInsights('test-brand-123', '2025-01-29', { followers: 1000, impressions: 5000, reach: 3000 })
    const result = await cache.getAccountInsights('test-brand-123', '2025-01-29')
    assert.deepStrictEqual(result, { followers: 1000, impressions: 5000, reach: 3000 })
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should store and retrieve media insights', async () => {
    const cache = new AnalyticsCache()
    await cache.setMediaInsights('test-brand-123', 'media-456', {
      impressions: 500,
      engagement: 25,
      saves: 10,
      reach: 100,
    })
    const result = await cache.getMediaInsights('test-brand-123', 'media-456')
    assert.deepStrictEqual(result, { impressions: 500, engagement: 25, saves: 10, reach: 100 })
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should respect TTL for account insights (1 hour)', async () => {
    const cache = new AnalyticsCache()
    await cache.setAccountInsights('test-brand-123', '2025-01-29', { followers: 1000, impressions: 5000, reach: 3000 })
    const ttl = await cache.getTTL('analytics:account:test-brand-123:2025-01-29')
    assert.ok(ttl <= 3600)
    assert.ok(ttl > 3500)
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should return null for expired/missing data', async () => {
    const cache = new AnalyticsCache()
    const result = await cache.getAccountInsights('nonexistent', '2025-01-29')
    assert.strictEqual(result, null)
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should track rate limits correctly', async () => {
    const cache = new AnalyticsCache()
    const brandId = 'test-brand-123'
    const count1 = await cache.incrementRateLimit(brandId)
    const count2 = await cache.incrementRateLimit(brandId)
    assert.strictEqual(count1, 1)
    assert.strictEqual(count2, 2)
    const currentCount = await cache.getRateLimit(brandId)
    assert.strictEqual(currentCount, 2)
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should check data freshness correctly', async () => {
    const cache = new AnalyticsCache()
    const brandId = 'test-brand-123'
    const mediaId = 'media-456'
    assert.strictEqual(await cache.isDataFresh(brandId, 'media', mediaId), false)
    await cache.setMediaInsights(brandId, mediaId, { impressions: 100, engagement: 5, reach: 80 })
    assert.strictEqual(await cache.isDataFresh(brandId, 'media', mediaId), true)
    await cache.clear()
    await cache.disconnect()
  })

  await t.test('should get cache status with metadata', async () => {
    const cache = new AnalyticsCache()
    const brandId = 'test-brand-123'
    const today = new Date().toISOString().split('T')[0]
    await cache.setAccountInsights(brandId, today, { followers: 1000, impressions: 5000, reach: 3000 })
    await cache.incrementRateLimit(brandId)
    const status = await cache.getCacheStatus(brandId)
    assert.strictEqual(status.rateLimitCount, 1)
    assert.ok(status.accountDataAge >= 0)
    assert.ok(status.lastUpdated)
    await cache.clear()
    await cache.disconnect()
  })

  t.after(async () => {
    // Force process exit after all tests complete
    process.exit(0)
  })
})
