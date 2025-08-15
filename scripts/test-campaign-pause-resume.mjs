import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function testCampaignPauseResume() {
  console.log('=== Campaign Pause/Resume Test Script ===\n')
  
  // 1. Find an active campaign with scheduled content
  const campaign = await prisma.campaign.findFirst({
    where: { status: 'active' },
    include: {
      content: {
        where: {
          status: 'scheduled',
          scheduledAt: { not: null }
        }
      }
    }
  })
  
  if (!campaign || campaign.content.length === 0) {
    console.log('❌ No active campaign with scheduled content found')
    console.log('\nSearching for any campaign with scheduled content...')
    
    const anyCampaign = await prisma.campaign.findFirst({
      where: {},
      include: {
        content: {
          where: {
            status: 'scheduled',
            scheduledAt: { not: null }
          }
        }
      }
    })
    
    if (anyCampaign && anyCampaign.content.length > 0) {
      console.log(`Found campaign: ${anyCampaign.name} (${anyCampaign.status})`)
      console.log(`Scheduled content: ${anyCampaign.content.length} posts`)
    }
    return
  }
  
  console.log(`✅ Testing campaign: ${campaign.name}`)
  console.log(`   Campaign ID: ${campaign.id}`)
  console.log(`   Status: ${campaign.status}`)
  console.log(`   Scheduled content: ${campaign.content.length} posts`)
  
  // 2. Analyze scheduled content
  console.log('\n--- SCHEDULED CONTENT ANALYSIS ---')
  const now = new Date()
  const futureContent = campaign.content.filter(c => 
    c.scheduledAt && c.scheduledAt > now
  )
  const pastContent = campaign.content.filter(c => 
    c.scheduledAt && c.scheduledAt < now
  )
  
  console.log(`📅 Future posts (would be cancelled on pause): ${futureContent.length}`)
  if (futureContent.length > 0) {
    console.log('   Next 3 future posts:')
    futureContent.slice(0, 3).forEach(c => {
      console.log(`   - ${c.scheduledAt?.toISOString()} - "${c.caption.substring(0, 50)}..."`)
    })
  }
  
  console.log(`⏰ Past posts (would be skipped on resume): ${pastContent.length}`)
  if (pastContent.length > 0) {
    console.log('   Last 3 past posts:')
    pastContent.slice(-3).forEach(c => {
      console.log(`   - ${c.scheduledAt?.toISOString()} - "${c.caption.substring(0, 50)}..."`)
    })
  }
  
  // 3. Check for the bug: content with 'scheduled' status
  console.log('\n--- BUG VERIFICATION ---')
  const scheduledStatusContent = await prisma.content.count({
    where: { campaignId: campaign.id, status: 'scheduled' }
  })
  
  const scheduledWithDate = await prisma.content.count({
    where: { 
      campaignId: campaign.id, 
      status: 'scheduled',
      scheduledAt: { not: null }
    }
  })
  
  if (scheduledStatusContent > 0) {
    console.log(`⚠️  UNEXPECTED: Found ${scheduledStatusContent} content with 'scheduled' status`)
    console.log('   This indicates migration may have partially occurred')
  } else {
    console.log(`✅ No content with 'scheduled' status (expected before migration)`)
  }
  
  console.log(`📊 Content with 'scheduled' + scheduledAt: ${scheduledWithDate}`)
  
  // 4. Test recommendations
  console.log('\n--- TEST RECOMMENDATIONS ---')
  if (futureContent.length === 0 && pastContent.length === 0) {
    console.log('⚠️  No testable content (all scheduled times are in the past or future)')
    console.log('   Recommendation: Create a test campaign with near-future scheduled posts')
  } else {
    console.log('✅ Ready for pause/resume testing')
    console.log('\nTo test pause:')
    console.log('1. Call campaignService.pauseCampaign(campaignId)')
    console.log(`2. Verify ${futureContent.length} posts change to 'skipped' status`)
    console.log('\nTo test resume:')
    console.log('1. Call campaignService.resumeCampaign(campaignId)')
    console.log(`2. Verify ${pastContent.length} posts change to 'skipped' status`)
  }
  
  // 5. Check all campaign statuses
  console.log('\n--- ALL CAMPAIGNS SUMMARY ---')
  const allCampaigns = await prisma.campaign.groupBy({
    by: ['status'],
    _count: true
  })
  
  allCampaigns.forEach(group => {
    console.log(`   ${group.status}: ${group._count} campaigns`)
  })
}

testCampaignPauseResume()
  .catch(error => {
    console.error('Error running test:', error)
  })
  .finally(() => {
    prisma.$disconnect()
  })