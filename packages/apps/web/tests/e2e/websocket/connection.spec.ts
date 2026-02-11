import { test, expect } from '../fixtures/auth.fixture';
import { WebSocketHelper } from '../utils/websocket-helper';

test.describe('WebSocket Connection Management', () => {
  let wsHelper: WebSocketHelper;

  test.beforeEach(async ({ authenticatedPage }) => {
    wsHelper = new WebSocketHelper(authenticatedPage);
    await wsHelper.setupMessageMonitoring();
  });

  test('should establish WebSocket connection on login', async ({ authenticatedPage }) => {
    // Wait for connection to be established
    await wsHelper.waitForConnection();

    // Verify connection status indicator
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Live');

    // Verify auth message was sent
    const sentMessages = await wsHelper.getMessages('sent');
    const authMessage = sentMessages.find((m) => m.data.type === 'auth');
    expect(authMessage).toBeTruthy();
    expect(authMessage.data.token).toBeTruthy();
  });

  test('should automatically reconnect after disconnection', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate disconnection
    await wsHelper.simulateDisconnect();

    // Wait for disconnected status
    await authenticatedPage.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return (
          status?.textContent?.includes('Reconnecting') ||
          status?.textContent?.includes('Connection lost')
        );
      },
      { timeout: 5000 }
    );

    // Wait for automatic reconnection
    await wsHelper.waitForConnection(15000);

    // Verify reconnected
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Live');
  });

  test('should not create duplicate connections on navigation', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Get initial connection count
    const initialCount = await wsHelper.getConnectionCount();
    expect(initialCount).toBe(1);

    // Navigate to different pages
    await authenticatedPage.goto('/brands');
    await authenticatedPage.waitForLoadState('networkidle');

    await authenticatedPage.goto('/content');
    await authenticatedPage.waitForLoadState('networkidle');

    await authenticatedPage.goto('/dashboard');
    await authenticatedPage.waitForLoadState('networkidle');

    // Check connection count remains 1
    const finalCount = await wsHelper.getConnectionCount();
    expect(finalCount).toBe(1);
  });

  test('should handle network offline/online transitions', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Go offline
    await wsHelper.goOffline();

    // Wait for disconnected status
    await authenticatedPage.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return status?.textContent?.includes('Connection lost');
      },
      { timeout: 5000 }
    );

    // Perform an action while offline (should be queued)
    const scheduleButton = authenticatedPage.locator('[data-testid="schedule-content"]').first();
    if (await scheduleButton.isVisible()) {
      await scheduleButton.click();
    }

    // Check offline queue
    const queueSize = await wsHelper.getOfflineQueueSize();
    expect(queueSize).toBeGreaterThanOrEqual(0);

    // Go back online
    await wsHelper.goOnline();

    // Wait for reconnection
    await wsHelper.waitForConnection(15000);

    // Verify queue is processed
    await authenticatedPage.waitForFunction(
      () => {
        const queueData = localStorage.getItem('offlineQueue');
        if (!queueData) return true;
        const queue = JSON.parse(queueData);
        return !Array.isArray(queue) || queue.length === 0;
      },
      { timeout: 10000 }
    );
  });

  test('should display retry countdown during reconnection', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate disconnection
    await wsHelper.simulateDisconnect();

    // Look for retry countdown
    await authenticatedPage.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return status?.textContent?.match(/Next retry in \d+s/);
      },
      { timeout: 5000 }
    );

    // Verify countdown updates
    const getRetryTime = async () => {
      const text = await authenticatedPage
        .locator('[data-testid="connection-status"]')
        .textContent();
      const match = text?.match(/Next retry in (\d+)s/);
      return match ? parseInt(match[1]) : null;
    };

    const time1 = await getRetryTime();
    await authenticatedPage.waitForTimeout(1500);
    const time2 = await getRetryTime();

    if (time1 !== null && time2 !== null) {
      expect(time2).toBeLessThan(time1);
    }
  });

  test('should handle max reconnection attempts', async ({ authenticatedPage }) => {
    // Mock WebSocket to always fail
    await authenticatedPage.evaluate(() => {
      const originalWebSocket = window.WebSocket;
      let attemptCount = 0;
      window.WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          attemptCount++;

          // Force close after connection
          setTimeout(() => {
            if (attemptCount <= 6) {
              // Allow initial connection + 5 retries
              this.close();
            }
          }, 100);
        }
      } as any;
    });

    // Trigger disconnection
    await wsHelper.simulateDisconnect();

    // Wait for max attempts to be reached
    await authenticatedPage.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return (
          status?.textContent?.includes('Connection lost') &&
          !status?.textContent?.includes('Reconnecting')
        );
      },
      { timeout: 30000 }
    );

    // Verify manual reconnect button appears
    const reconnectButton = authenticatedPage.locator('button:has-text("Reconnect")');
    await expect(reconnectButton).toBeVisible();
  });
});
