import { useEffect } from 'react';
import type { SchedulingWebSocketRefs } from './scheduling-websocket-types';
import {
  clearIntervalRef,
  clearTimeoutRef,
  closeWebSocketRefSafely,
} from './scheduling-websocket-utils';

interface UseSchedulingWebSocketLifecycleParams {
  enabled: boolean;
  selectedBrandId?: string;
  refs: SchedulingWebSocketRefs;
  connect: () => Promise<void>;
  disconnect: () => void;
  stopHeartbeat: () => void;
  setConnectionStatus: (status: 'disconnected') => void;
  setRetryIn: (value: number) => void;
}

function cleanupAll({
  refs,
  stopHeartbeat,
  setConnectionStatus,
  setRetryIn,
}: Pick<
  UseSchedulingWebSocketLifecycleParams,
  'refs' | 'stopHeartbeat' | 'setConnectionStatus' | 'setRetryIn'
>) {
  refs.isConnectingRef.current = false;
  clearTimeoutRef(refs.reconnectTimeoutRef);
  stopHeartbeat();
  clearIntervalRef(refs.countdownIntervalRef);
  closeWebSocketRefSafely(refs.wsRef);
  setConnectionStatus('disconnected');
  setRetryIn(0);
}

export function useSchedulingWebSocketLifecycle({
  enabled,
  selectedBrandId,
  refs,
  connect,
  disconnect,
  stopHeartbeat,
  setConnectionStatus,
  setRetryIn,
}: UseSchedulingWebSocketLifecycleParams) {
  useEffect(() => {
    const brandChanged =
      refs.previousBrandRef.current !== undefined &&
      refs.previousBrandRef.current !== selectedBrandId;

    if (enabled && selectedBrandId) {
      if (brandChanged && refs.wsRef.current) {
        disconnect();
        setTimeout(() => {
          void connect();
        }, 100);
      } else if (!refs.wsRef.current) {
        void connect();
      }
      refs.previousBrandRef.current = selectedBrandId;
    } else {
      disconnect();
      refs.previousBrandRef.current = undefined;
    }

    return () => {
      if (!enabled) {
        cleanupAll({ refs, stopHeartbeat, setConnectionStatus, setRetryIn });
      }
    };
  }, [
    enabled,
    selectedBrandId,
    refs,
    connect,
    disconnect,
    stopHeartbeat,
    setConnectionStatus,
    setRetryIn,
  ]);

  useEffect(() => {
    return () => {
      cleanupAll({ refs, stopHeartbeat, setConnectionStatus, setRetryIn });
    };
  }, [refs, stopHeartbeat, setConnectionStatus, setRetryIn]);
}
