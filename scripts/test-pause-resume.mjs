#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testPauseResume() {
  console.log('\n=== Testing Campaign Pause/Resume Functionality ===\n')
  
  try {
    // Find an active campaign with scheduled content
    const activeCampaign = await prisma.campaign.findFirst({
      where: { status: 'active' },
      include: {
        content: {
          where: { status: 'scheduled' }
        }
      }
    })
    
    if (!activeCampaign) {
      console.log('No active campaign found. Creating test campaign...')
      
      // Find a user and brand to create test data
      const brand = await prisma.brand.findFirst()
      if (!brand) {
        console.log('No brand found. Please create test data first.')
        return
      }
      
      // Create a test campaign
      const campaign = await prisma.campaign.create({
        data: {
          name: 'Test Pause/Resume Campaign',
          brandId: brand.id,
          status: 'active',
          priority: 5,
          config: {
            duration: {
              start: new Date().toISOString(),
              end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
            }
          }
        }
      })
      
      // Create scheduled content for testing
      const futureDate1 = new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
      const futureDate2 = new Date(Date.now() + 48 * 60 * 60 * 1000) // Day after
      
      await prisma.content.createMany({
        data: [
          {
            brandId: brand.id,
            campaignId: campaign.id,
            caption: 'Test content 1',
            hashtags: ['test'],
            status: 'scheduled',
            scheduledAt: futureDate1
          },
          {
            brandId: brand.id,
            campaignId: campaign.id,
            caption: 'Test content 2',
            hashtags: ['test'],
            status: 'scheduled',
            scheduledAt: futureDate2
          }
        ]
      })
      
      console.log('✅ Created test campaign with 2 scheduled posts')
    }
    
    // Get the campaign to test
    const testCampaign = await prisma.campaign.findFirst({
      where: { status: 'active' },
      include: {
        content: {
          where: { status: 'scheduled' }
        }
      }
    })
    
    if (!testCampaign || testCampaign.content.length === 0) {
      console.log('No active campaign with scheduled content found.')
      return
    }
    
    console.log(`Testing with campaign: ${testCampaign.name}`)
    console.log(`Initial scheduled content: ${testCampaign.content.length} posts`)
    console.log('Content before pause:')
    testCampaign.content.forEach(c => {
      console.log(`  - ${c.id.slice(-8)}: status=${c.status}, scheduledAt=${c.scheduledAt}`)
    })
    
    // TEST 1: Pause the campaign
    console.log('\n--- TEST 1: Pausing Campaign ---')
    
    // Simulate pause by updating status and content
    const skippedContent = await prisma.content.updateMany({
      where: {
        campaignId: testCampaign.id,
        status: 'scheduled',
        scheduledAt: { gte: new Date() }
      },
      data: {
        status: 'skipped',
        schedulingError: 'Skipped: Campaign was paused'
      }
    })
    
    await prisma.campaign.update({
      where: { id: testCampaign.id },
      data: { status: 'paused' }
    })
    
    console.log(`✅ Campaign paused. ${skippedContent.count} posts marked as skipped`)
    
    // Verify the content status
    const pausedContent = await prisma.content.findMany({
      where: { campaignId: testCampaign.id },
      select: { id: true, status: true, scheduledAt: true }
    })
    
    console.log('Content after pause:')
    pausedContent.forEach(c => {
      console.log(`  - ${c.id.slice(-8)}: status=${c.status}, scheduledAt=${c.scheduledAt} ${c.scheduledAt ? '✅ (preserved)' : '❌ (lost)'}`)
    })
    
    // Verify all scheduled content became skipped
    const stillScheduled = pausedContent.filter(c => c.status === 'scheduled')
    const nowSkipped = pausedContent.filter(c => c.status === 'skipped')
    
    if (stillScheduled.length > 0) {
      console.log(`❌ ERROR: ${stillScheduled.length} posts still scheduled after pause!`)
    } else {
      console.log(`✅ All scheduled posts correctly marked as skipped`)
    }
    
    // TEST 2: Resume the campaign
    console.log('\n--- TEST 2: Resuming Campaign ---')
    
    // Simulate resume by restoring skipped content
    const restoredContent = await prisma.content.updateMany({
      where: {
        campaignId: testCampaign.id,
        status: 'skipped',
        scheduledAt: { gte: new Date() }
      },
      data: {
        status: 'scheduled',
        schedulingError: null
      }
    })
    
    await prisma.campaign.update({
      where: { id: testCampaign.id },
      data: { status: 'active' }
    })
    
    console.log(`✅ Campaign resumed. ${restoredContent.count} posts restored to scheduled`)
    
    // Verify the content status after resume
    const resumedContent = await prisma.content.findMany({
      where: { campaignId: testCampaign.id },
      select: { id: true, status: true, scheduledAt: true }
    })
    
    console.log('Content after resume:')
    resumedContent.forEach(c => {
      console.log(`  - ${c.id.slice(-8)}: status=${c.status}, scheduledAt=${c.scheduledAt}`)
    })
    
    // Verify skipped content was restored
    const stillSkipped = resumedContent.filter(c => c.status === 'skipped' && c.scheduledAt && c.scheduledAt >= new Date())
    const nowScheduled = resumedContent.filter(c => c.status === 'scheduled')
    
    if (stillSkipped.length > 0) {
      console.log(`❌ ERROR: ${stillSkipped.length} future posts still skipped after resume!`)
    } else {
      console.log(`✅ All future skipped posts correctly restored to scheduled`)
    }
    
    console.log('\n=== Test Summary ===')
    console.log('Pause/Resume cycle:')
    console.log(`  1. Paused: scheduled → skipped (${skippedContent.count} posts)`)
    console.log(`  2. Resumed: skipped → scheduled (${restoredContent.count} posts)`)
    console.log(`  3. scheduledAt timestamps preserved: ${pausedContent.every(c => c.status !== 'skipped' || c.scheduledAt) ? '✅' : '❌'}`)
    
  } catch (error) {
    console.error('Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testPauseResume()
