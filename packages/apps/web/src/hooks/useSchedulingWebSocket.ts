import type { UseSchedulingWebSocketOptions } from '../types/websocket';
import { useSchedulingWebSocketEngine } from './ws/useSchedulingWebSocketEngine';

export function useSchedulingWebSocket(options: UseSchedulingWebSocketOptions = {}) {
  return useSchedulingWebSocketEngine(options);
}
