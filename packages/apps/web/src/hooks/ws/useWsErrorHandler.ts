import { useCallback } from 'react';
import { WebSocketError, ConnectionError } from '@/types/websocket';

export function useWsErrorHandler(
  onError?: (e: any) => void,
  onConnectionChange?: (s: any) => void
) {
  return useCallback(
    (error: Error | Event) => {
      const wsError =
        error instanceof Error
          ? new WebSocketError(error.message, 'WEBSOCKET_ERROR')
          : new ConnectionError('WebSocket connection failed');

      console.error('WebSocket error:', wsError);
      onError?.(wsError);
      onConnectionChange?.('error');
    },
    [onError, onConnectionChange]
  );
}
