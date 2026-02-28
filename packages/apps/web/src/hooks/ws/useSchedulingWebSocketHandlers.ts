import { useCallback, useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  ConnectionStatus,
  StatusUpdateEvent,
  UseSchedulingWebSocketOptions,
} from '@/types/websocket';
import { useWsBackoff } from './useWsBackoff';
import { useWsCacheInvalidation } from './useWsCacheInvalidation';
import { useWsErrorHandler } from './useWsErrorHandler';

interface UseSchedulingWebSocketHandlersParams {
  selectedBrandId?: string;
  queryClient: QueryClient;
  onStatusUpdate?: UseSchedulingWebSocketOptions['onStatusUpdate'];
  onConnectionChange?: UseSchedulingWebSocketOptions['onConnectionChange'];
  onError?: UseSchedulingWebSocketOptions['onError'];
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export function useSchedulingWebSocketHandlers({
  selectedBrandId,
  queryClient,
  onStatusUpdate,
  onConnectionChange,
  onError,
  setConnectionStatus,
}: UseSchedulingWebSocketHandlersParams) {
  const queryKeys = useMemo(() => {
    if (!selectedBrandId) {
      return [];
    }
    return [
      ['calendar', selectedBrandId],
      ['content'],
      ['content', selectedBrandId],
      ['content', 'pending', selectedBrandId],
      ['content', 'scheduled', selectedBrandId],
      ['content', 'history', selectedBrandId],
      ['analytics', 'scheduled', selectedBrandId],
    ];
  }, [selectedBrandId]);
  const handleStatusUpdate = useWsCacheInvalidation(queryClient, queryKeys, (event) => {
    onStatusUpdate?.(event as StatusUpdateEvent);
  }) as (event: StatusUpdateEvent) => void;
  const calculateReconnectDelay = useWsBackoff();
  const handleConnectionChange = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      onConnectionChange?.(status);
    },
    [onConnectionChange, setConnectionStatus]
  );
  const handleWebSocketError = useWsErrorHandler(onError, handleConnectionChange);
  const messageFilter = useCallback((message: { type: string }) => {
    return message.type !== 'ping' && message.type !== 'pong';
  }, []);
  return {
    calculateReconnectDelay,
    handleConnectionChange,
    handleStatusUpdate,
    handleWebSocketError,
    messageFilter,
  };
}
