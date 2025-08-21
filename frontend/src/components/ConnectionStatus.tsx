import React from 'react'
import { Wifi, WifiOff, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { ConnectionStatus as ConnectionStatusType } from '../types/websocket'

interface ConnectionStatusProps {
  status: ConnectionStatusType
  lastUpdate: Date | null
  onReconnect?: () => void
  className?: string
  compact?: boolean
  queueSize?: number
}

export function ConnectionStatus({
  status,
  lastUpdate,
  onReconnect,
  className,
  compact = false,
  queueSize = 0
}: ConnectionStatusProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'connecting':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'connected':
        return <Wifi className="h-4 w-4" />
      case 'disconnected':
        return <WifiOff className="h-4 w-4" />
      case 'error':
        return <AlertCircle className="h-4 w-4" />
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'connecting':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'connected':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'disconnected':
        return 'text-gray-600 bg-gray-50 border-gray-200'
      case 'error':
        return 'text-red-600 bg-red-50 border-red-200'
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'connecting':
        return 'Connecting...'
      case 'connected':
        return 'Live updates active'
      case 'disconnected':
        return 'Offline'
      case 'error':
        return 'Connection error'
    }
  }

  const formatLastUpdate = () => {
    if (!lastUpdate) return null
    
    const now = new Date()
    const diff = now.getTime() - lastUpdate.getTime()
    
    if (diff < 60000) {
      return 'Just now'
    } else if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000)
      return `${minutes}m ago`
    } else if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000)
      return `${hours}h ago`
    } else {
      return lastUpdate.toLocaleDateString()
    }
  }

  if (compact) {
    // Compact mode - just an icon with tooltip
    return (
      <div
        className={cn(
          'inline-flex items-center justify-center p-1.5 rounded-full transition-colors',
          getStatusColor(),
          className
        )}
        title={`${getStatusText()}${lastUpdate ? ` • Last update: ${formatLastUpdate()}` : ''}`}
      >
        {getStatusIcon()}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-colors',
        getStatusColor(),
        className
      )}
    >
      {getStatusIcon()}
      
      <span className="font-medium">
        {getStatusText()}
      </span>
      
      {lastUpdate && status === 'connected' && (
        <span className="text-xs opacity-75">
          • {formatLastUpdate()}
        </span>
      )}
      
      {queueSize > 0 && (
        <span className="text-xs opacity-75">
          • {queueSize} queued
        </span>
      )}
      
      {status === 'disconnected' && onReconnect && (
        <button
          onClick={onReconnect}
          className="ml-1 text-xs underline hover:no-underline"
        >
          Reconnect
        </button>
      )}
      
      {status === 'error' && onReconnect && (
        <button
          onClick={onReconnect}
          className="ml-1 text-xs underline hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}

// Optional: Export a hook that combines useSchedulingWebSocket with ConnectionStatus
export function useConnectionStatus() {
  const [mounted, setMounted] = React.useState(false)
  
  React.useEffect(() => {
    setMounted(true)
  }, [])
  
  // Import dynamically to avoid SSR issues
  const { connectionStatus, lastUpdate, reconnect, queueSize } = mounted 
    ? require('../hooks/useSchedulingWebSocket').useSchedulingWebSocket()
    : { connectionStatus: 'disconnected' as ConnectionStatusType, lastUpdate: null, reconnect: () => {}, queueSize: 0 }
  
  return {
    connectionStatus,
    lastUpdate,
    reconnect,
    queueSize
  }
}