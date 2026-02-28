import { useRef, useState } from 'react';
import type { ConnectionStatus } from '@/types/websocket';
import type {
  SchedulingWebSocketRefs,
  SchedulingWebSocketState,
} from './scheduling-websocket-types';

export function useSchedulingWebSocketState() {
  const refs: SchedulingWebSocketRefs = {
    wsRef: useRef<WebSocket | null>(null),
    reconnectTimeoutRef: useRef<NodeJS.Timeout | undefined>(undefined),
    reconnectAttemptsRef: useRef(0),
    isConnectingRef: useRef(false),
    countdownIntervalRef: useRef<NodeJS.Timeout | undefined>(undefined),
    lastConnectionAttemptRef: useRef<number>(0),
    isAuthenticatedRef: useRef(false),
    isRefreshingRef: useRef(false),
    previousBrandRef: useRef<string | undefined>(undefined),
  };
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
