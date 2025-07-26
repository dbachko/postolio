import { test } from 'node:test'
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
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-content@example.com',
      name: 'Test User'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Content Test Brand',
      instagramHandle: '@contenttest',
      userId: user.id,
      styleProfile: {
        colorPalette: ['#ff6b6b', '#4ecdc4'],
        aestheticStyle: 'Modern minimalist',
        contentThemes: ['lifestyle', 'wellness'],
        toneOfVoice: 'Friendly and inspiring',
        targetAudience: 'Health-conscious millennials',
        brandPersonality: ['authentic', 'inspiring']
      } as any
    }
  })

  const generationRequest = {
    brandId: brand.id,
    count: 3,
    theme: 'wellness',
    style: 'motivational'
  }

  const token = signJWT({ id: user.id, email: user.email })

  const response = await app.inject({
    method: 'POST',
    url: '/content/generate',
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: generationRequest
  })

  t.assert.strictEqual(response.statusCode, 201)
  const body = response.json()
  t.assert.ok(Array.isArray(body.content))
  t.assert.strictEqual(body.content.length, 3)
  t.assert.ok(body.content[0].caption)
  t.assert.ok(body.content[0].hashtags)
})