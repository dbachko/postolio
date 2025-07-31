#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import { autopilotService } from '../src/services/autopilot.js'

const prisma = new PrismaClient()

async function testAutopilot() {
  try {
    console.log('🤖 Testing Autopilot Content Generation System')
    console.log('=' .repeat(50))

    // Test 1: Manual trigger
    console.log('\n📝 Testing manual trigger...')
    const triggerResult = await autopilotService.triggerManual()
    console.log('Trigger result:', triggerResult)

    // Test 2: Get autopilot status
    console.log('\n📊 Getting autopilot status...')
    const status = await autopilotService.getAutopilotStatus()
    console.log('Status:', {
      running: status.running,
      brandCount: status.brandStatuses.length,
      brandsWithGaps: status.brandStatuses.filter(b => b.gapDays > 0).length
    })

    // Test 3: Check for brands with gaps
    if (status.brandStatuses.length > 0) {
      console.log('\n📈 Brand status details:')
      status.brandStatuses.forEach(brand => {
        console.log(`  • ${brand.brandName}: ${brand.scheduledCount} scheduled, ${brand.gapDays} gap days`)
      })
    } else {
      console.log('\n⚠️  No brands found with Instagram integration')
    }

    // Test 4: Update autopilot config for first brand (if exists)
    if (status.brandStatuses.length > 0) {
      const firstBrand = status.brandStatuses[0]
      console.log(`\n⚙️  Testing config update for brand: ${firstBrand.brandName}`)
      
      const configResult = await autopilotService.updateBrandConfig(firstBrand.brandId, {
        enabled: true,
        minDaysAhead: 14,
        contentStrategy: {
          themes: ['test-theme', 'lifestyle'],
          postingFrequency: 'daily' as const
        }
      })
      
      console.log('Config update result:', configResult)
    }

    console.log('\n✅ Autopilot test completed successfully!')

  } catch (error) {
    console.error('\n❌ Autopilot test failed:', error)
  } finally {
    await prisma.$disconnect()
    process.exit(0)
  }
}

// Run the test
testAutopilot()