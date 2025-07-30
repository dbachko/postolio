import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkContent() {
  try {
    console.log('🔍 Checking content in database...')
    
    const content = await prisma.content.findMany({
      include: {
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
    
    console.log(`📊 Total content items: ${content.length}`)
    console.log('')
    
    if (content.length === 0) {
      console.log('ℹ️ No content found')
      return
    }
    
    content.forEach((item, index) => {
      console.log(`${index + 1}. Content ID: ${item.id}`)
      console.log(`   Caption: ${item.caption.substring(0, 60)}...`)
      console.log(`   Status: ${item.status}`)
      console.log(`   Brand: ${item.brand.name}`)
      console.log(`   Created: ${item.createdAt.toISOString()}`)
      console.log(`   Image URL: ${item.imageUrl ? 'Yes' : 'No'}`)
      console.log('------------------------------------------')
    })
    
    // Count by status
    const statusCounts = content.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1
      return counts
    }, {})
    
    console.log('')
    console.log('📈 Content by status:')
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`)
    })
    
  } catch (error) {
    console.error('❌ Error checking content:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkContent()