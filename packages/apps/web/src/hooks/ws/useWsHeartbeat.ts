import type { MutableRefObject } from 'react';
import { useCallback, useRef } from 'react';

export function useWsHeartbeat() {
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const startHeartbeat = useCallback(
    (wsRef: MutableRefObject<WebSocket | null>, intervalMs: number) => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = setInterval(() => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, intervalMs);
    },
    []
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }
  }, []);

  return { startHeartbeat, stopHeartbeat, heartbeatIntervalRef };
}
