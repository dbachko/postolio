#!/usr/bin/env node

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixEmptyCaptions() {
  try {
    console.log('🔧 Fixing content with empty captions...')
    
    // Find content with empty captions
    const contentWithEmptyCaptions = await prisma.content.findMany({
      where: {
        caption: ''
      },
      select: {
        id: true,
        caption: true,
        status: true,
        createdAt: true,
        brand: {
          select: {
            name: true
          }
        },
        campaign: {
          select: {
            name: true
          }
        }
      }
    })
    
    console.log(`Found ${contentWithEmptyCaptions.length} content items with empty captions`)
    
    if (contentWithEmptyCaptions.length === 0) {
      console.log('✅ No content with empty captions found!')
      return
    }
    
    // List what will be deleted
    console.log('📋 Content items that will be deleted:')
    contentWithEmptyCaptions.forEach((content, index) => {
      console.log(`${index + 1}. ID: ${content.id}`)
      console.log(`   Brand: ${content.brand.name}`)
      console.log(`   Campaign: ${content.campaign?.name || 'None'}`)
      console.log(`   Status: ${content.status}`)
      console.log(`   Created: ${content.createdAt}`)
      console.log('   ---')
    })
    
    // Delete the content with empty captions
    const deleteResult = await prisma.content.deleteMany({
      where: {
        caption: ''
      }
    })
    
    console.log(`🗑️  Successfully deleted ${deleteResult.count} content items with empty captions`)
    
    // Verify cleanup
    const remainingEmptyContent = await prisma.content.count({
      where: {
        caption: ''
      }
    })
    
    if (remainingEmptyContent === 0) {
      console.log('✅ All content with empty captions has been successfully removed!')
    } else {
      console.log(`⚠️  Warning: ${remainingEmptyContent} content items with empty captions still remain`)
    }
    
  } catch (error) {
    console.error('❌ Error fixing empty captions:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixEmptyCaptions()