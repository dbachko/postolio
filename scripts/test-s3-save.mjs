#!/usr/bin/env node

// Test if S3 fields are being saved to database after generation
// This will generate a test post and check if S3 fields are saved

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testS3Save() {
  console.log('🧪 Testing S3 Field Saving After Deployment...\n')
  
  try {
    // Get the most recent content (last 5 items)
    const beforeCount = await prisma.content.count({
      where: {
        cdnImageUrl: { not: null }
      }
    })
    
    console.log(`📊 Before test: ${beforeCount} posts with CDN URLs\n`)
    
    // Find content created in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    
    const recentContent = await prisma.content.findMany({
      where: {
        createdAt: {
          gte: fiveMinutesAgo
        }
      },
      select: {
        id: true,
        caption: true,
        imageUrl: true,
        s3ImageKey: true,
        cdnImageUrl: true,
        imageRegion: true,
        createdAt: true,
        brand: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    if (recentContent.length > 0) {
      console.log(`🔍 Found ${recentContent.length} posts created in last 5 minutes:\n`)
      
      for (const content of recentContent) {
        console.log('─'.repeat(60))
        console.log(`📝 Content ID: ${content.id}`)
        console.log(`🏷️  Brand: ${content.brand.name}`)
        console.log(`📅 Created: ${content.createdAt.toISOString()}`)
        console.log(`📄 Caption: ${content.caption.substring(0, 50)}...`)
        
        if (content.cdnImageUrl) {
          console.log(`\n✅ HAS CDN URL!`)
          console.log(`   CDN: ${content.cdnImageUrl}`)
          console.log(`   S3 Key: ${content.s3ImageKey}`)
          console.log(`   Region: ${content.imageRegion || 'us-east-1'}`)
        } else if (content.s3ImageKey) {
          console.log(`\n⚠️  Has S3 key but no CDN URL`)
          console.log(`   S3 Key: ${content.s3ImageKey}`)
        } else {
          console.log(`\n❌ NO S3 FIELDS SAVED`)
          console.log(`   Using OpenAI URL: ${content.imageUrl?.substring(0, 60)}...`)
        }
      }
      console.log('─'.repeat(60))
    } else {
      console.log('ℹ️  No content created in last 5 minutes')
      console.log('   Generate new content to test if S3 fields are saved')
    }
    
    // Summary
    const afterCount = await prisma.content.count({
      where: {
        cdnImageUrl: { not: null }
      }
    })
    
    const totalContent = await prisma.content.count()
    const withS3Key = await prisma.content.count({
      where: { s3ImageKey: { not: null } }
    })
    
    console.log('\n📊 Summary:')
    console.log(`   Total content: ${totalContent}`)
    console.log(`   With S3 key: ${withS3Key}`)
    console.log(`   With CDN URL: ${afterCount}`)
    
    if (afterCount > beforeCount) {
      console.log(`\n✅ SUCCESS! ${afterCount - beforeCount} new posts saved with CDN URLs!`)
    } else if (recentContent.length > 0 && recentContent.every(c => !c.cdnImageUrl)) {
      console.log(`\n❌ FAILURE: Recent posts generated but S3 fields not saved`)
      console.log('   The fix may not be deployed yet or there\'s still an issue')
    }
    
  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
testS3Save().catch(console.error)