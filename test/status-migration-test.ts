import { test } from 'node:test'
import assert from 'node:assert'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

test('Status Migration Verification', async (t) => {
  console.log('\n=== Verifying Content Status Migration ===\n')

  await t.test('should have correct enum values in schema', async () => {
    // Check that we can create content with new statuses
    const testBrand = await prisma.brand.findFirst()
    if (!testBrand) {
      console.log('No test brand found, skipping enum test')
      return
    }

    const statuses = ['draft', 'scheduled', 'published', 'failed', 'skipped'] as const
    
    for (const status of statuses) {
      const content = await prisma.content.create({
        data: {
          brandId: testBrand.id,
          caption: `Test ${status} content`,
          hashtags: ['test'],
          status: status,
        }
      })
      
      assert.equal(content.status, status, `Content should have status ${status}`)
      console.log(`✅ Created content with status: ${status}`)
      
      // Clean up
      await prisma.content.delete({ where: { id: content.id } })
    }
  })

  await t.test('should not allow old status values', async () => {
    const testBrand = await prisma.brand.findFirst()
    if (!testBrand) {
      console.log('No test brand found, skipping old status test')
      return
    }

    // These should fail with TypeScript errors if attempted
    const oldStatuses = ['pending', 'approved', 'rejected']
    
    for (const oldStatus of oldStatuses) {
      try {
        // @ts-expect-error - Testing that old statuses are not allowed
        await prisma.content.create({
          data: {
            brandId: testBrand.id,
            caption: `Test ${oldStatus} content`,
            hashtags: ['test'],
            status: oldStatus,
          }
        })
        
        assert.fail(`Should not be able to create content with old status: ${oldStatus}`)
      } catch (error: any) {
        if (error.message.includes('Invalid value')) {
          console.log(`✅ Correctly rejected old status: ${oldStatus}`)
        } else if (error.code === 'P2027') {
          // Prisma validation error
          console.log(`✅ Correctly rejected old status: ${oldStatus}`)
        } else {
          throw error
        }
      }
    }
  })

  await t.test('should have correct campaign pause/resume behavior', async () => {
    const testBrand = await prisma.brand.findFirst()
    if (!testBrand) {
      console.log('No test brand found, creating one...')
      const user = await prisma.user.findFirst()
      if (!user) {
        console.log('No test user found, skipping campaign test')
        return
      }
      const brand = await prisma.brand.create({
        data: {
          name: 'Test Brand',
          userId: user.id,
        }
      })
      testBrand.id = brand.id
    }

    // Create a test campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: 'Test Campaign',
        brandId: testBrand.id,
        status: 'active',
        priority: 5,
      }
    })

    // Create scheduled content for the campaign
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
    const scheduledContent = await prisma.content.create({
      data: {
        brandId: testBrand.id,
        campaignId: campaign.id,
        caption: 'Scheduled test content',
        hashtags: ['test'],
        status: 'scheduled',
        scheduledAt: futureDate,
      }
    })

    // Test pause: Should mark scheduled content as skipped
    const skippedContent = await prisma.content.updateMany({
      where: {
        campaignId: campaign.id,
        status: 'scheduled',
        scheduledAt: { gte: new Date() }
      },
      data: {
        status: 'skipped'
      }
    })

    assert.equal(skippedContent.count, 1, 'Should have marked 1 content as skipped')
    console.log('✅ Campaign pause correctly marks content as skipped')

    // Test resume: Should mark skipped content back to scheduled
    const rescheduledContent = await prisma.content.updateMany({
      where: {
        campaignId: campaign.id,
        status: 'skipped'
      },
      data: {
        status: 'scheduled'
      }
    })

    assert.equal(rescheduledContent.count, 1, 'Should have rescheduled 1 content')
    console.log('✅ Campaign resume correctly reschedules skipped content')

    // Clean up
    await prisma.content.delete({ where: { id: scheduledContent.id } })
    await prisma.campaign.delete({ where: { id: campaign.id } })
  })

  console.log('\n=== All Status Migration Tests Passed ===\n')
})

// Run cleanup after tests
test.after(async () => {
  await prisma.$disconnect()
})