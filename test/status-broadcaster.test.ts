import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { StatusBroadcaster } from '../src/services/status-broadcaster.js'
import websocketPlugin from '../src/plugins/websocket.js'

describe('Status Broadcaster', () => {
  let app: FastifyInstance
  let broadcaster: StatusBroadcaster
  let redis: Redis

  beforeEach(async () => {
    app = Fastify({ logger: false })
    await app.register(websocketPlugin)
    await app.ready()
    
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1
    })
    
    broadcaster = new StatusBroadcaster(app, redis)
  })

  afterEach(async () => {
    await redis.flushdb()
    await redis.disconnect()
    await app.close()
  })

  test('should store status changes in Redis Stream', async () => {
    const contentId = 'test-content-123'
    const brandId = 'test-brand-456'
    
    await broadcaster.broadcastStatusChange(
      contentId,
      brandId,
      'draft',
      'scheduled',
      { scheduleId: 'schedule-789' }
    )

    // Check Redis Stream
    const events = await redis.xrange(`events:${brandId}`, '-', '+')
    assert.strictEqual(events.length, 1)
    
    const [eventId, fields] = events[0]
    const eventData = Object.fromEntries(
      fields.reduce((acc, val, idx) => {
        if (idx % 2 === 0) acc.push([val, fields[idx + 1]])
        return acc
      }, [] as Array<[string, string]>)
    )
    
    assert.strictEqual(eventData.type, 'status_change')
    assert.strictEqual(eventData.contentId, contentId)
    assert.strictEqual(eventData.oldStatus, 'draft')
    assert.strictEqual(eventData.newStatus, 'scheduled')
    
    const metadata = JSON.parse(eventData.metadata)
    assert.strictEqual(metadata.scheduleId, 'schedule-789')
  })

  test('should limit stream size to prevent memory issues', async () => {
    const brandId = 'test-brand-456'
    
    // Add many events
    for (let i = 0; i < 20; i++) {
      await broadcaster.broadcastStatusChange(
        `content-${i}`,
        brandId,
        'draft',
        'scheduled'
      )
    }

    // Check that stream is trimmed
    const events = await redis.xrange(`events:${brandId}`, '-', '+')
    assert.ok(events.length <= 10000, 'Stream should be trimmed to max 10000 events')
  })

  test('should retrieve recent events for a brand', async () => {
    const brandId = 'test-brand-456'
    
    // Add some events
    await broadcaster.broadcastStatusChange('content-1', brandId, 'draft', 'scheduled')
    await broadcaster.broadcastStatusChange('content-2', brandId, 'scheduled', 'published')
    await broadcaster.broadcastStatusChange('content-3', brandId, 'draft', 'failed')

    // Get recent events
    const recent = await broadcaster.getRecentEvents(brandId, 10)
    assert.strictEqual(recent.length, 3)
    
    // Check events are in reverse chronological order
    assert.strictEqual(recent[0].contentId, 'content-3')
    assert.strictEqual(recent[0].newStatus, 'failed')
    assert.strictEqual(recent[1].contentId, 'content-2')
    assert.strictEqual(recent[2].contentId, 'content-1')
  })

  test('should clean up old events after 7 days', async () => {
    const brandId = 'test-brand-456'
    const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000)
    
    // Add old event manually
    await redis.xadd(
      `events:${brandId}`,
      '*',
      'type', 'status_change',
      'contentId', 'old-content',
      'timestamp', eightDaysAgo.toString()
    )

    // Add recent event
    await broadcaster.broadcastStatusChange('new-content', brandId, 'draft', 'scheduled')

    // Clean up old events
    await broadcaster.cleanupOldEvents(brandId)

    const events = await redis.xrange(`events:${brandId}`, '-', '+')
    assert.strictEqual(events.length, 1)
    
    const eventData = Object.fromEntries(
      events[0][1].reduce((acc, val, idx) => {
        if (idx % 2 === 0) acc.push([val, events[0][1][idx + 1]])
        return acc
      }, [] as Array<[string, string]>)
    )
    assert.strictEqual(eventData.contentId, 'new-content')
  })
})