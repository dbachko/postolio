import { test } from 'node:test'
import { buildFastify } from '../src/server.ts'
import { PrismaClient } from '@prisma/client'
import { signJWT } from '../src/services/jwt.ts'

const prisma = new PrismaClient()

test('content approval workflow works correctly', async (t) => {
  const app = buildFastify()
  t.after(async () => {
    await app.close()
    await prisma.content.deleteMany({ where: { caption: 'Test content for approval' } })
    await prisma.brand.deleteMany({ where: { name: 'Approval Test Brand' } })
    await prisma.user.deleteMany({ where: { email: 'test-approval@example.com' } })
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-approval@example.com',
      name: 'Test User'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Approval Test Brand',
      instagramHandle: '@approvaltest',
      userId: user.id
    }
  })

  // Create test content
  const content = await prisma.content.create({
    data: {
      caption: 'Test content for approval',
      hashtags: ['test', 'approval', 'workflow'],
      status: 'pending',
      brandId: brand.id
    }
  })

  const token = signJWT({ id: user.id, email: user.email })

  // Test content approval
  const approvalResponse = await app.inject({
    method: 'POST',
    url: '/content/approve',
    headers: {
      authorization: `Bearer ${token}`
    },
    payload: {
      contentId: content.id,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }
  })

  t.assert.strictEqual(approvalResponse.statusCode, 200)
  const approvalBody = approvalResponse.json()
  t.assert.strictEqual(approvalBody.content.status, 'approved')
  t.assert.ok(approvalBody.content.scheduledAt)

  // Test getting pending content (should be empty now)
  const pendingResponse = await app.inject({
    method: 'GET',
    url: `/content/pending/${brand.id}`,
    headers: {
      authorization: `Bearer ${token}`
    }
  })

  t.assert.strictEqual(pendingResponse.statusCode, 200)
  const pendingBody = pendingResponse.json()
  t.assert.strictEqual(pendingBody.content.length, 0)
})