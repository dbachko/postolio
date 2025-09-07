import React from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import type { ConnectionStatus as ConnectionStatusType } from '../types/websocket'
import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { useAuthStore } from '../stores/authStore'

interface ConnectionStatusProps {
  status?: ConnectionStatusType
  lastUpdate?: Date | null
  onReconnect?: () => void
  className?: string
  compact?: boolean
  queueSize?: number
  retryCount?: number
  retryIn?: number
}

export function ConnectionStatus({
  status,
  onReconnect,
  className,
  queueSize = 0,
  retryCount = 0,
  retryIn = 0
}: ConnectionStatusProps) {
  // Enhanced connection status following the SCHEDULING_STATUS_PLAN.md specification
  if (status === 'connected') {
    return (
      <div className={cn(
        "fixed top-4 right-4 flex items-center gap-2 text-sm",
        className
      )}>
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span className="text-gray-600">Live</span>
      </div>
    )
  }
  
  return (
    <div className={cn(
      "fixed top-4 right-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3",
      className
    )}>
      <div className="flex items-center gap-2">
        {status === 'connecting' ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
            <span className="text-sm text-yellow-800">
              Reconnecting... ({retryCount}/3)
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-sm text-red-800">Connection lost</span>
            {onReconnect && (
              <button 
                onClick={onReconnect}
                className="ml-2 text-xs bg-red-100 px-2 py-1 rounded hover:bg-red-200 transition-colors"
              >
                Reconnect
              </button>
            )}
          </>
        )}
      </div>
      {retryIn > 0 && (
        <div className="text-xs text-gray-600 mt-1">
          Next retry in {Math.ceil(retryIn / 1000)}s
        </div>
      )}
      {queueSize > 0 && (
        <div className="text-xs text-gray-600 mt-1">
          {queueSize} action{queueSize !== 1 ? 's' : ''} queued for when reconnected
        </div>
      )}
    </div>
  )
}

// Context for connection status to ensure singleton WebSocket
const ConnectionStatusContext = React.createContext<ReturnType<typeof useSchedulingWebSocket> | null>(null)

// Provider component to ensure singleton WebSocket connection
export function ConnectionStatusProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  
  // Use auth store to check authentication status
  const isAuthenticated = useAuthStore(state => state.isAuthenticated)
  
  React.useEffect(() => {
    setMounted(true)
    
    // Cleanup on unmount only
    return () => {
      setMounted(false)
    }
  }, []) // Empty deps - only run once
  
  // Use WebSocket hook at app level - only enable if authenticated and mounted
  const hookResult = useSchedulingWebSocket({ 
    enabled: mounted && isAuthenticated,
    // Prevent reconnection on every render
    maxReconnectAttempts: 5
  })
  
  return (
    <ConnectionStatusContext.Provider value={hookResult}>
      {children}
    </ConnectionStatusContext.Provider>
  )
}

// Enhanced hook that provides all connection status data
export function useConnectionStatus() {
  const context = React.useContext(ConnectionStatusContext)
  
  // SSR safety: if context is null, return safe defaults
  if (!context) {
    return {
      connectionStatus: 'disconnected' as ConnectionStatusType,
      lastUpdate: null,
      reconnect: () => {},
      queueSize: 0,
      retryCount: 0,
      retryIn: 0
    }
  }
  
  return {
    connectionStatus: context.connectionStatus,
    lastUpdate: context.lastUpdate,
    reconnect: context.reconnect,
    queueSize: context.queueSize,
    retryCount: context.retryCount || 0,
    retryIn: context.retryIn || 0
  }
}

// Component that uses the hook automatically
export function AutoConnectionStatus({ className }: { className?: string }) {
  const {
    connectionStatus,
    lastUpdate,
    reconnect,
    queueSize,
    retryCount,
    retryIn
  } = useConnectionStatus()
  
  return (
    <ConnectionStatus
      status={connectionStatus}
      lastUpdate={lastUpdate}
      onReconnect={reconnect}
      queueSize={queueSize}
      retryCount={retryCount}
      retryIn={retryIn}
      className={className}
    />
  )
}