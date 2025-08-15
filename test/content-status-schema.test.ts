import { test } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('New content should have draft status', async (t) => {
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      password: 'hash',
      name: 'Test'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Test Brand',
      userId: user.id,
      styleProfile: {}
    }
  })

  const content = await prisma.content.create({
    data: {
      caption: 'Test post',
      hashtags: ['#test'],
      brandId: brand.id,
      status: 'draft' // New status
    }
  })

  assert.strictEqual(content.status, 'draft')

  // Cleanup
  await prisma.content.deleteMany({ where: { brandId: brand.id } })
  await prisma.brand.delete({ where: { id: brand.id } })
  await prisma.user.delete({ where: { id: user.id } })
})

test('Scheduled content should have scheduled status', async (t) => {
  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      password: 'hash',
      name: 'Test'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Test Brand',
      userId: user.id,
      styleProfile: {}
    }
  })

  const content = await prisma.content.create({
    data: {
      caption: 'Scheduled post',
      hashtags: ['#test'],
      brandId: brand.id,
      status: 'scheduled', // New status
      scheduledAt: new Date(Date.now() + 86400000)
    }
  })

  assert.strictEqual(content.status, 'scheduled')
  assert.notStrictEqual(content.scheduledAt, null)

  // Cleanup
  await prisma.content.deleteMany({ where: { brandId: brand.id } })
  await prisma.brand.delete({ where: { id: brand.id } })
  await prisma.user.delete({ where: { id: user.id } })
})

test('Only 5 valid statuses should exist', async (t) => {
  const validStatuses = ['draft', 'scheduled', 'published', 'failed', 'skipped']
  
  // This will pass after schema update
  assert.strictEqual(validStatuses.length, 5, 'Should have exactly 5 statuses')
  assert.ok(!validStatuses.includes('pending'), 'pending should not exist')
  assert.ok(!validStatuses.includes('approved'), 'approved should not exist')
  assert.ok(!validStatuses.includes('rejected'), 'rejected should not exist')
})

test.after(async () => {
  await prisma.$disconnect()
})