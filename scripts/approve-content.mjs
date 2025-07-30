import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function approveContent() {
  try {
    console.log('🔍 Finding pending content...')
    
    // Find all pending content
    const pendingContent = await prisma.content.findMany({
      where: {
        status: 'pending'
      },
      include: {
        brand: {
          select: {
            name: true
          }
        }
      }
    })
    
    console.log(`📊 Found ${pendingContent.length} pending content items`)
    
    if (pendingContent.length === 0) {
      console.log('ℹ️ No pending content found to approve')
      return
    }
    
    // Approve the first item for testing
    const firstContent = pendingContent[0]
    
    const updatedContent = await prisma.content.update({
      where: { id: firstContent.id },
      data: {
        status: 'approved'
      }
    })
    
    console.log('✅ Approved content for testing:')
    console.log('==========================================')
    console.log(`ID: ${updatedContent.id}`)
    console.log(`Caption: ${updatedContent.caption.substring(0, 50)}...`)
    console.log(`Brand: ${firstContent.brand.name}`)
    console.log(`Status: ${updatedContent.status}`)
    console.log('==========================================')
    console.log('')
    console.log('💡 You can now test the "Publish to Instagram" button in the UI!')
    
  } catch (error) {
    console.error('❌ Error approving content:', error)
  } finally {
    await prisma.$disconnect()
  }
}

approveContent()