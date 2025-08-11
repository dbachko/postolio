import { test } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('user registration creates new user', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.user.deleteMany({ where: { email: 'test-register@example.com' } })
    // Force process exit after all tests complete
    process.exit(0)
  })

  const userData = {
    email: 'test-register@example.com',
    password: 'Password123!',
    name: 'Test User',
  }

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: userData,
  })

  assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  assert.ok(body.token)
  assert.strictEqual(body.user.email, userData.email)
  assert.ok(!body.user.password) // Password should not be returned
})
