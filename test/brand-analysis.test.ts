import { test } from 'node:test'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'
import { signJWT } from '../src/services/jwt.ts'

const prisma = new PrismaClient()

test('brand analysis analyzes Instagram posts and creates profile', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.brand.deleteMany({ where: { name: 'Test Brand' } })
    await prisma.user.deleteMany({ where: { email: 'test-brand@example.com' } })
  })

  // Create user first
  const user = await prisma.user.create({
    data: {
      email: 'test-brand@example.com',
      name: 'Test User'
    }
  })

  const analysisData = {
    brandName: 'Test Brand',
    instagramHandle: '@testbrand',
    posts: [
      {
        imageUrl: 'https://example.com/image1.jpg',
        caption: 'Fresh organic coffee from local farmers ☕️ #organic #coffee',
        hashtags: ['organic', 'coffee', 'local']
      }
    ]
  }

  const token = signJWT({ id: user.id, email: user.email })

  const response = await app.inject({
    method: 'POST',
    url: '/brands/analyze',
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: analysisData
  })

  t.assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  t.assert.ok(body.brand.id)
  t.assert.strictEqual(body.brand.name, 'Test Brand')
  t.assert.ok(body.brand.styleProfile)
})