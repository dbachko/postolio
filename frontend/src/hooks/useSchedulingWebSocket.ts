import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useBrandStore } from '../stores/brandStore'
import { useQueryClient } from '@tanstack/react-query'
import { useOfflineQueue } from './useOfflineQueue'
import { toast } from 'sonner'
import type {
  ConnectionStatus,
  StatusUpdateEvent,
  UseSchedulingWebSocketOptions,
  WebSocketMessage
} from '../types/websocket'
import {
  WebSocketError,
  ConnectionError,
  AuthenticationError
} from '../types/websocket'

export function useSchedulingWebSocket({
  enabled = true,
  onStatusUpdate,
  onConnectionChange,
  onError,
  maxReconnectAttempts = 5,
  heartbeatInterval = 30000
}: UseSchedulingWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const reconnectAttemptsRef = useRef(0)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [retryIn, setRetryIn] = useState<number>(0)
  
  const getToken = useAuthStore(state => state.getToken)
  const token = getToken()
  const selectedBrand = useBrandStore(state => state.selectedBrand)
  const queryClient = useQueryClient()

  // Offline queue for scheduling actions
  const offlineQueue = useOfflineQueue({
    onProcess: async (action) => {
      try {
        switch (action.type) {
          case 'schedule':
            // TODO: Implement actual API calls when available
            console.log('Would schedule content:', action.payload)
            return true
          case 'reschedule':
            // TODO: Implement actual API calls when available  
            console.log('Would reschedule content:', action.payload)
            return true
          case 'cancel':
            // TODO: Implement actual API calls when available
            console.log('Would cancel schedule:', action.payload)
            return true
          default:
            return false
        }
      } catch (error) {
        console.error('Failed to process offline action:', error)
        return false
      }
    },
    onError: (action, error) => {
      console.error('Offline action failed permanently:', action, error)
      // Could show a toast notification here
    }
  })

  // Memoize query keys for better performance
  const queryKeys = useMemo(() => {
    if (!selectedBrand?.id) return []
    return [
      ['content', 'pending', selectedBrand.id],
      ['content', 'scheduled', selectedBrand.id],
      ['content', 'history', selectedBrand.id],
      ['analytics', 'scheduled', selectedBrand.id]
    ]
  }, [selectedBrand?.id])

  // Handle status update and invalidate queries
  const handleStatusUpdate = useCallback((event: StatusUpdateEvent) => {
    setLastUpdate(new Date())
    
    // Call custom handler if provided
    onStatusUpdate?.(event)
    
    // Invalidate relevant queries to refresh UI
    queryKeys.forEach(queryKey => {
      queryClient.invalidateQueries({ queryKey })
    })
    
    // Update cache optimistically if we have the data
    if (event.type === 'status_update' && 'contentId' in event.data) {
      const contentId = event.data.contentId
      const newStatus = event.data.newStatus
      const metadata = event.data.metadata
      
      // Show toast notifications for important status changes
      if (newStatus === 'published') {
        toast.success('Content published successfully!', {
          description: 'Your content is now live on Instagram',
          duration: 5000,
        })
      } else if (newStatus === 'failed') {
        toast.error('Publishing failed', {
          description: metadata?.error || 'Content could not be published to Instagram',
          duration: 8000,
        })
      } else if (newStatus === 'scheduled' && !metadata?.isOptimistic) {
        toast.success('Content scheduled!', {
          description: 'Your content has been scheduled for posting',
          duration: 3000,
        })
      } else if (newStatus === 'draft' && metadata?.isRollback) {
        toast.warning('Scheduling failed', {
          description: metadata?.error || 'Content has been returned to draft status',
          duration: 5000,
        })
      }
      
      // Update content in cache
      queryClient.setQueriesData(
        { queryKey: ['content'] },
        (oldData: any) => {
          if (!oldData) return oldData
          
          // Handle array of content
          if (Array.isArray(oldData)) {
            return oldData.map((item: any) =>
              item.id === contentId ? { ...item, status: newStatus } : item
            )
          }
          
          // Handle paginated response
          if (oldData.content && Array.isArray(oldData.content)) {
            return {
              ...oldData,
              content: oldData.content.map((item: any) =>
                item.id === contentId ? { ...item, status: newStatus } : item
              )
            }
          }
          
          return oldData
        }
      )
    }
  }, [queryKeys, queryClient, onStatusUpdate])

  // Exponential backoff calculation with jitter (react-use-websocket pattern)
  const calculateReconnectDelay = useCallback((attemptNumber: number) => {
    const baseDelay = Math.min(Math.pow(2, attemptNumber) * 1000, 10000) // Cap at 10 seconds
    const jitter = Math.random() * 0.1 * baseDelay // Add 10% jitter to prevent thundering herd
    return Math.floor(baseDelay + jitter)
  }, [])

  // Handle connection status changes
  const handleConnectionChange = useCallback((status: ConnectionStatus) => {
    setConnectionStatus(status)
    onConnectionChange?.(status)
  }, [onConnectionChange])

  // Handle WebSocket errors
  const handleWebSocketError = useCallback((error: Error | Event) => {
    const wsError = error instanceof Error ? 
      new WebSocketError(error.message, 'WEBSOCKET_ERROR') :
      new ConnectionError('WebSocket connection failed')
    
    console.error('WebSocket error:', wsError)
    onError?.(wsError)
    handleConnectionChange('error')
  }, [onError, handleConnectionChange])

  // Message filter to prevent unnecessary re-renders (react-use-websocket pattern)
  const messageFilter = useCallback((message: WebSocketMessage) => {
    // Filter out ping/pong messages to prevent unnecessary updates
    if (message.type === 'ping' || message.type === 'pong') {
      return false
    }
    return true
  }, [])

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!token || !selectedBrand || !enabled) {
      return
    }

    try {
      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close()
      }

      handleConnectionChange('connecting')

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const ws = new WebSocket(`${protocol}//${host}/ws`)

      ws.onopen = () => {
        console.log('WebSocket connected')
        handleConnectionChange('connected')
        reconnectAttemptsRef.current = 0
        setRetryIn(0) // Clear retry countdown

        // Authenticate and subscribe to brand room
        ws.send(JSON.stringify({
          type: 'auth',
          token,
          brandId: selectedBrand.id
        }))

        // Start heartbeat
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }))
          }
        }, heartbeatInterval)
        
        // Process any queued offline actions
        if (offlineQueue.getQueueSize() > 0) {
          console.log(`Processing ${offlineQueue.getQueueSize()} offline actions`)
          offlineQueue.processQueue()
        }
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          
          // Apply message filter to prevent unnecessary processing
          if (!messageFilter(message)) {
            return
          }
          
          if (message.type === 'auth_success') {
            console.log('WebSocket authenticated')
            return
          }
          
          if (message.type === 'auth_error') {
            const authError = new AuthenticationError(message.error || 'Authentication failed')
            handleWebSocketError(authError)
            ws.close()
            return
          }
          
          if (message.type === 'subscribed') {
            console.log('Subscribed to room:', message.room)
            return
          }
          
          if (message.type === 'status_update' || message.type === 'batch_status_update') {
            handleStatusUpdate(message as StatusUpdateEvent)
          }
        } catch (error) {
          const parseError = error instanceof Error ? error : new Error('Failed to parse WebSocket message')
          handleWebSocketError(parseError)
        }
      }

      ws.onerror = (error) => {
        handleWebSocketError(error)
      }

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason)
        handleConnectionChange('disconnected')
        wsRef.current = null

        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
        }

        // Attempt reconnection if enabled and not at max attempts
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = calculateReconnectDelay(reconnectAttemptsRef.current)
          reconnectAttemptsRef.current++
          
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`)
          
          // Set retry countdown
          setRetryIn(delay)
          
          // Countdown timer
          const countdownInterval = setInterval(() => {
            setRetryIn(prev => {
              if (prev <= 100) {
                clearInterval(countdownInterval)
                return 0
              }
              return prev - 100
            })
          }, 100)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            clearInterval(countdownInterval)
            setRetryIn(0)
            connect()
          }, delay)
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          const maxAttemptsError = new ConnectionError(`Max reconnection attempts (${maxReconnectAttempts}) reached`)
          handleWebSocketError(maxAttemptsError)
        }
      }

      wsRef.current = ws
    } catch (error) {
      const connectionError = error instanceof Error ? 
        new ConnectionError(error.message) :
        new ConnectionError('Failed to create WebSocket connection')
      handleWebSocketError(connectionError)
    }
  }, [token, selectedBrand?.id, enabled, handleStatusUpdate, calculateReconnectDelay, maxReconnectAttempts, heartbeatInterval, handleConnectionChange, handleWebSocketError, messageFilter])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
    }
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    setConnectionStatus('disconnected')
  }, [])

  // Effect to manage connection lifecycle
  useEffect(() => {
    if (enabled && token && selectedBrand) {
      connect()
    } else {
      disconnect()
    }

    // Cleanup function using react-use pattern for proper unmounting
    return () => {
      // Clear all timeouts and intervals
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current)
      }
      // Close WebSocket connection
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setConnectionStatus('disconnected')
    }
  }, [enabled, token, selectedBrand?.id, connect, disconnect])

  // Manual reconnect function (stable reference using react-use-websocket pattern)
  const reconnect = useCallback(() => {
    // Prevent race conditions by clearing any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }
    
    // Reset state
    reconnectAttemptsRef.current = 0
    setRetryIn(0)
    
    // Disconnect cleanly
    disconnect()
    
    // Reconnect after a short delay to ensure clean state
    setTimeout(() => {
      if (enabled && token && selectedBrand) {
        connect()
      }
    }, 100)
  }, [connect, disconnect, enabled, token, selectedBrand])

  // Helper function to queue action when offline
  const queueAction = useCallback((type: 'schedule' | 'reschedule' | 'cancel', payload: any) => {
    if (connectionStatus === 'disconnected' || connectionStatus === 'error') {
      return offlineQueue.enqueue(type, payload)
    }
    return null
  }, [connectionStatus, offlineQueue])

  return {
    connectionStatus,
    lastUpdate,
    reconnect,
    disconnect,
    queueAction,
    queueSize: offlineQueue.getQueueSize(),
    clearQueue: offlineQueue.clearQueue,
    retryCount: reconnectAttemptsRef.current,
    retryIn
  }
}