import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function checkSchedulingIssue() {
  console.log('🔍 Investigating scheduling issue...\n')
  
  // Check the specific content that failed
  const contentId = 'cmec1x6n200031x0hu8v05nsu'
  
  const content = await prisma.content.findUnique({
    where: { id: contentId },
    include: { 
      brand: true,
      campaign: true
    }
  })
  
  if (!content) {
    console.log('Content not found!')
    return
  }
  
  console.log('📝 Content Details:')
  console.log(`ID: ${content.id}`)
  console.log(`Status: ${content.status}`)
  console.log(`Created At: ${content.createdAt}`)
  console.log(`Updated At: ${content.updatedAt}`)
  console.log(`Scheduled At: ${content.scheduledAt}`)
  console.log(`Posted At: ${content.postedAt}`)
  console.log(`Campaign: ${content.campaign?.name || 'None'}`)
  console.log(`Caption: ${content.caption.substring(0, 50)}...`)
  
  console.log('\n⚠️  Issue Analysis:')
  
  // Check if scheduledAt is null or in the past
  const now = new Date()
  if (!content.scheduledAt) {
    console.log('❌ scheduledAt is NULL - This is the problem!')
    console.log('   Content has status="scheduled" but no scheduledAt date')
    console.log('   The scheduler picked it up because scheduledAt was null/undefined')
  } else if (content.scheduledAt < now) {
    console.log(`❌ scheduledAt is in the past: ${content.scheduledAt}`)
    console.log('   The scheduler tried to publish it immediately')
  } else {
    console.log(`✅ scheduledAt is in the future: ${content.scheduledAt}`)
  }
  
  // Check other content in the same campaign
  if (content.campaignId) {
    const campaignContent = await prisma.content.findMany({
      where: { campaignId: content.campaignId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        createdAt: true
      }
    })
    
    console.log(`\n📊 All content in campaign "${content.campaign?.name}":`)
    campaignContent.forEach(c => {
      console.log(`  ${c.id.slice(-8)}: status=${c.status}, scheduledAt=${c.scheduledAt || 'NULL'}`)
    })
  }
  
  // Check how content is created during campaign generation
  console.log('\n💡 Root Cause:')
  console.log('When the campaign generated content, it set status="scheduled"')
  console.log('but didn\'t set a scheduledAt date. The scheduler then tried to')
  console.log('publish it immediately because it queries for:')
  console.log('  - status = "scheduled"')
  console.log('  - scheduledAt <= now + 5 minutes')
  console.log('NULL scheduledAt likely matches this condition!')
  
  console.log('\n🔧 Fix needed:')
  console.log('1. Ensure campaign generation sets proper scheduledAt dates')
  console.log('2. Or set status="draft" if no date is provided')
  console.log('3. Update scheduler to skip content with null scheduledAt')
}

checkSchedulingIssue()
  .catch(console.error)
  .finally(() => prisma.$disconnect())