#!/usr/bin/env node

import { ContentSchedulerClient } from './dist/clients/content-scheduler-client.js';

// Force use the deployed AWS API
const AWS_API_URL = 'https://otjonnsrqe.execute-api.us-east-1.amazonaws.com/dev/';

async function testDirectAWS() {
  try {
    console.log('🔍 Testing AWS Content Scheduler API directly...');
    console.log(`🌐 Using API URL: ${AWS_API_URL}`);
    
    // Create client directly with AWS URL
    const client = new ContentSchedulerClient({
      baseURL: AWS_API_URL,
      timeout: 30000,
      maxRetries: 2,
      debug: true,
    });
    
    console.log('📋 Testing health check...');
    
    try {
      const healthResult = await client.healthCheck();
      console.log('✅ Health check result:', healthResult);
    } catch (healthError) {
      console.log('❌ Health check failed:', healthError.message);
    }
    
    console.log('\n📅 Fetching scheduled content...');
    
    try {
      // Test listing schedules
      const schedules = await client.listSchedules();
      console.log(`✅ Found ${schedules.schedules?.length || 0} scheduled items:`);
      
      if (schedules.schedules && schedules.schedules.length > 0) {
        schedules.schedules.forEach((item, index) => {
          console.log(`\n📋 Schedule ${index + 1}:`);
          console.log(`   Schedule ID: ${item.scheduleId}`);
          console.log(`   Content ID: ${item.contentId}`);
          console.log(`   Brand ID: ${item.brandId}`);
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
      
    } catch (listError) {
      console.log('❌ List schedules failed:', listError.message);
      if (listError.details) {
        console.log('Error details:', listError.details);
      }
    }
    
    // Try fetching for a specific brand
    console.log('\n🎯 Fetching for specific brand...');
    try {
      const brandId = 'cmei4f9z00002im24qr9bph3b';
      const brandSchedules = await client.getUpcomingSchedules(brandId, 10);
      console.log(`✅ Found ${brandSchedules.length} items for brand ${brandId}`);
      
      brandSchedules.forEach((item, index) => {
        console.log(`   ${index + 1}. ${item.contentId} - ${item.scheduledAt} (${item.status})`);
      });
      
    } catch (brandError) {
      console.log('❌ Brand-specific fetch failed:', brandError.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing AWS scheduler directly:', error);
    if (error.code === 'EOPENBREAKER') {
      console.log('🔧 Circuit breaker is open - service may be down or overloaded');
    }
    if (error.details) {
      console.log('Error details:', JSON.stringify(error.details, null, 2));
    }
  }
}

testDirectAWS().catch(console.error);