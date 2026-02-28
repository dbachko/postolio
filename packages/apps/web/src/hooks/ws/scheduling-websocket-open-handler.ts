import type { MutableRefObject } from 'react';
import { clearIntervalRef } from './scheduling-websocket-utils';

interface CreateSchedulingWebSocketOpenHandlerParams {
  wsRef: MutableRefObject<WebSocket | null>;
  isConnectingRef: MutableRefObject<boolean>;
  countdownIntervalRef: MutableRefObject<NodeJS.Timeout | undefined>;
  heartbeatInterval: number;
  handleConnectionChange: (status: 'connecting') => void;
  setRetryIn: (value: number) => void;
  startHeartbeat: (wsRef: MutableRefObject<WebSocket | null>, interval?: number) => void;
  getQueueSize: () => number;
  processQueue: () => Promise<void> | void;
}

export function createSchedulingWebSocketOpenHandler({
  wsRef,
  isConnectingRef,
  countdownIntervalRef,
  heartbeatInterval,
  handleConnectionChange,
  setRetryIn,
  startHeartbeat,
  getQueueSize,
  processQueue,
}: CreateSchedulingWebSocketOpenHandlerParams) {
  return () => {
    isConnectingRef.current = false;
    handleConnectionChange('connecting');
    setRetryIn(0);
    clearIntervalRef(countdownIntervalRef);
    startHeartbeat(wsRef, heartbeatInterval);

    if (getQueueSize() > 0) {
      processQueue();
    }
  };
}
