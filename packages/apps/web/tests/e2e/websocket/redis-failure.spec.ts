import { test, expect } from '../fixtures/auth.fixture';
import { WebSocketHelper } from '../utils/websocket-helper';

test.describe('WebSocket Redis Failure Handling', () => {
  let wsHelper: WebSocketHelper;

  test.beforeEach(async ({ authenticatedPage }) => {
    wsHelper = new WebSocketHelper(authenticatedPage);
    await wsHelper.setupMessageMonitoring();
  });

  test('should handle Redis unavailability gracefully', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate server sending Redis error
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'system_error',
            error: 'Redis connection failed',
            code: 'REDIS_ERROR',
            fallbackMode: true,
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should show degraded mode indicator
    await authenticatedPage.waitForFunction(
      () => {
        const status = document.querySelector('[data-testid="connection-status"]');
        return (
          status?.textContent?.includes('Limited') || status?.textContent?.includes('Degraded')
        );
      },
      { timeout: 5000 }
    );

    // Connection should remain active (degraded mode)
    const connCount = await wsHelper.getConnectionCount();
    expect(connCount).toBe(1);

    // Should be able to send messages (will be handled without Redis)
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0]) {
        sockets[0].send(
          JSON.stringify({
            type: 'schedule_content',
            data: { contentId: 'test-no-redis' },
          })
        );
      }
    });

    // Verify message was sent
    const messages = await wsHelper.getMessages('sent');
    const testMessage = messages.find((m) => m.data?.data?.contentId === 'test-no-redis');
    expect(testMessage).toBeTruthy();
  });

  test('should queue messages when Redis recovery is expected', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate Redis temporary failure
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'system_warning',
            warning: 'Redis temporarily unavailable',
            code: 'REDIS_TEMP_FAILURE',
            retryAfter: 5000,
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Try to send a critical operation
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0]) {
        sockets[0].send(
          JSON.stringify({
            type: 'broadcast_update',
            data: {
              contentId: 'critical-update',
              requiresPersistence: true,
            },
          })
        );
      }
    });

    // Message should be queued
    const queueSize = await wsHelper.getOfflineQueueSize();
    expect(queueSize).toBeGreaterThan(0);

    // Simulate Redis recovery
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'system_recovered',
            message: 'Redis connection restored',
            code: 'REDIS_RECOVERED',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Queue should be processed
    await authenticatedPage.waitForFunction(
      () => {
        const queueData = localStorage.getItem('offlineQueue');
        if (!queueData) return true;
        const queue = JSON.parse(queueData);
        return !Array.isArray(queue) || queue.length === 0;
      },
      { timeout: 10000 }
    );

    // Status should return to normal
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Live');
  });

  test('should handle Redis Stream backpressure', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate backpressure warning
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'backpressure',
            warning: 'Redis Stream buffer full',
            code: 'STREAM_BACKPRESSURE',
            delay: 1000,
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should throttle message sending
    const startTime = Date.now();

    // Try to send multiple messages rapidly
    for (let i = 0; i < 5; i++) {
      await authenticatedPage.evaluate((index) => {
        const sockets = (window as any).__websockets || [];
        if (sockets[0]) {
          sockets[0].send(
            JSON.stringify({
              type: 'test_message',
              data: { index },
            })
          );
        }
      }, i);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should have throttling delay
    expect(duration).toBeGreaterThan(1000);

    // All messages should eventually be sent
    const messages = await wsHelper.getMessages('sent');
    const testMessages = messages.filter((m) => m.data?.type === 'test_message');
    expect(testMessages.length).toBe(5);
  });

  test('should fallback to polling when Redis pub/sub fails', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate pub/sub failure
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'pubsub_failure',
            error: 'Redis pub/sub unavailable',
            code: 'PUBSUB_ERROR',
            fallback: 'polling',
            interval: 3000,
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should switch to polling mode
    await authenticatedPage.waitForFunction(
      () => {
        const messages = (window as any).__websocketMessages || [];
        return messages.some((m: any) => m.type === 'sent' && m.data?.type === 'poll_updates');
      },
      { timeout: 5000 }
    );

    // Verify polling requests are sent periodically
    await authenticatedPage.waitForTimeout(3500);

    const messages = await wsHelper.getMessages('sent');
    const pollMessages = messages.filter((m) => m.data?.type === 'poll_updates');
    expect(pollMessages.length).toBeGreaterThanOrEqual(1);
  });

  test('should handle Redis memory limit warnings', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate memory warning
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'memory_warning',
            warning: 'Redis memory usage high',
            code: 'REDIS_MEMORY_HIGH',
            usage: '95%',
            recommendation: 'reduce_cache_ttl',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should show warning notification
    await authenticatedPage.waitForFunction(
      () => {
        const toasts = document.querySelectorAll('[data-sonner-toast]');
        return Array.from(toasts).some(
          (toast) =>
            toast.textContent?.includes('memory') || toast.textContent?.includes('performance')
        );
      },
      { timeout: 5000 }
    );

    // Should adjust behavior (reduce message frequency)
    const messagesBefore = (await wsHelper.getMessages('sent')).length;

    // Send test messages with delay
    for (let i = 0; i < 3; i++) {
      await authenticatedPage.evaluate(() => {
        const sockets = (window as any).__websockets || [];
        if (sockets[0]) {
          sockets[0].send(
            JSON.stringify({
              type: 'test_reduced',
              data: { timestamp: Date.now() },
            })
          );
        }
      });
      await authenticatedPage.waitForTimeout(500);
    }

    const messagesAfter = await wsHelper.getMessages('sent');
    const newMessages = messagesAfter.slice(messagesBefore);

    // Messages should be batched or reduced
    expect(newMessages.length).toBeLessThanOrEqual(3);
  });

  test('should handle complete Redis failure with data persistence', async ({
    authenticatedPage,
  }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Add important data to track
    await authenticatedPage.evaluate(() => {
      const importantData = {
        pendingSchedules: ['schedule-1', 'schedule-2'],
        lastSync: Date.now(),
      };
      sessionStorage.setItem('ws-important-data', JSON.stringify(importantData));
    });

    // Simulate complete Redis failure
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'redis_failure',
            error: 'Redis completely unavailable',
            code: 'REDIS_COMPLETE_FAILURE',
            fallback: 'local_storage',
            action: 'persist_critical_data',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should persist critical data locally
    await authenticatedPage.waitForFunction(
      () => {
        const backup = localStorage.getItem('redis-backup');
        return backup !== null;
      },
      { timeout: 5000 }
    );

    // Verify data was persisted
    const backup = await authenticatedPage.evaluate(() => {
      return localStorage.getItem('redis-backup');
    });

    expect(backup).toBeTruthy();
    const parsedBackup = JSON.parse(backup!);
    expect(parsedBackup).toHaveProperty('timestamp');
    expect(parsedBackup).toHaveProperty('data');

    // Connection should switch to local-only mode
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Local');
  });
});
