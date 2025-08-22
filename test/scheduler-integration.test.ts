import { test, describe, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import Redis from 'ioredis'
import { SchedulerAdapter } from '../src/services/scheduler-adapter.js'
import { StatusBroadcaster } from '../src/services/status-broadcaster.js'
import websocketPlugin from '../src/plugins/websocket.js'
import { getDatabaseClient } from '../src/config/database.js'

const prisma = getDatabaseClient()

describe('Scheduler Integration with StatusBroadcaster', () => {
  let app: FastifyInstance
  let redis: Redis
  let broadcaster: StatusBroadcaster
  let schedulerAdapter: SchedulerAdapter

  beforeEach(async () => {
    app = Fastify({ logger: false })
    await app.register(websocketPlugin)
    await app.ready()
    
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1
    })
    
    broadcaster = new StatusBroadcaster(app, redis)
    
    // Create scheduler adapter with broadcaster
    schedulerAdapter = SchedulerAdapter.getInstance()
    schedulerAdapter.setBroadcaster(broadcaster)
  })

  afterEach(async () => {
    await redis.flushdb()
    await redis.disconnect()
    await app.close()
  })

  test('should broadcast status change when content is scheduled', async () => {
    // Create test data
    const testUser = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        password: 'hashed',
        name: 'Test User'
      }
    })

    const testBrand = await prisma.brand.create({
      data: {
        name: 'Test Brand',
        userId: testUser.id
      }
    })

    const testContent = await prisma.content.create({
      data: {
        caption: 'Test caption',
        hashtags: ['#test'],
        status: 'draft',
        brandId: testBrand.id
      }
    })

    // Mock the scheduler client
    const mockCreateSchedule = mock.fn(async () => ({
      scheduleId: 'mock-schedule-123',
      status: 'scheduled'
    }))

    schedulerAdapter.getClient().createSchedule = mockCreateSchedule

    // Schedule the content
    const result = await schedulerAdapter.scheduleContent(
      testContent.id,
      undefined,
      testUser.id
    )

    assert.ok(result.success)
    assert.strictEqual(result.scheduleId, 'mock-schedule-123')

    // Check that status was broadcast to Redis
    const events = await redis.xrange(`events:${testBrand.id}`, '-', '+')
    assert.strictEqual(events.length, 2) // One optimistic, one confirmation

    // Clean up
    await prisma.content.delete({ where: { id: testContent.id } })
    await prisma.brand.delete({ where: { id: testBrand.id } })
    await prisma.user.delete({ where: { id: testUser.id } })
  })

  test('should rollback optimistic update on scheduling failure', async () => {
    // Create test data
    const testUser = await prisma.user.create({
      data: {
        email: `test-fail-${Date.now()}@example.com`,
        password: 'hashed',
        name: 'Test User'
      }
    })

    const testBrand = await prisma.brand.create({
      data: {
        name: 'Test Brand',
        userId: testUser.id
      }
    })

    const testContent = await prisma.content.create({
      data: {
        caption: 'Test caption',
        hashtags: ['#test'],
        status: 'draft',
        brandId: testBrand.id
      }
    })

    // Mock the scheduler client to fail
    const mockCreateSchedule = mock.fn(async () => {
      throw new Error('Scheduling failed')
    })

    schedulerAdapter.getClient().createSchedule = mockCreateSchedule

    // Try to schedule the content
    const result = await schedulerAdapter.scheduleContent(
      testContent.id,
      undefined,
      testUser.id
    )

    assert.strictEqual(result.success, false)
    assert.ok(result.error?.includes('Scheduling failed'))

    // Check that rollback was broadcast
    const events = await redis.xrange(`events:${testBrand.id}`, '-', '+')
    assert.strictEqual(events.length, 2) // Optimistic + rollback

    const lastEvent = events[events.length - 1]
    const eventData = Object.fromEntries(
      lastEvent[1].reduce((acc, val, idx) => {
        if (idx % 2 === 0) acc.push([val, lastEvent[1][idx + 1]])
        return acc
      }, [] as Array<[string, string]>)
    )
    
    assert.strictEqual(eventData.oldStatus, 'scheduled')
    assert.strictEqual(eventData.newStatus, 'draft')

    // Clean up
    await prisma.content.delete({ where: { id: testContent.id } })
    await prisma.brand.delete({ where: { id: testBrand.id } })
    await prisma.user.delete({ where: { id: testUser.id } })
  })
})