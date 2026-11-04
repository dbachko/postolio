import { useMemo, useRef, useState } from 'react';
import type { ConnectionStatus } from '@/types/websocket';
import type {
  SchedulingWebSocketRefs,
  SchedulingWebSocketState,
} from './scheduling-websocket-types';

export function useSchedulingWebSocketState() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const isConnectingRef = useRef(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const lastConnectionAttemptRef = useRef<number>(0);
  const isAuthenticatedRef = useRef(false);
  const isRefreshingRef = useRef(false);
  const previousBrandRef = useRef<string | undefined>(undefined);
  const refs = useMemo<SchedulingWebSocketRefs>(
    () => ({
      wsRef,
      reconnectTimeoutRef,
      reconnectAttemptsRef,
      isConnectingRef,
      countdownIntervalRef,
      lastConnectionAttemptRef,
      isAuthenticatedRef,
      isRefreshingRef,
      previousBrandRef,
    }),
    [
      wsRef,
      reconnectTimeoutRef,
      reconnectAttemptsRef,
      isConnectingRef,
      countdownIntervalRef,
      lastConnectionAttemptRef,
      isAuthenticatedRef,
      isRefreshingRef,
      previousBrandRef,
    ]
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [retryIn, setRetryIn] = useState(0);
  const state: SchedulingWebSocketState = {
    connectionStatus,
    setConnectionStatus,
    retryIn,
    setRetryIn,
  };
  return { refs, state };
}
