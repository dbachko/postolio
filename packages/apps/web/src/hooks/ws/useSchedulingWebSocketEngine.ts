import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { UseSchedulingWebSocketOptions } from '@/types/websocket';
import { useBrandStore } from '@/stores/brandStore';
import { useWsHeartbeat } from './useWsHeartbeat';
import { useSchedulingOfflineQueue } from './useSchedulingOfflineQueue';
import { useSchedulingWebSocketConnection } from './useSchedulingWebSocketConnection';
import { useSchedulingWebSocketHandlers } from './useSchedulingWebSocketHandlers';
import { useSchedulingWebSocketLifecycle } from './useSchedulingWebSocketLifecycle';
import { useSchedulingWebSocketState } from './useSchedulingWebSocketState';

export function useSchedulingWebSocketEngine({
  enabled = true,
  onStatusUpdate,
  onConnectionChange,
  onError,
  maxReconnectAttempts = 5,
  heartbeatInterval = 25000,
}: UseSchedulingWebSocketOptions = {}) {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const queryClient = useQueryClient();
  const { refs, state } = useSchedulingWebSocketState();
  const offlineQueue = useSchedulingOfflineQueue();
  const handlers = useSchedulingWebSocketHandlers({
    selectedBrandId: selectedBrand?.id,
    queryClient,
    onStatusUpdate,
    onConnectionChange,
    onError,
    setConnectionStatus: state.setConnectionStatus,
  });
  const { startHeartbeat, stopHeartbeat } = useWsHeartbeat();
  const { connect, disconnect, reconnect } = useSchedulingWebSocketConnection({
    enabled,
    selectedBrandId: selectedBrand?.id,
    maxReconnectAttempts,
    heartbeatInterval,
    refs,
    state,
    handlers,
    offlineQueue,
    startHeartbeat,
    stopHeartbeat,
    calculateReconnectDelay: handlers.calculateReconnectDelay,
  });

  useSchedulingWebSocketLifecycle({
    enabled,
    selectedBrandId: selectedBrand?.id,
    refs,
    connect,
    disconnect,
    stopHeartbeat,
    setConnectionStatus: state.setConnectionStatus,
    setRetryIn: state.setRetryIn,
  });

  const queueAction = useCallback(
    (type: 'schedule' | 'reschedule' | 'cancel', payload: Record<string, unknown>) => {
      if (state.connectionStatus === 'disconnected' || state.connectionStatus === 'error') {
        return offlineQueue.enqueue(type, payload);
      }
      return null;
    },
    [state.connectionStatus, offlineQueue]
  );

  return {
    connectionStatus: state.connectionStatus,
    lastUpdate: null,
    reconnect,
    disconnect,
    queueAction,
    queueSize: offlineQueue.getQueueSize(),
    clearQueue: offlineQueue.clearQueue,
    retryCount: refs.reconnectAttemptsRef.current,
    retryIn: state.retryIn,
  };
}
