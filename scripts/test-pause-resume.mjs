#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    // Find the test campaign
    const campaign = await prisma.campaign.findFirst({
      where: {
        name: 'Test Campaign'
      }
    })
    
    if (!campaign) {
      console.log('❌ Campaign not found')
      return
    }
    
    console.log('📊 Current campaign status:', campaign.status)
    
    // Update campaign to preview status so we can test pause/resume
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { 
        status: 'preview',
        previewGenerated: true,
        errorMessage: null
      }
    })
    
    console.log('✅ Campaign updated to preview status:', updated.status)
    console.log('🆔 Campaign ID:', updated.id)
    
    // Now let's test starting it to active
    const active = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { 
        status: 'active',
        startedAt: new Date()
      }
    })
    
    console.log('✅ Campaign set to active:', active.status)
    console.log('\n🎯 Ready for pause/resume testing!')
    console.log('Campaign ID:', active.id)
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()