#!/usr/bin/env node

import { ContentSchedulerClient } from './dist/clients/content-scheduler-client.js';

// Use the deployed AWS API
const AWS_API_URL = 'https://otjonnsrqe.execute-api.us-east-1.amazonaws.com/dev/';

async function showScheduledTable() {
  try {
    console.log('📅 AWS Content Scheduler - Scheduled Posts (Los Angeles Time)\n');
    
    const client = new ContentSchedulerClient({
      baseURL: AWS_API_URL,
      timeout: 30000,
      maxRetries: 2,
      debug: false,
    });
    
    // Fetch all scheduled content
    const schedules = await client.listSchedules();
    
    if (!schedules.schedules || schedules.schedules.length === 0) {
      console.log('📭 No scheduled content found');
      return;
    }

    // Convert UTC times to Los Angeles timezone and sort by date
    const scheduledWithLA = schedules.schedules
      .map(item => {
        const utcDate = new Date(item.scheduledAt);
        const laDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
        return {
          ...item,
          scheduledAtLA: laDate,
          scheduledAtLAString: utcDate.toLocaleString("en-US", {
            timeZone: "America/Los_Angeles",
            weekday: 'short',
            month: 'short', 
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          }),
          dayFromNow: Math.ceil((utcDate - new Date()) / (1000 * 60 * 60 * 24))
        };
      })
      .sort((a, b) => a.scheduledAtLA - b.scheduledAtLA);

    // Create table
    console.log('┌─────────────────────────────┬──────────────────────────────────────────────────────────────────────┬────────────┐');
    console.log('│ Los Angeles Time            │ Content Preview                                                          │ Status     │');
    console.log('├─────────────────────────────┼──────────────────────────────────────────────────────────────────────┼────────────┤');
    
    scheduledWithLA.forEach(item => {
      const timeStr = item.scheduledAtLAString.padEnd(27);
      const preview = (item.caption || 'No caption').substring(0, 68);
      const previewPadded = (preview + (item.caption && item.caption.length > 68 ? '...' : '')).padEnd(70);
      const statusStr = item.status.padEnd(10);
      
      // Add emoji for timing
      let emoji = '';
      if (item.dayFromNow < 0) emoji = '🔴'; // Past due
      else if (item.dayFromNow === 0) emoji = '🟡'; // Today
      else if (item.dayFromNow === 1) emoji = '🟢'; // Tomorrow
      else emoji = '🔵'; // Future
      
      console.log(`│ ${emoji} ${timeStr}│ ${previewPadded}│ ${statusStr}│`);
    });
    
    console.log('└─────────────────────────────┴──────────────────────────────────────────────────────────────────────┴────────────┘');
    
    // Summary stats
    const today = scheduledWithLA.filter(item => item.dayFromNow === 0).length;
    const tomorrow = scheduledWithLA.filter(item => item.dayFromNow === 1).length;
    const future = scheduledWithLA.filter(item => item.dayFromNow > 1).length;
    const pastDue = scheduledWithLA.filter(item => item.dayFromNow < 0).length;
    
    console.log(`\n📊 Summary:`);
    console.log(`   🔴 Past Due: ${pastDue}`);
    console.log(`   🟡 Today: ${today}`);
    console.log(`   🟢 Tomorrow: ${tomorrow}`);
    console.log(`   🔵 Future: ${future}`);
    console.log(`   📝 Total: ${scheduledWithLA.length} scheduled posts`);
    
    // Show current LA time for reference
    const nowLA = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: 'long',
      year: 'numeric',
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    console.log(`\n🕐 Current Los Angeles Time: ${nowLA}`);
    
  } catch (error) {
    console.error('❌ Error fetching scheduled content:', error.message);
  }
}

showScheduledTable().catch(console.error);