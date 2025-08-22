#!/usr/bin/env node

import { SchedulerAdapter } from './dist/services/scheduler-adapter.js';

async function testGetScheduledContent() {
  try {
    console.log('🔍 Testing AWS Content Scheduler - Fetching scheduled content...');
    
    const adapter = SchedulerAdapter.getInstance();
    
    // Test with a sample brand ID (you can replace with an actual one)
    const testBrandId = 'cmei4f9z00002im24qr9bph3b'; // From the logs
    
    console.log(`📅 Fetching scheduled content for brand: ${testBrandId}`);
    
    const scheduledContent = await adapter.getScheduledContent(testBrandId, 20);
    
    console.log(`✅ Found ${scheduledContent.length} scheduled items:`);
    
    if (scheduledContent.length > 0) {
      scheduledContent.forEach((item, index) => {
        console.log(`\n📋 Item ${index + 1}:`);
        console.log(`   Content ID: ${item.contentId}`);
        console.log(`   Scheduled At: ${item.scheduledAt}`);
        console.log(`   Status: ${item.status}`);
        console.log(`   Platform: ${item.platform}`);
        if (item.caption) {
          console.log(`   Caption: ${item.caption.substring(0, 100)}${item.caption.length > 100 ? '...' : ''}`);
        }
      });
    } else {
      console.log('📭 No scheduled content found');
    }
    
    // Test health check
    console.log('\n🏥 Testing scheduler health...');
    const healthCheck = await adapter.healthCheck();
    console.log(`Health Status: ${healthCheck ? '✅ Healthy' : '❌ Unhealthy'}`);
    
  } catch (error) {
    console.error('❌ Error testing AWS scheduler:', error);
    if (error.code === 'EOPENBREAKER') {
      console.log('🔧 Circuit breaker is open - service may be down or overloaded');
    }
    if (error.details) {
      console.log('Error details:', error.details);
    }
  }
}

testGetScheduledContent().catch(console.error);