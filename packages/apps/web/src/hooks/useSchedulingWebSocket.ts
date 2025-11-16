import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useBrandStore } from '../stores/brandStore';
import { useQueryClient } from '@tanstack/react-query';
import { useOfflineQueue } from './useOfflineQueue';
import type {
  ConnectionStatus,
  StatusUpdateEvent,
  UseSchedulingWebSocketOptions,
  WebSocketMessage,
} from '../types/websocket';
import { ConnectionError } from '../types/websocket';
import { useWsCacheInvalidation } from './ws/useWsCacheInvalidation';
import { useWsBackoff } from './ws/useWsBackoff';
import { useWsErrorHandler } from './ws/useWsErrorHandler';
import { useWsHeartbeat } from './ws/useWsHeartbeat';

export function useSchedulingWebSocket({
  enabled = true,
  onStatusUpdate,
  onCampaignStatusUpdate,
  onCampaignError,
  onConnectionChange,
  onError,
  maxReconnectAttempts = 5,
  // Server drops sockets after 30s without a heartbeat; stay safely under that threshold.
  heartbeatInterval = 25000,
}: UseSchedulingWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false); // Guard against multiple simultaneous connections
  const countdownIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastConnectionAttemptRef = useRef<number>(0); // Track last connection attempt time
  const isAuthenticatedRef = useRef(false); // Track if server-side auth completed
  const isRefreshingRef = useRef(false); // Prevent duplicate refresh attempts

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [retryIn, setRetryIn] = useState<number>(0);

  // WebSocket now uses cookie-based authentication (auth_token cookie sent automatically with handshake)
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const queryClient = useQueryClient();

  // Track previous brand to detect actual changes
  const previousBrandRef = useRef<string | undefined>(undefined);

  // Offline queue for scheduling actions
  const offlineQueue = useOfflineQueue({
    onProcess: async (action) => {
      try {
        switch (action.type) {
          case 'schedule':
            // TODO: Implement actual API calls when available
            console.log('Would schedule content:', action.payload);
            return true;
          case 'reschedule':
            // TODO: Implement actual API calls when available
            console.log('Would reschedule content:', action.payload);
            return true;
          case 'cancel':
            // TODO: Implement actual API calls when available
            console.log('Would cancel schedule:', action.payload);
            return true;
          default:
            return false;
        }
      } catch (error) {
        console.error('Failed to process offline action:', error);
        return false;
      }
    },
    onError: (action, error) => {
      console.error('Offline action failed permanently:', action, error);
      // Could show a toast notification here
    },
  });

  // Memoize query keys for better performance
  const queryKeys = useMemo(() => {
    if (!selectedBrand?.id) return [];
    return [
      ['content', 'pending', selectedBrand.id],
      ['content', 'scheduled', selectedBrand.id],
      ['content', 'history', selectedBrand.id],
      ['analytics', 'scheduled', selectedBrand.id],
    ];
  }, [selectedBrand?.id]);

  // Handle status update and invalidate queries (extracted)
  const handleStatusUpdate = useWsCacheInvalidation(queryClient, queryKeys, (e) => {
    setLastUpdate(new Date());
    onStatusUpdate?.(e as any);
  }) as (event: StatusUpdateEvent) => void;

  // Exponential backoff calculation with jitter (extracted)
  const calculateReconnectDelay = useWsBackoff();

  // Handle connection status changes
  const handleConnectionChange = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      onConnectionChange?.(status);
    },
    [onConnectionChange]
  );

  // Handle WebSocket errors (extracted)
  const handleWebSocketError = useWsErrorHandler(onError, handleConnectionChange);

  // Message filter to prevent unnecessary re-renders (react-use-websocket pattern)
  const messageFilter = useCallback((message: WebSocketMessage) => {
    // Filter out ping/pong messages to prevent unnecessary updates
    if (message.type === 'ping' || message.type === 'pong') {
      return false;
    }
    return true;
  }, []);

  // Heartbeat management for active WebSocket connections
  const { startHeartbeat, stopHeartbeat } = useWsHeartbeat();

  // Connect to WebSocket
  const connect = useCallback(async () => {
    // Guard against multiple simultaneous connections
    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (!selectedBrand || !enabled) {
      return;
    }

    // Rate limiting: prevent reconnection storms
    const now = Date.now();
    const timeSinceLastAttempt = now - lastConnectionAttemptRef.current;

    // If we've reached max attempts and it's been less than 5 minutes, stop trying
    if (
      reconnectAttemptsRef.current >= maxReconnectAttempts &&
      timeSinceLastAttempt < 5 * 60 * 1000
    ) {
      console.log('Max reconnection attempts reached. Waiting before retry...');
      return;
    }

    // Reset attempts counter if it's been more than 5 minutes since last attempt
    if (timeSinceLastAttempt > 5 * 60 * 1000) {
      reconnectAttemptsRef.current = 0;
    }

    lastConnectionAttemptRef.current = now;
    isConnectingRef.current = true;

    try {
      // Clean up existing connection
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
        wsRef.current = null;
      }

      handleConnectionChange('connecting');

      // Build WebSocket URL
      // - Production: always use /ws on the main app host (behind CloudFront)
      // - Development: connect directly to the API server to avoid bugs in some
      //   dev proxies with Node 22's HTTP upgrade handling.
      let wsUrl: string;
      if (import.meta.env.DEV) {
        const apiBase = (import.meta.env as any).VITE_API_BASE_URL as string | undefined;
        if (apiBase) {
          try {
            const apiUrl = new URL(apiBase);
            const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${apiUrl.host}/ws`;
          } catch {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            wsUrl = `${protocol}//${window.location.hostname}:3000/ws`;
          }
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${protocol}//${window.location.hostname}:3000/ws`;
        }
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/ws`;
      }

      console.log('Connecting to WebSocket at:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        isConnectingRef.current = false; // Reset connecting flag
        // Do not mark as fully connected until server confirms authentication
        handleConnectionChange('connecting');
        setRetryIn(0); // Clear retry countdown

        // Clear countdown interval if exists
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = undefined;
        }

        // Note: Authentication happens automatically via auth_token cookie during handshake
        // Wait for 'authenticated' message from server before subscribing

        // Start heartbeat
        startHeartbeat(wsRef, heartbeatInterval);

        // Process any queued offline actions
        if (offlineQueue.getQueueSize() > 0) {
          console.log(`Processing ${offlineQueue.getQueueSize()} offline actions`);
          offlineQueue.processQueue();
        }
      };

      ws.onmessage = async (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'heartbeat') {
            try {
              ws.send(
                JSON.stringify({
                  type: 'heartbeat_ack',
                  timestamp: Date.now(),
                })
              );
            } catch (error) {
              console.warn('Failed to send WebSocket heartbeat ack', error);
            }
            return;
          }

          // Apply message filter to prevent unnecessary processing
          if (!messageFilter(message)) {
            return;
          }

          if (message.type === 'authenticated') {
            console.log('WebSocket authenticated via cookie');
            // Mark connection as fully established and reset reconnect attempts
            isAuthenticatedRef.current = true;
            reconnectAttemptsRef.current = 0;
            handleConnectionChange('connected');
            // Subscribe to brand room and user notifications room after authentication
            try {
              const rooms: string[] = [];
              if (selectedBrand?.id) rooms.push(`brand:${selectedBrand.id}`);
              const anyMsg: any = message as any;
              if (anyMsg.userId) rooms.push(`user:${anyMsg.userId}`);
              if (rooms.length > 0) {
                ws.send(
                  JSON.stringify({
                    type: 'subscribe',
                    rooms,
                  })
                );
              }
            } catch (e) {
              console.warn('Failed to subscribe to rooms', e);
            }
            return;
          }

          if (message.type === 'subscribed') {
            console.log('Subscribed to rooms:', message.rooms);
            return;
          }

          if (message.type === 'status_update' || message.type === 'batch_status_update') {
            handleStatusUpdate(message as StatusUpdateEvent);
          }

          if (message.type === 'campaign_status_update') {
            console.log('Campaign status update received:', message.data);
            if (onCampaignStatusUpdate && message.data) {
              onCampaignStatusUpdate(
                message.data as import('../types/websocket').CampaignStatusUpdateData
              );
            }
          }

          if (message.type === 'campaign_error') {
            console.log('Campaign error received:', message.data);
            if (onCampaignError && message.data) {
              onCampaignError(message.data as import('../types/websocket').CampaignErrorData);
            }
          }

          // Notifications stream (user room)
          if (message.type === 'notification_created') {
            try {
              const { useNotificationsStore } = await import('../stores/notificationsStore');
              const data: any = (message as any).data;
              // Prepend new item and increment unread
              useNotificationsStore.setState((state: any) => ({
                items: [data, ...state.items].slice(0, 50),
                unreadCount: (state.unreadCount || 0) + 1,
              }));
            } catch (e) {
              console.warn('Failed to process notification_created message', e);
            }
          }
          if (message.type === 'unread_count') {
            try {
              const { useNotificationsStore } = await import('../stores/notificationsStore');
              const count = (message as any)?.data?.count ?? 0;
              useNotificationsStore.setState({ unreadCount: count });
            } catch (e) {
              console.warn('Failed to process unread_count message', e);
            }
          }
        } catch (error) {
          const parseError =
            error instanceof Error ? error : new Error('Failed to parse WebSocket message');
          handleWebSocketError(parseError);
        }
      };

      ws.onerror = (error) => {
        isConnectingRef.current = false; // Reset connecting flag on error
        handleWebSocketError(error);
      };

      ws.onclose = async (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        isConnectingRef.current = false; // Reset connecting flag on close
        handleConnectionChange('disconnected');
        wsRef.current = null;

        // Clear heartbeat
        stopHeartbeat();

        // Clear any existing countdown
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = undefined;
        }

        // Special handling: if auth cookie is missing/invalid, attempt to refresh tokens once
        if (
          event.code === 1008 &&
          /No authentication cookie|Authentication failed/.test(event.reason) &&
          !isRefreshingRef.current
        ) {
          try {
            isRefreshingRef.current = true;
            const { auth } = await import('@/lib/api');
            console.log('[Auth] Attempting refresh due to WebSocket auth error...');
            await auth.refreshToken();
            console.log('[Auth] Token refreshed; reconnecting WebSocket');
          } catch (e) {
            console.warn('[Auth] Refresh failed after WebSocket auth error', e);
          } finally {
            isRefreshingRef.current = false;
          }
        }

        // Capture whether this connection ever authenticated before closing
        const wasAuthenticated = isAuthenticatedRef.current;
        // Reset auth flag on any close
        isAuthenticatedRef.current = false;

        // Attempt reconnection if enabled and not at max attempts
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = calculateReconnectDelay(reconnectAttemptsRef.current);
          // Only increment attempts if we never reached authenticated state
          // This prevents infinite 1/5 loops when server immediately closes after onopen
          if (!wasAuthenticated) reconnectAttemptsRef.current++;

          console.log(
            `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );

          // Set retry countdown
          setRetryIn(delay);

          // Clear any existing countdown interval
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
          }

          // Countdown timer
          countdownIntervalRef.current = setInterval(() => {
            setRetryIn((prev) => {
              if (prev <= 100) {
                if (countdownIntervalRef.current) {
                  clearInterval(countdownIntervalRef.current);
                  countdownIntervalRef.current = undefined;
                }
                return 0;
              }
              return prev - 100;
            });
          }, 100);

          reconnectTimeoutRef.current = setTimeout(() => {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = undefined;
            }
            setRetryIn(0);
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.log(
            `Max reconnection attempts (${maxReconnectAttempts}) reached. Will retry in 5 minutes.`
          );

          // Set a longer timeout (5 minutes) before allowing reconnection attempts again
          reconnectTimeoutRef.current = setTimeout(
            () => {
              reconnectAttemptsRef.current = 0;
              if (enabled && selectedBrand) {
                console.log('Retrying connection after cooldown period...');
                connect();
              }
            },
            5 * 60 * 1000
          ); // 5 minutes

          const maxAttemptsError = new ConnectionError(
            `Max reconnection attempts (${maxReconnectAttempts}) reached. Will retry in 5 minutes.`
          );
          handleWebSocketError(maxAttemptsError);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      const connectionError =
        error instanceof Error
          ? new ConnectionError(error.message)
          : new ConnectionError('Failed to create WebSocket connection');
      handleWebSocketError(connectionError);
    }
  }, [
    selectedBrand,
    enabled,
    handleStatusUpdate,
    onCampaignStatusUpdate,
    onCampaignError,
    calculateReconnectDelay,
    maxReconnectAttempts,
    heartbeatInterval,
    handleConnectionChange,
    handleWebSocketError,
    messageFilter,
    offlineQueue,
    startHeartbeat,
    stopHeartbeat,
  ]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isConnectingRef.current = false; // Reset connecting flag

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    stopHeartbeat();

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = undefined;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
    setRetryIn(0);
  }, [stopHeartbeat]);

  // Effect to manage connection lifecycle - only reconnect on actual brand changes
  useEffect(() => {
    const brandChanged =
      previousBrandRef.current !== undefined && previousBrandRef.current !== selectedBrand?.id;

    // Only connect/disconnect on initial mount or actual brand change
    if (enabled && selectedBrand) {
      // If brand actually changed, disconnect and reconnect
      if (brandChanged && wsRef.current) {
        console.log('Brand changed, reconnecting WebSocket...');
        disconnect();
        setTimeout(() => connect(), 100);
      } else if (!wsRef.current) {
        // Initial connection
        connect();
      }
      previousBrandRef.current = selectedBrand.id;
    } else if (!enabled || !selectedBrand) {
      disconnect();
      previousBrandRef.current = undefined;
    }

    // Cleanup function - only runs on unmount
    return () => {
      // Don't disconnect on every re-render, only on actual unmount
      if (!enabled) {
        isConnectingRef.current = false;

        // Clear all timeouts and intervals
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = undefined;
        }
        stopHeartbeat();
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = undefined;
        }
        // Close WebSocket connection
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        setConnectionStatus('disconnected');
        setRetryIn(0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedBrand?.id]); // Intentionally omit connect/disconnect to prevent loops

  // Ensure sockets are cleaned up when the provider unmounts (StrictMode, hot reload, etc).
  useEffect(() => {
    return () => {
      isConnectingRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = undefined;
      }

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = undefined;
      }

      stopHeartbeat();

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (error) {
          console.warn('Failed to close WebSocket during unmount cleanup', error);
        } finally {
          wsRef.current = null;
        }
      }
    };
  }, [stopHeartbeat]);

  // Manual reconnect function (stable reference using react-use-websocket pattern)
  const reconnect = useCallback(() => {
    // Prevent race conditions by clearing any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = undefined;
    }

    // Reset state
    isConnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
    isAuthenticatedRef.current = false;
    setRetryIn(0);

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear intervals
    stopHeartbeat();

    setConnectionStatus('disconnected');

    // Reconnect after a short delay to ensure clean state
    setTimeout(() => {
      if (enabled && selectedBrand) {
        connect();
      }
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedBrand?.id]); // Stable deps only

  // Helper function to queue action when offline
  const queueAction = useCallback(
    (type: 'schedule' | 'reschedule' | 'cancel', payload: Record<string, unknown>) => {
      if (connectionStatus === 'disconnected' || connectionStatus === 'error') {
        return offlineQueue.enqueue(type, payload);
      }
      return null;
    },
    [connectionStatus, offlineQueue]
  );

  return {
    connectionStatus,
    lastUpdate,
    reconnect,
    disconnect,
    queueAction,
    queueSize: offlineQueue.getQueueSize(),
    clearQueue: offlineQueue.clearQueue,
    retryCount: reconnectAttemptsRef.current,
    retryIn,
  };
}
