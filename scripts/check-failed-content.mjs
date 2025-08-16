import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function checkFailedContent() {
  console.log('🔍 Checking failed content...\n')
  
  // Get all failed content
  const failedContent = await prisma.content.findMany({
    where: { status: 'failed' },
    include: { brand: true },
    orderBy: { updatedAt: 'desc' }
  })
  
  console.log(`Found ${failedContent.length} failed content items:\n`)
  
  for (const content of failedContent) {
    console.log(`ID: ${content.id}`)
    console.log(`Brand: ${content.brand.name}`)
    console.log(`Caption: ${content.caption.substring(0, 50)}...`)
    console.log(`Error: ${content.schedulingError || 'No error message'}`)
    console.log(`Instagram Token: ${content.brand.instagramAccessToken?.substring(0, 20)}...`)
    console.log('---')
  }
  
  // Check brands with invalid tokens
  const brandsWithSampleToken = await prisma.brand.findMany({
    where: {
      instagramAccessToken: 'sample_token_for_testing'
    }
  })
  
  console.log(`\n⚠️  Brands with sample test token: ${brandsWithSampleToken.length}`)
  brandsWithSampleToken.forEach(brand => {
    console.log(`  - ${brand.name} (ID: ${brand.id})`)
  })
}

checkFailedContent()
  .catch(console.error)
  .finally(() => prisma.$disconnect())