/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';
import type { ConnectionStatus as ConnectionStatusType } from '../types/websocket';
import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket';
import { useAuthStore } from '../stores/authStore';

// Context for connection status to ensure singleton WebSocket
const ConnectionStatusContext = React.createContext<ReturnType<
  typeof useSchedulingWebSocket
> | null>(null);

// Provider component to ensure singleton WebSocket connection
export function ConnectionStatusProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);

  // Use auth store to check authentication status
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  React.useEffect(() => {
    setMounted(true);

    // Cleanup on unmount only
    return () => {
      setMounted(false);
    };
  }, []); // Empty deps - only run once

  // Use WebSocket hook at app level - only enable if authenticated and mounted
  const hookResult = useSchedulingWebSocket({
    enabled: mounted && isAuthenticated,
    // Prevent reconnection on every render
    maxReconnectAttempts: 5,
  });

  return (
    <ConnectionStatusContext.Provider value={hookResult}>
      {children}
    </ConnectionStatusContext.Provider>
  );
}

// Enhanced hook that provides all connection status data
export function useConnectionStatus() {
  const context = React.useContext(ConnectionStatusContext);

  // SSR safety: if context is null, return safe defaults
  if (!context) {
    return {
      connectionStatus: 'disconnected' as ConnectionStatusType,
      lastUpdate: null,
      reconnect: () => {},
      queueSize: 0,
      retryCount: 0,
      retryIn: 0,
    };
  }

  return {
    connectionStatus: context.connectionStatus,
    lastUpdate: context.lastUpdate,
    reconnect: context.reconnect,
    queueSize: context.queueSize,
    retryCount: context.retryCount || 0,
    retryIn: context.retryIn || 0,
  };
}
