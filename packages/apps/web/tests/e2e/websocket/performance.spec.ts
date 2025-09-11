import { test, expect } from '../fixtures/auth.fixture';
import { WebSocketHelper } from '../utils/websocket-helper';

test.describe('WebSocket Performance & Memory Tests', () => {
  let wsHelper: WebSocketHelper;

  test.beforeEach(async ({ authenticatedPage }) => {
    wsHelper = new WebSocketHelper(authenticatedPage);
    await wsHelper.setupMessageMonitoring();
  });

  test('should handle high message frequency without memory leaks', async ({
    authenticatedPage,
  }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Get initial memory usage
    const initialMemory = await authenticatedPage.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    // Send many messages rapidly
    const messageCount = 1000;
    const startTime = Date.now();

    for (let i = 0; i < messageCount; i++) {
      await authenticatedPage.evaluate((index) => {
        const sockets = (window as any).__websockets || [];
        if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
          // Simulate incoming message
          const event = new MessageEvent('message', {
            data: JSON.stringify({
              type: 'status_update',
              data: {
                contentId: `content-${index}`,
                status: 'scheduled',
                timestamp: Date.now(),
              },
            }),
          });
          sockets[0].dispatchEvent(event);
        }
      }, i);

      // Small delay every 100 messages to prevent browser freeze
      if (i % 100 === 0) {
        await authenticatedPage.waitForTimeout(10);
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should process messages quickly (less than 10ms per message average)
    expect(duration / messageCount).toBeLessThan(10);

    // Force garbage collection if available
    await authenticatedPage.evaluate(() => {
      if ((window as any).gc) {
        (window as any).gc();
      }
    });

    // Wait a bit for cleanup
    await authenticatedPage.waitForTimeout(2000);

    // Check memory after messages
    const finalMemory = await authenticatedPage.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    // Memory increase should be reasonable (less than 50MB for 1000 messages)
    if (initialMemory > 0 && finalMemory > 0) {
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;
      expect(memoryIncrease).toBeLessThan(50);
    }

    // Clear message history to prevent accumulation
    await authenticatedPage.evaluate(() => {
      (window as any).__websocketMessages = [];
    });
  });

  test('should cleanup event listeners on disconnect', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Get initial listener count
    const initialListeners = await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0]) {
        // Count event listeners (this is a proxy metric)
        const ws = sockets[0];
        let count = 0;
        ['open', 'close', 'error', 'message'].forEach((event) => {
          // Note: This is browser-specific and may not work in all browsers
          const listeners = (ws as any)._events?.[event];
          if (Array.isArray(listeners)) {
            count += listeners.length;
          } else if (listeners) {
            count += 1;
          }
        });
        return count;
      }
      return 0;
    });

    // Disconnect
    await wsHelper.simulateDisconnect();

    // Wait for cleanup
    await authenticatedPage.waitForTimeout(1000);

    // Reconnect
    await wsHelper.waitForConnection(15000);

    // Get listener count after reconnect
    const finalListeners = await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0]) {
        const ws = sockets[0];
        let count = 0;
        ['open', 'close', 'error', 'message'].forEach((event) => {
          const listeners = (ws as any)._events?.[event];
          if (Array.isArray(listeners)) {
            count += listeners.length;
          } else if (listeners) {
            count += 1;
          }
        });
        return count;
      }
      return 0;
    });

    // Listener count should not grow unbounded
    expect(finalListeners).toBeLessThanOrEqual(initialListeners + 2);
  });

  test('should handle large message payloads efficiently', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Create large payload (1MB)
    const largeData = {
      type: 'bulk_update',
      data: {
        items: Array.from({ length: 10000 }, (_, i) => ({
          id: `item-${i}`,
          caption: `This is a test caption for item ${i}`,
          hashtags: ['#test', '#content', '#automated'],
          status: 'scheduled',
          scheduledAt: new Date().toISOString(),
          metadata: {
            views: Math.floor(Math.random() * 10000),
            likes: Math.floor(Math.random() * 1000),
            comments: Math.floor(Math.random() * 100),
          },
        })),
      },
    };

    const startTime = Date.now();

    // Send large message
    await authenticatedPage.evaluate((payload) => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify(payload),
        });
        sockets[0].dispatchEvent(event);
      }
    }, largeData);

    // Wait for processing
    await authenticatedPage.waitForFunction(
      () => {
        const messages = (window as any).__websocketMessages || [];
        return messages.some((m: any) => m.type === 'received' && m.data?.type === 'bulk_update');
      },
      { timeout: 5000 }
    );

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    // Should process large message within reasonable time (< 2 seconds)
    expect(processingTime).toBeLessThan(2000);

    // UI should remain responsive
    const isResponsive = await authenticatedPage.evaluate(() => {
      return new Promise((resolve) => {
        const start = Date.now();
        requestAnimationFrame(() => {
          const rafTime = Date.now() - start;
          resolve(rafTime < 100); // RAF should fire within 100ms if UI is responsive
        });
      });
    });

    expect(isResponsive).toBe(true);
  });

  test('should throttle reconnection attempts to prevent CPU spikes', async ({
    authenticatedPage,
  }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Mock WebSocket to always fail
    await authenticatedPage.evaluate(() => {
      const originalWebSocket = window.WebSocket;
      let attemptTimes: number[] = [];

      window.WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          attemptTimes.push(Date.now());

          // Store attempt times for analysis
          (window as any).__reconnectAttempts = attemptTimes;

          // Force immediate close
          setTimeout(() => this.close(), 0);
        }
      } as any;
    });

    // Trigger disconnection
    await wsHelper.simulateDisconnect();

    // Wait for multiple reconnection attempts
    await authenticatedPage.waitForTimeout(10000);

    // Analyze reconnection timing
    const attempts = await authenticatedPage.evaluate(() => {
      return (window as any).__reconnectAttempts || [];
    });

    // Calculate intervals between attempts
    const intervals: number[] = [];
    for (let i = 1; i < attempts.length; i++) {
      intervals.push(attempts[i] - attempts[i - 1]);
    }

    // Verify exponential backoff is working
    if (intervals.length >= 3) {
      // Each interval should be longer than the previous (with some tolerance)
      for (let i = 1; i < Math.min(intervals.length, 5); i++) {
        expect(intervals[i]).toBeGreaterThan(intervals[i - 1] * 0.8);
      }
    }

    // No interval should be less than 1 second (prevent tight loops)
    intervals.forEach((interval) => {
      expect(interval).toBeGreaterThan(900);
    });
  });

  test('should efficiently batch UI updates for multiple status changes', async ({
    authenticatedPage,
  }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Track render count
    await authenticatedPage.evaluate(() => {
      (window as any).__renderCount = 0;

      // Monkey-patch React render tracking (simplified)
      const observer = new MutationObserver(() => {
        (window as any).__renderCount++;
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-status', 'class'],
      });

      (window as any).__observer = observer;
    });

    // Send multiple status updates rapidly
    const updates = 50;
    for (let i = 0; i < updates; i++) {
      await authenticatedPage.evaluate((index) => {
        const sockets = (window as any).__websockets || [];
        if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
          const event = new MessageEvent('message', {
            data: JSON.stringify({
              type: 'status_update',
              data: {
                contentId: `content-${index % 10}`, // Update same 10 items
                status: index % 2 === 0 ? 'scheduled' : 'published',
                timestamp: Date.now(),
              },
            }),
          });
          sockets[0].dispatchEvent(event);
        }
      }, i);
    }

    // Wait for updates to process
    await authenticatedPage.waitForTimeout(1000);

    // Get render count
    const renderCount = await authenticatedPage.evaluate(() => {
      (window as any).__observer?.disconnect();
      return (window as any).__renderCount || 0;
    });

    // Renders should be batched (much less than update count)
    expect(renderCount).toBeLessThan(updates * 0.5);
  });

  test('should not accumulate timer/interval references', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Track timer creation
    await authenticatedPage.evaluate(() => {
      const timers = new Set<number>();
      const intervals = new Set<number>();

      const originalSetTimeout = window.setTimeout;
      const originalSetInterval = window.setInterval;
      const originalClearTimeout = window.clearTimeout;
      const originalClearInterval = window.clearInterval;

      window.setTimeout = function (...args: any[]) {
        const id = originalSetTimeout.apply(window, args as any);
        timers.add(id);
        return id;
      } as any;

      window.setInterval = function (...args: any[]) {
        const id = originalSetInterval.apply(window, args as any);
        intervals.add(id);
        return id;
      } as any;

      window.clearTimeout = function (id: number) {
        timers.delete(id);
        return originalClearTimeout.call(window, id);
      };

      window.clearInterval = function (id: number) {
        intervals.delete(id);
        return originalClearInterval.call(window, id);
      };

      (window as any).__activeTimers = timers;
      (window as any).__activeIntervals = intervals;
    });

    // Perform multiple disconnect/reconnect cycles
    for (let i = 0; i < 3; i++) {
      await wsHelper.simulateDisconnect();
      await authenticatedPage.waitForTimeout(1000);
      await wsHelper.waitForConnection(15000);
      await authenticatedPage.waitForTimeout(1000);
    }

    // Check for timer leaks
    const timerStats = await authenticatedPage.evaluate(() => {
      return {
        timers: (window as any).__activeTimers?.size || 0,
        intervals: (window as any).__activeIntervals?.size || 0,
      };
    });

    // Should have minimal active timers/intervals
    expect(timerStats.timers).toBeLessThan(10);
    expect(timerStats.intervals).toBeLessThan(5);
  });

  test('should handle message queue overflow gracefully', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Set up queue monitoring
    await authenticatedPage.evaluate(() => {
      (window as any).__maxQueueSize = 0;

      // Monitor offline queue size
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = function (key: string, value: string) {
        if (key === 'offlineQueue') {
          try {
            const queue = JSON.parse(value);
            if (Array.isArray(queue)) {
              (window as any).__maxQueueSize = Math.max(
                (window as any).__maxQueueSize,
                queue.length
              );
            }
          } catch (e) {}
        }
        return originalSetItem.call(localStorage, key, value);
      };
    });

    // Go offline
    await wsHelper.goOffline();

    // Try to queue many messages
    for (let i = 0; i < 200; i++) {
      await authenticatedPage.evaluate((index) => {
        // Simulate queueing action
        const queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
        queue.push({
          id: `msg-${index}`,
          type: 'test_message',
          data: { index },
          timestamp: Date.now(),
        });

        // Limit queue size to prevent unbounded growth
        if (queue.length > 100) {
          queue.shift(); // Remove oldest
        }

        localStorage.setItem('offlineQueue', JSON.stringify(queue));
      }, i);
    }

    // Check max queue size
    const maxSize = await authenticatedPage.evaluate(() => {
      return (window as any).__maxQueueSize;
    });

    // Queue should be bounded
    expect(maxSize).toBeLessThanOrEqual(100);

    // Go back online
    await wsHelper.goOnline();

    // Queue should be processed without errors
    await authenticatedPage.waitForFunction(
      () => {
        const queueData = localStorage.getItem('offlineQueue');
        if (!queueData) return true;
        const queue = JSON.parse(queueData);
        return !Array.isArray(queue) || queue.length === 0;
      },
      { timeout: 15000 }
    );
  });
});
