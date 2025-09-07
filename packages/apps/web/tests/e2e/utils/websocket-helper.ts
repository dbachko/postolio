import { Page } from '@playwright/test';

export class WebSocketHelper {
  constructor(private page: Page) {}

  /**
   * Wait for WebSocket connection to be established
   */
  async waitForConnection(timeout = 10000): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const connectionStatus = document.querySelector('[data-testid="connection-status"]');
        return connectionStatus?.textContent?.includes('Live');
      },
      { timeout }
    );
  }

  /**
   * Simulate network disconnection
   */
  async simulateDisconnect(): Promise<void> {
    await this.page.evaluate(() => {
      // Close all WebSocket connections
      const sockets = (window as any).__websockets || [];
      sockets.forEach((ws: WebSocket) => ws.close());
    });
  }

  /**
   * Monitor WebSocket messages
   */
  async setupMessageMonitoring(): Promise<void> {
    await this.page.evaluateOnNewDocument(() => {
      (window as any).__websocketMessages = [];
      (window as any).__websockets = [];
      
      const originalWebSocket = window.WebSocket;
      window.WebSocket = class extends originalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          
          (window as any).__websockets.push(this);
          
          // Monitor messages
          this.addEventListener('message', (event) => {
            try {
              const data = JSON.parse(event.data);
              (window as any).__websocketMessages.push({
                type: 'received',
                data,
                timestamp: Date.now(),
              });
            } catch (e) {
              // Ignore non-JSON messages
            }
          });
          
          // Monitor sent messages
          const originalSend = this.send.bind(this);
          this.send = (data: string | Blob | ArrayBuffer | ArrayBufferView) => {
            try {
              if (typeof data === 'string') {
                const parsed = JSON.parse(data);
                (window as any).__websocketMessages.push({
                  type: 'sent',
                  data: parsed,
                  timestamp: Date.now(),
                });
              }
            } catch (e) {
              // Ignore non-JSON messages
            }
            return originalSend(data);
          };
        }
      } as any;
    });
  }

  /**
   * Get all WebSocket messages
   */
  async getMessages(type?: 'sent' | 'received'): Promise<any[]> {
    return await this.page.evaluate((filterType) => {
      const messages = (window as any).__websocketMessages || [];
      if (filterType) {
        return messages.filter((m: any) => m.type === filterType);
      }
      return messages;
    }, type);
  }

  /**
   * Wait for specific message type
   */
  async waitForMessage(messageType: string, timeout = 5000): Promise<any> {
    return await this.page.waitForFunction(
      (type) => {
        const messages = (window as any).__websocketMessages || [];
        return messages.find((m: any) => 
          m.type === 'received' && m.data?.type === type
        );
      },
      type,
      { timeout }
    );
  }

  /**
   * Get connection count
   */
  async getConnectionCount(): Promise<number> {
    return await this.page.evaluate(() => {
      const sockets = (window as any).__websockets || [];
      return sockets.filter((ws: WebSocket) => ws.readyState === WebSocket.OPEN).length;
    });
  }

  /**
   * Simulate offline mode
   */
  async goOffline(): Promise<void> {
    await this.page.context().setOffline(true);
  }

  /**
   * Simulate online mode
   */
  async goOnline(): Promise<void> {
    await this.page.context().setOffline(false);
  }

  /**
   * Get offline queue size
   */
  async getOfflineQueueSize(): Promise<number> {
    return await this.page.evaluate(() => {
      const queueData = localStorage.getItem('offlineQueue');
      if (queueData) {
        const queue = JSON.parse(queueData);
        return Array.isArray(queue) ? queue.length : 0;
      }
      return 0;
    });
  }

  /**
   * Clear offline queue
   */
  async clearOfflineQueue(): Promise<void> {
    await this.page.evaluate(() => {
      localStorage.removeItem('offlineQueue');
    });
  }
}