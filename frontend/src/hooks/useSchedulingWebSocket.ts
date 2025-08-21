import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useBrandStore } from '../stores/brandStore'
import { useQueryClient } from '@tanstack/react-query'
import { useOfflineQueue } from './useOfflineQueue'
import { apiClient } from '../lib/api'
import {
  ContentStatus,
  ConnectionStatus,
  StatusUpdateEvent,
  UseSchedulingWebSocketOptions,
  WebSocketMessage,
  WebSocketError,
  ConnectionError,
  AuthenticationError
} from '../types/websocket'

export function useSchedulingWebSocket({
  enabled = true,
  onStatusUpdate,
  onConnectionChange,
  onError,
  reconnectInterval = 5000,
  maxReconnectAttempts = 5,
  heartbeatInterval = 30000
}: UseSchedulingWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const reconnectAttemptsRef = useRef(0)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>()
  
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  
  const { token } = useAuthStore()
  const { selectedBrand } = useBrandStore()
  const queryClient = useQueryClient()

  // Offline queue for scheduling actions
  const offlineQueue = useOfflineQueue({
    onProcess: async (action) => {
      try {
        switch (action.type) {
          case 'schedule':
            await apiClient.scheduleContent(action.payload.contentId, action.payload.time)
            return true
          case 'reschedule':
            await apiClient.rescheduleContent(action.payload.contentId, action.payload.newTime)
            return true
          case 'cancel':
            await apiClient.cancelSchedule(action.payload.contentId)
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

  // Handle status update and invalidate queries
  const handleStatusUpdate = useCallback((event: StatusUpdateEvent) => {
    setLastUpdate(new Date())
    
    // Call custom handler if provided
    onStatusUpdate?.(event)
    
    // Invalidate relevant queries to refresh UI
    if (selectedBrand) {
      queryClient.invalidateQueries({ queryKey: ['content', 'pending', selectedBrand.id] })
      queryClient.invalidateQueries({ queryKey: ['content', 'scheduled', selectedBrand.id] })
      queryClient.invalidateQueries({ queryKey: ['content', 'history', selectedBrand.id] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'scheduled', selectedBrand.id] })
    }
    
    // Update cache optimistically if we have the data
    if (event.type === 'status_update' && 'contentId' in event.data) {
      const contentId = event.data.contentId
      const newStatus = event.data.newStatus
      
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
  }, [selectedBrand?.id, queryClient, onStatusUpdate])

  // Exponential backoff calculation
  const calculateReconnectDelay = useCallback((attemptNumber: number) => {
    return Math.min(Math.pow(2, attemptNumber) * 1000, 10000) // Cap at 10 seconds
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

        // Authenticate
        ws.send(JSON.stringify({
          type: 'auth',
          token
        }))

        // Subscribe to brand room
        ws.send(JSON.stringify({
          type: 'subscribe',
          room: `brand:${selectedBrand.id}`
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
          
          if (message.type === 'pong') {
            // Heartbeat response, ignore
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
          
          reconnectTimeoutRef.current = setTimeout(() => {
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
  }, [token, selectedBrand?.id, enabled, handleStatusUpdate, calculateReconnectDelay, maxReconnectAttempts, heartbeatInterval, handleConnectionChange, handleWebSocketError, offlineQueue])

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

    return () => {
      disconnect()
    }
  }, [enabled, token, selectedBrand?.id, connect, disconnect]) // Fixed dependency array

  // Manual reconnect function
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0
    disconnect()
    setTimeout(connect, 100)
  }, [connect, disconnect])

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
    clearQueue: offlineQueue.clearQueue
  }
}