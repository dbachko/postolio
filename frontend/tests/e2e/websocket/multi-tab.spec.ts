import { test, expect } from '../fixtures/auth.fixture';
import { WebSocketHelper } from '../utils/websocket-helper';
import { BrowserContext } from '@playwright/test';

test.describe('Multi-Tab WebSocket Synchronization', () => {
  let wsHelper1: WebSocketHelper;
  let wsHelper2: WebSocketHelper;
  
  test('should share single connection across multiple tabs', async ({ browser, testUser }) => {
    const context = await browser.newContext();
    
    // First tab - login and establish connection
    const page1 = await context.newPage();
    await page1.goto('/login');
    await page1.fill('input[type="email"]', testUser.email);
    await page1.fill('input[type="password"]', testUser.password);
    await page1.click('button[type="submit"]');
    await page1.waitForURL('/dashboard');
    
    wsHelper1 = new WebSocketHelper(page1);
    await wsHelper1.setupMessageMonitoring();
    await wsHelper1.waitForConnection();
    
    // Second tab - should reuse existing connection
    const page2 = await context.newPage();
    await page2.goto('/dashboard');
    
    wsHelper2 = new WebSocketHelper(page2);
    await wsHelper2.setupMessageMonitoring();
    
    // Wait a bit for connection sharing to establish
    await page2.waitForTimeout(2000);
    
    // Verify only one connection exists
    const connCount1 = await wsHelper1.getConnectionCount();
    const connCount2 = await wsHelper2.getConnectionCount();
    
    expect(connCount1).toBe(1);
    expect(connCount2).toBe(1);
    
    // Verify both tabs show connected status
    const status1 = await page1.locator('[data-testid="connection-status"]');
    const status2 = await page2.locator('[data-testid="connection-status"]');
    
    await expect(status1).toContainText('Live');
    await expect(status2).toContainText('Live');
    
    await context.close();
  });
  
  test('should sync real-time updates across tabs', async ({ browser, testUser }) => {
    const context = await browser.newContext();
    
    // Setup two tabs
    const page1 = await context.newPage();
    await page1.goto('/login');
    await page1.fill('input[type="email"]', testUser.email);
    await page1.fill('input[type="password"]', testUser.password);
    await page1.click('button[type="submit"]');
    await page1.waitForURL('/dashboard');
    
    const page2 = await context.newPage();
    await page2.goto('/dashboard');
    
    wsHelper1 = new WebSocketHelper(page1);
    wsHelper2 = new WebSocketHelper(page2);
    
    await wsHelper1.setupMessageMonitoring();
    await wsHelper2.setupMessageMonitoring();
    
    // Wait for connections
    await wsHelper1.waitForConnection();
    await page2.waitForTimeout(2000);
    
    // Simulate receiving a status update message
    await page1.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        // Simulate incoming message
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'status_update',
            data: {
              contentId: 'test-content-123',
              status: 'scheduled',
              scheduledAt: new Date().toISOString()
            }
          })
        });
        sockets[0].dispatchEvent(event);
      }
    });
    
    // Both tabs should receive the update
    const messages1 = await wsHelper1.getMessages('received');
    const messages2 = await wsHelper2.getMessages('received');
    
    const update1 = messages1.find(m => m.data?.type === 'status_update');
    const update2 = messages2.find(m => m.data?.type === 'status_update');
    
    expect(update1).toBeTruthy();
    expect(update2).toBeTruthy();
    
    await context.close();
  });
  
  test('should handle tab closure gracefully', async ({ browser, testUser }) => {
    const context = await browser.newContext();
    
    // Create three tabs
    const page1 = await context.newPage();
    await page1.goto('/login');
    await page1.fill('input[type="email"]', testUser.email);
    await page1.fill('input[type="password"]', testUser.password);
    await page1.click('button[type="submit"]');
    await page1.waitForURL('/dashboard');
    
    const page2 = await context.newPage();
    await page2.goto('/dashboard');
    
    const page3 = await context.newPage();
    await page3.goto('/campaigns');
    
    wsHelper1 = new WebSocketHelper(page1);
    await wsHelper1.setupMessageMonitoring();
    await wsHelper1.waitForConnection();
    
    // Close middle tab
    await page2.close();
    
    // Wait a moment for cleanup
    await page1.waitForTimeout(1000);
    
    // Connection should still be active
    const connCount = await wsHelper1.getConnectionCount();
    expect(connCount).toBe(1);
    
    // Third tab should still work
    const status3 = await page3.locator('[data-testid="connection-status"]');
    await expect(status3).toContainText('Live');
    
    // Close first tab
    await page1.close();
    
    // Third tab should maintain connection
    await page3.waitForTimeout(1000);
    const finalStatus = await page3.locator('[data-testid="connection-status"]');
    await expect(finalStatus).toContainText('Live');
    
    await context.close();
  });
  
  test('should sync offline queue across tabs', async ({ browser, testUser }) => {
    const context = await browser.newContext();
    
    // Setup two tabs
    const page1 = await context.newPage();
    await page1.goto('/login');
    await page1.fill('input[type="email"]', testUser.email);
    await page1.fill('input[type="password"]', testUser.password);
    await page1.click('button[type="submit"]');
    await page1.waitForURL('/dashboard');
    
    const page2 = await context.newPage();
    await page2.goto('/campaigns');
    
    wsHelper1 = new WebSocketHelper(page1);
    wsHelper2 = new WebSocketHelper(page2);
    
    await wsHelper1.setupMessageMonitoring();
    await wsHelper1.waitForConnection();
    
    // Go offline
    await context.setOffline(true);
    
    // Queue an action in first tab
    await page1.evaluate(() => {
      const offlineQueue = [{
        id: 'test-queue-1',
        type: 'schedule_content',
        data: { contentId: 'content-1' },
        timestamp: Date.now()
      }];
      localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
    });
    
    // Verify second tab sees the same queue
    const queue2 = await page2.evaluate(() => {
      const queueData = localStorage.getItem('offlineQueue');
      return queueData ? JSON.parse(queueData) : [];
    });
    
    expect(queue2).toHaveLength(1);
    expect(queue2[0].id).toBe('test-queue-1');
    
    // Go back online
    await context.setOffline(false);
    
    // Wait for queue processing
    await page1.waitForFunction(
      () => {
        const queueData = localStorage.getItem('offlineQueue');
        if (!queueData) return true;
        const queue = JSON.parse(queueData);
        return !Array.isArray(queue) || queue.length === 0;
      },
      { timeout: 10000 }
    );
    
    // Both tabs should have empty queue
    const finalQueue1 = await wsHelper1.getOfflineQueueSize();
    const finalQueue2 = await wsHelper2.getOfflineQueueSize();
    
    expect(finalQueue1).toBe(0);
    expect(finalQueue2).toBe(0);
    
    await context.close();
  });
  
  test('should coordinate reconnection across tabs', async ({ browser, testUser }) => {
    const context = await browser.newContext();
    
    // Setup two tabs
    const page1 = await context.newPage();
    await page1.goto('/login');
    await page1.fill('input[type="email"]', testUser.email);
    await page1.fill('input[type="password"]', testUser.password);
    await page1.click('button[type="submit"]');
    await page1.waitForURL('/dashboard');
    
    const page2 = await context.newPage();
    await page2.goto('/dashboard');
    
    wsHelper1 = new WebSocketHelper(page1);
    wsHelper2 = new WebSocketHelper(page2);
    
    await wsHelper1.setupMessageMonitoring();
    await wsHelper2.setupMessageMonitoring();
    await wsHelper1.waitForConnection();
    
    // Simulate disconnection
    await wsHelper1.simulateDisconnect();
    
    // Both tabs should show reconnecting
    await page1.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return status?.textContent?.includes('Reconnecting') || 
               status?.textContent?.includes('Connection lost');
      },
      { timeout: 5000 }
    );
    
    await page2.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return status?.textContent?.includes('Reconnecting') || 
               status?.textContent?.includes('Connection lost');
      },
      { timeout: 5000 }
    );
    
    // Wait for reconnection
    await wsHelper1.waitForConnection(15000);
    
    // Both tabs should be reconnected
    const status1 = await page1.locator('[data-testid="connection-status"]');
    const status2 = await page2.locator('[data-testid="connection-status"]');
    
    await expect(status1).toContainText('Live');
    await expect(status2).toContainText('Live');
    
    // Verify still single connection
    const connCount = await wsHelper1.getConnectionCount();
    expect(connCount).toBe(1);
    
    await context.close();
  });
});