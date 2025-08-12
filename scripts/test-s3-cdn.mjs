#!/usr/bin/env node

// Test script to verify S3 upload and CDN serving is working
// Usage: node scripts/test-s3-cdn.mjs

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testS3CDN() {
  console.log('🔍 Testing S3 Upload and CDN Serving...\n')
  
  try {
    // Find recent content with CDN URLs
    const recentContent = await prisma.content.findMany({
      where: {
        cdnImageUrl: {
          not: null
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
      },
      take: 5
    })

    if (recentContent.length === 0) {
      console.log('❌ No content found with CDN URLs')
      console.log('   This means S3 upload is not working or content hasn\'t been generated yet.\n')
      
      // Check for content with only OpenAI URLs
      const openAIContent = await prisma.content.findMany({
        where: {
          imageUrl: {
            contains: 'oaidalleapi'
          },
          cdnImageUrl: null
        },
        select: {
          id: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 5
      })
      
      if (openAIContent.length > 0) {
        console.log(`⚠️  Found ${openAIContent.length} recent posts with OpenAI URLs but no CDN URLs`)
        console.log('   These were generated before the S3 fix was deployed.')
        console.log('   Generate new content to test CDN serving.\n')
      }
    } else {
      console.log(`✅ Found ${recentContent.length} posts with CDN URLs!\n`)
      
      for (const content of recentContent) {
        console.log('─'.repeat(60))
        console.log(`📝 Content ID: ${content.id}`)
        console.log(`🏷️  Brand: ${content.brand.name}`)
        console.log(`📅 Created: ${content.createdAt.toISOString()}`)
        console.log(`📄 Caption: ${content.caption.substring(0, 50)}...`)
        
        if (content.cdnImageUrl) {
          console.log(`\n✅ CDN URL: ${content.cdnImageUrl}`)
          console.log(`   S3 Key: ${content.s3ImageKey}`)
          console.log(`   Region: ${content.imageRegion || 'us-east-1'}`)
          
          // Check if it's a CloudFront URL
          if (content.cdnImageUrl.includes('cloudfront.net') || content.cdnImageUrl.includes('postolio.example')) {
            console.log('   ✅ Using CloudFront CDN!')
          } else if (content.cdnImageUrl.includes('s3')) {
            console.log('   ⚠️  Direct S3 URL (not using CloudFront)')
          }
        }
        
        if (content.imageUrl) {
          console.log(`\n📎 Original URL: ${content.imageUrl.substring(0, 80)}...`)
          if (content.imageUrl.includes('oaidalleapi')) {
            console.log('   ℹ️  OpenAI URL (fallback)')
          }
        }
        console.log()
      }
    }
    
    // Summary statistics
    const stats = await prisma.content.aggregate({
      _count: {
        id: true,
        cdnImageUrl: true,
        s3ImageKey: true
      }
    })
    
    console.log('─'.repeat(60))
    console.log('\n📊 Overall Statistics:')
    console.log(`   Total content: ${stats._count.id}`)
    console.log(`   With CDN URL: ${stats._count.cdnImageUrl}`)
    console.log(`   With S3 Key: ${stats._count.s3ImageKey}`)
    
    const percentage = stats._count.id > 0 
      ? ((stats._count.cdnImageUrl / stats._count.id) * 100).toFixed(1)
      : 0
    console.log(`   CDN Coverage: ${percentage}%`)
    
    if (percentage < 100) {
      console.log(`\n💡 Tip: ${stats._count.id - stats._count.cdnImageUrl} posts still using external URLs.`)
      console.log('   Generate new content to use CloudFront CDN.')
    }
    
  } catch (error) {
    console.error('❌ Error testing S3/CDN:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
testS3CDN().catch(console.error)