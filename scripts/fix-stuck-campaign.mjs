#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixStuckCampaign() {
  try {
    const campaignId = 'cmdqjvl8x0001iqkn7beqsx3h'
    
    console.log(`🔍 Investigating stuck campaign: ${campaignId}`)
    
    // Get campaign details
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        brand: {
          select: {
            id: true,
            name: true
          }
        },
        content: {
          select: {
            id: true,
            caption: true,
            status: true,
            createdAt: true
          }
        }
      }
    })
    
    if (!campaign) {
      console.log('❌ Campaign not found')
      return
    }
    
    console.log(`📋 Campaign details:`)
    console.log(`   Name: ${campaign.name}`)
    console.log(`   Status: ${campaign.status}`)
    console.log(`   Progress: ${campaign.progress}%`)
    console.log(`   Brand: ${campaign.brand.name}`)
    console.log(`   Content Count: ${campaign.content.length}`)
    console.log(`   Preview Generated: ${campaign.previewGenerated}`)
    console.log(`   Error Message: ${campaign.errorMessage || 'None'}`)
    console.log(`   Created: ${campaign.createdAt.toISOString()}`)
    console.log(`   Updated: ${campaign.updatedAt.toISOString()}`)
    
    // Show content details
    if (campaign.content.length > 0) {
      console.log(`\n📝 Generated content:`)
      campaign.content.forEach((content, index) => {
        console.log(`   ${index + 1}. ${content.caption.substring(0, 50)}... (${content.status})`)
      })
    }
    
    // Check the campaign config
    console.log(`\n⚙️ Campaign config:`)
    console.log(JSON.stringify(campaign.config, null, 2))
    
    // Fix the stuck campaign by resetting it to preview status
    console.log(`\n🔧 Fixing stuck campaign...`)
    
    const updateData = {
      status: 'preview',
      progress: 100,
      previewGenerated: true,
      errorMessage: null,
      updatedAt: new Date()
    }
    
    const updatedCampaign = await prisma.campaign.update({
      where: { id: campaignId },
      data: updateData
    })
    
    console.log(`✅ Campaign fixed!`)
    console.log(`   New Status: ${updatedCampaign.status}`)
    console.log(`   New Progress: ${updatedCampaign.progress}%`)
    console.log(`   Preview Generated: ${updatedCampaign.previewGenerated}`)
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixStuckCampaign()