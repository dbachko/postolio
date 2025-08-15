import { test } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'
import { campaignService } from '../src/services/campaign.js'

const prisma = new PrismaClient()

test('Campaign pause should cancel future scheduled content', async (t) => {
  // Setup: Create test data
  const user = await prisma.user.create({
    data: {
      email: `test-pause-${Date.now()}@example.com`,
      password: 'hashedpassword',
      name: 'Test User'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Test Brand',
      userId: user.id,
      styleProfile: { tone: 'professional' }
    }
  })

  const campaign = await prisma.campaign.create({
    data: {
      name: 'Test Campaign',
      brandId: brand.id,
      status: 'active',
      config: { frequency: 'daily' }
    }
  })

  // Create future scheduled content with current (broken) status
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
  const futureContent = await prisma.content.create({
    data: {
      caption: 'Future post',
      hashtags: ['#test'],
      brandId: brand.id,
      campaignId: campaign.id,
      status: 'scheduled', // Now using the actual scheduled status
      scheduledAt: futureDate
    }
  })

  // Act: Pause the campaign
  await campaignService.pauseCampaign(campaign.id)

  // Assert: Future content should be unscheduled
  const updatedContent = await prisma.content.findUnique({
    where: { id: futureContent.id }
  })

  // Should now work correctly with 'scheduled' status
  assert.strictEqual(updatedContent?.status, 'draft', 'Future content should revert to draft')
  assert.strictEqual(updatedContent?.scheduledAt, null, 'Future content should have no scheduled time')

  // Cleanup
  await prisma.content.deleteMany({ where: { campaignId: campaign.id } })
  await prisma.campaign.delete({ where: { id: campaign.id } })
  await prisma.brand.delete({ where: { id: brand.id } })
  await prisma.user.delete({ where: { id: user.id } })
})

test('Campaign resume should mark past scheduled content as skipped', async (t) => {
  // Setup: Create test data
  const user = await prisma.user.create({
    data: {
      email: `test-resume-${Date.now()}@example.com`,
      password: 'hashedpassword',
      name: 'Test User'
    }
  })

  const brand = await prisma.brand.create({
    data: {
      name: 'Test Brand',
      userId: user.id,
      styleProfile: { tone: 'professional' }
    }
  })

  const campaign = await prisma.campaign.create({
    data: {
      name: 'Test Campaign',
      brandId: brand.id,
      status: 'paused',
      config: { frequency: 'daily' }
    }
  })

  // Create past scheduled content (missed during pause)
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // Yesterday
  const pastContent = await prisma.content.create({
    data: {
      caption: 'Missed post',
      hashtags: ['#test'],
      brandId: brand.id,
      campaignId: campaign.id,
      status: 'scheduled', // Now using the actual scheduled status
      scheduledAt: pastDate
    }
  })

  // Act: Resume the campaign
  await campaignService.resumeCampaign(campaign.id)

  // Assert: Past content should be marked as skipped
  const updatedContent = await prisma.content.findUnique({
    where: { id: pastContent.id }
  })

  // Should now work correctly with 'scheduled' status
  assert.strictEqual(updatedContent?.status, 'skipped', 'Past content should be marked as skipped')
  assert.notStrictEqual(updatedContent?.schedulingError, null, 'Should have scheduling error message')

  // Cleanup
  await prisma.content.deleteMany({ where: { campaignId: campaign.id } })
  await prisma.campaign.delete({ where: { id: campaign.id } })
  await prisma.brand.delete({ where: { id: brand.id } })
  await prisma.user.delete({ where: { id: user.id } })
})

// Close Prisma connection after all tests
test.after(async () => {
  await prisma.$disconnect()
})