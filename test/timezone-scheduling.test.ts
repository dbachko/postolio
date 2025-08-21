import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TimezoneService } from '../src/services/timezone.js';
import { formatEventBridgeScheduleTime } from '../src/constants/scheduler.js';

describe('Timezone-Aware Scheduling', () => {
  test('should preserve timezone context through the scheduling pipeline', () => {
    // Scenario: User wants to schedule at 2:00 PM Eastern Time
    const brandTimezone = 'America/New_York';
    const userLocalTime = '14:30'; // 2:30 PM
    const scheduleDate = '2025-08-21'; // August 21, 2025
    
    // Step 1: Backend creates date in brand timezone and converts to UTC
    // Note: createDateInBrandTimezone already returns UTC time
    const utcTime = TimezoneService.createDateInBrandTimezone(
      scheduleDate, 
      userLocalTime, 
      brandTimezone
    );
    console.log(`UTC time: ${utcTime.toISOString()}`);
    
    // Step 2: AWS Lambda formats for EventBridge (our change)
    const eventBridgeFormat = formatEventBridgeScheduleTime(utcTime.toISOString());
    console.log(`EventBridge format: ${eventBridgeFormat}`);
    
    // Step 4: Verify EventBridge would execute at the correct UTC time
    const eventBridgeDate = new Date(eventBridgeFormat + 'Z'); // EventBridge treats as UTC
    
    // Verify the times match
    assert.strictEqual(eventBridgeDate.getTime(), utcTime.getTime());
    
    // Verify this translates back to correct local time
    const backToLocal = TimezoneService.toLocal(eventBridgeDate, brandTimezone);
    const localHours = backToLocal.getHours();
    const localMinutes = backToLocal.getMinutes();
    
    assert.strictEqual(localHours, 14); // 2 PM
    assert.strictEqual(localMinutes, 30); // 30 minutes
    
    console.log(`Verification: ${eventBridgeFormat} executes at ${localHours}:${localMinutes.toString().padStart(2, '0')} in ${brandTimezone}`);
  });

  test('should handle different timezones correctly', () => {
    const testCases = [
      { timezone: 'America/Los_Angeles', time: '09:00', expected: 17 }, // 9 AM PST = 5 PM UTC (winter)
      { timezone: 'Europe/London', time: '15:30', expected: 15 }, // 3:30 PM GMT = 3:30 PM UTC (winter)
      { timezone: 'Asia/Tokyo', time: '12:00', expected: 3 }, // 12 PM JST = 3 AM UTC
    ];

    testCases.forEach(({ timezone, time, expected }) => {
      const scheduleDate = '2025-01-15'; // Winter time to avoid DST complications
      
      // Create date in timezone and get UTC
      const utcTime = TimezoneService.createDateInBrandTimezone(
        scheduleDate, 
        time, 
        timezone
      );
      
      // Format for EventBridge
      const eventBridgeFormat = formatEventBridgeScheduleTime(utcTime.toISOString());
      
      // Verify UTC hour
      const eventBridgeDate = new Date(eventBridgeFormat + 'Z');
      assert.strictEqual(eventBridgeDate.getUTCHours(), expected);
      
      console.log(`${time} in ${timezone} → ${eventBridgeFormat} (${expected}:xx UTC)`);
    });
  });

  test('should handle daylight saving time transitions', () => {
    const timezone = 'America/New_York';
    
    // Test during standard time (EST = UTC-5)
    const winterDate = '2025-01-15';
    const winterTime = '14:00'; // 2 PM EST
    
    const winterUTC = TimezoneService.createDateInBrandTimezone(winterDate, winterTime, timezone);
    const winterEventBridge = formatEventBridgeScheduleTime(winterUTC.toISOString());
    
    // Should be 7 PM UTC (2 PM + 5 hours)
    assert.strictEqual(new Date(winterEventBridge + 'Z').getUTCHours(), 19);
    
    // Test during daylight time (EDT = UTC-4)
    const summerDate = '2025-07-15';
    const summerTime = '14:00'; // 2 PM EDT
    
    const summerUTC = TimezoneService.createDateInBrandTimezone(summerDate, summerTime, timezone);
    const summerEventBridge = formatEventBridgeScheduleTime(summerUTC.toISOString());
    
    // Should be 6 PM UTC (2 PM + 4 hours)
    assert.strictEqual(new Date(summerEventBridge + 'Z').getUTCHours(), 18);
    
    console.log(`Winter: ${winterTime} EST → ${winterEventBridge}`);
    console.log(`Summer: ${summerTime} EDT → ${summerEventBridge}`);
  });

  test('should validate formatEventBridgeScheduleTime removes milliseconds correctly', () => {
    const testInputs = [
      '2025-08-21T19:00:00.000Z',
      '2025-08-21T19:00:00.123Z',
      '2025-08-21T19:00:00.999Z',
      new Date('2025-08-21T19:00:00.456Z'),
    ];

    testInputs.forEach(input => {
      const result = formatEventBridgeScheduleTime(input);
      assert.strictEqual(result, '2025-08-21T19:00:00');
      
      // Verify EventBridge would interpret correctly
      const eventBridgeDate = new Date(result + 'Z');
      const originalDate = new Date(input);
      
      // Should match original time (ignoring milliseconds)
      assert.strictEqual(eventBridgeDate.getUTCHours(), originalDate.getUTCHours());
      assert.strictEqual(eventBridgeDate.getUTCMinutes(), originalDate.getUTCMinutes());
      assert.strictEqual(eventBridgeDate.getUTCSeconds(), originalDate.getUTCSeconds());
    });
  });
});