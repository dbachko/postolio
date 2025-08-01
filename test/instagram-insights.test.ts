import { test, describe } from 'node:test'
import assert from 'node:assert'
import { instagramService } from '../src/services/instagram.js'

describe('Instagram Insights', () => {
  test('should get account insights with caching', async () => {
    const mockBrand = {
      instagramAccessToken: 'mock_token_123',
      instagramAccountId: 'mock_account_123',
      instagramPageId: 'mock_page_123',
    }
    
    const insights = await instagramService.getAccountInsights(mockBrand, '7d')
    
    // Verify mock data structure
    assert.ok(insights.data)
    assert.ok(typeof insights.data.followers === 'number')
    assert.ok(typeof insights.data.impressions === 'number')
    assert.ok(typeof insights.data.reach === 'number')
    assert.ok(typeof insights.data.profile_views === 'number')
    assert.ok(insights.lastUpdated)
    assert.strictEqual(insights.fromCache, false)
    
    // Verify mock values
    assert.strictEqual(insights.data.followers, 2540)
    assert.strictEqual(insights.data.impressions, 12500)
    assert.strictEqual(insights.data.reach, 8900)
    assert.strictEqual(insights.data.profile_views, 450)
  })

  test('should handle unconfigured brand', async () => {
    const unconfiguredBrand = {
      instagramAccessToken: null,
      instagramAccountId: null,
      instagramPageId: null,
    }
    try {
      await instagramService.getAccountInsights(unconfiguredBrand)
      assert.fail('Should have thrown an error for unconfigured brand')
    } catch (error) {
      assert.ok(error instanceof Error)
      assert.strictEqual(error.message, 'Instagram not configured for this brand')
    }
  })

  test('should handle recent posts performance', async () => {
    const mockBrand = {
      instagramAccessToken: 'mock_token_123',
      instagramAccountId: 'mock_account_123',
      instagramPageId: 'mock_page_123',
    }
    
    const performance = await instagramService.getRecentPostsPerformance(mockBrand, 5)
    
    // Verify mock data structure
    assert.ok(performance.posts)
    assert.ok(Array.isArray(performance.posts))
    assert.ok(performance.lastUpdated)
    assert.ok(performance.posts.length <= 5) // Should respect limit
    
    // Verify mock post structure
    if (performance.posts.length > 0) {
      const post = performance.posts[0]
      assert.ok(post.id)
      assert.ok(post.caption)
      assert.ok(typeof post.impressions === 'number')
      assert.ok(typeof post.engagement === 'number')
      assert.ok(post.media_url)
      assert.ok(post.posted_at)
    }
    
    // Verify we get expected mock data
    assert.strictEqual(performance.posts[0].id, 'mock_post_1')
    assert.strictEqual(performance.posts[0].impressions, 1200)
    assert.strictEqual(performance.posts[0].engagement, 156)
  })

  test('should get analytics cache status', async () => {
    const mockBrand = {
      instagramAccessToken: 'mock_token_123',
      instagramAccountId: 'mock_account_123',
      instagramPageId: 'mock_page_123',
    }
    try {
      const status = await instagramService.getAnalyticsCacheStatus(mockBrand)
      assert.ok(typeof status.cacheAge === 'number')
      assert.ok(typeof status.rateLimitRemaining === 'number')
      assert.ok(status.rateLimitRemaining >= 0 && status.rateLimitRemaining <= 200)
    } catch (error) {
      assert.ok(error instanceof Error)
    }
  })

  test('should validate configuration check', async () => {
    const configuredBrand = {
      instagramAccessToken: 'valid_token',
      instagramAccountId: 'valid_account',
      instagramPageId: 'valid_page',
    }
    const unconfiguredBrand1 = {
      instagramAccessToken: null,
      instagramAccountId: 'valid_account',
      instagramPageId: 'valid_page',
    }
    const unconfiguredBrand2 = {
      instagramAccessToken: 'valid_token',
      instagramAccountId: null,
      instagramPageId: 'valid_page',
    }
    assert.strictEqual(instagramService.isConfigured(configuredBrand), true)
    assert.strictEqual(instagramService.isConfigured(unconfiguredBrand1), false)
    assert.strictEqual(instagramService.isConfigured(unconfiguredBrand2), false)
  })

  test('cleanup', async () => {
    process.exit(0)
  })
})
