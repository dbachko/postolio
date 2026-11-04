import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { WebSocketMessage } from '@/types/websocket';

function resolveDevWebSocketUrl(apiBase?: string): string {
  if (apiBase) {
    try {
      const apiUrl = new URL(apiBase);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${apiUrl.host}/ws`;
    } catch {
      // fallthrough
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

function handleWebSocketMessage(
  event: MessageEvent,
  brandId: string,
  queryClient: ReturnType<typeof useQueryClient>
) {
  try {
    const message: WebSocketMessage = JSON.parse(event.data);
    if (message.type !== 'dm_message') {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['inbox-items', brandId] });
    if (!message.conversationId) {
      return;
    }

    queryClient.invalidateQueries({
      queryKey: ['dm-messages', brandId, message.conversationId],
    });
  } catch {
    // ignore malformed payloads
  }
}

export function useInboxWebSocket(brandId: string | undefined) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connectWebSocket = useCallback(() => {
    if (!brandId) {
      return;
    }

    const current = wsRef.current;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    const wsUrl = import.meta.env.DEV
      ? resolveDevWebSocketUrl((import.meta.env as any).VITE_API_BASE_URL)
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', brandId }));
    };
    ws.onmessage = (event) => handleWebSocketMessage(event, brandId, queryClient);
    ws.onerror = () => {};
    ws.onclose = (event) => {
      wsRef.current = null;
      if (event.code === 1008) {
        toast.error('WebSocket disconnected: authentication required. Please sign in again.');
        return;
      }
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
    };
  }, [brandId, queryClient]);

  useEffect(() => {
    if (!brandId) {
      return;
    }

    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, [brandId, connectWebSocket]);
}
