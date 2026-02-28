import { useCallback, type MutableRefObject } from 'react';
import { ConnectionError } from '@/types/websocket';
import { createSchedulingWebSocketCloseHandler } from './scheduling-websocket-close-handler';
import { createSchedulingWebSocketMessageHandler } from './scheduling-websocket-message-handlers';
import { createSchedulingWebSocketOpenHandler } from './scheduling-websocket-open-handler';
import {
  buildSchedulingWebSocketUrl,
  clearIntervalRef,
  clearTimeoutRef,
  closeWebSocketRef,
  hasReconnectBudget,
  maybeResetReconnectAttempts,
} from './scheduling-websocket-utils';
import type {
  SchedulingOfflineQueue,
  SchedulingWebSocketHandlers,
  SchedulingWebSocketRefs,
  SchedulingWebSocketState,
} from './scheduling-websocket-types';

interface UseSchedulingWebSocketConnectionParams {
  enabled: boolean;
  selectedBrandId?: string;
  maxReconnectAttempts: number;
  heartbeatInterval: number;
  refs: SchedulingWebSocketRefs;
  state: SchedulingWebSocketState;
  handlers: SchedulingWebSocketHandlers;
  offlineQueue: SchedulingOfflineQueue;
  startHeartbeat: (wsRef: MutableRefObject<WebSocket | null>, interval?: number) => void;
  stopHeartbeat: () => void;
  calculateReconnectDelay: (attempt: number) => number;
}

interface ConnectSchedulingWebSocketParams extends UseSchedulingWebSocketConnectionParams {
  connect: () => Promise<void>;
}

function shouldSkipConnect({
  enabled,
  selectedBrandId,
  maxReconnectAttempts,
  refs,
}: Pick<
  ConnectSchedulingWebSocketParams,
  'enabled' | 'selectedBrandId' | 'maxReconnectAttempts' | 'refs'
>) {
  if (refs.isConnectingRef.current || refs.wsRef.current?.readyState === WebSocket.OPEN) {
    return true;
  }
  if (!enabled || !selectedBrandId) {
    return true;
  }
  return !hasReconnectBudget(
    refs.reconnectAttemptsRef.current,
    maxReconnectAttempts,
    refs.lastConnectionAttemptRef.current
  );
}

async function connectSchedulingWebSocket({
  enabled,
  selectedBrandId,
  maxReconnectAttempts,
  heartbeatInterval,
  refs,
  state,
  handlers,
  offlineQueue,
  startHeartbeat,
  stopHeartbeat,
  calculateReconnectDelay,
  connect,
}: ConnectSchedulingWebSocketParams) {
  if (shouldSkipConnect({ enabled, selectedBrandId, maxReconnectAttempts, refs })) {
    return;
  }
  maybeResetReconnectAttempts(refs.reconnectAttemptsRef, refs.lastConnectionAttemptRef.current);
  refs.lastConnectionAttemptRef.current = Date.now();
  refs.isConnectingRef.current = true;

  try {
    if (refs.wsRef.current && refs.wsRef.current.readyState !== WebSocket.CLOSED) {
      refs.wsRef.current.close();
      refs.wsRef.current = null;
    }
    handlers.handleConnectionChange('connecting');
    const ws = new WebSocket(buildSchedulingWebSocketUrl());
    ws.onopen = createSchedulingWebSocketOpenHandler({
      wsRef: refs.wsRef,
      isConnectingRef: refs.isConnectingRef,
      countdownIntervalRef: refs.countdownIntervalRef,
      heartbeatInterval,
      handleConnectionChange: handlers.handleConnectionChange,
      setRetryIn: (value) => state.setRetryIn(value),
      startHeartbeat,
      getQueueSize: offlineQueue.getQueueSize,
      processQueue: offlineQueue.processQueue,
    });
    ws.onmessage = createSchedulingWebSocketMessageHandler({
      ws,
      selectedBrandId,
      reconnectAttemptsRef: refs.reconnectAttemptsRef,
      isAuthenticatedRef: refs.isAuthenticatedRef,
      handleConnectionChange: handlers.handleConnectionChange,
      handleStatusUpdate: handlers.handleStatusUpdate,
      handleWebSocketError: handlers.handleWebSocketError,
      messageFilter: handlers.messageFilter,
    });
    ws.onerror = (error) => {
      refs.isConnectingRef.current = false;
      handlers.handleWebSocketError(
        new Error(`WebSocket error event${error?.type ? ` (${error.type})` : ''}`)
      );
    };
    ws.onclose = createSchedulingWebSocketCloseHandler({
      refs,
      enabled,
      selectedBrandId,
      maxReconnectAttempts,
      calculateReconnectDelay,
      connect,
      setRetryIn: state.setRetryIn,
      handleConnectionChange: handlers.handleConnectionChange,
      handleWebSocketError: handlers.handleWebSocketError,
      stopHeartbeat,
    });
    refs.wsRef.current = ws;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create WebSocket connection';
    handlers.handleWebSocketError(new ConnectionError(message));
  }
}

function useConnectCallback(params: UseSchedulingWebSocketConnectionParams) {
  const connect = useCallback(async () => {
    await connectSchedulingWebSocket({ ...params, connect });
  }, [params]);
  return connect;
}

function useDisconnectCallback({
  refs,
  state,
  stopHeartbeat,
}: Pick<UseSchedulingWebSocketConnectionParams, 'refs' | 'state' | 'stopHeartbeat'>) {
  return useCallback(() => {
    refs.isConnectingRef.current = false;
    clearTimeoutRef(refs.reconnectTimeoutRef);
    stopHeartbeat();
    clearIntervalRef(refs.countdownIntervalRef);
    closeWebSocketRef(refs.wsRef);
    state.setConnectionStatus('disconnected');
    state.setRetryIn(0);
  }, [refs, state, stopHeartbeat]);
}

function useReconnectCallback({
  refs,
  state,
  stopHeartbeat,
  enabled,
  selectedBrandId,
  connect,
}: Pick<
  UseSchedulingWebSocketConnectionParams,
  'refs' | 'state' | 'stopHeartbeat' | 'enabled' | 'selectedBrandId'
> & { connect: () => Promise<void> }) {
  return useCallback(() => {
    clearTimeoutRef(refs.reconnectTimeoutRef);
    clearIntervalRef(refs.countdownIntervalRef);
    refs.isConnectingRef.current = false;
    refs.reconnectAttemptsRef.current = 0;
    refs.isAuthenticatedRef.current = false;
    state.setRetryIn(0);
    closeWebSocketRef(refs.wsRef);
    stopHeartbeat();
    state.setConnectionStatus('disconnected');
    setTimeout(() => {
      if (enabled && selectedBrandId) {
        void connect();
      }
    }, 100);
  }, [refs, state, stopHeartbeat, enabled, selectedBrandId, connect]);
}

export function useSchedulingWebSocketConnection(params: UseSchedulingWebSocketConnectionParams) {
  const connect = useConnectCallback(params);
  const disconnect = useDisconnectCallback(params);
  const reconnect = useReconnectCallback({ ...params, connect });
  return { connect, disconnect, reconnect };
}
