import { test } from 'node:test'
import assert from 'node:assert'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'
import { signJWT } from '../src/services/jwt.ts'

const prisma = new PrismaClient()

test('content generation creates multiple content options', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.content.deleteMany({ where: { caption: { contains: 'Generated content' } } })
    await prisma.brand.deleteMany({ where: { name: 'Content Test Brand' } })
    await prisma.user.deleteMany({ where: { email: 'test-content@example.com' } })
    // Force process exit after all tests complete
    process.exit(0)
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-content@example.com',
      name: 'Test User',
      password: 'TestPassword123!',
    },
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Content Test Brand',
      userId: user.id,
      styleProfile: {
        colorPalette: ['#ff6b6b', '#4ecdc4'],
        aestheticStyle: 'Modern minimalist',
        contentThemes: ['lifestyle', 'wellness'],
        toneOfVoice: 'Friendly and inspiring',
        targetAudience: 'Health-conscious millennials',
        brandPersonality: ['authentic', 'inspiring'],
      } as any,
    },
  })

  const generationRequest = {
    brandId: brand.id,
    count: 3,
    theme: 'wellness',
    style: 'motivational',
  }

  const token = signJWT({ id: user.id, email: user.email })

  const response = await app.inject({
    method: 'POST',
    url: '/api/content/generate',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: generationRequest,
  })

  assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  assert.ok(Array.isArray(body.content))
  assert.strictEqual(body.content.length, 3)
  assert.ok(body.content[0].caption)
  assert.ok(body.content[0].hashtags)
})
