import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ConnectionStatus, StatusUpdateEvent, WebSocketMessage } from '@/types/websocket';

export interface SchedulingWebSocketRefs {
  wsRef: MutableRefObject<WebSocket | null>;
  reconnectTimeoutRef: MutableRefObject<NodeJS.Timeout | undefined>;
  reconnectAttemptsRef: MutableRefObject<number>;
  isConnectingRef: MutableRefObject<boolean>;
  countdownIntervalRef: MutableRefObject<NodeJS.Timeout | undefined>;
  lastConnectionAttemptRef: MutableRefObject<number>;
  isAuthenticatedRef: MutableRefObject<boolean>;
  isRefreshingRef: MutableRefObject<boolean>;
  previousBrandRef: MutableRefObject<string | undefined>;
}

export interface SchedulingWebSocketState {
  connectionStatus: ConnectionStatus;
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus>>;
  retryIn: number;
  setRetryIn: Dispatch<SetStateAction<number>>;
}

export interface SchedulingWebSocketHandlers {
  handleConnectionChange: (status: ConnectionStatus) => void;
  handleWebSocketError: (error: Error) => void;
  handleStatusUpdate: (event: StatusUpdateEvent) => void;
  messageFilter: (message: WebSocketMessage) => boolean;
}

export interface SchedulingOfflineQueue {
  enqueue: (type: 'schedule' | 'reschedule' | 'cancel', payload: Record<string, unknown>) => string;
  clearQueue: () => void;
  getQueueSize: () => number;
  processQueue: () => Promise<void> | void;
}

export interface SchedulingWebSocketCallbacks {
  connect: () => Promise<void>;
  disconnect: () => void;
  reconnect: () => void;
}
