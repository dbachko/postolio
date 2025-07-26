import { test } from 'node:test'
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
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-list@example.com',
      name: 'Test User'
    }
  })

  await prisma.brand.create({
    data: {
      name: 'List Test Brand',
      instagramHandle: '@listtest',
      userId: user.id
    }
  })

  const token = signJWT({ id: user.id, email: user.email })

  const response = await app.inject({
    method: 'GET',
    url: '/brands/list',
    headers: {
      authorization: `Bearer ${token}`
    }
  })

  t.assert.strictEqual(response.statusCode, 200)
  const body = response.json()
  t.assert.ok(Array.isArray(body.brands))
  t.assert.strictEqual(body.brands.length, 1)
  t.assert.strictEqual(body.brands[0].name, 'List Test Brand')
})