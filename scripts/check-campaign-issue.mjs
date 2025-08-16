import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function checkCampaignIssue() {
  const campaignId = 'cmec1vijo00011x0h5txx37e5'
  
  console.log(`🔍 Checking campaign: ${campaignId}\n`)
  
  // Get campaign details
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      brand: true,
      content: {
        orderBy: { createdAt: 'desc' }
      }
    }
  })
  
  if (!campaign) {
    console.log('❌ Campaign not found!')
    return
  }
  
  console.log('📊 Campaign Details:')
  console.log(`Name: ${campaign.name}`)
  console.log(`Status: ${campaign.status}`)
  console.log(`Brand: ${campaign.brand.name}`)
  console.log(`Brand ID: ${campaign.brandId}`)
  console.log(`Content count: ${campaign.content.length}`)
  console.log(`Error message: ${campaign.errorMessage || 'None'}`)
  console.log(`Progress: ${campaign.progress}%`)
  
  console.log('\n🔍 Brand Instagram Config:')
  console.log(`Instagram Token: ${campaign.brand.instagramAccessToken ? 'Present' : 'Missing'}`)
  if (campaign.brand.instagramAccessToken) {
    console.log(`Token preview: ${campaign.brand.instagramAccessToken.substring(0, 30)}...`)
  }
  console.log(`Account ID: ${campaign.brand.instagramAccountId || 'Not set'}`)
  console.log(`Page ID: ${campaign.brand.instagramPageId || 'Not set'}`)
  
  console.log('\n📝 Campaign Content Status:')
  const statusCounts = {}
  campaign.content.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
  })
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`)
  })
  
  // Check for failed content
  const failedContent = campaign.content.filter(c => c.status === 'failed')
  if (failedContent.length > 0) {
    console.log('\n❌ Failed Content:')
    failedContent.forEach(content => {
      console.log(`\nContent ID: ${content.id}`)
      console.log(`Caption: ${content.caption.substring(0, 60)}...`)
      console.log(`Status: ${content.status}`)
      console.log(`Scheduled At: ${content.scheduledAt}`)
      console.log(`Error: ${content.schedulingError || 'No error message'}`)
    })
  }
  
  // Check the specific failed content from the error log
  const specificContent = await prisma.content.findUnique({
    where: { id: 'cmec1x6n200031x0hu8v05nsu' }
  })
  
  if (specificContent) {
    console.log('\n📌 Specific Failed Content (cmec1x6n200031x0hu8v05nsu):')
    console.log(`Campaign ID: ${specificContent.campaignId}`)
    console.log(`Brand ID: ${specificContent.brandId}`)
    console.log(`Status: ${specificContent.status}`)
    console.log(`Error: ${specificContent.schedulingError}`)
  }
}

checkCampaignIssue()
  .catch(console.error)
  .finally(() => prisma.$disconnect())