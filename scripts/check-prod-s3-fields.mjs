#!/usr/bin/env node
import { PrismaClient } from '@prisma/client'

// Use production database URL
const prodDbUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL

if (!prodDbUrl || !prodDbUrl.includes('amazonaws.com')) {
  console.error('Error: PROD_DATABASE_URL not set or not pointing to AWS RDS')
  console.error('Please set PROD_DATABASE_URL to your production database connection string')
  process.exit(1)
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: prodDbUrl
    }
  }
})

async function checkCampaignContent() {
  try {
    const campaignId = 'cme82hjmu0009jt24srpvq5wv'
    
    console.log('Checking production database for campaign:', campaignId)
    console.log('Database:', prodDbUrl.split('@')[1]?.split('/')[0] || 'unknown')
    console.log('---')
    
    // Get campaign details
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    })
    
    if (!campaign) {
      console.log('Campaign not found!')
      return
    }
    
    console.log('Campaign found:', campaign.name)
    console.log('Status:', campaign.status)
    console.log('Updated:', campaign.updatedAt)
    console.log('---')
    
    // Get content with S3 fields
    const content = await prisma.content.findMany({
      where: { campaignId },
      select: {
        id: true,
        imageUrl: true,
        s3ImageKey: true,
        cdnImageUrl: true,
        imageRegion: true,
        retentionExpiresAt: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'asc' }
    })
    
    console.log(`Found ${content.length} content items`)
    console.log('---')
    
    content.forEach((c, i) => {
      console.log(`\nPost ${i+1} (${c.id}):`)
      console.log('  Created:', c.createdAt)
      console.log('  Updated:', c.updatedAt)
      console.log('  imageUrl:', c.imageUrl ? c.imageUrl.substring(0, 60) + '...' : 'NULL')
      console.log('  s3ImageKey:', c.s3ImageKey || 'NULL')
      console.log('  cdnImageUrl:', c.cdnImageUrl || 'NULL')
      console.log('  imageRegion:', c.imageRegion || 'NULL')
      console.log('  retentionExpiresAt:', c.retentionExpiresAt || 'NULL')
      
      // Check if S3 fields are populated
      if (c.s3ImageKey || c.cdnImageUrl) {
        console.log('  ✅ S3 fields are populated!')
      } else {
        console.log('  ❌ S3 fields are NULL - image not uploaded to S3')
      }
    })
    
    // Summary
    const withS3 = content.filter(c => c.s3ImageKey || c.cdnImageUrl).length
    const withoutS3 = content.length - withS3
    
    console.log('\n=== SUMMARY ===')
    console.log(`Total posts: ${content.length}`)
    console.log(`With S3 fields: ${withS3}`)
    console.log(`Without S3 fields: ${withoutS3}`)
    
    if (withoutS3 > 0) {
      console.log('\n⚠️  Some posts are missing S3 fields!')
      console.log('This means they were created before S3 upload was implemented')
      console.log('or the S3 upload failed but the content was still saved.')
    }
    
  } catch (error) {
    console.error('Error:', error.message)
    if (error.message.includes('P1001')) {
      console.error('\nCannot connect to production database.')
      console.error('Make sure PROD_DATABASE_URL is set correctly.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

checkCampaignContent()