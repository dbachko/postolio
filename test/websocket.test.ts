import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import websocketPlugin from '../src/plugins/websocket.js'

describe('WebSocket Plugin', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify({ logger: false })
  })

  afterEach(async () => {
    await app.close()
  })

  test('should register WebSocket plugin', async () => {
    await app.register(websocketPlugin)
    await app.ready()

    // Check that WebSocket support is enabled
    assert.ok(app.websocketServer, 'WebSocket server should be initialized')
  })

  test('should handle WebSocket connections', async () => {
    await app.register(websocketPlugin)
    await app.ready()

    // Check that the WebSocket handler is available
    const wsRoute = app.hasRoute({ method: 'GET', url: '/ws' })
    assert.ok(wsRoute, 'WebSocket route should exist')
  })

  test('should broadcast to rooms', async () => {
    await app.register(websocketPlugin)
    await app.ready()

    // Check that broadcast decorator is added
    assert.ok('broadcastToRoom' in app, 'broadcastToRoom decorator should be added')
    assert.strictEqual(typeof (app as any).broadcastToRoom, 'function')
  })
})