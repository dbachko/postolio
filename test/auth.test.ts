import { test } from 'node:test'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('user registration creates new user', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.user.deleteMany({ where: { email: 'test-register@example.com' } })
  })

  const userData = {
    email: 'test-register@example.com',
    password: 'Password123!',
    name: 'Test User'
  }

  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: userData
  })

  t.assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  t.assert.ok(body.token)
  t.assert.strictEqual(body.user.email, userData.email)
  t.assert.ok(!body.user.password) // Password should not be returned
})