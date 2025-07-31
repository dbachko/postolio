#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkCampaignStatus() {
  try {
    const campaignId = 'cmdqhgq8i0001iqp4apy37euk'
    
    console.log(`🔍 Checking status of campaign: ${campaignId}`)
    
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        brand: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            content: true
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
    console.log(`   Brand: ${campaign.brand.name}`)
    console.log(`   Content Count: ${campaign._count.content}`)
    console.log(`   Created: ${campaign.createdAt.toISOString()}`)
    console.log(`   Started: ${campaign.startedAt?.toISOString() || 'Not started'}`)
    console.log(`   Completed: ${campaign.completedAt?.toISOString() || 'Not completed'}`)
    
    // Check if deletion is allowed
    if (campaign.status === 'draft') {
      console.log('✅ Campaign can be deleted (status is draft)')
    } else {
      console.log(`❌ Campaign cannot be deleted (status is '${campaign.status}', only 'draft' campaigns can be deleted)`)
      
      // Show what statuses exist
      const allCampaigns = await prisma.campaign.findMany({
        select: {
          id: true,
          name: true,
          status: true
        }
      })
      
      const statusCounts = {}
      allCampaigns.forEach(c => {
        statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
      })
      
      console.log('\n📊 All campaign statuses in system:')
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   ${status}: ${count} campaigns`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkCampaignStatus()