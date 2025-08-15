import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function fixInvalidTokens() {
  console.log('🔧 Fixing invalid Instagram tokens...\n')
  
  // Find brands with sample token
  const brandsWithSampleToken = await prisma.brand.findMany({
    where: {
      instagramAccessToken: 'sample_token_for_testing'
    }
  })
  
  console.log(`Found ${brandsWithSampleToken.length} brands with invalid tokens\n`)
  
  for (const brand of brandsWithSampleToken) {
    // Remove the invalid token - this will prevent Instagram publishing attempts
    const updated = await prisma.brand.update({
      where: { id: brand.id },
      data: {
        instagramAccessToken: null,
        // Keep the IDs for reference but clear the token
        instagramAccountId: brand.instagramAccountId,
        instagramPageId: brand.instagramPageId
      }
    })
    
    console.log(`✅ Cleared invalid token for: ${updated.name}`)
    console.log(`   - Token removed (was: sample_token_for_testing)`)
    console.log(`   - Account ID kept: ${updated.instagramAccountId}`)
    console.log(`   - Page ID kept: ${updated.instagramPageId}`)
  }
  
  // Also reset any failed content back to scheduled
  const failedContent = await prisma.content.updateMany({
    where: {
      status: 'failed',
      schedulingError: {
        contains: 'Invalid OAuth access token'
      }
    },
    data: {
      status: 'scheduled',
      schedulingError: null
    }
  })
  
  console.log(`\n✅ Reset ${failedContent.count} failed content items back to scheduled`)
  
  console.log('\n📝 Note: These brands will no longer attempt to publish to Instagram')
  console.log('   To enable Instagram publishing, you need to:')
  console.log('   1. Connect a real Instagram Business/Creator account')
  console.log('   2. Complete the OAuth flow to get a valid access token')
  console.log('   3. Or use the Instagram OAuth connection in the app Settings')
}

fixInvalidTokens()
  .catch(console.error)
  .finally(() => prisma.$disconnect())