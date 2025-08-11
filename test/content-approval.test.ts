import { test } from 'node:test'
import assert from 'node:assert'
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
    // Force process exit after all tests complete
    process.exit(0)
  })

  // Create user and brand
  const user = await prisma.user.create({
    data: {
      email: 'test-approval@example.com',
      name: 'Test User',
      password: 'TestPassword123!',
    },
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Approval Test Brand',
      userId: user.id,
    },
  })

  // Create test content
  const content = await prisma.content.create({
    data: {
      caption: 'Test content for approval',
      hashtags: ['test', 'approval', 'workflow'],
      status: 'pending',
      brandId: brand.id,
    },
  })

  const token = signJWT({ id: user.id, email: user.email })

  // Test content approval
  const approvalResponse = await app.inject({
    method: 'POST',
    url: '/api/content/approve',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      contentId: content.id,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  })

  assert.strictEqual(approvalResponse.statusCode, 200)
  const approvalBody = approvalResponse.json()
  assert.strictEqual(approvalBody.content.status, 'approved')
  assert.ok(approvalBody.content.scheduledAt)

  // Test getting pending content (should be empty now)
  const pendingResponse = await app.inject({
    method: 'GET',
    url: `/api/content/pending/${brand.id}`,
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  assert.strictEqual(pendingResponse.statusCode, 200)
  const pendingBody = pendingResponse.json()
  assert.strictEqual(pendingBody.content.length, 0)
})
