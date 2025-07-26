import { test } from 'node:test'
import { buildFastify } from '../src/server.ts'

test('health check endpoint responds correctly', async (t) => {
  const app = buildFastify()
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/health'
  })

  t.assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  t.assert.strictEqual(body.status, 'ok')
  t.assert.ok(body.timestamp)
})