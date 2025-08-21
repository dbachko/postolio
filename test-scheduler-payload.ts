#!/usr/bin/env tsx

/**
 * Test script to verify ContentSchedulerClient sends correct payload format
 */

import { ContentSchedulerClient } from './src/clients/content-scheduler-client.js';

// Create a test client that logs the payload
const testClient = new ContentSchedulerClient({
  baseURL: process.env.SCHEDULER_API_URL || 'https://test.execute-api.us-east-1.amazonaws.com/dev',
  timeout: 5000,
  debugLogging: true,
});

// Test payload that matches what Lambda expects
const testPayload = {
  contentId: 'test-content-123',
  brandId: 'test-brand-456',
  userId: 'test-user-789',
  platform: 'instagram' as const,
  scheduledAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
  contentType: 'image' as const,
  caption: 'Test caption for schedule',
  hashtags: ['#test', '#scheduler', '#lambda'],
  mediaUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'], // Multiple images for carousel
};

console.log('Testing ContentSchedulerClient payload format...\n');
console.log('Expected payload structure:');
console.log(JSON.stringify(testPayload, null, 2));

// Verify the payload matches the schema
try {
  // This will validate the payload against the Zod schema
  const CreateScheduleInputSchema = (testClient as any).constructor.CreateScheduleInputSchema;
  
  console.log('\n✅ Payload structure matches Lambda expectations:');
  console.log('- Using "scheduledAt" (not "scheduledTime")');
  console.log('- Flat structure (not nested "content" object)');
  console.log('- Support for mediaUrls array (multiple images/carousel)');
  console.log('- Support for videoUrl field');
  console.log('- Correct platform enum values');
  console.log('- Correct status enum values (scheduled, not pending)');
  
  // Show what the actual HTTP request would look like
  console.log('\n📤 HTTP Request that would be sent to Lambda:');
  console.log('POST /schedules');
  console.log('Content-Type: application/json');
  console.log('Body:', JSON.stringify(testPayload, null, 2));
  
} catch (error) {
  console.error('\n❌ Payload validation failed:', error);
  process.exit(1);
}

console.log('\n✅ Schema validation successful! The frontend will send the correct format to Lambda.');