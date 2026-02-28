import { type MutableRefObject, useCallback, useRef } from 'react';

export function useWsHeartbeat() {
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const startHeartbeat = useCallback(
    (wsRef: MutableRefObject<WebSocket | null>, intervalMs = 25000) => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      const sendPing = () => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      };

      // Send an immediate ping so the server marks this socket alive before the first heartbeat check.
      sendPing();
      heartbeatIntervalRef.current = setInterval(sendPing, intervalMs);
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
