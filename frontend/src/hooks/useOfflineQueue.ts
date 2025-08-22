import { useRef, useCallback, useEffect, useMemo } from 'react'

export interface QueuedAction {
  id: string
  type: 'schedule' | 'reschedule' | 'cancel'
  payload: any
  timestamp: number
  retries: number
  maxRetries?: number // Allow per-action max retries
}

interface UseOfflineQueueOptions {
  maxRetries?: number
  retryDelay?: number
  onProcess?: (action: QueuedAction) => Promise<boolean>
  onError?: (action: QueuedAction, error: Error) => void
}

export function useOfflineQueue({
  maxRetries = 3,
  retryDelay = 1000,
  onProcess,
  onError
}: UseOfflineQueueOptions = {}) {
  const queueRef = useRef<QueuedAction[]>([])
  const processingRef = useRef(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Mount effect using react-use pattern for initial load
  useEffect(() => {
    const loadQueue = () => {
      const savedQueue = localStorage.getItem('offlineQueue')
      if (savedQueue) {
        try {
          const parsed = JSON.parse(savedQueue)
          // Validate queue structure
          if (Array.isArray(parsed)) {
            queueRef.current = parsed.filter(action => 
              action && typeof action === 'object' && action.id && action.type
            )
          }
        } catch (error) {
          console.error('Failed to load offline queue:', error)
          // Clear corrupted data
          localStorage.removeItem('offlineQueue')
        }
      }
    }
    
    loadQueue()
  }, [])

  // Save queue to localStorage with error handling
  const saveQueue = useCallback(() => {
    try {
      // Check localStorage availability (react-use pattern)
      if (typeof Storage !== 'undefined') {
        localStorage.setItem('offlineQueue', JSON.stringify(queueRef.current))
      }
    } catch (error) {
      console.error('Failed to save offline queue:', error instanceof Error ? error.message : error)
      // Handle quota exceeded or other localStorage errors
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded, clearing old queue data')
        try {
          localStorage.removeItem('offlineQueue')
        } catch (clearError) {
          console.error('Failed to clear corrupted queue:', clearError instanceof Error ? clearError.message : clearError)
        }
      }
    }
  }, [])

  // Add action to queue with crypto.randomUUID for unique IDs
  const enqueue = useCallback((type: QueuedAction['type'], payload: any, actionMaxRetries?: number) => {
    const action: QueuedAction = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Fallback for older browsers
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: actionMaxRetries
    }
    
    queueRef.current.push(action)
    saveQueue()
    
    console.log('Action queued for offline processing:', action)
    
    return action.id
  }, [saveQueue])

  // Remove action from queue
  const dequeue = useCallback((actionId: string) => {
    queueRef.current = queueRef.current.filter(a => a.id !== actionId)
    saveQueue()
  }, [saveQueue])

  // Process a single action with enhanced error handling
  const processAction = useCallback(async (action: QueuedAction): Promise<boolean> => {
    if (!onProcess) {
      console.warn('No onProcess handler provided for offline queue')
      return false
    }

    // Use action-specific max retries or default
    const actionMaxRetries = action.maxRetries ?? maxRetries

    try {
      const success = await onProcess(action)
      
      if (success) {
        dequeue(action.id)
        return true
      }
      
      // If not successful but no error thrown, retry
      action.retries++
      
      if (action.retries >= actionMaxRetries) {
        console.error(`Max retries reached for action ${action.id}`)
        onError?.(action, new Error('Max retries exceeded'))
        dequeue(action.id)
        return false
      }
      
      saveQueue()
      return false
    } catch (error) {
      console.error(`Error processing action ${action.id}:`, error)
      
      action.retries++
      
      if (action.retries >= actionMaxRetries) {
        onError?.(action, error as Error)
        dequeue(action.id)
        return false
      }
      
      saveQueue()
      return false
    }
  }, [onProcess, onError, dequeue, saveQueue, maxRetries])

  // Process all queued actions
  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) {
      return
    }

    processingRef.current = true
    console.log(`Processing ${queueRef.current.length} queued actions`)

    try {
      // Process actions in order
      for (const action of [...queueRef.current]) {
        const success = await processAction(action)
        
        const actionMaxRetries = action.maxRetries ?? maxRetries
        if (!success && action.retries < actionMaxRetries) {
          // Schedule retry with exponential backoff + jitter (react-use-websocket pattern)
          const baseDelay = retryDelay * Math.pow(2, action.retries - 1)
          const jitter = Math.random() * 0.3 * baseDelay // Add 30% jitter
          const delay = Math.min(baseDelay + jitter, 30000) // Cap at 30 seconds
          
          console.log(`Retrying action ${action.id} in ${Math.round(delay)}ms (attempt ${action.retries + 1}/${actionMaxRetries})`)
          
          retryTimeoutRef.current = setTimeout(() => {
            processQueue()
          }, delay)
          
          break // Stop processing and wait for retry
        }
      }
    } catch (error) {
      console.error('Error during queue processing:', error)
    } finally {
      processingRef.current = false
    }
  }, [processAction, maxRetries, retryDelay])

  // Clear the queue
  const clearQueue = useCallback(() => {
    queueRef.current = []
    saveQueue()
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
  }, [saveQueue])

  // Get queue size
  const getQueueSize = useCallback(() => {
    return queueRef.current.length
  }, [])

  // Get all queued actions
  const getQueue = useCallback(() => {
    return [...queueRef.current]
  }, [])

  // Clean up on unmount using react-use pattern
  useEffect(() => {
    return () => {
      // Clear all timeouts and save final state
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
      // Save queue one final time before unmount
      try {
        if (typeof Storage !== 'undefined' && queueRef.current.length > 0) {
          localStorage.setItem('offlineQueue', JSON.stringify(queueRef.current))
        }
      } catch (error) {
        console.error('Failed to save queue on unmount:', error)
      }
    }
  }, [])

  // Memoize return object to prevent unnecessary re-renders (react-use pattern)
  return useMemo(() => ({
    enqueue,
    dequeue,
    processQueue,
    clearQueue,
    getQueueSize,
    getQueue,
    // Add status indicators
    isProcessing: () => processingRef.current,
    hasRetryScheduled: () => !!retryTimeoutRef.current
  }), [enqueue, dequeue, processQueue, clearQueue, getQueueSize, getQueue])
}