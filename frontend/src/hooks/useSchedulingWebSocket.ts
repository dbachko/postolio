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
  const isConnectingRef = useRef(false) // Guard against multiple simultaneous connections
  const countdownIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const lastConnectionAttemptRef = useRef<number>(0) // Track last connection attempt time
  const tokenRefreshAttemptedRef = useRef(false) // Track if we've attempted token refresh
  
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [retryIn, setRetryIn] = useState<number>(0)
  
  const getToken = useAuthStore(state => state.getToken)
  const token = getToken()
  const selectedBrand = useBrandStore(state => state.selectedBrand)
  const queryClient = useQueryClient()
  
  // Track previous brand to detect actual changes
  const previousBrandRef = useRef<string | undefined>(undefined)

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

  // Type definitions for cache data (moved outside callback for performance)
  type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed'
  
  interface ContentItem {
    id: string
    status: ContentStatus
    [key: string]: unknown
  }
  
  interface CacheData {
    content?: ContentItem[]
    [key: string]: unknown
  }

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
          description: (metadata?.error as string) || 'Content could not be published to Instagram',
          duration: 8000,
        })
      } else if (newStatus === 'scheduled' && !metadata?.isOptimistic) {
        toast.success('Content scheduled!', {
          description: 'Your content has been scheduled for posting',
          duration: 3000,
        })
      } else if (newStatus === 'draft' && metadata?.isRollback) {
        toast.warning('Scheduling failed', {
          description: (metadata?.error as string) || 'Content has been returned to draft status',
          duration: 5000,
        })
      }
      
      // Update content in cache
      queryClient.setQueriesData(
        { queryKey: ['content'] },
        (oldData: CacheData | ContentItem[] | undefined) => {
          if (!oldData) return oldData
          
          // Handle array of content
          if (Array.isArray(oldData)) {
            return oldData.map((item: ContentItem) =>
              item.id === contentId ? { ...item, status: newStatus } : item
            )
          }
          
          // Handle paginated response
          if ('content' in oldData && Array.isArray(oldData.content)) {
            return {
              ...oldData,
              content: oldData.content.map((item: ContentItem) =>
                item.id === contentId ? { ...item, status: newStatus } : item
              )
            }
          }
          
          return oldData
        }
      )
    }
  }, [queryKeys, queryClient, onStatusUpdate])

  // Helper function to check if JWT is expired
  const isTokenExpired = useCallback((token: string): boolean => {
    try {
      // Validate JWT format: should have 3 parts separated by dots
      if (typeof token !== 'string') {
        console.error('JWT token is not a string')
        return true
      }
      const parts = token.split('.')
      if (parts.length !== 3 || !parts[1]) {
        console.error('JWT token is not properly formatted')
        return true
      }
      // Decode JWT without verification (just to check expiry)
      const payload = JSON.parse(atob(parts[1]))
      const expiryTime = payload.exp * 1000 // Convert to milliseconds
      return Date.now() >= expiryTime
    } catch (error) {
      console.error('Failed to decode JWT:', error)
      return true // Assume expired if we can't decode
    }
  }, [])

  // Helper function to refresh token
  const refreshAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.token) {
          localStorage.setItem('auth_token', data.token)
          return data.token
        }
        console.error('Token refresh response missing token field:', data)
      } else {
        // Log detailed error information for non-2xx responses
        const errorText = await response.text()
        console.error(`Token refresh failed with status ${response.status}: ${response.statusText}`, errorText)
        
        // Handle specific error codes
        if (response.status === 401) {
          console.error('Authentication expired. User needs to log in again.')
        } else if (response.status === 403) {
          console.error('Token refresh forbidden. Invalid refresh token.')
        } else if (response.status >= 500) {
          console.error('Server error during token refresh. Will retry later.')
        }
      }
    } catch (error) {
      console.error('Network error during token refresh:', error)
    }
    return null
  }, [])

  // Exponential backoff calculation with jitter (react-use-websocket pattern)
  const calculateReconnectDelay = useCallback((attemptNumber: number) => {
    // Increase max delay to 30 seconds for JWT expiration scenarios
    const baseDelay = Math.min(Math.pow(2, attemptNumber) * 1000, 30000) // Cap at 30 seconds
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
  const connect = useCallback(async () => {
    // Guard against multiple simultaneous connections
    if (isConnectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    
    if (!token || !selectedBrand || !enabled) {
      return
    }

    // Rate limiting: prevent reconnection storms
    const now = Date.now()
    const timeSinceLastAttempt = now - lastConnectionAttemptRef.current
    
    // If we've reached max attempts and it's been less than 5 minutes, stop trying
    if (reconnectAttemptsRef.current >= maxReconnectAttempts && timeSinceLastAttempt < 5 * 60 * 1000) {
      console.log('Max reconnection attempts reached. Waiting before retry...')
      return
    }
    
    // Reset attempts counter if it's been more than 5 minutes since last attempt
    if (timeSinceLastAttempt > 5 * 60 * 1000) {
      reconnectAttemptsRef.current = 0
      tokenRefreshAttemptedRef.current = false
    }
    
    lastConnectionAttemptRef.current = now
    
    // Check if token is expired and attempt refresh
    let currentToken = token
    if (isTokenExpired(token)) {
      console.log('JWT token expired, attempting refresh...')
      
      // Only attempt token refresh once per connection cycle
      if (!tokenRefreshAttemptedRef.current) {
        tokenRefreshAttemptedRef.current = true
        const newToken = await refreshAuthToken()
        
        if (newToken) {
          console.log('Token refreshed successfully')
          currentToken = newToken
          // Reset attempts since we have a fresh token
          reconnectAttemptsRef.current = 0
        } else {
          console.error('Failed to refresh token. User may need to re-authenticate.')
          handleConnectionChange('error')
          // Don't attempt further connections without valid token
          isConnectingRef.current = false
          return
        }
      } else {
        console.log('Token refresh already attempted, skipping...')
        isConnectingRef.current = false
        return
      }
    }

    isConnectingRef.current = true

    try {
      // Clean up existing connection
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close()
        wsRef.current = null
      }

      handleConnectionChange('connecting')

      // Fetch WebSocket configuration from backend
      let wsUrl = ''
      try {
        const response = await fetch('/api/config/websocket', {
          headers: {
            'Authorization': `Bearer ${currentToken}`
          }
        })
        
        if (response.ok) {
          const config = await response.json()
          if (!config.useRelative && config.wsUrl) {
            wsUrl = config.wsUrl
          }
        }
      } catch (error) {
        console.warn('Failed to fetch WebSocket config, using default:', error)
      }
      
      // Use configured URL or fall back to relative path
      if (!wsUrl) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        wsUrl = `${protocol}//${window.location.host}/ws`
      }
      
      console.log('Connecting to WebSocket at:', wsUrl)
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('WebSocket connected')
        isConnectingRef.current = false // Reset connecting flag
        handleConnectionChange('connected')
        reconnectAttemptsRef.current = 0
        tokenRefreshAttemptedRef.current = false // Reset token refresh flag on successful connection
        setRetryIn(0) // Clear retry countdown
        
        // Clear countdown interval if exists
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = undefined
        }

        // Authenticate and subscribe to brand room (use currentToken which may be refreshed)
        ws.send(JSON.stringify({
          type: 'auth',
          token: currentToken,
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
        isConnectingRef.current = false // Reset connecting flag on error
        handleWebSocketError(error)
      }

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason)
        isConnectingRef.current = false // Reset connecting flag on close
        handleConnectionChange('disconnected')
        wsRef.current = null

        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
          heartbeatIntervalRef.current = undefined
        }
        
        // Clear any existing countdown
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = undefined
        }

        // Attempt reconnection if enabled and not at max attempts
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = calculateReconnectDelay(reconnectAttemptsRef.current)
          reconnectAttemptsRef.current++
          
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`)
          
          // Set retry countdown
          setRetryIn(delay)
          
          // Clear any existing countdown interval
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current)
          }
          
          // Countdown timer
          countdownIntervalRef.current = setInterval(() => {
            setRetryIn(prev => {
              if (prev <= 100) {
                if (countdownIntervalRef.current) {
                  clearInterval(countdownIntervalRef.current)
                  countdownIntervalRef.current = undefined
                }
                return 0
              }
              return prev - 100
            })
          }, 100)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current)
              countdownIntervalRef.current = undefined
            }
            setRetryIn(0)
            connect()
          }, delay)
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.log(`Max reconnection attempts (${maxReconnectAttempts}) reached. Will retry in 5 minutes.`)
          
          // Set a longer timeout (5 minutes) before allowing reconnection attempts again
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current = 0
            tokenRefreshAttemptedRef.current = false
            if (enabled && token && selectedBrand) {
              console.log('Retrying connection after cooldown period...')
              connect()
            }
          }, 5 * 60 * 1000) // 5 minutes
          
          const maxAttemptsError = new ConnectionError(`Max reconnection attempts (${maxReconnectAttempts}) reached. Will retry in 5 minutes.`)
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
  }, [token, selectedBrand, enabled, handleStatusUpdate, calculateReconnectDelay, maxReconnectAttempts, heartbeatInterval, handleConnectionChange, handleWebSocketError, messageFilter, offlineQueue, isTokenExpired, refreshAuthToken])

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isConnectingRef.current = false // Reset connecting flag
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }
    
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = undefined
    }
    
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = undefined
    }
    
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    setConnectionStatus('disconnected')
    setRetryIn(0)
  }, [])

  // Effect to manage connection lifecycle - only reconnect on actual brand changes
  useEffect(() => {
    const brandChanged = previousBrandRef.current !== undefined && 
                        previousBrandRef.current !== selectedBrand?.id
    
    // Only connect/disconnect on initial mount or actual brand change
    if (enabled && token && selectedBrand) {
      // If brand actually changed, disconnect and reconnect
      if (brandChanged && wsRef.current) {
        console.log('Brand changed, reconnecting WebSocket...')
        disconnect()
        setTimeout(() => connect(), 100)
      } else if (!wsRef.current) {
        // Initial connection
        connect()
      }
      previousBrandRef.current = selectedBrand.id
    } else if (!enabled || !token || !selectedBrand) {
      disconnect()
      previousBrandRef.current = undefined
    }

    // Cleanup function - only runs on unmount
    return () => {
      // Don't disconnect on every re-render, only on actual unmount
      if (!enabled) {
        isConnectingRef.current = false
        
        // Clear all timeouts and intervals
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = undefined
        }
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current)
          heartbeatIntervalRef.current = undefined
        }
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = undefined
        }
        // Close WebSocket connection
        if (wsRef.current) {
          wsRef.current.close()
          wsRef.current = null
        }
        setConnectionStatus('disconnected')
        setRetryIn(0)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, selectedBrand?.id]) // Intentionally omit connect/disconnect to prevent loops

  // Manual reconnect function (stable reference using react-use-websocket pattern)
  const reconnect = useCallback(() => {
    // Prevent race conditions by clearing any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = undefined
    }
    
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = undefined
    }
    
    // Reset state
    isConnectingRef.current = false
    reconnectAttemptsRef.current = 0
    tokenRefreshAttemptedRef.current = false // Reset token refresh flag
    setRetryIn(0)
    
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    
    // Clear intervals
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = undefined
    }
    
    setConnectionStatus('disconnected')
    
    // Reconnect after a short delay to ensure clean state
    setTimeout(() => {
      if (enabled && token && selectedBrand) {
        connect()
      }
    }, 100)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, selectedBrand?.id]) // Stable deps only

  // Helper function to queue action when offline
  const queueAction = useCallback((type: 'schedule' | 'reschedule' | 'cancel', payload: Record<string, unknown>) => {
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