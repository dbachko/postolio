import type { MutableRefObject } from 'react';

export const MAX_RECONNECT_COOLDOWN_MS = 5 * 60 * 1000;

export function buildSchedulingWebSocketUrl() {
  if (!import.meta.env.DEV) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  const apiBase = (import.meta.env as { VITE_API_BASE_URL?: string }).VITE_API_BASE_URL;
  if (apiBase) {
    try {
      const apiUrl = new URL(apiBase);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${apiUrl.host}/ws`;
    } catch {
      return buildDevFallbackWebSocketUrl();
    }
  }
  return buildDevFallbackWebSocketUrl();
}

function buildDevFallbackWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

export function clearTimeoutRef(ref: MutableRefObject<NodeJS.Timeout | undefined>) {
  if (!ref.current) {
    return;
  }
  clearTimeout(ref.current);
  ref.current = undefined;
}

export function clearIntervalRef(ref: MutableRefObject<NodeJS.Timeout | undefined>) {
  if (!ref.current) {
    return;
  }
  clearInterval(ref.current);
  ref.current = undefined;
}

export function closeWebSocketRef(ref: MutableRefObject<WebSocket | null>) {
  if (!ref.current) {
    return;
  }
  ref.current.close();
  ref.current = null;
}

export function closeWebSocketRefSafely(ref: MutableRefObject<WebSocket | null>) {
  if (!ref.current) {
    return;
  }
  try {
    ref.current.close();
  } catch (error) {
    console.warn('Failed to close WebSocket during cleanup', error);
  } finally {
    ref.current = null;
  }
}

export function hasReconnectBudget(
  reconnectAttempts: number,
  maxReconnectAttempts: number,
  lastConnectionAttempt: number
) {
  const timeSinceLastAttempt = Date.now() - lastConnectionAttempt;
  return !(
    reconnectAttempts >= maxReconnectAttempts && timeSinceLastAttempt < MAX_RECONNECT_COOLDOWN_MS
  );
}

export function maybeResetReconnectAttempts(
  reconnectAttemptsRef: MutableRefObject<number>,
  lastConnectionAttempt: number
) {
  if (Date.now() - lastConnectionAttempt > MAX_RECONNECT_COOLDOWN_MS) {
    reconnectAttemptsRef.current = 0;
  }
}
