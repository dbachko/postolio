import { test } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'
import { signJWT } from '../src/services/jwt.ts'

const prisma = new PrismaClient()

test('brands list returns user brands', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.brand.deleteMany({ where: { name: 'List Test Brand' } })
    await prisma.user.deleteMany({ where: { email: 'test-list@example.com' } })
    // Force process exit after all tests complete
    process.exit(0)
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-list@example.com',
      name: 'Test User',
      password: 'TestPassword123!',
    },
  })

  await prisma.brand.create({
    data: {
      name: 'List Test Brand',
      userId: user.id,
    },
  })

  const token = signJWT({ id: user.id, email: user.email })

  const response = await app.inject({
    method: 'GET',
    url: '/api/brands/list',
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  assert.ok(Array.isArray(body.brands))
  assert.strictEqual(body.brands.length, 1)
  assert.strictEqual(body.brands[0].name, 'List Test Brand')
})
