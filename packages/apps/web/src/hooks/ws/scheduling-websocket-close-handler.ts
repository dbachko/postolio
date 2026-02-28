import { ConnectionError } from '@/types/websocket';
import type { SchedulingWebSocketRefs } from './scheduling-websocket-types';
import { MAX_RECONNECT_COOLDOWN_MS, clearIntervalRef } from './scheduling-websocket-utils';

interface CreateSchedulingWebSocketCloseHandlerParams {
  refs: SchedulingWebSocketRefs;
  enabled: boolean;
  selectedBrandId?: string;
  maxReconnectAttempts: number;
  calculateReconnectDelay: (attempt: number) => number;
  connect: () => Promise<void>;
  setRetryIn: (value: number | ((previous: number) => number)) => void;
  handleConnectionChange: (status: 'disconnected') => void;
  handleWebSocketError: (error: Error) => void;
  stopHeartbeat: () => void;
}

function shouldRefreshOnClose(event: CloseEvent) {
  return event.code === 1008 && /No authentication cookie|Authentication failed/.test(event.reason);
}

async function refreshAuthTokenIfNeeded(event: CloseEvent, refs: SchedulingWebSocketRefs) {
  if (!shouldRefreshOnClose(event) || refs.isRefreshingRef.current) {
    return;
  }
  try {
    refs.isRefreshingRef.current = true;
    const { AuthInterceptor } = await import('@/lib/auth-interceptor');
    await AuthInterceptor.refreshNow('ws-auth-error');
  } catch (error) {
    console.warn('[Auth] Refresh failed after WebSocket auth error', error);
  } finally {
    refs.isRefreshingRef.current = false;
  }
}

function startReconnectCountdown(
  delay: number,
  countdownIntervalRef: SchedulingWebSocketRefs['countdownIntervalRef'],
  setRetryIn: CreateSchedulingWebSocketCloseHandlerParams['setRetryIn']
) {
  setRetryIn(delay);
  clearIntervalRef(countdownIntervalRef);
  countdownIntervalRef.current = setInterval(() => {
    setRetryIn((previous) => {
      if (previous <= 100) {
        clearIntervalRef(countdownIntervalRef);
        return 0;
      }
      return previous - 100;
    });
  }, 100);
}

function scheduleReconnect({
  refs,
  delay,
  connect,
  setRetryIn,
}: {
  refs: SchedulingWebSocketRefs;
  delay: number;
  connect: () => Promise<void>;
  setRetryIn: CreateSchedulingWebSocketCloseHandlerParams['setRetryIn'];
}) {
  startReconnectCountdown(delay, refs.countdownIntervalRef, setRetryIn);
  refs.reconnectTimeoutRef.current = setTimeout(() => {
    clearIntervalRef(refs.countdownIntervalRef);
    setRetryIn(0);
    void connect();
  }, delay);
}

function scheduleCooldownReconnect({
  refs,
  enabled,
  selectedBrandId,
  connect,
}: {
  refs: SchedulingWebSocketRefs;
  enabled: boolean;
  selectedBrandId?: string;
  connect: () => Promise<void>;
}) {
  refs.reconnectTimeoutRef.current = setTimeout(() => {
    refs.reconnectAttemptsRef.current = 0;
    if (enabled && selectedBrandId) {
      void connect();
    }
  }, MAX_RECONNECT_COOLDOWN_MS);
}

function maybeScheduleReconnect({
  refs,
  enabled,
  maxReconnectAttempts,
  calculateReconnectDelay,
  connect,
  setRetryIn,
  selectedBrandId,
  handleWebSocketError,
  wasAuthenticated,
}: {
  refs: SchedulingWebSocketRefs;
  enabled: boolean;
  maxReconnectAttempts: number;
  calculateReconnectDelay: (attempt: number) => number;
  connect: () => Promise<void>;
  setRetryIn: CreateSchedulingWebSocketCloseHandlerParams['setRetryIn'];
  selectedBrandId?: string;
  handleWebSocketError: (error: Error) => void;
  wasAuthenticated: boolean;
}) {
  if (enabled && refs.reconnectAttemptsRef.current < maxReconnectAttempts) {
    const delay = calculateReconnectDelay(refs.reconnectAttemptsRef.current);
    if (!wasAuthenticated) {
      refs.reconnectAttemptsRef.current++;
    }
    scheduleReconnect({ refs, delay, connect, setRetryIn });
    return;
  }
  if (refs.reconnectAttemptsRef.current < maxReconnectAttempts) {
    return;
  }
  scheduleCooldownReconnect({ refs, enabled, selectedBrandId, connect });
  handleWebSocketError(
    new ConnectionError(
      `Max reconnection attempts (${maxReconnectAttempts}) reached. Will retry in 5 minutes.`
    )
  );
}

export function createSchedulingWebSocketCloseHandler({
  refs,
  enabled,
  selectedBrandId,
  maxReconnectAttempts,
  calculateReconnectDelay,
  connect,
  setRetryIn,
  handleConnectionChange,
  handleWebSocketError,
  stopHeartbeat,
}: CreateSchedulingWebSocketCloseHandlerParams) {
  return async (event: CloseEvent) => {
    refs.isConnectingRef.current = false;
    handleConnectionChange('disconnected');
    refs.wsRef.current = null;
    stopHeartbeat();
    clearIntervalRef(refs.countdownIntervalRef);
    await refreshAuthTokenIfNeeded(event, refs);

    const wasAuthenticated = refs.isAuthenticatedRef.current;
    refs.isAuthenticatedRef.current = false;
    maybeScheduleReconnect({
      refs,
      enabled,
      maxReconnectAttempts,
      calculateReconnectDelay,
      connect,
      setRetryIn,
      selectedBrandId,
      handleWebSocketError,
      wasAuthenticated,
    });
  };
}
