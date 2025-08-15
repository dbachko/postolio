import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function fixCampaignContent() {
  console.log('🔧 Fixing failed campaign content...\n')
  
  // Reset the specific failed content back to scheduled
  const failedContent = await prisma.content.findUnique({
    where: { id: 'cmec1x6n200031x0hu8v05nsu' },
    include: { brand: true }
  })
  
  if (failedContent) {
    console.log(`Found failed content for brand: ${failedContent.brand.name}`)
    console.log(`Current status: ${failedContent.status}`)
    console.log(`Error: ${failedContent.schedulingError}\n`)
    
    // Update content back to scheduled status and set a future scheduled time
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 1) // Schedule for tomorrow
    futureDate.setHours(14, 0, 0, 0) // At 2 PM
    
    const updated = await prisma.content.update({
      where: { id: failedContent.id },
      data: {
        status: 'scheduled',
        schedulingError: null,
        scheduledAt: futureDate
      }
    })
    
    console.log('✅ Content fixed:')
    console.log(`  - Status changed: failed → scheduled`)
    console.log(`  - Error cleared`)
    console.log(`  - Scheduled for: ${updated.scheduledAt}`)
    console.log(`  - Caption: ${updated.caption.substring(0, 50)}...`)
  }
  
  // Also check and fix any other failed content for this campaign
  const campaign = await prisma.campaign.findUnique({
    where: { id: 'cmec1vijo00011x0h5txx37e5' },
    include: {
      content: {
        where: { status: 'failed' }
      }
    }
  })
  
  if (campaign && campaign.content.length > 0) {
    console.log(`\n🔍 Found ${campaign.content.length} other failed content in campaign`)
    
    for (const content of campaign.content) {
      if (content.id !== 'cmec1x6n200031x0hu8v05nsu') { // Skip the one we already fixed
        const futureDate = new Date()
        futureDate.setDate(futureDate.getDate() + 2) // Schedule 2 days ahead
        futureDate.setHours(15, 0, 0, 0)
        
        await prisma.content.update({
          where: { id: content.id },
          data: {
            status: 'scheduled',
            schedulingError: null,
            scheduledAt: futureDate
          }
        })
        console.log(`✅ Fixed additional content: ${content.id}`)
      }
    }
  }
  
  // Update campaign statistics
  const finalCampaign = await prisma.campaign.findUnique({
    where: { id: 'cmec1vijo00011x0h5txx37e5' },
    include: {
      content: true
    }
  })
  
  console.log('\n📊 Campaign Content Summary:')
  const statusCounts = {}
  finalCampaign.content.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
  })
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })
  
  console.log('\n✅ Campaign content fixed successfully!')
  console.log('📝 Note: Content is now scheduled but won\'t publish to Instagram')
  console.log('   (Instagram token was removed due to being invalid)')
}

fixCampaignContent()
  .catch(console.error)
  .finally(() => prisma.$disconnect())