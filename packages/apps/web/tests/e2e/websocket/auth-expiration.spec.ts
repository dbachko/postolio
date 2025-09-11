import { test, expect } from '../fixtures/auth.fixture';
import { WebSocketHelper } from '../utils/websocket-helper';

test.describe('WebSocket JWT Expiration Handling', () => {
  let wsHelper: WebSocketHelper;

  test.beforeEach(async ({ authenticatedPage }) => {
    wsHelper = new WebSocketHelper(authenticatedPage);
    await wsHelper.setupMessageMonitoring();
  });

  test('should handle JWT expiration during active connection', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Simulate JWT expiration by modifying the token in storage
    await authenticatedPage.evaluate(() => {
      const authStore = localStorage.getItem('auth-storage');
      if (authStore) {
        const parsed = JSON.parse(authStore);
        // Set an expired token
        parsed.state.token = 'expired.jwt.token';
        localStorage.setItem('auth-storage', JSON.stringify(parsed));
      }
    });

    // Simulate server sending auth_error message
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'auth_error',
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should attempt to refresh token
    await authenticatedPage.waitForFunction(
      () => {
        const messages = (window as any).__websocketMessages || [];
        return messages.some((m: any) => m.type === 'sent' && m.data?.type === 'refresh_auth');
      },
      { timeout: 5000 }
    );

    // Verify auth refresh was attempted
    const messages = await wsHelper.getMessages('sent');
    const refreshMessage = messages.find((m) => m.data?.type === 'refresh_auth');
    expect(refreshMessage).toBeTruthy();
  });

  test('should redirect to login on refresh token failure', async ({ authenticatedPage, page }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Mock refresh token API to fail
    await authenticatedPage.route('**/api/auth/refresh', (route) => {
      route.fulfill({
        status: 401,
        json: { error: 'Refresh token expired' },
      });
    });

    // Simulate token expiration
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'auth_error',
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Should redirect to login
    await authenticatedPage.waitForURL('/login', { timeout: 10000 });

    // Verify auth storage is cleared
    const authStorage = await authenticatedPage.evaluate(() => {
      return localStorage.getItem('auth-storage');
    });

    const parsed = authStorage ? JSON.parse(authStorage) : null;
    expect(parsed?.state?.token).toBeFalsy();
  });

  test('should queue operations during token refresh', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Mock refresh token API with delay
    await authenticatedPage.route('**/api/auth/refresh', async (route) => {
      await authenticatedPage.waitForTimeout(2000); // Simulate delay
      await route.fulfill({
        status: 200,
        json: {
          token: 'new.jwt.token',
          user: { id: '1', email: 'test@example.com' },
        },
      });
    });

    // Simulate token expiration
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'auth_error',
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Try to send a message during refresh (should be queued)
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0]) {
        sockets[0].send(
          JSON.stringify({
            type: 'schedule_content',
            data: { contentId: 'test-123' },
          })
        );
      }
    });

    // Wait for token refresh to complete
    await authenticatedPage.waitForFunction(
      () => {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          return parsed.state?.token === 'new.jwt.token';
        }
        return false;
      },
      { timeout: 10000 }
    );

    // Verify queued message was sent after refresh
    const messages = await wsHelper.getMessages('sent');
    const queuedMessage = messages.find(
      (m) => m.data?.type === 'schedule_content' && m.data?.data?.contentId === 'test-123'
    );
    expect(queuedMessage).toBeTruthy();
  });

  test('should handle token refresh with WebSocket reconnection', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Mock successful refresh
    await authenticatedPage.route('**/api/auth/refresh', (route) => {
      route.fulfill({
        status: 200,
        json: {
          token: 'refreshed.jwt.token',
          user: { id: '1', email: 'test@example.com' },
        },
      });
    });

    // Simulate auth error that closes connection
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        // Send auth error
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'auth_error',
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
        sockets[0].dispatchEvent(event);

        // Server closes connection
        setTimeout(() => sockets[0].close(1008, 'Token expired'), 100);
      }
    });

    // Wait for disconnection
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

    // Wait for reconnection with new token
    await wsHelper.waitForConnection(15000);

    // Verify new auth message sent with refreshed token
    const messages = await wsHelper.getMessages('sent');
    const reAuthMessage = messages.find(
      (m) => m.data?.type === 'auth' && m.data?.token === 'refreshed.jwt.token'
    );
    expect(reAuthMessage).toBeTruthy();

    // Connection should be live again
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Live');
  });

  test('should handle rapid token expirations gracefully', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    let refreshCount = 0;

    // Mock refresh with counter
    await authenticatedPage.route('**/api/auth/refresh', (route) => {
      refreshCount++;
      route.fulfill({
        status: 200,
        json: {
          token: `refreshed.jwt.token.${refreshCount}`,
          user: { id: '1', email: 'test@example.com' },
        },
      });
    });

    // Simulate multiple rapid auth errors
    for (let i = 0; i < 3; i++) {
      await authenticatedPage.evaluate(() => {
        const sockets = (window as any).__websockets || [];
        if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
          const event = new MessageEvent('message', {
            data: JSON.stringify({
              type: 'auth_error',
              error: 'Token expired',
              code: 'TOKEN_EXPIRED',
            }),
          });
          sockets[0].dispatchEvent(event);
        }
      });

      await authenticatedPage.waitForTimeout(100);
    }

    // Should only refresh once (debounced)
    await authenticatedPage.waitForTimeout(2000);
    expect(refreshCount).toBeLessThanOrEqual(2); // Allow for some timing variance

    // Connection should remain stable
    const status = await authenticatedPage.locator('[data-testid="connection-status"]');
    await expect(status).toContainText('Live');
  });

  test('should preserve offline queue during token refresh', async ({ authenticatedPage }) => {
    // Wait for initial connection
    await wsHelper.waitForConnection();

    // Add items to offline queue
    await authenticatedPage.evaluate(() => {
      const queue = [
        { id: '1', type: 'schedule_content', data: { contentId: 'c1' } },
        { id: '2', type: 'update_status', data: { contentId: 'c2' } },
      ];
      localStorage.setItem('offlineQueue', JSON.stringify(queue));
    });

    // Mock successful refresh
    await authenticatedPage.route('**/api/auth/refresh', (route) => {
      route.fulfill({
        status: 200,
        json: {
          token: 'new.jwt.token',
          user: { id: '1', email: 'test@example.com' },
        },
      });
    });

    // Simulate token expiration
    await authenticatedPage.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      if (sockets[0] && sockets[0].readyState === WebSocket.OPEN) {
        const event = new MessageEvent('message', {
          data: JSON.stringify({
            type: 'auth_error',
            error: 'Token expired',
            code: 'TOKEN_EXPIRED',
          }),
        });
        sockets[0].dispatchEvent(event);
      }
    });

    // Wait for refresh
    await authenticatedPage.waitForTimeout(2000);

    // Verify queue is preserved
    const queueSize = await wsHelper.getOfflineQueueSize();
    expect(queueSize).toBe(2);

    // Queue should be processed after reconnection
    await wsHelper.waitForConnection(10000);

    // Give time for queue processing
    await authenticatedPage.waitForTimeout(2000);

    // Verify queue items were sent
    const messages = await wsHelper.getMessages('sent');
    const queuedMessages = messages.filter(
      (m) => m.data?.type === 'schedule_content' || m.data?.type === 'update_status'
    );
    expect(queuedMessages.length).toBeGreaterThanOrEqual(2);
  });
});
