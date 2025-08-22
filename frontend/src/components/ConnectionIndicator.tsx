import React, { useState, useEffect } from 'react'
import { useConnectionStatus } from './ConnectionStatus'
import { toast } from 'sonner'
import { WifiOff, Wifi, AlertCircle } from 'lucide-react'

/**
 * Minimal WebSocket connection indicator following progressive disclosure pattern:
 * - Connected: Show nothing (invisible)
 * - Reconnecting (< 3s): Show nothing
 * - Reconnecting (> 3s): Show subtle dot
 * - Disconnected (> 10s): Show toast notification
 * - Failed: Show action required modal
 */
export function ConnectionIndicator() {
  const connectionStatus = useConnectionStatus()
  const [showIndicator, setShowIndicator] = useState(false)
  const [disconnectedDuration, setDisconnectedDuration] = useState(0)
  const [toastId, setToastId] = useState<string | number | undefined>()

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined
    
    if (!connectionStatus?.isConnected) {
      // Start counting disconnection duration
      const startTime = Date.now()
      interval = setInterval(() => {
        const duration = Math.floor((Date.now() - startTime) / 1000)
        setDisconnectedDuration(duration)
        
        // Progressive disclosure based on duration
        if (duration >= 3 && duration < 10) {
          setShowIndicator(true)
        } else if (duration >= 10 && !toastId) {
          // Show persistent toast for extended disconnection
          const id = toast.warning(
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              <div>
                <p className="font-medium">Connection interrupted</p>
                <p className="text-sm opacity-90">Your changes will sync when reconnected</p>
              </div>
            </div>,
            {
              duration: Infinity,
              action: connectionStatus.retryIn && connectionStatus.retryIn > 0 ? {
                label: `Retry (${connectionStatus.retryIn}s)`,
                onClick: () => connectionStatus.connect?.()
              } : undefined,
            }
          )
          setToastId(id)
        }
      }, 1000)
    } else {
      // Connected - clear everything
      setShowIndicator(false)
      setDisconnectedDuration(0)
      
      // Dismiss toast if exists
      if (toastId) {
        toast.dismiss(toastId)
        setToastId(undefined)
        
        // Show success briefly
        toast.success('Connection restored', {
          duration: 2000,
          icon: <Wifi className="h-4 w-4" />
        })
      }
    }
    
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [connectionStatus?.isConnected, connectionStatus?.retryIn, toastId])

  // Don't render anything when connected or in first 3 seconds
  if (connectionStatus?.isConnected || disconnectedDuration < 3) {
    return null
  }

  // Subtle indicator for 3-10 seconds of disconnection
  if (disconnectedDuration < 10) {
    return (
      <div 
        className="fixed bottom-4 right-4 z-40 p-2 cursor-pointer group"
        onClick={() => {
          toast.info(
            connectionStatus.isReconnecting 
              ? `Reconnecting... ${connectionStatus.retryIn ? `(${connectionStatus.retryIn}s)` : ''}`
              : 'Connection lost. Attempting to reconnect...',
            { duration: 3000 }
          )
        }}
        title={connectionStatus.isReconnecting ? 'Reconnecting...' : 'Connection lost'}
      >
        <div className="relative">
          {/* Pulsing dot */}
          <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
          
          {/* Hover tooltip */}
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
            <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
              {connectionStatus.isReconnecting ? 'Reconnecting...' : 'Connection interrupted'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // After 10 seconds, the toast handles it
  return null
}

/**
 * Mobile-optimized connection banner (only shows on mobile for better visibility)
 */
export function MobileConnectionBanner() {
  const connectionStatus = useConnectionStatus()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Only show on mobile devices when disconnected for > 5 seconds
    const isMobile = window.innerWidth < 768
    
    if (isMobile && !connectionStatus?.isConnected) {
      const timer = setTimeout(() => setShow(true), 5000)
      return () => clearTimeout(timer)
    } else {
      setShow(false)
    }
  }, [connectionStatus?.isConnected])

  if (!show) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-900 px-4 py-2 text-sm flex items-center justify-between md:hidden">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        <span>No connection. Changes will sync when online.</span>
      </div>
      <button 
        onClick={() => setShow(false)}
        className="text-yellow-900 hover:text-yellow-800"
      >
        ✕
      </button>
    </div>
  )
}