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
import { WebSocketError, ConnectionError } from '../types/websocket';

export function useSchedulingWebSocket({
  enabled = true,
  onStatusUpdate,
  onCampaignStatusUpdate,
  onCampaignError,
  onConnectionChange,
  onError,
  maxReconnectAttempts = 5,
  heartbeatInterval = 30000,
}: UseSchedulingWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isConnectingRef = useRef(false); // Guard against multiple simultaneous connections
  const countdownIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastConnectionAttemptRef = useRef<number>(0); // Track last connection attempt time

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

  // Type definitions for cache data (moved outside callback for performance)
  type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed';

  interface ContentItem {
    id: string;
    status: ContentStatus;
    [key: string]: unknown;
  }

  interface CacheData {
    content?: ContentItem[];
    [key: string]: unknown;
  }

  // Handle status update and invalidate queries
  const handleStatusUpdate = useCallback(
    (event: StatusUpdateEvent) => {
      setLastUpdate(new Date());

      // Call custom handler if provided
      onStatusUpdate?.(event);

      // Invalidate relevant queries to refresh UI
      queryKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });

      // If this update is related to a campaign, invalidate the campaign query
      if (event.type === 'status_update' && 'contentId' in event.data) {
        const metadata = event.data.metadata as { campaignId?: string } | undefined;
        if (metadata?.campaignId) {
          console.log('Invalidating campaign query for campaign:', metadata.campaignId);
          queryClient.invalidateQueries({ queryKey: ['campaign', metadata.campaignId] });
        }
      }

      // Update cache optimistically if we have the data
      if (event.type === 'status_update' && 'contentId' in event.data) {
        const contentId = event.data.contentId;
        const newStatus = event.data.newStatus;

        // Update content in cache
        queryClient.setQueriesData(
          { queryKey: ['content'] },
          (oldData: CacheData | ContentItem[] | undefined) => {
            if (!oldData) return oldData;

            // Handle array of content
            if (Array.isArray(oldData)) {
              return oldData.map((item: ContentItem) =>
                item.id === contentId ? { ...item, status: newStatus } : item
              );
            }

            // Handle paginated response
            if ('content' in oldData && Array.isArray(oldData.content)) {
              return {
                ...oldData,
                content: oldData.content.map((item: ContentItem) =>
                  item.id === contentId ? { ...item, status: newStatus } : item
                ),
              };
            }

            return oldData;
          }
        );

        // Also update individual post detail cache and clear any processing flags
        queryClient.setQueryData(['post', contentId], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            status: newStatus,
            generationParams: {
              ...(old.generationParams || {}),
              processing: {
                ...(old.generationParams?.processing || {}),
                active: false,
              },
            },
          };
        });
      }
    },
    [queryKeys, queryClient, onStatusUpdate]
  );

  // Exponential backoff calculation with jitter (react-use-websocket pattern)
  const calculateReconnectDelay = useCallback((attemptNumber: number) => {
    // Increase max delay to 30 seconds for JWT expiration scenarios
    const baseDelay = Math.min(Math.pow(2, attemptNumber) * 1000, 30000); // Cap at 30 seconds
    const jitter = Math.random() * 0.1 * baseDelay; // Add 10% jitter to prevent thundering herd
    return Math.floor(baseDelay + jitter);
  }, []);

  // Handle connection status changes
  const handleConnectionChange = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      onConnectionChange?.(status);
    },
    [onConnectionChange]
  );

  // Handle WebSocket errors
  const handleWebSocketError = useCallback(
    (error: Error | Event) => {
      const wsError =
        error instanceof Error
          ? new WebSocketError(error.message, 'WEBSOCKET_ERROR')
          : new ConnectionError('WebSocket connection failed');

      console.error('WebSocket error:', wsError);
      onError?.(wsError);
      handleConnectionChange('error');
    },
    [onError, handleConnectionChange]
  );

  // Message filter to prevent unnecessary re-renders (react-use-websocket pattern)
  const messageFilter = useCallback((message: WebSocketMessage) => {
    // Filter out ping/pong messages to prevent unnecessary updates
    if (message.type === 'ping' || message.type === 'pong') {
      return false;
    }
    return true;
  }, []);

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

      // Always use /ws path through CloudFront on main domain
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log('Connecting to WebSocket at:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        isConnectingRef.current = false; // Reset connecting flag
        handleConnectionChange('connected');
        reconnectAttemptsRef.current = 0;
        setRetryIn(0); // Clear retry countdown

        // Clear countdown interval if exists
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = undefined;
        }

        // Note: Authentication happens automatically via auth_token cookie during handshake
        // Wait for 'authenticated' message from server before subscribing

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, heartbeatInterval);

        // Process any queued offline actions
        if (offlineQueue.getQueueSize() > 0) {
          console.log(`Processing ${offlineQueue.getQueueSize()} offline actions`);
          offlineQueue.processQueue();
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Apply message filter to prevent unnecessary processing
          if (!messageFilter(message)) {
            return;
          }

          if (message.type === 'authenticated') {
            console.log('WebSocket authenticated via cookie');
            // Subscribe to brand room after authentication
            ws.send(
              JSON.stringify({
                type: 'subscribe',
                brandId: selectedBrand.id,
              })
            );
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

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason);
        isConnectingRef.current = false; // Reset connecting flag on close
        handleConnectionChange('disconnected');
        wsRef.current = null;

        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = undefined;
        }

        // Clear any existing countdown
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = undefined;
        }

        // Attempt reconnection if enabled and not at max attempts
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = calculateReconnectDelay(reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;

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
  ]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isConnectingRef.current = false; // Reset connecting flag

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }

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
  }, []);

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
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = undefined;
        }
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
    setRetryIn(0);

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear intervals
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }

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
