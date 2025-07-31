#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testCampaignBrandFiltering() {
  try {
    console.log('🧪 Testing campaign brand filtering...')
    
    // Get all brands
    const brands = await prisma.brand.findMany({
      select: {
        id: true,
        name: true,
        userId: true
      }
    })
    
    console.log(`Found ${brands.length} brands:`)
    brands.forEach(brand => {
      console.log(`- ${brand.name} (ID: ${brand.id})`)
    })
    
    // Test filtering for each brand
    for (const brand of brands) {
      console.log(`\n🔍 Testing campaigns for brand: ${brand.name}`)
      
      const campaignsForBrand = await prisma.campaign.findMany({
        where: {
          brandId: brand.id,
          brand: {
            userId: brand.userId
          }
        },
        select: {
          id: true,
          name: true,
          status: true,
          brandId: true
        }
      })
      
      console.log(`Found ${campaignsForBrand.length} campaigns for ${brand.name}:`)
      campaignsForBrand.forEach(campaign => {
        console.log(`  • ${campaign.name} (${campaign.status}) - Brand ID: ${campaign.brandId}`)
      })
      
      // Verify all campaigns belong to the correct brand
      const wrongBrandCampaigns = campaignsForBrand.filter(c => c.brandId !== brand.id)
      if (wrongBrandCampaigns.length > 0) {
        console.log(`❌ Found ${wrongBrandCampaigns.length} campaigns with wrong brand ID!`)
      } else {
        console.log(`✅ All campaigns correctly associated with ${brand.name}`)
      }
    }
    
    // Test the query that would be used by the API endpoint
    console.log('\n🔍 Testing API endpoint query pattern...')
    
    for (const brand of brands) {
      const whereClause = {
        brand: {
          userId: brand.userId
        },
        brandId: brand.id
      }
      
      const apiStyleCampaigns = await prisma.campaign.findMany({
        where: whereClause,
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
      
      console.log(`API query for ${brand.name}: ${apiStyleCampaigns.length} campaigns`)
      apiStyleCampaigns.forEach(campaign => {
        console.log(`  • ${campaign.name} (${campaign.status}) - Content: ${campaign._count.content}`)
      })
    }
    
  } catch (error) {
    console.error('❌ Error testing campaign brand filtering:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testCampaignBrandFiltering()